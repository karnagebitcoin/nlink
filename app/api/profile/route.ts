import { NextResponse } from "next/server";
import { getServerProfileByPubkey } from "@/lib/nostr/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pubkey = searchParams.get("pubkey")?.trim() ?? "";

  if (!pubkey) {
    return NextResponse.json({ error: "Missing pubkey" }, { status: 400 });
  }

  const profile = await getServerProfileByPubkey(pubkey);

  if (!profile) {
    return NextResponse.json({ profile: null }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
      status: 404,
    });
  }

  return NextResponse.json(
    { profile },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
