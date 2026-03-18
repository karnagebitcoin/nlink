"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/context";
import { useNostr } from "@/lib/nostr/context";
import {
  extractMedia,
  shortenNpub,
  stripNostrUris,
  stripUrls,
  toNpub,
  type NostrEvent,
  type Profile,
} from "@/lib/nostr/utils";
import { cn } from "@/lib/utils";

interface ParentNotePreviewProps {
  className?: string;
  eventId: string;
  onClick?: (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => void;
}

export function ParentNotePreview({ className, eventId, onClick }: ParentNotePreviewProps) {
  const { t } = useI18n();
  const { getCachedEvent, getEvent, getCachedProfile, getProfile } = useNostr();
  const [event, setEvent] = useState<NostrEvent | null>(() => getCachedEvent(eventId));
  const [author, setAuthor] = useState<Profile | null>(() => {
    const cachedEvent = getCachedEvent(eventId);
    return cachedEvent ? getCachedProfile(cachedEvent.pubkey) : null;
  });
  const [loading, setLoading] = useState(() => !getCachedEvent(eventId));

  useEffect(() => {
    let cancelled = false;
    const cachedEvent = getCachedEvent(eventId);

    if (cachedEvent) {
      setEvent(cachedEvent);
      setLoading(false);

      const cachedAuthor = getCachedProfile(cachedEvent.pubkey);
      if (cachedAuthor) {
        setAuthor(cachedAuthor);
      }
    } else {
      setLoading(true);
    }

    async function loadParent() {
      const parentEvent = cachedEvent ?? await getEvent(eventId);
      if (cancelled) {
        return;
      }

      if (!parentEvent) {
        setEvent(null);
        setAuthor(null);
        setLoading(false);
        return;
      }

      setEvent(parentEvent);
      setLoading(false);

      const cachedAuthor = getCachedProfile(parentEvent.pubkey);
      if (cachedAuthor) {
        setAuthor(cachedAuthor);
        return;
      }

      const profile = await getProfile(parentEvent.pubkey);
      if (!cancelled && profile) {
        setAuthor(profile);
      }
    }

    void loadParent();

    return () => {
      cancelled = true;
    };
  }, [eventId, getCachedEvent, getCachedProfile, getEvent, getProfile]);

  const previewText = useMemo(() => {
    if (!event) {
      return t.couldNotLoadNote;
    }

    const text = stripNostrUris(stripUrls(event.content));
    if (text) {
      return text;
    }

    const media = extractMedia(event.content);
    if (
      media.images.length > 0 ||
      media.videos.length > 0 ||
      media.youtube.length > 0 ||
      media.audio.length > 0 ||
      media.links.length > 0
    ) {
      return t.media;
    }

    return "...";
  }, [event, t]);

  const displayName = event
    ? author?.display_name || author?.name || shortenNpub(toNpub(event.pubkey))
    : "";

  const handleKeyDown = (keyboardEvent: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) {
      return;
    }

    if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
      keyboardEvent.preventDefault();
      onClick(keyboardEvent);
    }
  };

  if (loading) {
    return (
      <div
        className={cn(
          "flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-1 text-sm text-muted-foreground",
          className,
        )}
      >
        <div className="shrink-0">{t.replyTo}</div>
        <Skeleton className="h-4 w-4 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-fit max-w-full items-center gap-1 rounded-full bg-muted px-2 py-1 text-sm text-muted-foreground",
        onClick && event && "cursor-pointer hover:text-foreground",
        className,
      )}
      onClick={event && onClick ? onClick : undefined}
      onKeyDown={event && onClick ? handleKeyDown : undefined}
      role={event && onClick ? "link" : undefined}
      tabIndex={event && onClick ? 0 : undefined}
    >
      <div className="shrink-0">{t.replyTo}</div>
      {event && (
        <>
          <Avatar className="h-4 w-4 shrink-0">
            <AvatarImage src={author?.picture || "/placeholder.svg"} />
            <AvatarFallback className="text-[9px]">
              {displayName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{previewText}</span>
        </>
      )}
      {!event && <span className="truncate">{previewText}</span>}
    </div>
  );
}
