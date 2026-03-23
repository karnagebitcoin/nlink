import { getStore } from "@netlify/blobs";
import { unstable_cache } from "next/cache";
import { nip19, SimplePool, type Event as RawNostrEvent, type Filter } from "nostr-tools";
import {
  getIngesterEvent,
  getIngesterProfile,
  getIngesterProfileNotes,
  ingestIngesterEvents,
} from "@/lib/nostr/ingester";
import { parseProfile, type NostrEvent, type Profile } from "@/lib/nostr/utils";

type IdentifierType = "profile" | "note" | "unknown";

type ResolvedIdentifier =
  | {
      type: "profile";
      identifier: string;
      pubkey: string;
      relayHints: string[];
    }
  | {
      type: "note";
      identifier: string;
      eventId: string;
      relayHints: string[];
    }
  | {
      type: "unknown";
      identifier: string;
    };

type NotePageData = {
  event: NostrEvent | null;
  author: Profile | null;
};

type ProfilePageData = {
  hasMoreNotes: boolean;
  profile: Profile | null;
  notes: NostrEvent[];
};

interface CacheEnvelope<T> {
  expiresAt: number | null;
  value: T | null;
}

interface CachedNoteList {
  hasMore: boolean;
  notes: NostrEvent[];
}

const EVENT_CACHE_TTL = 1000 * 60 * 60 * 24 * 30;
const PROFILE_CACHE_TTL = 1000 * 60 * 30;
const NOTE_LIST_CACHE_TTL = 1000 * 60 * 5;
const NEGATIVE_CACHE_TTL = 1000 * 60 * 2;
const INITIAL_PROFILE_NOTES_LIMIT = 10;
const NOTE_PAGE_REVALIDATE_SECONDS = 60 * 60;
const PROFILE_PAGE_REVALIDATE_SECONDS = 60 * 5;

const BLOB_STORE_NAME = "nostr-cache-v1";

const JUST_ID_RELAYS = [
  "wss://cache2.primal.net/v1",
  "wss://relay.nostr.band",
  "wss://relay.damus.io",
];

const PROFILE_RELAYS = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://relay.nos.social",
  "wss://relay.vertexlab.io",
  "wss://indexer.coracle.social",
];

const NOTE_RELAYS = [
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.snort.social",
];

const globalState = globalThis as typeof globalThis & {
  __nlinkBlobMemoryCache?: Map<string, CacheEnvelope<unknown>>;
  __nlinkServerPool?: SimplePool;
};

const memoryCache = globalState.__nlinkBlobMemoryCache ?? new Map<string, CacheEnvelope<unknown>>();
globalState.__nlinkBlobMemoryCache = memoryCache;

const pool = globalState.__nlinkServerPool ?? new SimplePool();
pool.trackRelays = true;
pool.maxWaitForConnection = 1200;
pool.enableReconnect = false;
globalState.__nlinkServerPool = pool;

function combineRelays(...relayLists: string[][]): string[] {
  return Array.from(
    new Set(
      relayLists
        .flat()
        .map((relay) => relay.trim())
        .filter(Boolean),
    ),
  );
}

function isHex64(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

function normalizeEvent(event: RawNostrEvent): NostrEvent {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  };
}

function sortEvents(events: NostrEvent[]): NostrEvent[] {
  return [...events].sort((a, b) => b.created_at - a.created_at);
}

function getBlobStore() {
  try {
    return getStore(BLOB_STORE_NAME);
  } catch {
    return null;
  }
}

function readMemoryCache<T>(key: string): T | null | undefined {
  const memoryValue = memoryCache.get(key);
  if (memoryValue) {
    if (memoryValue.expiresAt === null || memoryValue.expiresAt > Date.now()) {
      return memoryValue.value as T | null;
    }

    memoryCache.delete(key);
  }

  return undefined;
}

async function readBlobCache<T>(key: string): Promise<T | null | undefined> {
  const memoryValue = readMemoryCache<T>(key);
  if (memoryValue !== undefined) {
    return memoryValue;
  }

  const store = getBlobStore();
  if (!store) {
    return undefined;
  }

  try {
    const envelope = (await store.get(key, {
      consistency: "eventual",
      type: "json",
    })) as CacheEnvelope<T> | null;

    if (!envelope) {
      return undefined;
    }

    if (envelope.expiresAt !== null && envelope.expiresAt <= Date.now()) {
      return undefined;
    }

    memoryCache.set(key, envelope as CacheEnvelope<unknown>);
    return envelope.value;
  } catch {
    return undefined;
  }
}

function writeCache<T>(key: string, value: T | null, ttlMs: number): void {
  const envelope: CacheEnvelope<T> = {
    expiresAt: ttlMs > 0 ? Date.now() + ttlMs : null,
    value,
  };

  memoryCache.set(key, envelope as CacheEnvelope<unknown>);

  const store = getBlobStore();
  if (!store) {
    return;
  }

  void store.setJSON(key, envelope).catch(() => {
    // Ignore cache write failures and fall back to in-memory behavior.
  });
}

export function persistEventsInServerCache(events: NostrEvent[]): void {
  const uniqueEvents = new Map<string, NostrEvent>();

  for (const event of events) {
    if (!event?.id) {
      continue;
    }

    uniqueEvents.set(event.id, event);
  }

  for (const event of uniqueEvents.values()) {
    writeCache(`event:${event.id}`, event, EVENT_CACHE_TTL);
  }
}

export async function mirrorEventsToServerDatabase(events: NostrEvent[]): Promise<void> {
  const uniqueEvents = Array.from(
    new Map(
      events
        .filter((event) => event?.id)
        .map((event) => [event.id, event] as const),
    ).values(),
  );

  if (uniqueEvents.length === 0) {
    return;
  }

  await ingestIngesterEvents(uniqueEvents);
}

async function queryRelays(relays: string[], filter: Filter, maxWait = 1200): Promise<NostrEvent[]> {
  const uniqueRelays = combineRelays(relays);
  if (uniqueRelays.length === 0) {
    return [];
  }

  try {
    const events = await pool.querySync(uniqueRelays, filter, { maxWait });
    return events.map(normalizeEvent);
  } catch {
    return [];
  }
}

async function fetchEventFromRelays(eventId: string, relayHints: string[]): Promise<NostrEvent | null> {
  const events = await queryRelays(
    combineRelays(relayHints, JUST_ID_RELAYS, NOTE_RELAYS),
    { ids: [eventId], limit: 1 },
    1500,
  );

  return sortEvents(events)[0] ?? null;
}

async function fetchEventFromIngesterOrRelays(
  eventId: string,
  relayHints: string[],
): Promise<NostrEvent | null> {
  const ingesterEvent = await getIngesterEvent(eventId);
  if (ingesterEvent) {
    persistEventsInServerCache([ingesterEvent]);
    return ingesterEvent;
  }

  return fetchEventFromRelays(eventId, relayHints);
}

export async function getServerEventById(
  eventId: string,
  relayHints: string[] = [],
): Promise<NostrEvent | null> {
  const cacheKey = `event:${eventId}`;
  const cachedEvent = readMemoryCache<NostrEvent>(cacheKey);
  if (cachedEvent !== undefined) {
    return cachedEvent;
  }

  const ingesterEvent = await getIngesterEvent(eventId);
  if (ingesterEvent) {
    persistEventsInServerCache([ingesterEvent]);
    return ingesterEvent;
  }

  const blobCachedEvent = await readBlobCache<NostrEvent>(cacheKey);
  if (blobCachedEvent !== undefined) {
    return blobCachedEvent;
  }

  const event = await fetchEventFromRelays(eventId, relayHints);
  writeCache(cacheKey, event, event ? EVENT_CACHE_TTL : NEGATIVE_CACHE_TTL);
  return event;
}

async function fetchProfileBatchFromRelays(pubkeys: string[]): Promise<Map<string, Profile | null>> {
  const missingPubkeys = pubkeys.filter(isHex64);
  const result = new Map<string, Profile | null>();

  if (missingPubkeys.length === 0) {
    return result;
  }

  const events = await queryRelays(
    combineRelays(PROFILE_RELAYS, NOTE_RELAYS),
    {
      authors: missingPubkeys,
      kinds: [0],
      limit: missingPubkeys.length,
    },
    1500,
  );

  const latestProfiles = new Map<string, NostrEvent>();
  for (const event of sortEvents(events)) {
    if (!latestProfiles.has(event.pubkey)) {
      latestProfiles.set(event.pubkey, event);
    }
  }

  for (const pubkey of missingPubkeys) {
    const event = latestProfiles.get(pubkey);
    result.set(pubkey, event ? parseProfile(event) : null);
  }

  return result;
}

async function fetchProfileFromCacheOrRelays(pubkey: string): Promise<Profile | null> {
  const cacheKey = `profile:${pubkey}`;
  const cached = readMemoryCache<Profile>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const ingesterProfile = await getIngesterProfile(pubkey);
  if (ingesterProfile) {
    writeCache(cacheKey, ingesterProfile, PROFILE_CACHE_TTL);
    return ingesterProfile;
  }

  const blobCached = await readBlobCache<Profile>(cacheKey);
  if (blobCached !== undefined) {
    return blobCached;
  }

  const profileMap = await fetchProfileBatchFromRelays([pubkey]);
  const profile = profileMap.get(pubkey) ?? null;
  writeCache(cacheKey, profile, profile ? PROFILE_CACHE_TTL : NEGATIVE_CACHE_TTL);
  return profile;
}

export async function getServerProfileByPubkey(pubkey: string): Promise<Profile | null> {
  return fetchProfileFromCacheOrRelays(pubkey);
}

async function fetchProfilesFromCacheOrRelays(pubkeys: string[]): Promise<Map<string, Profile | null>> {
  const uniquePubkeys = Array.from(new Set(pubkeys.filter(isHex64)));
  const profileMap = new Map<string, Profile | null>();
  const missing: string[] = [];

  for (const pubkey of uniquePubkeys) {
    const cached = readMemoryCache<Profile>(`profile:${pubkey}`);
    if (cached !== undefined) {
      profileMap.set(pubkey, cached);
    } else {
      missing.push(pubkey);
    }
  }

  if (missing.length > 0) {
    const ingesterProfiles = await Promise.all(
      missing.map(async (pubkey) => [pubkey, await getIngesterProfile(pubkey)] as const),
    );
    const missingFromRelays: string[] = [];

    for (const [pubkey, profile] of ingesterProfiles) {
      if (profile) {
        profileMap.set(pubkey, profile);
        writeCache(`profile:${pubkey}`, profile, PROFILE_CACHE_TTL);
      } else {
        missingFromRelays.push(pubkey);
      }
    }

    const missingAfterBlobs: string[] = [];

    for (const pubkey of missingFromRelays) {
      const cached = await readBlobCache<Profile>(`profile:${pubkey}`);
      if (cached !== undefined) {
        profileMap.set(pubkey, cached);
      } else {
        missingAfterBlobs.push(pubkey);
      }
    }

    const fetched = missingAfterBlobs.length > 0
      ? await fetchProfileBatchFromRelays(missingAfterBlobs)
      : new Map<string, Profile | null>();

    for (const pubkey of missingAfterBlobs) {
      const profile = fetched.get(pubkey) ?? null;
      profileMap.set(pubkey, profile);
      writeCache(`profile:${pubkey}`, profile, profile ? PROFILE_CACHE_TTL : NEGATIVE_CACHE_TTL);
    }
  }

  return profileMap;
}

async function fetchRecentNotesForProfile(
  pubkey: string,
  limit = INITIAL_PROFILE_NOTES_LIMIT,
): Promise<CachedNoteList> {
  const cacheKey = `notes:${pubkey}:${limit}`;
  const cached = readMemoryCache<CachedNoteList>(cacheKey);
  if (cached !== undefined) {
    return cached ?? { hasMore: false, notes: [] };
  }

  const ingesterNotes = await getIngesterProfileNotes(pubkey, { cursor: 0, limit });
  if (ingesterNotes && ingesterNotes.events.length > 0) {
    const sorted = sortEvents(ingesterNotes.events);
    persistEventsInServerCache(sorted);
    const result = {
      hasMore: ingesterNotes.nextCursor !== null,
      notes: sorted,
    };

    writeCache(cacheKey, result, NOTE_LIST_CACHE_TTL);
    return result;
  }

  const blobCached = await readBlobCache<CachedNoteList>(cacheKey);
  if (blobCached !== undefined) {
    return blobCached ?? { hasMore: false, notes: [] };
  }

  const events = await queryRelays(
    NOTE_RELAYS,
    {
      authors: [pubkey],
      kinds: [1],
      limit: limit + 1,
    },
    1600,
  );

  const sorted = sortEvents(events);
  persistEventsInServerCache(sorted);
  const result = {
    hasMore: sorted.length > limit,
    notes: sorted.slice(0, limit),
  };

  writeCache(cacheKey, result, result.notes.length > 0 ? NOTE_LIST_CACHE_TTL : NEGATIVE_CACHE_TTL);
  return result;
}

function resolveIdentifier(identifier: string): ResolvedIdentifier {
  if (isHex64(identifier)) {
    return {
      identifier,
      pubkey: identifier,
      relayHints: [],
      type: "profile",
    };
  }

  try {
    const decoded = nip19.decode(identifier);

    if (decoded.type === "npub") {
      return {
        identifier,
        pubkey: decoded.data as string,
        relayHints: [],
        type: "profile",
      };
    }

    if (decoded.type === "nprofile") {
      const data = decoded.data as { pubkey: string; relays?: string[] };
      return {
        identifier,
        pubkey: data.pubkey,
        relayHints: data.relays ?? [],
        type: "profile",
      };
    }

    if (decoded.type === "note") {
      return {
        eventId: decoded.data as string,
        identifier,
        relayHints: [],
        type: "note",
      };
    }

    if (decoded.type === "nevent") {
      const data = decoded.data as { id: string; relays?: string[] };
      return {
        eventId: data.id,
        identifier,
        relayHints: data.relays ?? [],
        type: "note",
      };
    }
  } catch {
    return { identifier, type: "unknown" };
  }

  return { identifier, type: "unknown" };
}

const getCachedNotePageData = unstable_cache(
  async (identifier: string): Promise<NotePageData> => {
    const resolved = resolveIdentifier(identifier);
    if (resolved.type !== "note") {
      return { author: null, event: null };
    }

    const cacheKey = `event:${resolved.eventId}`;
    const cachedEvent = readMemoryCache<NostrEvent>(cacheKey);
    let event = cachedEvent;

    if (event === undefined) {
      event = await getIngesterEvent(resolved.eventId);
      if (event) {
        persistEventsInServerCache([event]);
      }
    }

    if (event === undefined) {
      event = await readBlobCache<NostrEvent>(cacheKey);
    }

    if (event === undefined) {
      event = await fetchEventFromRelays(resolved.eventId, resolved.relayHints);
    }

    if (cachedEvent === undefined) {
      writeCache(cacheKey, event, event ? EVENT_CACHE_TTL : NEGATIVE_CACHE_TTL);
    }

    if (!event) {
      return { author: null, event: null };
    }

    const author = await fetchProfileFromCacheOrRelays(event.pubkey);
    return { author, event };
  },
  ["nlink-note-page"],
  { revalidate: NOTE_PAGE_REVALIDATE_SECONDS },
);

const getCachedProfilePageData = unstable_cache(
  async (identifier: string): Promise<ProfilePageData> => {
    const resolved = resolveIdentifier(identifier);
    if (resolved.type !== "profile") {
      return { hasMoreNotes: false, notes: [], profile: null };
    }

    const [profile, noteList] = await Promise.all([
      fetchProfileFromCacheOrRelays(resolved.pubkey),
      fetchRecentNotesForProfile(resolved.pubkey, INITIAL_PROFILE_NOTES_LIMIT),
    ]);

    return {
      hasMoreNotes: noteList.hasMore,
      notes: noteList.notes,
      profile,
    };
  },
  ["nlink-profile-page"],
  { revalidate: PROFILE_PAGE_REVALIDATE_SECONDS },
);

export async function getServerIdentifierData(identifier: string): Promise<{
  hexId: string | null;
  initialAuthor: Profile | null;
  initialEvent: NostrEvent | null;
  initialHasMoreNotes: boolean;
  initialNotes: NostrEvent[];
  initialProfile: Profile | null;
  type: IdentifierType;
}> {
  const resolved = resolveIdentifier(identifier);

  if (resolved.type === "note") {
    const { author, event } = await getCachedNotePageData(identifier);
    return {
      hexId: resolved.eventId,
      initialAuthor: author,
      initialEvent: event,
      initialHasMoreNotes: false,
      initialNotes: [],
      initialProfile: null,
      type: "note",
    };
  }

  if (resolved.type === "profile") {
    const { hasMoreNotes, notes, profile } = await getCachedProfilePageData(identifier);
    return {
      hexId: resolved.pubkey,
      initialAuthor: profile,
      initialEvent: null,
      initialHasMoreNotes: hasMoreNotes,
      initialNotes: notes,
      initialProfile: profile,
      type: "profile",
    };
  }

  return {
    hexId: null,
    initialAuthor: null,
    initialEvent: null,
    initialHasMoreNotes: false,
    initialNotes: [],
    initialProfile: null,
    type: "unknown",
  };
}

export async function prefetchServerProfiles(pubkeys: string[]): Promise<Map<string, Profile | null>> {
  return fetchProfilesFromCacheOrRelays(pubkeys);
}
