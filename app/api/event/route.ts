import { NextResponse } from "next/server";
import { getServerEventById } from "@/lib/nostr/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("id")?.trim() ?? "";

  if (!eventId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const event = await getServerEventById(eventId);

  if (!event) {
    return NextResponse.json({ event: null }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
      status: 404,
    });
  }

  return NextResponse.json(
    { event },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
