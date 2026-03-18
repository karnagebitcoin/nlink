import path from "node:path";

function getBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function getNumber(name, fallback) {
  const value = process.env[name];
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  backfillBatchSize: getNumber("NOSTR_INGESTER_BACKFILL_BATCH_SIZE", 500),
  backfillDelayMs: getNumber("NOSTR_INGESTER_BACKFILL_DELAY_MS", 250),
  backfillEnabled: getBoolean("NOSTR_INGESTER_BACKFILL_ENABLED", true),
  backfillEoseTimeoutMs: getNumber("NOSTR_INGESTER_BACKFILL_EOSE_TIMEOUT_MS", 8_000),
  cursorOverlapSeconds: getNumber("NOSTR_INGESTER_CURSOR_OVERLAP_SECONDS", 5),
  dbPath: path.resolve(process.cwd(), process.env.NOSTR_INGESTER_DB_PATH ?? "./data/nostr-ingester"),
  host: process.env.NOSTR_INGESTER_HOST ?? "127.0.0.1",
  maxEventAgeDays: getNumber("NOSTR_INGESTER_MAX_EVENT_AGE_DAYS", 365),
  netlifyAuthToken: process.env.NETLIFY_AUTH_TOKEN ?? process.env.NOSTR_NETLIFY_TOKEN ?? null,
  netlifySiteId: process.env.NETLIFY_SITE_ID ?? process.env.NOSTR_NETLIFY_SITE_ID ?? null,
  port: getNumber("NOSTR_INGESTER_PORT", 8787),
  profileFetchTimeoutMs: getNumber("NOSTR_INGESTER_PROFILE_FETCH_TIMEOUT_MS", 4000),
  pruneIntervalMs: getNumber("NOSTR_INGESTER_PRUNE_INTERVAL_MS", 1000 * 60 * 60 * 12),
  reconnectDelayMs: getNumber("NOSTR_INGESTER_RECONNECT_DELAY_MS", 3000),
  relayUrl: process.env.NOSTR_RELAY_URL ?? "wss://relay.damus.io",
};
