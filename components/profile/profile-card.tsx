"use client";

import { useState } from "react";
import Image from "next/image";
import { Copy, Check, ExternalLink, Globe, Zap, BadgeCheck, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { OpenInClientDialog } from "@/components/open-in-client-dialog";
import { shortenNpub, toNpub } from "@/lib/nostr/utils";
import { useI18n } from "@/lib/i18n/context";
import { toast } from "sonner";

interface Profile {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
}

interface ProfileCardProps {
  profile: Profile | null;
  pubkey: string;
  npub: string;
}

export function ProfileCard({ profile, pubkey, npub }: ProfileCardProps) {
  const { t } = useI18n();
  const [copiedNpub, setCopiedNpub] = useState(false);
  const [openInClientOpen, setOpenInClientOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);

  const displayName = profile?.display_name || profile?.name || "Anonymous";
  const username = profile?.name;
  const fullNpub = npub.startsWith("npub1") ? npub : toNpub(pubkey);

  const copyNpub = async () => {
    await navigator.clipboard.writeText(fullNpub);
    setCopiedNpub(true);
    setTimeout(() => setCopiedNpub(false), 2000);
    toast.success(t.copied);
  };

  return (
    <>
      <Card className="overflow-hidden py-0 gap-0">
        {/* Banner */}
        {profile?.banner && (
          <div className="relative h-32 sm:h-40 w-full bg-muted">
            <Image
              src={profile.banner || "/placeholder.svg"}
              alt="Banner"
              fill
              className="object-cover"
              unoptimized
            />
          </div>
        )}
        
        <CardContent className={`${profile?.banner ? "-mt-12" : "pt-4"} pb-4 px-4`}>
          {/* Header row with avatar, name, and action buttons */}
          <div className="flex items-start gap-3">
            {/* Avatar */}
            <Avatar className="h-20 w-20 sm:h-24 sm:w-24 border-4 border-background ring-2 ring-border shrink-0">
              <AvatarImage src={profile?.picture || "/placeholder.svg"} alt={displayName} />
              <AvatarFallback className="text-2xl">
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            {/* Name and buttons in same row */}
            <div className="flex-1 min-w-0 pt-14 sm:pt-14">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h1 className="text-xl font-bold truncate">{displayName}</h1>
                  {username && username !== displayName && (
                    <p className="text-sm text-muted-foreground truncate">@{username}</p>
                  )}
                  {profile?.nip05 && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <BadgeCheck className="h-3.5 w-3.5 text-primary" />
                      <span className="truncate">{profile.nip05}</span>
                    </p>
                  )}
                </div>
                
                {/* Action buttons - next to username */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenInClientOpen(true)}
                  >
                    <ExternalLink className="h-4 w-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">{t.openInClient}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setQrDialogOpen(true)}
                    className="h-8 w-8"
                  >
                    <QrCode className="h-4 w-4" />
                    <span className="sr-only">Show QR code</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* About */}
          {profile?.about && (
            <p className="mt-3 text-sm text-foreground/90 whitespace-pre-wrap break-words line-clamp-4">
              {profile.about}
            </p>
          )}

          {/* Links and Npub */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-3 text-sm text-muted-foreground">
            {profile?.website && (
              <a
                href={profile.website.startsWith("http") ? profile.website : `https://${profile.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <Globe className="h-3.5 w-3.5" />
                <span className="truncate max-w-[150px]">
                  {profile.website.replace(/^https?:\/\//, "")}
                </span>
              </a>
            )}
            {profile?.lud16 && (
              <span className="flex items-center gap-1">
                <Zap className="h-3.5 w-3.5" />
                <span className="truncate max-w-[150px]">{profile.lud16}</span>
              </span>
            )}
            <button
              onClick={copyNpub}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              {copiedNpub ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span className="font-mono text-xs">{shortenNpub(fullNpub)}</span>
            </button>
          </div>
        </CardContent>
      </Card>

      <OpenInClientDialog
        open={openInClientOpen}
        onOpenChange={setOpenInClientOpen}
        type="profile"
        identifier={fullNpub}
      />

      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center">{t.scanToFollow}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="p-4 bg-white rounded-xl">
              <QRCodeSVG 
                value={`nostr:${fullNpub}`}
                size={200}
                level="M"
              />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              {t.scanWithNostrApp}
            </p>
            <p className="font-mono text-xs text-muted-foreground break-all text-center px-4">
              {fullNpub}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
