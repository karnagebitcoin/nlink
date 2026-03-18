import { NextResponse } from "next/server";
import { persistEventsInServerCache } from "@/lib/nostr/server";
import type { NostrEvent } from "@/lib/nostr/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isEventLike(value: unknown): value is NostrEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Partial<NostrEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.pubkey === "string" &&
    typeof event.kind === "number" &&
    typeof event.created_at === "number" &&
    typeof event.content === "string" &&
    typeof event.sig === "string" &&
    Array.isArray(event.tags)
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { events?: unknown };
    const incomingEvents = Array.isArray(body?.events) ? body.events : [];
    const events = incomingEvents.filter(isEventLike).slice(0, 100);

    if (events.length === 0) {
      return NextResponse.json({ cached: 0, ok: true });
    }

    persistEventsInServerCache(events);

    return NextResponse.json({ cached: events.length, ok: true });
  } catch {
    return NextResponse.json(
      { cached: 0, error: "Invalid request body", ok: false },
      { status: 400 },
    );
  }
}
