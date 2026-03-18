"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useNostr } from "@/lib/nostr/context";
import { decodeNip19, toNpub, shortenNpub } from "@/lib/nostr/utils";

interface NostrMentionProps {
  identifier: string; // npub1... or nprofile1...
}

export function NostrMention({ identifier }: NostrMentionProps) {
  const { getCachedProfile, getProfile } = useNostr();
  const [displayName, setDisplayName] = useState<string | null>(null);
  
  // Decode the identifier to get the pubkey
  const decoded = decodeNip19(identifier);
  const pubkey = decoded?.type === "npub" || decoded?.type === "nprofile" 
    ? (decoded.data as string) 
    : null;
  
  const npub = pubkey ? toNpub(pubkey) : identifier;

  useEffect(() => {
    if (!pubkey) return;

    // Try cache first
    const cached = getCachedProfile(pubkey);
    if (cached) {
      setDisplayName(cached.display_name || cached.name || null);
      return;
    }

    // Fetch profile
    let cancelled = false;
    getProfile(pubkey).then((profile) => {
      if (!cancelled && profile) {
        setDisplayName(profile.display_name || profile.name || null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pubkey, getCachedProfile, getProfile]);

  const label = displayName ? `@${displayName}` : `@${shortenNpub(npub)}`;

  return (
    <Link
      href={`/${npub}`}
      onClick={(e) => e.stopPropagation()}
      className="text-sky-500 hover:text-sky-400 hover:underline font-medium"
    >
      {label}
    </Link>
  );
}
