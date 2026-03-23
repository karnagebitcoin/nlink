import { closeDatabase } from "./db.mjs";
import { isBlobMirrorEnabled } from "./blob-cache.mjs";
import { config } from "./config.mjs";
import { startHttpServer } from "./http-server.mjs";
import { NostrIngester } from "./nostr-ingester.mjs";
import WebSocket from "ws";

if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = WebSocket;
}

const ingester = new NostrIngester();
let server;

async function shutdown(signal) {
  console.log(`[ingester] shutting down on ${signal}`);
  await ingester.stop();
  await new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });
  await closeDatabase();
  process.exit(0);
}

async function main() {
  server = await startHttpServer();
  console.log(`[ingester] Netlify Blob mirror ${isBlobMirrorEnabled() ? "enabled" : "disabled"}`);
  console.log(`[ingester] retention window ${config.maxEventAgeDays} days; backfill ${config.backfillEnabled ? "enabled" : "disabled"}`);
  await ingester.start();
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

main().catch(async (error) => {
  console.error("[ingester] fatal error", error);
  await closeDatabase();
  process.exit(1);
});
