import { getStore } from "@netlify/blobs";
import { saveNoteEvent, saveProfileMetadata } from "./db.mjs";

const STORE_NAME = "nostr-cache-v1";
const IMPORT_RELAY_LABEL = "netlify-blobs-import";
const PAGE_LIMIT = 25;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 750;

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID ?? process.env.NOSTR_NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN ?? process.env.NOSTR_NETLIFY_TOKEN;

  if (!siteID || !token) {
    throw new Error("Missing NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN for blob import.");
  }

  return getStore({
    name: STORE_NAME,
    siteID,
    token,
  });
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractEnvelopeValue(payload) {
  if (isObject(payload) && "value" in payload) {
    return payload.value;
  }

  return payload;
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function getJsonWithRetry(store, key) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await store.get(key, { type: "json" });
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES;
      console.warn(`[import] blob read failed for ${key} (attempt ${attempt}/${MAX_RETRIES})`, error);

      if (isLastAttempt) {
        throw error;
      }

      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  return null;
}

async function importEvents(store) {
  let imported = 0;
  let skipped = 0;

  for await (const page of store.list({ paginate: true, prefix: "event:" })) {
    const keys = page.blobs.map((blob) => blob.key).filter(Boolean);

    for (let index = 0; index < keys.length; index += PAGE_LIMIT) {
      const chunk = keys.slice(index, index + PAGE_LIMIT);
      for (const key of chunk) {
        const payload = await getJsonWithRetry(store, key);
        const event = extractEnvelopeValue(payload);
        if (!isObject(event) || typeof event.id !== "string") {
          skipped += 1;
          continue;
        }

        const inserted = await saveNoteEvent(event, IMPORT_RELAY_LABEL);
        if (inserted) {
          imported += 1;
        } else {
          skipped += 1;
        }
      }

      console.log(`[import] events imported=${imported} skipped=${skipped}`);
    }
  }

  return { imported, skipped };
}

async function importProfiles(store) {
  let imported = 0;
  let skipped = 0;

  for await (const page of store.list({ paginate: true, prefix: "profile:" })) {
    const keys = page.blobs.map((blob) => blob.key).filter(Boolean);

    for (let index = 0; index < keys.length; index += PAGE_LIMIT) {
      const chunk = keys.slice(index, index + PAGE_LIMIT);
      for (const key of chunk) {
        const payload = await getJsonWithRetry(store, key);
        const metadata = extractEnvelopeValue(payload);
        const pubkey = key.slice("profile:".length);

        if (!pubkey || !isObject(metadata)) {
          skipped += 1;
          continue;
        }

        const updatedAt =
          isObject(payload) && "expiresAt" in payload && typeof payload.expiresAt === "number"
            ? new Date(payload.expiresAt).toISOString()
            : new Date().toISOString();

        const inserted = await saveProfileMetadata(pubkey, metadata, IMPORT_RELAY_LABEL, updatedAt);
        if (inserted) {
          imported += 1;
        } else {
          skipped += 1;
        }
      }

      console.log(`[import] profiles imported=${imported} skipped=${skipped}`);
    }
  }

  return { imported, skipped };
}

async function main() {
  const store = getBlobStore();
  console.log(`[import] reading blobs from store ${STORE_NAME}`);

  const events = await importEvents(store);
  const profiles = await importProfiles(store);

  console.log("[import] complete", {
    eventImported: events.imported,
    eventSkipped: events.skipped,
    profileImported: profiles.imported,
    profileSkipped: profiles.skipped,
  });
}

main().catch((error) => {
  console.error("[import] failed", error);
  process.exit(1);
});
