import http from "node:http";
import { getEventById, getProfileByPubkey, getStats, listAllProfiles, listNotesByAuthor } from "./db.mjs";
import { createProfileSearchEntry, filterAndRankProfileSearchResults } from "./profile-search.mjs";
import { config } from "./config.mjs";

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

export function startHttpServer() {
  const server = http.createServer((request, response) => {
    if (!request.url) {
      sendJson(response, 400, { error: "Missing request URL" });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? `${config.host}:${config.port}`}`);
    const pathname = url.pathname;

    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    if (pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        relayUrl: config.relayUrl,
      });
      return;
    }

    if (pathname === "/stats") {
      sendJson(response, 200, getStats());
      return;
    }

    if (pathname === "/search/profiles") {
      const query = url.searchParams.get("q") ?? "";
      const limit = Number(url.searchParams.get("limit") ?? 10);
      const profiles = listAllProfiles().map((profile) => createProfileSearchEntry(profile.pubkey, profile.metadata ?? {}));
      sendJson(response, 200, {
        results: filterAndRankProfileSearchResults(profiles, query, limit),
      });
      return;
    }

    if (pathname.startsWith("/event/")) {
      const eventId = pathname.slice("/event/".length);
      const event = getEventById(eventId);

      if (!event) {
        sendJson(response, 404, { error: "Event not found" });
        return;
      }

      sendJson(response, 200, { event });
      return;
    }

    const profileNotesMatch = pathname.match(/^\/profile\/([^/]+)\/notes$/);
    if (profileNotesMatch) {
      const pubkey = profileNotesMatch[1];
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const cursor = Number(url.searchParams.get("cursor") ?? 0);

      sendJson(response, 200, listNotesByAuthor(pubkey, { cursor, limit }));
      return;
    }

    const profileMatch = pathname.match(/^\/profile\/([^/]+)$/);
    if (profileMatch) {
      const pubkey = profileMatch[1];
      const profile = getProfileByPubkey(pubkey);

      if (!profile) {
        sendJson(response, 404, { error: "Profile not found" });
        return;
      }

      sendJson(response, 200, { profile });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });

  return new Promise((resolve) => {
    server.listen(config.port, config.host, () => {
      console.log(`[ingester] HTTP API listening on http://${config.host}:${config.port}`);
      resolve(server);
    });
  });
}
