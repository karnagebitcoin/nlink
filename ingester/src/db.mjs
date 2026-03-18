import { open } from "lmdb";
import { config } from "./config.mjs";

const STATS_KEY = "meta:stats";
const EVENT_KEY_PREFIX = "event:";
const EVENT_KEY_SUFFIX = "event:\uffff";
const AUTHOR_NOTE_KEY_PREFIX = "author-note:";
const AUTHOR_NOTE_KEY_SUFFIX = "\uffff";
const PROFILE_KEY_PREFIX = "profile:";
const PROFILE_KEY_SUFFIX = "profile:\uffff";
const MAX_TIMESTAMP = 9_999_999_999;

const db = open({
  compression: true,
  path: config.dbPath,
});

function createDefaultStats() {
  return {
    noteCount: 0,
    profileCount: 0,
    relayUrl: config.relayUrl,
    startedAt: new Date().toISOString(),
    totalCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

function normalizePubkey(pubkey) {
  return pubkey.trim().toLowerCase();
}

function getAuthorCountKey(pubkey) {
  return `author-count:${normalizePubkey(pubkey)}`;
}

function getAuthorNotePrefix(pubkey) {
  return `${AUTHOR_NOTE_KEY_PREFIX}${normalizePubkey(pubkey)}:`;
}

function createAuthorNoteIndexKey(pubkey, createdAt, eventId) {
  const invertedTimestamp = String(MAX_TIMESTAMP - Math.max(0, createdAt)).padStart(10, "0");
  return `${getAuthorNotePrefix(pubkey)}${invertedTimestamp}:${eventId}`;
}

export function getStats() {
  const stats = db.get(STATS_KEY);
  if (stats) {
    return stats;
  }

  const initialStats = createDefaultStats();
  db.putSync(STATS_KEY, initialStats);
  return initialStats;
}

export function getState(name) {
  return db.get(`state:${name}`) ?? null;
}

export async function setState(name, value) {
  await db.put(`state:${name}`, value);
}

export function getStoredEvent(id) {
  return db.get(`${EVENT_KEY_PREFIX}${id}`) ?? null;
}

export async function saveNoteEvent(event, relayUrl) {
  const existing = getStoredEvent(event.id);
  if (existing) {
    return false;
  }

  const eventEnvelope = {
    event,
    firstSeenAt: new Date().toISOString(),
    relayUrl,
  };

  db.transactionSync(() => {
    db.putSync(`${EVENT_KEY_PREFIX}${event.id}`, eventEnvelope);
    db.putSync(createAuthorNoteIndexKey(event.pubkey, event.created_at, event.id), event.id);

    const authorCountKey = getAuthorCountKey(event.pubkey);
    const authorCount = db.get(authorCountKey) ?? 0;
    db.putSync(authorCountKey, authorCount + 1);

    const stats = getStats();
    db.putSync(STATS_KEY, {
      ...stats,
      noteCount: stats.noteCount + 1,
      lastNoteCreatedAt: Math.max(stats.lastNoteCreatedAt ?? 0, event.created_at),
      totalCount: stats.noteCount + 1 + stats.profileCount,
      updatedAt: new Date().toISOString(),
    });
  });

  return true;
}

export function getStoredProfile(pubkey) {
  return db.get(`${PROFILE_KEY_PREFIX}${normalizePubkey(pubkey)}`) ?? null;
}

export async function saveProfileEvent(event, metadata, relayUrl) {
  const pubkey = normalizePubkey(event.pubkey);
  const existing = getStoredProfile(pubkey);
  if (existing?.event?.created_at >= event.created_at) {
    return false;
  }

  db.transactionSync(() => {
    db.putSync(`${PROFILE_KEY_PREFIX}${pubkey}`, {
      event,
      metadata,
      relayUrl,
      updatedAt: new Date().toISOString(),
    });

    const stats = getStats();
    db.putSync(STATS_KEY, {
      ...stats,
      profileCount: existing ? stats.profileCount : stats.profileCount + 1,
      totalCount: stats.noteCount + (existing ? stats.profileCount : stats.profileCount + 1),
      updatedAt: new Date().toISOString(),
    });
  });

  return true;
}

export function getEventById(id) {
  return getStoredEvent(id)?.event ?? null;
}

export function getProfileByPubkey(pubkey) {
  return getStoredProfile(pubkey);
}

export function listAllProfiles() {
  return Array.from(
    db.getRange({
      end: PROFILE_KEY_SUFFIX,
      start: PROFILE_KEY_PREFIX,
    }),
  ).map(({ key, value }) => ({
    event: value.event,
    metadata: value.metadata ?? {},
    pubkey: String(key).slice(PROFILE_KEY_PREFIX.length),
    updatedAt: value.updatedAt ?? null,
  }));
}

export function listNotesByAuthor(pubkey, { cursor = 0, limit = 20 } = {}) {
  const start = Math.max(0, cursor);
  const normalizedLimit = Math.max(1, limit);
  const prefix = getAuthorNotePrefix(pubkey);
  const end = Math.max(start, start + normalizedLimit);
  const entries = Array.from(
    db.getRange({
      end: `${prefix}${AUTHOR_NOTE_KEY_SUFFIX}`,
      limit: normalizedLimit,
      offset: start,
      start: prefix,
    }),
  );
  const events = entries
    .map(({ value }) => getEventById(value))
    .filter(Boolean);
  const total = db.get(getAuthorCountKey(pubkey)) ?? 0;

  return {
    events,
    nextCursor: end < total ? end : null,
    total,
  };
}

export function getRecentNotesSnapshot(pubkey, limit = 10) {
  const { events, total } = listNotesByAuthor(pubkey, { cursor: 0, limit });

  return {
    hasMore: total > Math.max(1, limit),
    notes: events,
  };
}

export function pruneNotesOlderThan(cutoffTimestamp) {
  const staleEvents = [];

  for (const { value } of db.getRange({ start: EVENT_KEY_PREFIX, end: EVENT_KEY_SUFFIX })) {
    const event = value?.event;

    if (event?.created_at && event.created_at < cutoffTimestamp) {
      staleEvents.push(event);
    }
  }

  if (staleEvents.length === 0) {
    return {
      affectedAuthors: [],
      removedCount: 0,
      removedEvents: [],
    };
  }

  const affectedAuthors = new Set();
  let removedCount = 0;

  db.transactionSync(() => {
    for (const event of staleEvents) {
      const removed = db.removeSync(`${EVENT_KEY_PREFIX}${event.id}`);
      if (!removed) {
        continue;
      }

      db.removeSync(createAuthorNoteIndexKey(event.pubkey, event.created_at, event.id));
      affectedAuthors.add(normalizePubkey(event.pubkey));
      removedCount += 1;

      const authorCountKey = getAuthorCountKey(event.pubkey);
      const authorCount = db.get(authorCountKey) ?? 0;
      if (authorCount <= 1) {
        db.removeSync(authorCountKey);
      } else {
        db.putSync(authorCountKey, authorCount - 1);
      }
    }

    if (removedCount === 0) {
      return;
    }

    const stats = getStats();
    const nextNoteCount = Math.max(0, stats.noteCount - removedCount);

    db.putSync(STATS_KEY, {
      ...stats,
      lastNoteCreatedAt: nextNoteCount > 0 ? stats.lastNoteCreatedAt ?? 0 : 0,
      noteCount: nextNoteCount,
      totalCount: nextNoteCount + stats.profileCount,
      updatedAt: new Date().toISOString(),
    });
  });

  return {
    affectedAuthors: Array.from(affectedAuthors),
    removedCount,
    removedEvents: staleEvents,
  };
}

export async function closeDatabase() {
  await db.close();
}
