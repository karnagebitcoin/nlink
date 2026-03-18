import { getStore } from "@netlify/blobs";
import { getIngesterStats, isIngesterConfigured } from "@/lib/nostr/ingester";

const NOSTR_CACHE_STORE_NAME = "nostr-cache-v1";
const STATS_CACHE_TTL_MS = 5_000;

export interface NostrCacheStats {
  available: boolean;
  error: string | null;
  eventCount: number;
  fetchedAt: string;
  noteListCount: number;
  profileCount: number;
  relayUrl?: string | null;
  source: "lmdb-ingester" | "netlify-blobs" | "unavailable";
  totalCount: number;
}

interface BlobCounterStats {
  noteCount: number;
  profileCount: number;
  relayUrl?: string | null;
  source?: string;
  startedAt?: string;
  totalCount?: number;
  updatedAt: string;
}

const globalState = globalThis as typeof globalThis & {
  __nlinkStatsCache?: {
    expiresAt: number;
    value: NostrCacheStats;
  };
  __nlinkStatsPromise?: Promise<NostrCacheStats>;
};

function createUnavailableStats(error: string | null = null): NostrCacheStats {
  return {
    available: false,
    error,
    eventCount: 0,
    fetchedAt: new Date().toISOString(),
    noteListCount: 0,
    profileCount: 0,
    source: "unavailable",
    totalCount: 0,
  };
}

export async function getNostrCacheStats(): Promise<NostrCacheStats> {
  const cached = globalState.__nlinkStatsCache;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (globalState.__nlinkStatsPromise) {
    return globalState.__nlinkStatsPromise;
  }

  const statsPromise = (async () => {
    if (isIngesterConfigured()) {
      const ingesterStats = await getIngesterStats();

      if (ingesterStats) {
        const stats: NostrCacheStats = {
          available: true,
          error: null,
          eventCount: ingesterStats.noteCount,
          fetchedAt: ingesterStats.updatedAt,
          noteListCount: 0,
          profileCount: ingesterStats.profileCount,
          relayUrl: ingesterStats.relayUrl ?? null,
          source: "lmdb-ingester",
          totalCount: ingesterStats.totalCount ?? ingesterStats.noteCount + ingesterStats.profileCount,
        };

        globalState.__nlinkStatsCache = {
          expiresAt: Date.now() + STATS_CACHE_TTL_MS,
          value: stats,
        };

        return stats;
      }
    }

    try {
      const store = getStore({
        consistency: "strong",
        name: NOSTR_CACHE_STORE_NAME,
      });

      const blobCounterStats = await store.get("meta:stats", { type: "json" }) as BlobCounterStats | null;
      if (blobCounterStats) {
        const stats: NostrCacheStats = {
          available: true,
          error: null,
          eventCount: blobCounterStats.noteCount,
          fetchedAt: blobCounterStats.updatedAt,
          noteListCount: 0,
          profileCount: blobCounterStats.profileCount,
          relayUrl: blobCounterStats.relayUrl ?? null,
          source: blobCounterStats.source === "lmdb-ingester" ? "lmdb-ingester" : "netlify-blobs",
          totalCount: blobCounterStats.totalCount ?? blobCounterStats.noteCount + blobCounterStats.profileCount,
        };

        globalState.__nlinkStatsCache = {
          expiresAt: Date.now() + STATS_CACHE_TTL_MS,
          value: stats,
        };

        return stats;
      }

      let eventCount = 0;
      let noteListCount = 0;
      let profileCount = 0;
      let totalCount = 0;

      for await (const page of store.list({ paginate: true })) {
        totalCount += page.blobs.length;

        for (const blob of page.blobs) {
          if (blob.key.startsWith("event:")) {
            eventCount += 1;
            continue;
          }

          if (blob.key.startsWith("profile:")) {
            profileCount += 1;
            continue;
          }

          if (blob.key.startsWith("notes:")) {
            noteListCount += 1;
          }
        }
      }

      const stats: NostrCacheStats = {
        available: true,
        error: null,
        eventCount,
        fetchedAt: new Date().toISOString(),
        noteListCount,
        profileCount,
        relayUrl: null,
        source: "netlify-blobs",
        totalCount,
      };

      globalState.__nlinkStatsCache = {
        expiresAt: Date.now() + STATS_CACHE_TTL_MS,
        value: stats,
      };

      return stats;
    } catch (error) {
      return createUnavailableStats(error instanceof Error ? error.message : "Stats unavailable");
    }
  })();

  globalState.__nlinkStatsPromise = statsPromise;

  try {
    return await statsPromise;
  } finally {
    globalState.__nlinkStatsPromise = undefined;
  }
}
