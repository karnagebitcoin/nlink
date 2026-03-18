import type { ProfileSearchResult } from "@/lib/nostr/profile-search";
import { parseProfile, type NostrEvent, type Profile } from "@/lib/nostr/utils";

const INGESTER_REQUEST_TIMEOUT_MS = 1_500;
const baseUrl = process.env.NOSTR_INGESTER_URL?.replace(/\/+$/, "") ?? null;

interface IngesterEventResponse {
  event: NostrEvent;
}

interface IngesterProfileEnvelope {
  event: NostrEvent;
  metadata?: Profile | null;
  relayUrl?: string;
  updatedAt?: string;
}

interface IngesterProfileResponse {
  profile: IngesterProfileEnvelope;
}

interface IngesterProfileNotesResponse {
  events: NostrEvent[];
  nextCursor: number | null;
  total: number;
}

interface IngesterStatsResponse {
  lastNoteCreatedAt?: number;
  noteCount: number;
  profileCount: number;
  relayUrl?: string;
  startedAt: string;
  totalCount?: number;
  updatedAt: string;
}

interface IngesterSearchProfilesResponse {
  results: ProfileSearchResult[];
}

function createSignal() {
  return AbortSignal.timeout(INGESTER_REQUEST_TIMEOUT_MS);
}

async function fetchIngesterJson<T>(pathname: string): Promise<T | null> {
  if (!baseUrl) {
    return null;
  }

  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      cache: "no-store",
      signal: createSignal(),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function isIngesterConfigured() {
  return Boolean(baseUrl);
}

export async function getIngesterEvent(eventId: string): Promise<NostrEvent | null> {
  const response = await fetchIngesterJson<IngesterEventResponse>(`/event/${encodeURIComponent(eventId)}`);
  return response?.event ?? null;
}

export async function getIngesterProfile(pubkey: string): Promise<Profile | null> {
  const response = await fetchIngesterJson<IngesterProfileResponse>(`/profile/${encodeURIComponent(pubkey)}`);
  const profile = response?.profile;

  if (!profile) {
    return null;
  }

  if (profile.metadata) {
    return profile.metadata;
  }

  return parseProfile(profile.event);
}

export async function getIngesterProfileNotes(
  pubkey: string,
  { cursor = 0, limit = 20 }: { cursor?: number; limit?: number } = {},
): Promise<IngesterProfileNotesResponse | null> {
  const searchParams = new URLSearchParams({
    cursor: String(Math.max(0, cursor)),
    limit: String(Math.max(1, limit)),
  });

  return fetchIngesterJson<IngesterProfileNotesResponse>(
    `/profile/${encodeURIComponent(pubkey)}/notes?${searchParams.toString()}`,
  );
}

export async function getIngesterStats(): Promise<IngesterStatsResponse | null> {
  return fetchIngesterJson<IngesterStatsResponse>("/stats");
}

export async function searchIngesterProfiles(query: string, limit = 10): Promise<ProfileSearchResult[] | null> {
  const searchParams = new URLSearchParams({
    limit: String(Math.max(1, limit)),
    q: query,
  });

  const response = await fetchIngesterJson<IngesterSearchProfilesResponse>(
    `/search/profiles?${searchParams.toString()}`,
  );

  return response?.results ?? null;
}
