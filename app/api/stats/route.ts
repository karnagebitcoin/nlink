import { NextResponse } from "next/server";
import { getNostrCacheStats } from "@/lib/nostr/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const stats = await getNostrCacheStats();

  return NextResponse.json(stats, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
