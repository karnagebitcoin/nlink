import { Relay } from "nostr-tools";
import {
  getRecentNotesSnapshot,
  getProfileByPubkey,
  getStats,
  listAllProfiles,
  pruneNotesOlderThan,
  getState,
  saveNoteEvent,
  saveProfileEvent,
  setState,
} from "./db.mjs";
import {
  deleteEventFromBlobs,
  isBlobMirrorEnabled,
  mirrorEventToBlobs,
  mirrorProfileToBlobs,
  mirrorRecentNotesToBlobs,
  mirrorStatsToBlobs,
  rebuildProfileSearchIndex,
  upsertProfileSearchEntry,
} from "./blob-cache.mjs";
import { config } from "./config.mjs";

function parseProfile(content) {
  try {
    const parsed = JSON.parse(content);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function createSubscriptionId(prefix, value) {
  return `${prefix}:${String(value).slice(0, 12)}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class NostrIngester {
  #backfillCursor = Number(getState("backfill_cursor") ?? Math.floor(Date.now() / 1000));
  #backfillLoopPromise = null;
  #blobMirrorQueue = Promise.resolve();
  #pendingProfiles = new Set();
  #pruneInFlight = false;
  #pruneInterval = null;
  #reconnectTimeout = null;
  #relay = null;
  #running = false;
  #noteCursor = Number(getState("notes_cursor") ?? Math.floor(Date.now() / 1000));

  async start() {
    this.#running = true;
    await this.#pruneExpiredNotes();
    this.#schedulePrune();
    await this.#syncProfileSearchIndexToBlobs();
    await this.#syncStatsToBlobs();
    await this.#connect();
  }

  async stop() {
    this.#running = false;

    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = null;
    }

    if (this.#pruneInterval) {
      clearInterval(this.#pruneInterval);
      this.#pruneInterval = null;
    }

    this.#relay?.close();
    this.#relay = null;
  }

  #getRetentionCutoff() {
    return Math.floor(Date.now() / 1000) - (config.maxEventAgeDays * 24 * 60 * 60);
  }

  async #connect() {
    if (!this.#running) {
      return;
    }

    try {
      console.log(`[ingester] connecting to ${config.relayUrl}`);
      const relay = await Relay.connect(config.relayUrl, {
        timeout: 10_000,
      });

      relay.onclose = () => {
        console.warn("[ingester] relay connection closed");
        this.#relay = null;
        this.#scheduleReconnect();
      };

      this.#relay = relay;
      console.log("[ingester] relay connected");
      this.#subscribeToLiveNotes();
      this.#startBackfillLoop();
    } catch (error) {
      console.error("[ingester] failed to connect to relay", error);
      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect() {
    if (!this.#running || this.#reconnectTimeout) {
      return;
    }

    this.#reconnectTimeout = setTimeout(() => {
      this.#reconnectTimeout = null;
      void this.#connect();
    }, config.reconnectDelayMs);
  }

  #schedulePrune() {
    if (this.#pruneInterval || config.pruneIntervalMs <= 0) {
      return;
    }

    this.#pruneInterval = setInterval(() => {
      void this.#pruneExpiredNotes();
    }, config.pruneIntervalMs);

    this.#pruneInterval.unref?.();
  }

  #subscribeToLiveNotes() {
    if (!this.#relay) {
      return;
    }

    const since = Math.max(0, this.#noteCursor - config.cursorOverlapSeconds);
    console.log(`[ingester] subscribing to kind 1 notes since ${since}`);

    this.#relay.subscribe(
      [{ kinds: [1], since }],
      {
        eoseTimeout: 4_000,
        id: "live-notes",
        oneose: () => {
          console.log("[ingester] caught up to the live note stream");
        },
        onevent: (event) => {
          void this.#handleNoteEvent(event);
        },
        onclose: (reason) => {
          console.warn(`[ingester] live note subscription closed: ${reason}`);
        },
      },
    );
  }

  async #handleNoteEvent(event, { mode = "live" } = {}) {
    if (event.kind !== 1 || event.created_at < this.#getRetentionCutoff()) {
      return false;
    }

    const inserted = await saveNoteEvent(event, config.relayUrl);

    if (mode === "live" && event.created_at > this.#noteCursor) {
      this.#noteCursor = event.created_at;
      await setState("notes_cursor", this.#noteCursor);
    }

    if (!inserted) {
      return false;
    }

    if (mode === "live") {
      console.log(`[ingester] saved note ${event.id} from ${event.pubkey}`);
      this.#queueBlobMirror(async () => {
        await mirrorEventToBlobs(event);
        await mirrorRecentNotesToBlobs(event.pubkey, getRecentNotesSnapshot(event.pubkey, 10), 10);
        await mirrorStatsToBlobs(getStats());
      });
      void this.#ensureProfile(event.pubkey);
    }

    return true;
  }

  #startBackfillLoop() {
    if (!config.backfillEnabled || this.#backfillLoopPromise || !this.#relay) {
      return;
    }

    this.#backfillLoopPromise = this.#runBackfillLoop()
      .catch((error) => {
        console.error("[ingester] backfill loop failed", error);
      })
      .finally(() => {
        this.#backfillLoopPromise = null;
      });
  }

  async #runBackfillLoop() {
    while (this.#running && this.#relay) {
      const cutoff = this.#getRetentionCutoff();

      if (this.#backfillCursor <= cutoff) {
        await setState("backfill_cursor", cutoff);
        console.log(`[ingester] backfill reached the ${config.maxEventAgeDays}-day retention boundary`);
        return;
      }

      const batch = await this.#fetchHistoricalNoteBatch({
        limit: config.backfillBatchSize,
        since: cutoff,
        until: this.#backfillCursor,
      });

      if (!this.#running || !this.#relay) {
        return;
      }

      if (batch.length === 0) {
        this.#backfillCursor = cutoff;
        await setState("backfill_cursor", this.#backfillCursor);
        console.log("[ingester] backfill exhausted the available retention window");
        return;
      }

      const sorted = [...batch].sort((left, right) => right.created_at - left.created_at);
      const affectedAuthors = new Set();
      let insertedCount = 0;

      for (const event of sorted) {
        const inserted = await this.#handleNoteEvent(event, { mode: "backfill" });
        if (inserted) {
          insertedCount += 1;
          affectedAuthors.add(event.pubkey);
        }
      }

      const oldestCreatedAt = sorted.reduce(
        (oldest, event) => Math.min(oldest, event.created_at),
        sorted[0].created_at,
      );

      this.#backfillCursor = Math.max(cutoff, oldestCreatedAt - 1);
      await setState("backfill_cursor", this.#backfillCursor);

      if (insertedCount > 0) {
        const authors = Array.from(affectedAuthors);
        console.log(
          `[ingester] backfilled ${insertedCount} notes; oldest=${oldestCreatedAt}; cursor=${this.#backfillCursor}`,
        );

        for (const pubkey of authors.slice(0, 20)) {
          void this.#ensureProfile(pubkey);
        }

        this.#queueBlobMirror(async () => {
          for (const pubkey of authors.slice(0, 10)) {
            await mirrorRecentNotesToBlobs(pubkey, getRecentNotesSnapshot(pubkey, 10), 10);
          }

          await mirrorStatsToBlobs(getStats());
        });
      } else {
        console.log(`[ingester] scanned ${sorted.length} historical notes; cursor=${this.#backfillCursor}`);
      }

      if (batch.length < config.backfillBatchSize) {
        this.#backfillCursor = cutoff;
        await setState("backfill_cursor", this.#backfillCursor);
        console.log("[ingester] backfill caught up to the oldest available notes in-range");
        return;
      }

      await sleep(config.backfillDelayMs);
    }
  }

  async #fetchHistoricalNoteBatch({ limit, since, until }) {
    if (!this.#relay) {
      return [];
    }

    const events = [];
    let subscription;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort("backfill-timeout");
    }, config.backfillEoseTimeoutMs);

    try {
      return await new Promise((resolve) => {
        let settled = false;

        const finish = () => {
          if (settled) {
            return;
          }

          settled = true;
          subscription?.close();
          resolve(events);
        };

        subscription = this.#relay.subscribe(
          [{ kinds: [1], limit, since, until }],
          {
            abort: abortController.signal,
            eoseTimeout: config.backfillEoseTimeoutMs,
            id: createSubscriptionId("backfill", until),
            oneose: finish,
            onevent: (event) => {
              events.push(event);
            },
            onclose: finish,
          },
        );
      });
    } catch (error) {
      console.error("[ingester] failed to fetch a historical note batch", error);
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async #ensureProfile(pubkey) {
    const normalizedPubkey = pubkey.trim().toLowerCase();
    if (this.#pendingProfiles.has(normalizedPubkey) || getProfileByPubkey(normalizedPubkey)) {
      return;
    }

    if (!this.#relay) {
      return;
    }

    this.#pendingProfiles.add(normalizedPubkey);

    let subscription;
    let latestEvent = null;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort("profile-timeout");
    }, config.profileFetchTimeoutMs);

    try {
      await new Promise((resolve) => {
        subscription = this.#relay.subscribe(
          [{ authors: [normalizedPubkey], kinds: [0], limit: 1 }],
          {
            abort: abortController.signal,
            eoseTimeout: config.profileFetchTimeoutMs,
            id: createSubscriptionId("profile", normalizedPubkey),
            oneose: () => {
              subscription?.close();
              resolve();
            },
            onevent: (event) => {
              if (!latestEvent || latestEvent.created_at < event.created_at) {
                latestEvent = event;
              }
            },
            onclose: () => {
              resolve();
            },
          },
        );
      });
    } finally {
      clearTimeout(timeoutId);
      this.#pendingProfiles.delete(normalizedPubkey);
    }

    if (latestEvent) {
      const metadata = parseProfile(latestEvent.content);
      await saveProfileEvent(
        latestEvent,
        metadata,
        config.relayUrl,
      );
      console.log(`[ingester] saved profile metadata for ${normalizedPubkey}`);
      this.#queueBlobMirror(async () => {
        await mirrorProfileToBlobs(normalizedPubkey, metadata);
        await upsertProfileSearchEntry(normalizedPubkey, metadata);
        await mirrorStatsToBlobs(getStats());
      });
    }
  }

  async #pruneExpiredNotes() {
    if (this.#pruneInFlight) {
      return;
    }

    this.#pruneInFlight = true;

    try {
      const { affectedAuthors, removedCount, removedEvents } = pruneNotesOlderThan(this.#getRetentionCutoff());
      if (removedCount === 0) {
        return;
      }

      console.log(`[ingester] pruned ${removedCount} notes older than ${config.maxEventAgeDays} days`);

      this.#queueBlobMirror(async () => {
        for (const event of removedEvents) {
          await deleteEventFromBlobs(event.id);
        }

        for (const pubkey of affectedAuthors.slice(0, 100)) {
          await mirrorRecentNotesToBlobs(pubkey, getRecentNotesSnapshot(pubkey, 10), 10);
        }

        await mirrorStatsToBlobs(getStats());
      });
    } finally {
      this.#pruneInFlight = false;
    }
  }

  #queueBlobMirror(operation) {
    if (!isBlobMirrorEnabled()) {
      return;
    }

    this.#blobMirrorQueue = this.#blobMirrorQueue
      .catch(() => {
        // Keep the queue alive after a failed mirror attempt.
      })
      .then(operation)
      .catch((error) => {
        console.error("[ingester] failed to mirror cache to Netlify Blobs", error);
      });
  }

  async #syncStatsToBlobs() {
    if (!isBlobMirrorEnabled()) {
      return;
    }

    try {
      await mirrorStatsToBlobs(getStats());
      console.log("[ingester] mirrored stats to Netlify Blobs");
    } catch (error) {
      console.error("[ingester] failed to mirror initial stats to Netlify Blobs", error);
    }
  }

  async #syncProfileSearchIndexToBlobs() {
    if (!isBlobMirrorEnabled()) {
      return;
    }

    try {
      await rebuildProfileSearchIndex(listAllProfiles());
      console.log("[ingester] mirrored profile search index to Netlify Blobs");
    } catch (error) {
      console.error("[ingester] failed to mirror profile search index", error);
    }
  }
}
