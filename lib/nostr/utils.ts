import { nip19, nip05, generateSecretKey, getPublicKey } from "nostr-tools";

export interface Profile {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// Decode any NIP-19 identifier
export function decodeNip19(input: string): { type: string; data: string | Uint8Array } | null {
  try {
    // Check if it's already a hex string (64 chars)
    if (/^[0-9a-f]{64}$/i.test(input)) {
      return { type: "hex", data: input };
    }
    
    const decoded = nip19.decode(input);
    
    if (decoded.type === "npub" || decoded.type === "note") {
      return { type: decoded.type, data: decoded.data as string };
    }
    
    if (decoded.type === "nprofile") {
      return { type: "nprofile", data: (decoded.data as { pubkey: string }).pubkey };
    }
    
    if (decoded.type === "nevent") {
      return { type: "nevent", data: (decoded.data as { id: string }).id };
    }
    
    if (decoded.type === "nsec") {
      return { type: "nsec", data: decoded.data as Uint8Array };
    }
    
    return null;
  } catch {
    return null;
  }
}

// Convert to npub
export function toNpub(pubkey: string): string {
  try {
    if (pubkey.startsWith("npub1")) return pubkey;
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
}

// Convert to note1
export function toNoteId(eventId: string): string {
  try {
    if (eventId.startsWith("note1")) return eventId;
    return nip19.noteEncode(eventId);
  } catch {
    return eventId;
  }
}

// Convert to nevent
export function toNevent(eventId: string, relays?: string[]): string {
  try {
    if (eventId.startsWith("nevent1")) return eventId;
    // If it's a note1, decode it first
    if (eventId.startsWith("note1")) {
      const decoded = nip19.decode(eventId);
      eventId = decoded.data as string;
    }
    return nip19.neventEncode({ id: eventId, relays });
  } catch {
    return eventId;
  }
}

// Shorten npub for display
export function shortenNpub(npub: string): string {
  if (!npub) return "";
  const encoded = npub.startsWith("npub1") ? npub : toNpub(npub);
  return `${encoded.slice(0, 8)}...${encoded.slice(-4)}`;
}

// Parse profile JSON from kind 0 event
export function parseProfile(event: NostrEvent): Profile {
  try {
    return JSON.parse(event.content);
  } catch {
    return {};
  }
}

// Resolve NIP-05 identifier
export async function resolveNip05(identifier: string): Promise<string | null> {
  try {
    const profile = await nip05.queryProfile(identifier);
    return profile?.pubkey || null;
  } catch {
    return null;
  }
}

// Generate new keypair
export function generateKeypair(): { sk: Uint8Array; pk: string; nsec: string; npub: string } {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return {
    sk,
    pk,
    nsec: nip19.nsecEncode(sk),
    npub: nip19.npubEncode(pk),
  };
}

// Extract YouTube video ID from various URL formats
export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Detect media in content
export interface ExtractedMedia {
  images: string[];
  videos: string[];
  youtube: string[];
  audio: string[];
  links: string[];
}

export function extractMedia(content: string): ExtractedMedia {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  const urls = content.match(urlRegex) || [];
  
  const images: string[] = [];
  const videos: string[] = [];
  const youtube: string[] = [];
  const audio: string[] = [];
  const links: string[] = [];
  
  urls.forEach((url) => {
    const cleanUrl = url.replace(/[.,;:!?)]+$/, "");
    
    // Check for YouTube URLs first
    const ytId = extractYouTubeId(cleanUrl);
    if (ytId) {
      if (!youtube.includes(ytId)) {
        youtube.push(ytId);
      }
      return;
    }
    
    // Image formats
    if (/\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i.test(cleanUrl) ||
        /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico)/i.test(cleanUrl)) {
      if (!images.includes(cleanUrl)) images.push(cleanUrl);
    }
    // Video formats
    else if (/\.(mp4|webm|mov|m4v|avi|mkv|ogv|3gp)(\?.*)?$/i.test(cleanUrl) ||
             /\.(mp4|webm|mov|m4v|avi|mkv|ogv|3gp)/i.test(cleanUrl)) {
      if (!videos.includes(cleanUrl)) videos.push(cleanUrl);
    }
    // Audio formats
    else if (/\.(mp3|wav|ogg|flac|aac|m4a|opus|wma|aiff)(\?.*)?$/i.test(cleanUrl) ||
             /\.(mp3|wav|ogg|flac|aac|m4a|opus|wma|aiff)/i.test(cleanUrl)) {
      if (!audio.includes(cleanUrl)) audio.push(cleanUrl);
    }
    // Regular links
    else {
      if (!links.includes(cleanUrl)) links.push(cleanUrl);
    }
  });
  
  return { images, videos, youtube, audio, links };
}

// Format timestamp
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

// Remove all URLs from content for display (all URLs are rendered as embeds)
export function stripUrls(content: string): string {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  return content.replace(urlRegex, "").replace(/\s+/g, " ").trim();
}

// Popular Nostr clients
export const NOSTR_CLIENTS = [
  { name: "Damus", scheme: "damus:", webUrl: null, platforms: ["ios"] },
  { name: "Amethyst", scheme: "nostr:", webUrl: null, platforms: ["android"] },
  { name: "Primal", scheme: "primal:", webUrl: "https://primal.net", platforms: ["ios", "android", "web"] },
  { name: "Snort", scheme: null, webUrl: "https://snort.social", platforms: ["web"] },
  { name: "Coracle", scheme: null, webUrl: "https://coracle.social", platforms: ["web"] },
  { name: "Nostrudel", scheme: null, webUrl: "https://nostrudel.ninja", platforms: ["web"] },
  { name: "Iris", scheme: null, webUrl: "https://iris.to", platforms: ["web"] },
];

// Generate client URLs
export function getClientUrls(type: "profile" | "note", identifier: string) {
  return {
    primal: type === "profile" 
      ? `https://primal.net/p/${identifier}` 
      : `https://primal.net/e/${identifier}`,
    damus: type === "profile"
      ? `https://damus.io/${identifier}`
      : `https://damus.io/${identifier}`,
    x21: type === "profile"
      ? `https://x21.social/${identifier}`
      : `https://x21.social/${identifier}`,
    jumble: type === "profile"
      ? `https://jumble.social/${identifier}`
      : `https://jumble.social/${identifier}`,
    snort: type === "profile"
      ? `https://snort.social/p/${identifier}`
      : `https://snort.social/e/${identifier}`,
    coracle: type === "profile"
      ? `https://coracle.social/${identifier}`
      : `https://coracle.social/${identifier}`,
    nostrudel: type === "profile"
      ? `https://nostrudel.ninja/u/${identifier}`
      : `https://nostrudel.ninja/n/${identifier}`,
    iris: type === "profile"
      ? `https://iris.to/${identifier}`
      : `https://iris.to/${identifier}`,
    nostrScheme: `nostr:${identifier}`,
  };
}

// Detect if mobile
export function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

// Parse nostr: URIs from content
export interface NostrUri {
  type: "note" | "nevent" | "npub" | "nprofile";
  id: string;
  original: string;
}

export function parseNostrUris(content: string): NostrUri[] {
  const regex = /nostr:(note1[a-z0-9]+|nevent1[a-z0-9]+|npub1[a-z0-9]+|nprofile1[a-z0-9]+)/gi;
  const matches = content.matchAll(regex);
  const uris: NostrUri[] = [];

  for (const match of matches) {
    const identifier = match[1];
    let type: NostrUri["type"];
    
    if (identifier.startsWith("note1")) {
      type = "note";
    } else if (identifier.startsWith("nevent1")) {
      type = "nevent";
    } else if (identifier.startsWith("npub1")) {
      type = "npub";
    } else if (identifier.startsWith("nprofile1")) {
      type = "nprofile";
    } else {
      continue;
    }

    uris.push({
      type,
      id: identifier,
      original: match[0],
    });
  }

  return uris;
}

// Strip nostr URIs from content
export function stripNostrUris(content: string): string {
  return content.replace(/nostr:(note1[a-z0-9]+|nevent1[a-z0-9]+|npub1[a-z0-9]+|nprofile1[a-z0-9]+)/gi, "").trim();
}
