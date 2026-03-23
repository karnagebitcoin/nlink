import { NextResponse } from "next/server";
import { prefetchServerProfiles } from "@/lib/nostr/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pubkeys = (searchParams.get("pubkeys") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (pubkeys.length === 0) {
    return NextResponse.json({ profiles: {} }, { status: 400 });
  }

  const profilesMap = await prefetchServerProfiles(pubkeys);
  const profiles = Object.fromEntries(profilesMap.entries());

  return NextResponse.json(
    { profiles },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
