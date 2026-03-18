"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { NoteCard } from "@/components/note-card";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNoteStats } from "@/hooks/use-note-stats";
import { useNostr } from "@/lib/nostr/context";
import { getReplyTargetIds, isReplyNoteEvent, type NostrEvent } from "@/lib/nostr/utils";

interface NoteCommentsProps {
  commentCount?: number;
  eventId: string;
}

const COMMENTS_FETCH_LIMIT = 120;

function dedupeEvents(events: NostrEvent[]): NostrEvent[] {
  const seen = new Set<string>();

  return events.filter((event) => {
    if (seen.has(event.id)) {
      return false;
    }

    seen.add(event.id);
    return true;
  });
}

export function NoteComments({ commentCount = 0, eventId }: NoteCommentsProps) {
  const { prefetchProfiles, query } = useNostr();
  const [comments, setComments] = useState<NostrEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const commentStats = useNoteStats(useMemo(() => comments.map((comment) => comment.id), [comments]));

  useEffect(() => {
    let cancelled = false;

    async function loadComments() {
      setLoading(true);
      setError(null);

      try {
        const events = await query([
          { "#e": [eventId], kinds: [1], limit: COMMENTS_FETCH_LIMIT },
        ]);

        if (cancelled) {
          return;
        }

        const relevantComments = dedupeEvents(
          events.filter((event) => isReplyNoteEvent(event) && getReplyTargetIds(event).includes(eventId))
        ).sort((a, b) => a.created_at - b.created_at);

        setComments(relevantComments);
        void prefetchProfiles(Array.from(new Set(relevantComments.map((comment) => comment.pubkey))));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load comments");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadComments();

    return () => {
      cancelled = true;
    };
  }, [eventId, prefetchProfiles, query]);

  return (
    <section className="mt-6 space-y-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Comments</h2>
        <span className="text-sm text-muted-foreground">
          {commentCount}
        </span>
      </div>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!loading && error && (
        <Card className="py-0 gap-0">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4" />
            <span>{error}</span>
          </CardContent>
        </Card>
      )}

      {!loading && !error && comments.length === 0 && (
        <Card className="py-0 gap-0">
          <CardContent className="p-4 text-sm text-muted-foreground">
            No comments yet.
          </CardContent>
        </Card>
      )}

      {!loading && !error && comments.length > 0 && (
        <div className="space-y-3">
          {comments.map((comment) => (
            <NoteCard
              key={comment.id}
              event={comment}
              engagement={commentStats[comment.id]}
            />
          ))}
        </div>
      )}
    </section>
  );
}
