"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useNostr } from "@/lib/nostr/context";
import { extractMedia, toNevent, type NostrEvent } from "@/lib/nostr/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";

interface MediaGalleryProps {
  initialEvents?: NostrEvent[];
  pubkey: string;
}

interface MediaItem {
  url: string;
  type: "image" | "video";
  noteId: string;
  createdAt: number;
}

function extractMediaFromEventsStatic(events: NostrEvent[]): MediaItem[] {
  const items: MediaItem[] = [];
  const seenUrls = new Set<string>();

  for (const event of events) {
    const { images, videos } = extractMedia(event.content);

    for (const url of images) {
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        items.push({
          createdAt: event.created_at,
          noteId: event.id,
          type: "image",
          url,
        });
      }
    }

    for (const url of videos) {
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        items.push({
          createdAt: event.created_at,
          noteId: event.id,
          type: "video",
          url,
        });
      }
    }
  }

  return items;
}

export function MediaGallery({
  initialEvents = [],
  pubkey,
}: MediaGalleryProps) {
  const { query, getCachedMedia, cacheMedia } = useNostr();
  const initialMedia = initialEvents.length > 0 ? extractMediaFromEventsStatic(initialEvents) : null;
  
  // Get cached media only once on mount
  const [initialCache] = useState(() => getCachedMedia(pubkey) ?? (initialMedia ? {
    lastTimestamp: initialEvents[initialEvents.length - 1]?.created_at ?? null,
    media: initialMedia,
  } : null));
  const [cached] = useState(initialCache !== null); // Declare cached variable
  
  const [media, setMedia] = useState<MediaItem[]>(initialCache?.media || []);
  const [loading, setLoading] = useState(!initialCache);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastTimestamp, setLastTimestamp] = useState<number | null>(initialCache?.lastTimestamp || null);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const extractMediaFromEvents = useCallback((events: NostrEvent[]): MediaItem[] => {
    return extractMediaFromEventsStatic(events);
  }, []);

  useEffect(() => {
    if (initialMedia && initialMedia.length > 0) {
      setMedia(initialMedia);
      setLoading(false);
      setHasMore(initialEvents.length > 0);
      setLastTimestamp(initialEvents[initialEvents.length - 1]?.created_at ?? null);
    }
  }, [initialEvents, initialMedia]);

  useEffect(() => {
    if (initialEvents.length > 0) {
      return;
    }

    async function loadMedia() {
      try {
        const events = await query([
          { kinds: [1], authors: [pubkey], limit: 50 },
        ]);
        
        const sorted = events.sort((a, b) => b.created_at - a.created_at);
        const items = extractMediaFromEvents(sorted);
        
        setMedia(items);
        setHasMore(sorted.length >= 50);
        
        const newLastTimestamp = sorted.length > 0 ? sorted[sorted.length - 1].created_at : null;
        setLastTimestamp(newLastTimestamp);
        
        // Cache the results
        cacheMedia(pubkey, items, newLastTimestamp);
      } catch (error) {
        console.error("Failed to load media:", error);
      } finally {
        setLoading(false);
      }
    }

    loadMedia();
  }, [cacheMedia, extractMediaFromEvents, initialEvents, pubkey, query]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !lastTimestamp) return;
    
    setLoadingMore(true);
    try {
      const events = await query([
        { kinds: [1], authors: [pubkey], limit: 50, until: lastTimestamp - 1 },
      ]);
      
      const sorted = events.sort((a, b) => b.created_at - a.created_at);
      const newItems = extractMediaFromEvents(sorted);
      
      // Filter out duplicates
      const existingUrls = new Set(media.map(m => m.url));
      const uniqueItems = newItems.filter(m => !existingUrls.has(m.url));
      
      const updatedMedia = [...media, ...uniqueItems];
      const newLastTimestamp = sorted.length > 0 ? sorted[sorted.length - 1].created_at : lastTimestamp;
      
      setMedia(updatedMedia);
      setHasMore(sorted.length >= 50);
      setLastTimestamp(newLastTimestamp);
      
      // Update cache with new media
      cacheMedia(pubkey, updatedMedia, newLastTimestamp);
    } catch (error) {
      console.error("Failed to load more media:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [media, loadingMore, hasMore, lastTimestamp, pubkey, query, extractMediaFromEvents, cacheMedia]);

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

  // Filter out failed URLs
  const visibleMedia = media.filter((item) => !failedUrls.has(item.url));

  const handleImageError = (url: string) => {
    setFailedUrls((prev) => new Set(prev).add(url));
  };

  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-1">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square w-full rounded-sm" />
        ))}
      </div>
    );
  }

  if (visibleMedia.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No media found
      </div>
    );
  }

  return (
    <>
      {/* Grid View */}
      <div className="grid grid-cols-3 gap-1">
        {visibleMedia.map((item, index) => (
          <Link
            key={`${item.url}-${index}`}
            href={`/${toNevent(item.noteId)}`}
            className="relative aspect-square overflow-hidden rounded-sm bg-muted hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {item.type === "image" ? (
              <Image
                src={item.url || "/placeholder.svg"}
                alt=""
                fill
                className="object-cover"
                unoptimized
                onError={() => handleImageError(item.url)}
              />
            ) : (
              <video
                src={item.url}
                className="w-full h-full object-cover"
                muted
                onError={() => handleImageError(item.url)}
              />
            )}
          </Link>
        ))}
      </div>

      {/* Infinite scroll trigger */}
      <div ref={loadMoreRef} className="py-4">
        {loadingMore && (
          <div className="flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {!hasMore && media.length > 0 && (
          <p className="text-center text-sm text-muted-foreground">
            No more media
          </p>
        )}
      </div>
    </>
  );
}
