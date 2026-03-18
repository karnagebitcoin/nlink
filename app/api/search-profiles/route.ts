import { getStore } from "@netlify/blobs";
import { NextResponse } from "next/server";
import { searchIngesterProfiles } from "@/lib/nostr/ingester";
import { searchProfilesOnRelaysServer } from "@/lib/nostr/profile-search-relays";
import {
  filterAndRankProfileSearchResults,
  getProfileSearchShardCandidates,
  type ProfileSearchResult,
} from "@/lib/nostr/profile-search";

const NOSTR_CACHE_STORE_NAME = "nostr-cache-v1";
const SEARCH_CACHE_TTL_MS = 30_000;
const RELAY_FALLBACK_MIN_RESULTS = 3;

const globalState = globalThis as typeof globalThis & {
  __nlinkProfileSearchCache?: Map<string, { expiresAt: number; value: ProfileSearchResult[] }>;
  __nlinkProfileSearchPending?: Map<string, Promise<ProfileSearchResult[]>>;
};

const responseCache = globalState.__nlinkProfileSearchCache ?? new Map<string, { expiresAt: number; value: ProfileSearchResult[] }>();
globalState.__nlinkProfileSearchCache = responseCache;
const pendingSearches = globalState.__nlinkProfileSearchPending ?? new Map<string, Promise<ProfileSearchResult[]>>();
globalState.__nlinkProfileSearchPending = pendingSearches;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function runProfileSearch(query: string, limit: number): Promise<ProfileSearchResult[]> {
  const [ingesterResults, blobResults] = await Promise.all([
    searchIngesterProfiles(query, limit),
    searchProfilesFromBlobs(query, limit),
  ]);

  let results = filterAndRankProfileSearchResults(
    [...(ingesterResults ?? []), ...blobResults],
    query,
    limit,
  );

  if (results.length >= Math.min(RELAY_FALLBACK_MIN_RESULTS, limit)) {
    return results;
  }

  const relayResults = await searchProfilesOnRelaysServer(query, limit);
  results = filterAndRankProfileSearchResults(
    [...results, ...relayResults],
    query,
    limit,
  );

  return results;
}

async function searchProfilesFromBlobs(query: string, limit: number): Promise<ProfileSearchResult[]> {
  try {
    const remoteStoreOptions =
      process.env.NETLIFY_SITE_ID && process.env.NETLIFY_AUTH_TOKEN
        ? {
            siteID: process.env.NETLIFY_SITE_ID,
            token: process.env.NETLIFY_AUTH_TOKEN,
          }
        : {};
    const store = getStore({
      consistency: "eventual",
      name: NOSTR_CACHE_STORE_NAME,
      ...remoteStoreOptions,
    });
    const shardCandidates = getProfileSearchShardCandidates(query);
    const shardEntries = await Promise.all(
      shardCandidates.map((shard) => store.get(`search:profiles:${shard}`, { type: "json" })),
    );

    return filterAndRankProfileSearchResults(
      shardEntries.flatMap((entries) => (Array.isArray(entries) ? entries : [])),
      query,
      limit,
    );
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const limit = Number(searchParams.get("limit") ?? 10);
  const normalizedLimit = Math.max(1, limit);
  const normalizedQuery = query.toLowerCase();
  const cacheKey = `${normalizedQuery}:${normalizedLimit}`;

  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(
      { results: cached.value },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  const inflight = pendingSearches.get(cacheKey);
  if (inflight) {
    const results = await inflight;
    return NextResponse.json(
      { results },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  const searchPromise = runProfileSearch(query, normalizedLimit).finally(() => {
    pendingSearches.delete(cacheKey);
  });
  pendingSearches.set(cacheKey, searchPromise);

  const results = await searchPromise;

  responseCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    value: results,
  });

  return NextResponse.json(
    { results },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
