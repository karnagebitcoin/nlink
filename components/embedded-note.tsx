"use client";

import React from "react"

import Link from "next/link"

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useNostr } from "@/lib/nostr/context";
import {
  decodeNip19,
  extractMedia,
  formatTimestamp,
  stripUrls,
  toNevent,
  toNpub,
  shortenNpub,
  type NostrEvent,
} from "@/lib/nostr/utils";
import Image from "next/image";

interface EmbeddedNoteProps {
  noteId: string; // Can be note1..., nevent1..., or hex
}

export function EmbeddedNote({ noteId }: EmbeddedNoteProps) {
  const router = useRouter();
  const { query, getCachedProfile, getProfile } = useNostr();
  const [event, setEvent] = useState<NostrEvent | null>(null);
  const [author, setAuthor] = useState<{ name?: string; display_name?: string; picture?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchNote() {
      setLoading(true);
      setError(false);

      try {
        // Decode the note ID to get the hex event ID
        const decoded = decodeNip19(noteId);
        if (!decoded) {
          setError(true);
          setLoading(false);
          return;
        }

        const eventId = decoded.data as string;

        // Fetch the event
        const events = await query([{ ids: [eventId], kinds: [1], limit: 1 }]);

        if (events.length === 0) {
          setError(true);
          setLoading(false);
          return;
        }

        const noteEvent = events[0];
        setEvent(noteEvent);

        // Try to get cached profile first
        const cached = getCachedProfile(noteEvent.pubkey);
        if (cached) {
          setAuthor(cached);
        } else {
          // Fetch profile
          const profile = await getProfile(noteEvent.pubkey);
          if (profile) {
            setAuthor(profile);
          }
        }
      } catch (err) {
        console.error("Failed to fetch embedded note:", err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchNote();
  }, [noteId, query, getCachedProfile, getProfile]);

  if (loading) {
    return (
      <div className="mt-2 p-3 bg-muted/30 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4 mt-1" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="mt-2 p-3 bg-muted/30 border border-border rounded-lg">
        <p className="text-sm text-muted-foreground">
          Could not load referenced note
        </p>
      </div>
    );
  }

  const textContent = stripUrls(event.content).slice(0, 280);
  const displayName = author?.display_name || author?.name || shortenNpub(toNpub(event.pubkey));
  const neventEncoded = toNevent(event.id);
  const { images, videos, youtube } = extractMedia(event.content);
  const hasMedia = images.length > 0 || videos.length > 0 || youtube.length > 0;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/${neventEncoded}`);
  };

  return (
    <div
      onClick={handleClick}
      onKeyDown={(e) => e.key === "Enter" && handleClick(e as unknown as React.MouseEvent)}
      role="link"
      tabIndex={0}
      className="block cursor-pointer"
    >
      <div className="mt-2 p-3 bg-muted/30 border border-border rounded-lg hover:bg-muted/50 transition-colors">
          {/* Author header */}
          <div className="flex items-center gap-2 mb-1">
            <Avatar className="h-5 w-5 shrink-0">
              <AvatarImage src={author?.picture || "/placeholder.svg"} />
              <AvatarFallback className="text-xs">
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-medium truncate">
              {displayName}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(event.created_at)}
            </span>
          </div>

          {/* Text content (truncated) */}
          {textContent && (
            <p className="text-sm text-muted-foreground line-clamp-3">
              {textContent}
              {event.content.length > 280 && "..."}
            </p>
          )}

          {/* Media preview */}
          {hasMedia && (
            <div className={`${textContent ? "mt-2" : ""} flex gap-1 overflow-hidden rounded`}>
              {/* Show first image */}
              {images.length > 0 && (
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded bg-muted">
                  <Image
                    src={images[0] || "/placeholder.svg"}
                    alt=""
                    fill
                    className="object-cover"
                    unoptimized
                  />
                  {images.length > 1 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xs font-medium">
                      +{images.length - 1}
                    </div>
                  )}
                </div>
              )}
              
              {/* Show first video thumbnail */}
              {videos.length > 0 && images.length === 0 && (
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded bg-muted">
                  <video
                    src={videos[0]}
                    className="w-full h-full object-cover"
                    muted
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-6 h-6 rounded-full bg-black/60 flex items-center justify-center">
                      <div className="w-0 h-0 border-t-[5px] border-t-transparent border-l-[8px] border-l-white border-b-[5px] border-b-transparent ml-0.5" />
                    </div>
                  </div>
                </div>
              )}
              
              {/* Show YouTube thumbnail */}
              {youtube.length > 0 && images.length === 0 && videos.length === 0 && (
                <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded bg-muted">
                  <Image
                    src={`https://img.youtube.com/vi/${youtube[0]}/mqdefault.jpg`}
                    alt=""
                    fill
                    className="object-cover"
                    unoptimized
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-6 h-6 rounded-full bg-red-600 flex items-center justify-center">
                      <div className="w-0 h-0 border-t-[5px] border-t-transparent border-l-[8px] border-l-white border-b-[5px] border-b-transparent ml-0.5" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
    </div>
  );
}
