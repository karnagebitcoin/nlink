"use client";

import { useEffect, useMemo, useState } from "react";
import { useNostr } from "@/lib/nostr/context";
import {
  getReactionTargetEventId,
  getReplyTargetIds,
  isReplyNoteEvent,
  type NostrEvent,
} from "@/lib/nostr/utils";

export interface NoteEngagementStats {
  commentCount: number;
  reactionCount: number;
}

type NoteStatsMap = Record<string, NoteEngagementStats>;

const STATS_TTL_MS = 1000 * 60 * 2;
const EMPTY_STATS: NoteEngagementStats = {
  commentCount: 0,
  reactionCount: 0,
};

const noteStatsCache = new Map<
  string,
  {
    fetchedAt: number;
    stats: NoteEngagementStats;
  }
>();

const inflightBatches = new Map<string, Promise<NoteStatsMap>>();

function uniqueNoteIds(noteIds: string[]): string[] {
  return Array.from(new Set(noteIds.filter(Boolean)));
}

function areStatsEqual(a: NoteEngagementStats | undefined, b: NoteEngagementStats | undefined): boolean {
  return (a?.commentCount ?? 0) === (b?.commentCount ?? 0) &&
    (a?.reactionCount ?? 0) === (b?.reactionCount ?? 0);
}

function buildBatchKey(noteIds: string[]): string {
  return [...noteIds].sort().join("|");
}

function getCachedStats(noteIds: string[]): NoteStatsMap {
  const next: NoteStatsMap = {};

  noteIds.forEach((noteId) => {
    const cached = noteStatsCache.get(noteId);
    if (cached) {
      next[noteId] = cached.stats;
    }
  });

  return next;
}

function upsertStatsCache(statsMap: NoteStatsMap): void {
  const now = Date.now();

  Object.entries(statsMap).forEach(([noteId, stats]) => {
    noteStatsCache.set(noteId, {
      fetchedAt: now,
      stats,
    });
  });
}

function mergeStats(base: NoteStatsMap, next: NoteStatsMap): NoteStatsMap {
  return {
    ...base,
    ...next,
  };
}

function isFresh(noteId: string): boolean {
  const cached = noteStatsCache.get(noteId);
  if (!cached) {
    return false;
  }

  return Date.now() - cached.fetchedAt < STATS_TTL_MS;
}

function createBlankStats(noteIds: string[]): NoteStatsMap {
  return Object.fromEntries(noteIds.map((noteId) => [noteId, { ...EMPTY_STATS }]));
}

function countEventsByTarget(noteIds: string[], events: NostrEvent[]): NoteStatsMap {
  const noteIdSet = new Set(noteIds);
  const next = createBlankStats(noteIds);
  const reactionIdsByTarget = new Map<string, Set<string>>();
  const replyIdsByTarget = new Map<string, Set<string>>();

  const track = (
    collection: Map<string, Set<string>>,
    noteId: string,
    eventId: string,
    increment: (stats: NoteEngagementStats) => void
  ) => {
    if (!noteIdSet.has(noteId)) {
      return;
    }

    let seenIds = collection.get(noteId);
    if (!seenIds) {
      seenIds = new Set<string>();
      collection.set(noteId, seenIds);
    }

    if (seenIds.has(eventId)) {
      return;
    }

    seenIds.add(eventId);
    increment(next[noteId]);
  };

  events.forEach((event) => {
    if (event.kind === 7) {
      const targetId = getReactionTargetEventId(event);
      if (!targetId) {
        return;
      }

      track(reactionIdsByTarget, targetId, event.id, (stats) => {
        stats.reactionCount += 1;
      });
      return;
    }

    if (!isReplyNoteEvent(event)) {
      return;
    }

    getReplyTargetIds(event).forEach((targetId) => {
      track(replyIdsByTarget, targetId, event.id, (stats) => {
        stats.commentCount += 1;
      });
    });
  });

  return next;
}

async function fetchBatch(
  noteIds: string[],
  query: (filters: Record<string, unknown>[], relayUrls?: string[]) => Promise<NostrEvent[]>
): Promise<NoteStatsMap> {
  if (noteIds.length === 0) {
    return {};
  }

  const batchKey = buildBatchKey(noteIds);
  const inflight = inflightBatches.get(batchKey);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    const interactionLimit = Math.min(3000, Math.max(600, noteIds.length * 80));
    const events = await query([
      { "#e": noteIds, kinds: [7], limit: interactionLimit },
      { "#e": noteIds, kinds: [1], limit: interactionLimit },
    ]);

    const next = countEventsByTarget(noteIds, events);
    upsertStatsCache(next);
    return next;
  })().finally(() => {
    inflightBatches.delete(batchKey);
  });

  inflightBatches.set(batchKey, promise);
  return promise;
}

export function useNoteStats(noteIds: string[]): NoteStatsMap {
  const { query } = useNostr();
  const noteIdsKey = useMemo(() => noteIds.filter(Boolean).join("|"), [noteIds]);
  const ids = useMemo(() => uniqueNoteIds(noteIds), [noteIdsKey]);
  const idsKey = useMemo(() => ids.join("|"), [ids]);
  const [statsMap, setStatsMap] = useState<NoteStatsMap>(() => getCachedStats(ids));

  useEffect(() => {
    const cachedStats = getCachedStats(ids);

    setStatsMap((prev) => {
      let changed = false;
      const next = { ...prev };

      ids.forEach((noteId) => {
        const cached = cachedStats[noteId];
        if (cached && !areStatsEqual(prev[noteId], cached)) {
          next[noteId] = cached;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [idsKey]);

  useEffect(() => {
    if (ids.length === 0) {
      return;
    }

    const staleIds = ids.filter((noteId) => !isFresh(noteId));
    if (staleIds.length === 0) {
      return;
    }

    let cancelled = false;

    void fetchBatch(staleIds, query)
      .then((next) => {
        if (cancelled) {
          return;
        }

        setStatsMap((prev) => mergeStats(prev, next));
      })
      .catch((error) => {
        console.error("Failed to fetch note stats:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [idsKey, ids, query]);

  return useMemo(() => {
    const next: NoteStatsMap = {};

    ids.forEach((noteId) => {
      next[noteId] = statsMap[noteId] ?? noteStatsCache.get(noteId)?.stats ?? EMPTY_STATS;
    });

    return next;
  }, [ids, statsMap]);
}
