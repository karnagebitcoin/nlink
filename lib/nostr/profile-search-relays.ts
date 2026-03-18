import { SimplePool, type Event as RawNostrEvent, type Filter } from "nostr-tools";
import { filterAndRankProfileSearchResults, type ProfileSearchResult } from "@/lib/nostr/profile-search";

const SEARCH_RELAYS = [
  "wss://relay.nostr.band",
  "wss://search.nos.today",
];

const PROFILE_FALLBACK_RELAYS = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://relay.nos.social",
];

const SEARCH_RELAYS_MAX_WAIT_MS = 1_500;
const PROFILE_SCAN_MAX_WAIT_MS = 2_000;
const PROFILE_SCAN_LIMIT = 400;
const PROFILE_SCAN_WINDOW_SECONDS = 60 * 60 * 24 * 365;

const globalState = globalThis as typeof globalThis & {
  __nlinkProfileSearchPool?: SimplePool;
};

const pool = globalState.__nlinkProfileSearchPool ?? new SimplePool();
pool.trackRelays = true;
pool.maxWaitForConnection = 1_200;
pool.enableReconnect = false;
globalState.__nlinkProfileSearchPool = pool;

function parseProfileSearchEvent(event: RawNostrEvent): ProfileSearchResult | null {
  try {
    const profile = JSON.parse(event.content) as Record<string, unknown>;
    return {
      display_name: typeof profile.display_name === "string" ? profile.display_name : undefined,
      name: typeof profile.name === "string" ? profile.name : undefined,
      nip05: typeof profile.nip05 === "string" ? profile.nip05 : undefined,
      picture: typeof profile.picture === "string" ? profile.picture : undefined,
      pubkey: event.pubkey,
    };
  } catch {
    return null;
  }
}

async function queryProfileSearchRelays(
  relays: string[],
  filter: Filter,
  maxWait: number,
): Promise<ProfileSearchResult[]> {
  try {
    const events = await pool.querySync(relays, filter, { maxWait });
    return events
      .map(parseProfileSearchEvent)
      .filter((profile): profile is ProfileSearchResult => Boolean(profile));
  } catch {
    return [];
  }
}

export async function searchProfilesOnRelaysServer(
  query: string,
  limit = 10,
): Promise<ProfileSearchResult[]> {
  const normalizedLimit = Math.max(1, limit);
  const searchResults = await queryProfileSearchRelays(
    SEARCH_RELAYS,
    {
      kinds: [0],
      limit: Math.max(20, normalizedLimit * 3),
      search: query,
    },
    SEARCH_RELAYS_MAX_WAIT_MS,
  );

  if (query.trim().length < 3 || searchResults.length >= normalizedLimit) {
    return filterAndRankProfileSearchResults(searchResults, query, normalizedLimit);
  }

  const since = Math.floor(Date.now() / 1000) - PROFILE_SCAN_WINDOW_SECONDS;
  const recentProfileResults = await queryProfileSearchRelays(
    PROFILE_FALLBACK_RELAYS,
    {
      kinds: [0],
      limit: PROFILE_SCAN_LIMIT,
      since,
    },
    PROFILE_SCAN_MAX_WAIT_MS,
  );

  return filterAndRankProfileSearchResults(
    [...searchResults, ...recentProfileResults],
    query,
    normalizedLimit,
  );
}
