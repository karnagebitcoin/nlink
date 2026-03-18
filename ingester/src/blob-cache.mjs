import { getStore } from "@netlify/blobs";
import { config } from "./config.mjs";
import { createProfileSearchEntry, getProfileSearchShards } from "./profile-search.mjs";

const BLOB_STORE_NAME = "nostr-cache-v1";
const EVENT_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const PROFILE_CACHE_TTL_MS = 1000 * 60 * 30;
const NOTE_LIST_CACHE_TTL_MS = 1000 * 60 * 5;
const PROFILE_SEARCH_META_KEY = "meta:profile-search-shards";
const PROFILE_SEARCH_SHARD_PREFIX = "search:profiles:";
const PROFILE_SEARCH_SHARD_MAX_ENTRIES = 20000;

let store;

function createEnvelope(value, ttlMs) {
  return {
    expiresAt: ttlMs > 0 ? Date.now() + ttlMs : null,
    value,
  };
}

function getBlobStore() {
  if (!config.netlifyAuthToken || !config.netlifySiteId) {
    return null;
  }

  if (!store) {
    store = getStore({
      name: BLOB_STORE_NAME,
      siteID: config.netlifySiteId,
      token: config.netlifyAuthToken,
    });
  }

  return store;
}

export function isBlobMirrorEnabled() {
  return Boolean(getBlobStore());
}

export async function mirrorEventToBlobs(event) {
  const blobStore = getBlobStore();
  if (!blobStore) {
    return;
  }

  await blobStore.setJSON(`event:${event.id}`, createEnvelope(event, EVENT_CACHE_TTL_MS));
}

export async function deleteEventFromBlobs(eventId) {
  const blobStore = getBlobStore();
  if (!blobStore) {
    return;
  }

  await blobStore.delete(`event:${eventId}`);
}

export async function mirrorProfileToBlobs(pubkey, profile) {
  const blobStore = getBlobStore();
  if (!blobStore) {
    return;
  }

  await blobStore.setJSON(`profile:${pubkey}`, createEnvelope(profile, PROFILE_CACHE_TTL_MS));
}

function getSearchShardBlobKey(shard) {
  return `${PROFILE_SEARCH_SHARD_PREFIX}${shard}`;
}

export async function rebuildProfileSearchIndex(profiles) {
  const blobStore = getBlobStore();
  if (!blobStore) {
    return;
  }

  const nextShards = new Map();
  for (const profile of profiles) {
    const entry = createProfileSearchEntry(profile.pubkey, profile.metadata ?? {});
    if (!entry.searchText) {
      continue;
    }

    for (const shard of getProfileSearchShards(entry)) {
      const shardEntries = nextShards.get(shard) ?? [];
      shardEntries.push(entry);
      nextShards.set(shard, shardEntries);
    }
  }

  const previousShards = (await blobStore.get(PROFILE_SEARCH_META_KEY, { type: "json" })) ?? [];
  const nextShardKeys = Array.from(nextShards.keys());

  for (const shard of previousShards) {
    if (!nextShards.has(shard)) {
      await blobStore.delete(getSearchShardBlobKey(shard));
    }
  }

  for (const [shard, shardEntries] of nextShards.entries()) {
    const deduped = [];
    const seen = new Set();

    for (const entry of shardEntries) {
      if (seen.has(entry.pubkey)) {
        continue;
      }

      seen.add(entry.pubkey);
      deduped.push(entry);
    }

    await blobStore.setJSON(getSearchShardBlobKey(shard), deduped.slice(0, PROFILE_SEARCH_SHARD_MAX_ENTRIES));
  }

  await blobStore.setJSON(PROFILE_SEARCH_META_KEY, nextShardKeys);
}

export async function upsertProfileSearchEntry(pubkey, profile) {
  const blobStore = getBlobStore();
  if (!blobStore) {
    return;
  }

  const entry = createProfileSearchEntry(pubkey, profile);
  if (!entry.searchText) {
    return;
  }

  const shardList = new Set((await blobStore.get(PROFILE_SEARCH_META_KEY, { type: "json" })) ?? []);

  for (const shard of getProfileSearchShards(entry)) {
    const key = getSearchShardBlobKey(shard);
    const currentEntries = (await blobStore.get(key, { type: "json" })) ?? [];
    const nextEntries = [entry, ...currentEntries.filter((item) => item.pubkey !== pubkey)];

    await blobStore.setJSON(key, nextEntries.slice(0, PROFILE_SEARCH_SHARD_MAX_ENTRIES));
    shardList.add(shard);
  }

  await blobStore.setJSON(PROFILE_SEARCH_META_KEY, Array.from(shardList));
}

export async function mirrorRecentNotesToBlobs(pubkey, snapshot, limit) {
  const blobStore = getBlobStore();
  if (!blobStore) {
    return;
  }

  await blobStore.setJSON(`notes:${pubkey}:${limit}`, createEnvelope(snapshot, NOTE_LIST_CACHE_TTL_MS));
}

export async function mirrorStatsToBlobs(stats) {
  const blobStore = getBlobStore();
  if (!blobStore) {
    return;
  }

  await blobStore.setJSON("meta:stats", {
    noteCount: stats.noteCount,
    profileCount: stats.profileCount,
    relayUrl: stats.relayUrl,
    source: "lmdb-ingester",
    startedAt: stats.startedAt,
    totalCount: stats.totalCount ?? stats.noteCount + stats.profileCount,
    updatedAt: stats.updatedAt,
  });
}
