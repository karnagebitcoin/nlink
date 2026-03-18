# MKStack Reference for nLink

## Core Technologies
- **nostr-tools**: For NIP-19 encoding/decoding (npub, nsec, note1, nprofile, etc.)
- **@nostrify/nostrify**: For relay connections, pooling, and signing
- **@nostrify/react**: For React hooks (useNostr)
- **@tanstack/react-query**: For data fetching and caching

## Key Imports

\`\`\`typescript
// nostr-tools for encoding/decoding
import { nip19 } from 'nostr-tools';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';

// Nostrify for relay connections
import { NPool, NRelay1, NSecSigner, NConnectSigner } from '@nostrify/nostrify';
import { useNostr, NostrContext } from '@nostrify/react';
\`\`\`

## NIP-19 Encoding/Decoding

\`\`\`typescript
// Decode npub to hex pubkey
const { type, data } = nip19.decode('npub1...');
// type = 'npub', data = hex pubkey

// Encode hex to npub
const npub = nip19.npubEncode(hexPubkey);

// Encode note1
const note1 = nip19.noteEncode(eventId);

// Decode note1
const { type, data } = nip19.decode('note1...');
// type = 'note', data = hex event id

// Generate keys
const sk = generateSecretKey(); // Uint8Array
const pk = getPublicKey(sk); // hex string
const nsec = nip19.nsecEncode(sk);
const npub = nip19.npubEncode(pk);
\`\`\`

## Relay Pool Setup (NostrProvider)

\`\`\`typescript
import { NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social'
];

const pool = new NPool({
  open(url) {
    return new NRelay1(url);
  },
  reqRouter(filters) {
    return new Map(DEFAULT_RELAYS.map((url) => [url, filters]));
  },
  eventRouter(event) {
    return DEFAULT_RELAYS;
  },
});
\`\`\`

## Querying Events with useNostr

\`\`\`typescript
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

// Query profile (kind 0)
const { nostr } = useNostr();
const { data: profiles } = useQuery({
  queryKey: ['profile', pubkey],
  queryFn: () => nostr.query([{ kinds: [0], authors: [pubkey], limit: 1 }]),
});

// Query notes (kind 1)
const { data: notes } = useQuery({
  queryKey: ['notes', pubkey],
  queryFn: () => nostr.query([{ kinds: [1], authors: [pubkey], limit: 50 }]),
});

// Query single event by id
const { data: event } = useQuery({
  queryKey: ['event', eventId],
  queryFn: () => nostr.query([{ ids: [eventId] }]),
});
\`\`\`

## Signing Events

### Private Key Signer (NSecSigner)
\`\`\`typescript
import { NSecSigner } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

// From nsec
const { type, data: sk } = nip19.decode(nsec);
const signer = new NSecSigner(sk);

// Sign event
const event = await signer.signEvent({
  kind: 0,
  content: JSON.stringify({ name: 'username' }),
  tags: [],
  created_at: Math.floor(Date.now() / 1000),
});
\`\`\`

### NIP-07 Extension Signer
\`\`\`typescript
// Check if extension available
if (window.nostr) {
  const pubkey = await window.nostr.getPublicKey();
  const event = await window.nostr.signEvent(unsignedEvent);
}
\`\`\`

### Nostr Connect / Bunker (NConnectSigner)
\`\`\`typescript
import { NConnectSigner, NSecSigner, NRelay1 } from '@nostrify/nostrify';
import { generateSecretKey } from 'nostr-tools';

// Parse bunker URL: bunker://pubkey?relay=wss://relay.example&secret=xxx
const local = new NSecSigner(generateSecretKey());
const relay = new NRelay1('wss://relay.example');

const signer = new NConnectSigner({
  pubkey: targetPubkey,
  signer: local,
  relay,
  timeout: 60000,
});

await signer.connect(secret);
const signedEvent = await signer.signEvent(event);
\`\`\`

## Publishing Events

\`\`\`typescript
const { nostr } = useNostr();

// Create and publish profile
const profileEvent = {
  kind: 0,
  content: JSON.stringify({
    name: 'Username',
    about: 'Description',
    picture: 'https://example.com/avatar.jpg'
  }),
  tags: [],
  created_at: Math.floor(Date.now() / 1000),
};

const signedEvent = await signer.signEvent(profileEvent);
await nostr.event(signedEvent);
\`\`\`

## Event Kinds We Support
- Kind 0: Profile metadata
- Kind 1: Text notes

## NIP-05 Lookup
\`\`\`typescript
import { nip05 } from 'nostr-tools';

const profile = await nip05.queryProfile('user@domain.com');
// Returns: { pubkey: 'hex...', relays: ['wss://...'] }
\`\`\`

## Media Detection in Notes
- Check for image URLs: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`
- Check for video URLs: `.mp4`, `.webm`, `.mov`
- Support for embedded YouTube/Vimeo links
