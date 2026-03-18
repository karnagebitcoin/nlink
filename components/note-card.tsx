"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Copy, Link2, User, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNostr } from "@/lib/nostr/context";
import { useI18n } from "@/lib/i18n/context";
import type { NoteEngagementStats } from "@/hooks/use-note-stats";
import { toast } from "sonner";
import {
  extractMedia,
  formatTimestamp,
  getParentEventId,
  parseNostrUris,
  stripUrls,
  stripNostrUris,
  toNevent,
  toNpub,
  shortenNpub,
  type Profile,
  type NostrEvent,
} from "@/lib/nostr/utils";
import { EmbeddedNote } from "@/components/embedded-note";
import { LinkPreview } from "@/components/link-preview";
import { NoteContent } from "@/components/note-content";
import { ParentNotePreview } from "@/components/parent-note-preview";
import { NoteStatsRow } from "@/components/note-stats-row";

interface NoteCardProps {
  event: NostrEvent;
  engagement?: NoteEngagementStats;
  initialAuthor?: Profile | null;
}

export function NoteCard({ event, engagement, initialAuthor = null }: NoteCardProps) {
  const router = useRouter();
  const { getCachedProfile, getProfile } = useNostr();
  const { t } = useI18n();
  // Try to get from cache immediately for instant display
  const [author, setAuthor] = useState(() => initialAuthor ?? getCachedProfile(event.pubkey));
  const { images, videos, youtube, audio, links } = extractMedia(event.content);
  const nostrUris = parseNostrUris(event.content);
  const noteUris = nostrUris.filter((uri) => uri.type === "note" || uri.type === "nevent");
  const textContent = stripNostrUris(stripUrls(event.content));
  const neventId = toNevent(event.id);
  const parentEventId = getParentEventId(event);
  const displayName = author?.display_name || author?.name || shortenNpub(toNpub(event.pubkey));

  useEffect(() => {
    if (initialAuthor) {
      setAuthor(initialAuthor);
      return;
    }

    // If we already have it cached, no need to fetch
    if (author) return;
    
    let cancelled = false;
    
    getProfile(event.pubkey).then((profile) => {
      if (!cancelled && profile) {
        setAuthor(profile);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [author, event.pubkey, getProfile, initialAuthor]);

  return (
    <Link href={`/${neventId}`} className="block">
      <Card className="hover:bg-accent/50 transition-colors cursor-pointer py-0 gap-0">
        <CardContent className="p-3">
          {/* Author header */}
          <div className="flex items-center gap-2 mb-2">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarImage src={author?.picture || "/placeholder.svg"} />
              <AvatarFallback className="text-xs">
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {displayName}
              </p>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatTimestamp(event.created_at)}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.preventDefault()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  <span className="sr-only">Note menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.preventDefault()}>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(textContent);
                    toast.success(t.copied);
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  {t.copyText}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(toNpub(event.pubkey));
                    toast.success(t.copied);
                  }}
                >
                  <User className="mr-2 h-4 w-4" />
                  {t.copyUserKey}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(neventId);
                    toast.success(t.copied);
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  {t.copyNoteId}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    const url = `${window.location.origin}/${neventId}`;
                    navigator.clipboard.writeText(url);
                    toast.success(t.copied);
                  }}
                >
                  <Link2 className="mr-2 h-4 w-4" />
                  {t.copyNoteUrl}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Text content with inline mentions */}
          {parentEventId && (
            <ParentNotePreview
              className="mb-2"
              eventId={parentEventId}
              onClick={(previewEvent) => {
                previewEvent.preventDefault();
                previewEvent.stopPropagation();
                router.push(`/${toNevent(parentEventId)}`);
              }}
            />
          )}

          <NoteContent content={event.content} className="text-sm leading-relaxed" />

          {/* Embedded notes */}
          {noteUris.length > 0 && (
            <div className="mt-2" onClick={(e) => e.stopPropagation()}>
              {noteUris.map((uri) => (
                <EmbeddedNote key={uri.id} noteId={uri.id} />
              ))}
            </div>
          )}

          {/* Images */}
          {images.length > 0 && (
            <div className={`mt-2 grid gap-2 ${images.length === 1 ? "" : "grid-cols-2"}`}>
              {images.slice(0, 4).map((url, i) => (
                <div
                  key={url}
                  className="relative rounded-md overflow-hidden bg-muted"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(url, "_blank");
                  }}
                >
                  <Image
                    src={url || "/placeholder.svg"}
                    alt=""
                    width={800}
                    height={600}
                    className="w-full h-auto object-contain hover:scale-105 transition-transform"
                    unoptimized
                  />
                  {i === 3 && images.length > 4 && (
                    <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                      <span className="text-lg font-semibold">+{images.length - 4}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Videos */}
          {videos.length > 0 && (
            <div className="mt-2 space-y-2">
              {videos.slice(0, 2).map((url) => (
                <video
                  key={url}
                  src={url}
                  controls
                  className="w-full rounded-md"
                  onClick={(e) => e.stopPropagation()}
                />
              ))}
            </div>
          )}

          {/* YouTube embeds */}
          {youtube.length > 0 && (
            <div className="mt-2 space-y-2">
              {youtube.slice(0, 2).map((videoId) => (
                <div
                  key={videoId}
                  className="relative aspect-video rounded-md overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  <iframe
                    src={`https://www.youtube.com/embed/${videoId}`}
                    title="YouTube video"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 w-full h-full"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Audio */}
          {audio.length > 0 && (
            <div className="mt-2 space-y-2">
              {audio.map((url) => (
                <audio
                  key={url}
                  src={url}
                  controls
                  className="w-full"
                  onClick={(e) => e.stopPropagation()}
                />
              ))}
            </div>
          )}

          {/* Link previews */}
          {links.length > 0 && (
            <div onClick={(e) => e.stopPropagation()}>
              {links.slice(0, 2).map((url) => (
                <LinkPreview key={url} url={url} />
              ))}
            </div>
          )}

          <NoteStatsRow
            stats={engagement}
            className="mt-3 border-t border-border/50 pt-3"
          />
        </CardContent>
      </Card>
    </Link>
  );
}
