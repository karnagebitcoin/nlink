import http from "node:http";
import { getEventById, getProfileByPubkey, getStats, listAllProfiles, listNotesByAuthor, saveNoteEvent } from "./db.mjs";
import { createProfileSearchEntry, filterAndRankProfileSearchResults } from "./profile-search.mjs";
import { config } from "./config.mjs";

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function isEventLike(value) {
  return Boolean(value)
    && typeof value === "object"
    && typeof value.id === "string"
    && typeof value.pubkey === "string"
    && typeof value.kind === "number"
    && typeof value.created_at === "number"
    && typeof value.content === "string"
    && typeof value.sig === "string"
    && Array.isArray(value.tags);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const body = chunks.length > 0
          ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
          : {};
        resolve(body);
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

export function startHttpServer() {
  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      sendJson(response, 400, { error: "Missing request URL" });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? `${config.host}:${config.port}`}`);
    const pathname = url.pathname;

    if (request.method === "POST" && pathname === "/events") {
      try {
        const body = await readJsonBody(request);
        const incomingEvents = Array.isArray(body?.events) ? body.events : [];
        const noteEvents = incomingEvents.filter((event) => isEventLike(event) && event.kind === 1);

        let inserted = 0;
        let ignored = 0;

        for (const event of noteEvents.slice(0, 100)) {
          const wasInserted = await saveNoteEvent(event, "remote-api");
          if (wasInserted) {
            inserted += 1;
          } else {
            ignored += 1;
          }
        }

        sendJson(response, 200, {
          ignored,
          inserted,
          ok: true,
        });
      } catch {
        sendJson(response, 400, { error: "Invalid request body", ok: false });
      }
      return;
    }

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
