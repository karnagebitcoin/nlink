# nLink LMDB Ingester

This is a separate always-on process for collecting new Nostr events from a relay
and storing them in LMDB for fast local reads.

## What it does

- connects to `wss://relay.damus.io` by default
- stores and backfills kind `1` text notes within a bounded retention window
- fetches profile metadata for note authors on first sight
- prunes notes that age out of the retention window
- exposes a small HTTP API for stats, event lookup, and profile note listing

## Environment

- `NOSTR_RELAY_URL`
  - default: `wss://relay.damus.io`
- `NOSTR_INGESTER_PORT`
  - default: `8787`
- `NOSTR_INGESTER_HOST`
  - default: `127.0.0.1`
- `NOSTR_INGESTER_MAX_EVENT_AGE_DAYS`
  - default: `365`
- `NOSTR_INGESTER_BACKFILL_ENABLED`
  - default: `true`
- `NOSTR_INGESTER_BACKFILL_BATCH_SIZE`
  - default: `500`
- `NOSTR_INGESTER_BACKFILL_DELAY_MS`
  - default: `250`
- `NOSTR_INGESTER_BACKFILL_EOSE_TIMEOUT_MS`
  - default: `8000`
- `NOSTR_INGESTER_DB_PATH`
  - default: `./data/nostr-ingester`
- `NOSTR_INGESTER_CURSOR_OVERLAP_SECONDS`
  - default: `5`
- `NOSTR_INGESTER_PROFILE_FETCH_TIMEOUT_MS`
  - default: `4000`
- `NOSTR_INGESTER_PRUNE_INTERVAL_MS`
  - default: `43200000` (12 hours)
- `NOSTR_INGESTER_RECONNECT_DELAY_MS`
  - default: `3000`
- `NETLIFY_SITE_ID`
  - required if you want to mirror into the production Blob cache
- `NETLIFY_AUTH_TOKEN`
  - required if you want to mirror into the production Blob cache

## Run

```bash
cd ingester
npm install
npm start
```

## App Integration

If you want the Next app to read from this ingester first, set:

```bash
NOSTR_INGESTER_URL=http://127.0.0.1:8787
```

The app will then:

- use the ingester for `/stats`
- prefer ingester-backed event lookups on note pages
- prefer ingester-backed profile note lists before falling back to relays
- use the ingester-backed profile notes API for infinite scrolling

Even without `NOSTR_INGESTER_URL`, the ingester can still warm production if you
set `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN`, because it will mirror events,
profiles, recent profile note snapshots, and a live stats counter into the
site-level Blob cache.

## HTTP API

- `GET /health`
- `GET /stats`
- `GET /event/:id`
- `GET /profile/:pubkey`
- `GET /profile/:pubkey/notes?limit=20&cursor=0`

## Notes

- Notes are stored individually as `event:*`.
- Profile metadata is stored as `profile:*`.
- Per-author feeds are indexed with ordered `author-note:*` keys so profile pagination stays efficient as the LMDB store grows.
- Historical paging stops at the retention boundary, so the local database stays bounded instead of growing forever.
