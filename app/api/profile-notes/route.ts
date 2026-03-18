import { NextResponse } from "next/server";
import { getIngesterProfileNotes } from "@/lib/nostr/ingester";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pubkey = searchParams.get("pubkey");

  if (!pubkey) {
    return NextResponse.json({ error: "Missing pubkey" }, { status: 400 });
  }

  const cursor = Number(searchParams.get("cursor") ?? 0);
  const limit = Number(searchParams.get("limit") ?? 20);
  const result = await getIngesterProfileNotes(pubkey, { cursor, limit });

  if (!result) {
    return NextResponse.json({ error: "Ingester unavailable" }, { status: 503 });
  }

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
