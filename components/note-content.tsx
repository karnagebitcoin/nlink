"use client";

import { Fragment } from "react";
import { NostrMention } from "@/components/nostr-mention";
import { parseNostrUris, stripUrls } from "@/lib/nostr/utils";

interface NoteContentProps {
  content: string;
  className?: string;
}

export function NoteContent({ content, className = "" }: NoteContentProps) {
  // Strip URLs first (they're rendered separately as embeds)
  const textWithoutUrls = stripUrls(content);
  
  // Parse nostr URIs
  const nostrUris = parseNostrUris(textWithoutUrls);
  
  // Filter for profile mentions (npub/nprofile)
  const profileMentions = nostrUris.filter(
    (uri) => uri.type === "npub" || uri.type === "nprofile"
  );
  
  // If no profile mentions, just render the text (stripping note references)
  if (profileMentions.length === 0) {
    // Strip note/nevent references as they're rendered as embeds
    const cleanText = textWithoutUrls
      .replace(/nostr:(note1[a-z0-9]+|nevent1[a-z0-9]+)/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    
    return cleanText ? (
      <p className={`whitespace-pre-wrap break-words ${className}`}>
        {cleanText}
      </p>
    ) : null;
  }

  // Build parts array by splitting on profile mentions
  const parts: Array<{ type: "text" | "mention"; content: string }> = [];
  let remaining = textWithoutUrls;

  // Sort mentions by their position in the string
  const sortedMentions = [...profileMentions].sort((a, b) => {
    return remaining.indexOf(a.original) - remaining.indexOf(b.original);
  });

  for (const mention of sortedMentions) {
    const idx = remaining.indexOf(mention.original);
    if (idx === -1) continue;

    // Add text before mention
    if (idx > 0) {
      const textBefore = remaining.slice(0, idx);
      // Strip note references from text
      const cleanText = textBefore
        .replace(/nostr:(note1[a-z0-9]+|nevent1[a-z0-9]+)/gi, "");
      if (cleanText) {
        parts.push({ type: "text", content: cleanText });
      }
    }

    // Add mention
    parts.push({ type: "mention", content: mention.id });

    // Update remaining
    remaining = remaining.slice(idx + mention.original.length);
  }

  // Add any remaining text
  if (remaining) {
    const cleanText = remaining
      .replace(/nostr:(note1[a-z0-9]+|nevent1[a-z0-9]+)/gi, "");
    if (cleanText) {
      parts.push({ type: "text", content: cleanText });
    }
  }

  // If nothing to render
  if (parts.length === 0) return null;

  return (
    <p className={`whitespace-pre-wrap break-words ${className}`}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part.type === "text" ? (
            part.content
          ) : (
            <NostrMention identifier={part.content} />
          )}
        </Fragment>
      ))}
    </p>
  );
}
