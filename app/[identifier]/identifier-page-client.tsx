"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ExternalLink, ArrowLeft, MoreHorizontal, Copy, Link2, User, FileText } from "lucide-react";
import { useNostr } from "@/lib/nostr/context";
import { useI18n } from "@/lib/i18n/context";
import { ProfileCard } from "@/components/profile/profile-card";
import { NoteFeed } from "@/components/profile/note-feed";
import { MediaGallery } from "@/components/profile/media-gallery";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OpenInClientDialog } from "@/components/open-in-client-dialog";
import { LinkPreview } from "@/components/link-preview";
import { NoteScreenshot } from "@/components/note-screenshot";
import { NoteContent } from "@/components/note-content";
import { NoteComments } from "@/components/note-comments";
import { NoteStatsRow } from "@/components/note-stats-row";
import { toast } from "sonner";
import { useNoteStats } from "@/hooks/use-note-stats";
import {
  extractMedia,
  formatTimestamp,
  stripUrls,
  toNpub,
  toNevent,
  shortenNpub,
  type NostrEvent,
  type Profile,
} from "@/lib/nostr/utils";

type IdentifierType = "profile" | "note" | "unknown";

interface IdentifierPageClientProps {
  identifier: string;
  initialAuthor: Profile | null;
  initialEvent: NostrEvent | null;
  initialHasMoreNotes: boolean;
  initialNotes: NostrEvent[];
  initialProfile: Profile | null;
  resolvedType: IdentifierType;
  resolvedHexId: string | null;
}

function ProfileView({
  initialHasMoreNotes,
  initialNotes,
  initialProfile,
  npub,
  pubkey,
}: {
  initialHasMoreNotes: boolean;
  initialNotes: NostrEvent[];
  initialProfile: Profile | null;
  npub: string;
  pubkey: string;
}) {
  const { getCachedProfile, getProfile } = useNostr();
  const { t } = useI18n();
  const [profile, setProfile] = useState<Profile | null>(initialProfile);
  const [loading, setLoading] = useState(!initialProfile);

  useEffect(() => {
    let cancelled = false;
    const cached = initialProfile ?? getCachedProfile(pubkey);

    if (cached) {
      setProfile(cached);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    async function loadProfile() {
      const freshProfile = await getProfile(pubkey);
      if (cancelled) return;

      if (freshProfile) {
        setProfile(freshProfile);
      } else {
        setProfile({});
      }
      setLoading(false);
    }

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [getCachedProfile, getProfile, initialProfile, pubkey]);

  return (
    <>
      {loading && !profile ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <div className="flex gap-4">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        </div>
      ) : (
        <ProfileCard profile={profile} pubkey={pubkey} npub={npub} />
      )}
      <Tabs defaultValue="notes" className="mt-6">
        <TabsList className="w-full">
          <TabsTrigger value="notes" className="flex-1">{t.notes}</TabsTrigger>
          <TabsTrigger value="media" className="flex-1">{t.media}</TabsTrigger>
        </TabsList>
        <TabsContent value="notes" className="mt-4">
          <NoteFeed
            initialAuthor={profile}
            initialHasMore={initialHasMoreNotes}
            initialNotes={initialNotes}
            pubkey={pubkey}
          />
        </TabsContent>
        <TabsContent value="media" className="mt-4">
          <MediaGallery initialEvents={initialNotes} pubkey={pubkey} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function NoteView({
  eventId,
  initialAuthor,
  initialEvent,
  nevent,
}: {
  eventId: string;
  initialAuthor: Profile | null;
  initialEvent: NostrEvent | null;
  nevent: string;
}) {
  const { getEvent, getCachedEvent, getCachedProfile, getProfile } = useNostr();
  const { t } = useI18n();
  const [event, setEvent] = useState<NostrEvent | null>(initialEvent);
  const [author, setAuthor] = useState<Profile | null>(initialAuthor);
  const [loading, setLoading] = useState(!initialEvent);
  const [error, setError] = useState<string | null>(null);
  const [openInClientOpen, setOpenInClientOpen] = useState(false);
  const noteStats = useNoteStats(event ? [event.id] : []);

  useEffect(() => {
    let cancelled = false;

    async function loadNote() {
      setError(null);

      const cachedEvent = initialEvent ?? getCachedEvent(eventId);
      if (cachedEvent) {
        setEvent(cachedEvent);
        setLoading(false);

        const cachedAuthor = initialAuthor ?? getCachedProfile(cachedEvent.pubkey);
        if (cachedAuthor) {
          setAuthor(cachedAuthor);
          return;
        }
      } else {
        setLoading(true);
      }

      try {
        const noteEvent = cachedEvent ?? await getEvent(eventId);
        if (!noteEvent) {
          if (!cancelled) {
            setError("Note not found");
            setLoading(false);
          }
          return;
        }

        if (cancelled) return;
        setEvent(noteEvent);
        setLoading(false);

        const cachedAuthor = initialAuthor ?? getCachedProfile(noteEvent.pubkey);
        if (cachedAuthor) {
          setAuthor(cachedAuthor);
          return;
        }

        const freshAuthor = await getProfile(noteEvent.pubkey);
        if (!cancelled && freshAuthor) {
          setAuthor(freshAuthor);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load note");
          setLoading(false);
        }
      }
    }

    loadNote();

    return () => {
      cancelled = true;
    };
  }, [eventId, getCachedEvent, getCachedProfile, getEvent, getProfile, initialAuthor, initialEvent]);

  if (error) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold mb-2">Error</h2>
        <p className="text-muted-foreground">{error}</p>
        <Button asChild className="mt-4">
          <Link href="/">Go Home</Link>
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <>
        <Skeleton className="h-8 w-24 mb-6" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </>
    );
  }

  if (!event) return null;

  const { images, videos, youtube, audio, links } = extractMedia(event.content);
  const textContent = stripUrls(event.content);
  const displayName = author?.display_name || author?.name || shortenNpub(toNpub(event.pubkey));
  const fullNevent = nevent.startsWith("nevent1") ? nevent : toNevent(event.id);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/${toNpub(event.pubkey)}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t.backToProfile}
          </Link>
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 bg-transparent"
            onClick={() => {
              const url = `${window.location.origin}/${fullNevent}`;
              navigator.clipboard.writeText(url);
              toast.success(t.copied);
            }}
          >
            <Link2 className="h-4 w-4" />
            <span className="sr-only">Copy link</span>
          </Button>
          <NoteScreenshot
            event={event}
            author={author}
            textContent={textContent}
            noteUrl={`${typeof window !== "undefined" ? window.location.origin : ""}/${fullNevent}`}
            images={images}
            videos={videos}
            youtube={youtube}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpenInClientOpen(true)}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            {t.openInClient}
          </Button>
        </div>
      </div>

      <Card className="py-0 gap-0">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <Link
              href={`/${toNpub(event.pubkey)}`}
              className="flex items-center gap-3 group min-w-0 flex-1"
            >
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={author?.picture || "/placeholder.svg"} />
                <AvatarFallback>
                  {displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-semibold group-hover:underline truncate">
                  {displayName}
                </p>
                {author?.nip05 && (
                  <p className="text-sm text-muted-foreground truncate">
                    {author.nip05}
                  </p>
                )}
              </div>
            </Link>
            <span className="text-sm text-muted-foreground shrink-0">
              {formatTimestamp(event.created_at)}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Note menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    navigator.clipboard.writeText(textContent);
                    toast.success(t.copied);
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  {t.copyText}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    navigator.clipboard.writeText(toNpub(event.pubkey));
                    toast.success(t.copied);
                  }}
                >
                  <User className="mr-2 h-4 w-4" />
                  {t.copyUserKey}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    navigator.clipboard.writeText(fullNevent);
                    toast.success(t.copied);
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  {t.copyNoteId}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const url = `${window.location.origin}/${fullNevent}`;
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

          <NoteContent content={event.content} className="text-base leading-relaxed" />

          {images.length > 0 && (
            <div className={`mt-4 grid gap-2 ${images.length === 1 ? "" : "grid-cols-2"}`}>
              {images.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative rounded-lg overflow-hidden bg-muted"
                >
                  <Image
                    src={url || "/placeholder.svg"}
                    alt=""
                    width={800}
                    height={600}
                    className="w-full h-auto object-contain hover:scale-105 transition-transform"
                    unoptimized
                  />
                </a>
              ))}
            </div>
          )}

          {videos.length > 0 && (
            <div className="mt-4 space-y-2">
              {videos.map((url) => (
                <video
                  key={url}
                  src={url}
                  controls
                  className="w-full rounded-lg"
                />
              ))}
            </div>
          )}

          {youtube.length > 0 && (
            <div className="mt-4 space-y-2">
              {youtube.map((videoId) => (
                <div
                  key={videoId}
                  className="relative aspect-video rounded-lg overflow-hidden"
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

          {audio.length > 0 && (
            <div className="mt-4 space-y-2">
              {audio.map((url) => (
                <audio
                  key={url}
                  src={url}
                  controls
                  className="w-full"
                />
              ))}
            </div>
          )}

          {links.length > 0 && (
            <div>
              {links.map((url) => (
                <LinkPreview key={url} url={url} />
              ))}
            </div>
          )}

          <NoteStatsRow
            stats={noteStats[event.id]}
            className="mt-4 border-t border-border/50 pt-4 text-sm"
          />
        </CardContent>
      </Card>

      <NoteComments
        eventId={event.id}
        commentCount={noteStats[event.id]?.commentCount ?? 0}
      />

      <OpenInClientDialog
        open={openInClientOpen}
        onOpenChange={setOpenInClientOpen}
        type="note"
        identifier={fullNevent}
      />
    </>
  );
}

export function IdentifierPageClient({
  identifier,
  initialAuthor,
  initialEvent,
  initialHasMoreNotes,
  initialNotes,
  initialProfile,
  resolvedType,
  resolvedHexId,
}: IdentifierPageClientProps) {
  if (resolvedType === "unknown" || !resolvedHexId) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold mb-2">Invalid Identifier</h2>
        <p className="text-muted-foreground">
          The identifier provided is not a valid npub, nevent, note, or nprofile.
        </p>
        <Button asChild className="mt-4">
          <Link href="/">Go Home</Link>
        </Button>
      </div>
    );
  }

  return resolvedType === "profile" ? (
    <ProfileView
      initialHasMoreNotes={initialHasMoreNotes}
      initialNotes={initialNotes}
      initialProfile={initialProfile}
      npub={identifier.startsWith("npub1") ? identifier : toNpub(resolvedHexId)}
      pubkey={resolvedHexId}
    />
  ) : (
    <NoteView
      eventId={resolvedHexId}
      initialAuthor={initialAuthor}
      initialEvent={initialEvent}
      nevent={identifier.startsWith("nevent1") ? identifier : toNevent(resolvedHexId)}
    />
  );
}
