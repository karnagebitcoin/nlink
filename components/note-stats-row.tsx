"use client";

import { Heart, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NoteEngagementStats } from "@/hooks/use-note-stats";

interface NoteStatsRowProps {
  className?: string;
  stats?: NoteEngagementStats;
}

function formatCount(count: number): string {
  if (count < 1000) {
    return String(count);
  }

  if (count < 1_000_000) {
    const compact = count / 1000;
    return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}k`;
  }

  const compact = count / 1_000_000;
  return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}m`;
}

export function NoteStatsRow({ className, stats }: NoteStatsRowProps) {
  const reactionCount = stats?.reactionCount ?? 0;
  const commentCount = stats?.commentCount ?? 0;

  return (
    <div className={cn("flex items-center gap-4 text-xs text-muted-foreground", className)}>
      <div className="inline-flex items-center gap-1.5" aria-label={`${reactionCount} reactions`}>
        <Heart className="h-3.5 w-3.5" />
        <span>{formatCount(reactionCount)}</span>
      </div>
      <div className="inline-flex items-center gap-1.5" aria-label={`${commentCount} comments`}>
        <MessageCircle className="h-3.5 w-3.5" />
        <span>{formatCount(commentCount)}</span>
      </div>
    </div>
  );
}
