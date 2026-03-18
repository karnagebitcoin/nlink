"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useNostr } from "@/lib/nostr/context";
import { NoteCard } from "@/components/note-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNoteStats } from "@/hooks/use-note-stats";
import { Loader2 } from "lucide-react";
import type { NostrEvent, Profile } from "@/lib/nostr/utils";

interface NoteFeedProps {
  initialAuthor?: Profile | null;
  initialHasMore?: boolean;
  initialNotes?: NostrEvent[];
  pubkey: string;
}

interface IngesterProfileNotesResponse {
  events: NostrEvent[];
  nextCursor: number | null;
  total: number;
}

function extractProfilePubkeys(events: NostrEvent[]): string[] {
  const pubkeys = new Set<string>();

  for (const event of events) {
    pubkeys.add(event.pubkey);

    for (const [tagName, tagValue] of event.tags) {
      if (tagName === "p" && tagValue && /^[0-9a-f]{64}$/i.test(tagValue)) {
        pubkeys.add(tagValue);
      }
    }
  }

  return Array.from(pubkeys);
}

export function NoteFeed({
  initialAuthor = null,
  initialHasMore = false,
  initialNotes = [],
  pubkey,
}: NoteFeedProps) {
  const { query, prefetchProfiles } = useNostr();
  const [notes, setNotes] = useState<NostrEvent[]>(initialNotes);
  const [loading, setLoading] = useState(initialNotes.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<number | null>(initialNotes.length > 0 ? initialNotes.length : 0);
  const [preferIngester, setPreferIngester] = useState(initialNotes.length > 0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const noteStats = useNoteStats(notes.map((note) => note.id));

  const loadNotesFromIngester = useCallback(
    async (cursor: number, limit: number): Promise<IngesterProfileNotesResponse | null> => {
      try {
        const searchParams = new URLSearchParams({
          cursor: String(Math.max(0, cursor)),
          limit: String(Math.max(1, limit)),
          pubkey,
        });
        const response = await fetch(`/api/profile-notes?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return null;
        }

        return (await response.json()) as IngesterProfileNotesResponse;
      } catch {
        return null;
      }
    },
    [pubkey],
  );

  useEffect(() => {
    if (initialNotes.length > 0) {
      setNotes(initialNotes);
      // Don't treat a short first page as exhaustion. Keep paging until a request returns 0 notes.
      setHasMore(initialHasMore || initialNotes.length > 0);
      setNextCursor(initialHasMore ? initialNotes.length : null);
      setPreferIngester(true);
      setLoading(false);
      return;
    }

    async function loadNotes() {
      setLoading(true);
      try {
        const ingesterNotes = await loadNotesFromIngester(0, 20);
        if (ingesterNotes) {
          const sorted = ingesterNotes.events.sort((a, b) => b.created_at - a.created_at);
          void prefetchProfiles(extractProfilePubkeys(sorted));
          setNotes(sorted);
          setNextCursor(ingesterNotes.nextCursor);
          setHasMore(ingesterNotes.nextCursor !== null);
          setPreferIngester(true);
          return;
        }

        setPreferIngester(false);
        const events = await query([
          { kinds: [1], authors: [pubkey], limit: 20 },
        ]);
        
        // Sort by created_at descending
        const sorted = events.sort((a, b) => b.created_at - a.created_at);
        void prefetchProfiles(extractProfilePubkeys(sorted));
        setNotes(sorted);
        setHasMore(sorted.length > 0);
        setNextCursor(null);
      } catch (error) {
        console.error("Failed to load notes:", error);
      } finally {
        setLoading(false);
      }
    }

    loadNotes();
  }, [initialHasMore, initialNotes, loadNotesFromIngester, pubkey, prefetchProfiles, query]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    try {
      if (preferIngester && nextCursor !== null) {
        const ingesterNotes = await loadNotesFromIngester(nextCursor, 20);
        if (ingesterNotes) {
          const sorted = ingesterNotes.events.sort((a, b) => b.created_at - a.created_at);
          void prefetchProfiles(extractProfilePubkeys(sorted));

          const existingIds = new Set(notes.map((note) => note.id));
          const newNotes = sorted.filter((note) => !existingIds.has(note.id));

          setNotes((prev) => [...prev, ...newNotes]);
          setNextCursor(ingesterNotes.nextCursor);
          setHasMore(ingesterNotes.nextCursor !== null);
          return;
        }

        setPreferIngester(false);
      }

      const lastNote = notes[notes.length - 1];
      if (!lastNote) return;
      
      const events = await query([
        { kinds: [1], authors: [pubkey], limit: 20, until: lastNote.created_at - 1 },
      ]);
      
      const sorted = events.sort((a, b) => b.created_at - a.created_at);
      void prefetchProfiles(extractProfilePubkeys(sorted));
      
      // Filter out any duplicates
      const existingIds = new Set(notes.map(n => n.id));
      const newNotes = sorted.filter(n => !existingIds.has(n.id));
      
      setNotes((prev) => [...prev, ...newNotes]);
      setHasMore(newNotes.length > 0);
    } catch (error) {
      console.error("Failed to load more notes:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [notes, loadingMore, hasMore, preferIngester, nextCursor, loadNotesFromIngester, pubkey, prefetchProfiles, query]);

  // Set up intersection observer for infinite scroll
  useEffect(() => {
    if (loading) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "100px" }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [loading, hasMore, loadingMore, loadMore]);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No notes found
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          event={note}
          engagement={noteStats[note.id]}
          initialAuthor={initialAuthor}
        />
      ))}
      
      {/* Infinite scroll trigger */}
      <div ref={loadMoreRef} className="py-4">
        {loadingMore && (
          <div className="flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {!hasMore && notes.length > 0 && (
          <p className="text-center text-sm text-muted-foreground">
            No more notes
          </p>
        )}
      </div>
    </div>
  );
}
