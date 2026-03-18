import type { Metadata } from "next";
import { LiveStatsCard } from "@/components/stats/live-stats-card";
import { getNostrCacheStats } from "@/lib/nostr/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stats - nLink",
  description: "Live stats for the Nostr event cache and ingester.",
};

export default async function StatsPage() {
  const initialStats = await getNostrCacheStats();

  return <LiveStatsCard initialStats={initialStats} />;
}
