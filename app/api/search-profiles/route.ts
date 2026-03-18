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
const SEARCH_CACHE_TTL_MS = 10_000;

const globalState = globalThis as typeof globalThis & {
  __nlinkProfileSearchCache?: Map<string, { expiresAt: number; value: ProfileSearchResult[] }>;
};

const responseCache = globalState.__nlinkProfileSearchCache ?? new Map<string, { expiresAt: number; value: ProfileSearchResult[] }>();
globalState.__nlinkProfileSearchCache = responseCache;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const cacheKey = `${query}:${normalizedLimit}`;

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

  const ingesterResults = await searchIngesterProfiles(query, normalizedLimit);
  const blobResults = await searchProfilesFromBlobs(query, normalizedLimit);

  let results = filterAndRankProfileSearchResults(
    [...(ingesterResults ?? []), ...blobResults],
    query,
    normalizedLimit,
  );

  if (results.length < normalizedLimit) {
    const relayResults = await searchProfilesOnRelaysServer(query, normalizedLimit);
    results = filterAndRankProfileSearchResults(
      [...results, ...relayResults],
      query,
      normalizedLimit,
    );
  }

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
