"use client";

import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from "react";
import type { NostrEvent } from "nostr-tools";

// Default relays for querying
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band", 
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://purplepag.es",
];

const DB_NAME = "nostr_land_cache";
const DB_VERSION = 3;
const PROFILE_STORE = "profiles";
const MEDIA_STORE = "media";
const EVENT_STORE = "events";
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

interface CachedProfile {
  pubkey: string;
  profile: ProfileData;
  timestamp: number;
}

interface MediaItem {
  url: string;
  type: "image" | "video";
  noteId: string;
  createdAt: number;
}

interface CachedMedia {
  pubkey: string;
  media: MediaItem[];
  lastTimestamp: number | null;
  timestamp: number;
}

interface CachedEvent {
  id: string;
  event: NostrEvent;
  timestamp: number;
}

interface ProfileData {
  name?: string;
  display_name?: string;
  picture?: string;
  banner?: string;
  about?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
}

interface NostrSigner {
  getPublicKey: () => Promise<string>;
  signEvent: (event: Omit<NostrEvent, "id" | "pubkey" | "sig">) => Promise<NostrEvent>;
}

interface NostrContextType {
  query: (filters: Record<string, unknown>[], relayUrls?: string[]) => Promise<NostrEvent[]>;
  event: (event: NostrEvent) => Promise<void>;
  signer: NostrSigner | null;
  setSigner: (signer: NostrSigner | null) => void;
  currentUser: { pubkey: string } | null;
  setCurrentUser: (user: { pubkey: string } | null) => void;
  isConnected: boolean;
  getEvent: (eventId: string, relayUrls?: string[]) => Promise<NostrEvent | null>;
  getCachedEvent: (eventId: string) => NostrEvent | null;
  getProfile: (pubkey: string) => Promise<ProfileData | null>;
  getCachedProfile: (pubkey: string) => ProfileData | null;
  prefetchProfiles: (pubkeys: string[]) => Promise<void>;
  getCachedMedia: (pubkey: string) => { media: MediaItem[]; lastTimestamp: number | null } | null;
  cacheMedia: (pubkey: string, media: MediaItem[], lastTimestamp: number | null) => void;
}

const NostrContext = createContext<NostrContextType | null>(null);

// IndexedDB helpers
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(PROFILE_STORE)) {
        db.createObjectStore(PROFILE_STORE, { keyPath: "pubkey" });
      }
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: "pubkey" });
      }
      if (!db.objectStoreNames.contains(EVENT_STORE)) {
        db.createObjectStore(EVENT_STORE, { keyPath: "id" });
      }
    };
  });
}

async function getFromDB(pubkey: string): Promise<CachedProfile | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(PROFILE_STORE, "readonly");
      const store = tx.objectStore(PROFILE_STORE);
      const request = store.get(pubkey);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveToDB(pubkey: string, profile: ProfileData): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(PROFILE_STORE, "readwrite");
    const store = tx.objectStore(PROFILE_STORE);
    store.put({ pubkey, profile, timestamp: Date.now() } as CachedProfile);
  } catch {
    // Ignore DB errors
  }
}

async function getMediaFromDB(pubkey: string): Promise<CachedMedia | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(MEDIA_STORE, "readonly");
      const store = tx.objectStore(MEDIA_STORE);
      const request = store.get(pubkey);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveMediaToDB(pubkey: string, media: MediaItem[], lastTimestamp: number | null): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(MEDIA_STORE, "readwrite");
    const store = tx.objectStore(MEDIA_STORE);
    store.put({ pubkey, media, lastTimestamp, timestamp: Date.now() } as CachedMedia);
  } catch {
    // Ignore DB errors
  }
}

async function getEventFromDB(eventId: string): Promise<CachedEvent | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(EVENT_STORE, "readonly");
      const store = tx.objectStore(EVENT_STORE);
      const request = store.get(eventId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveEventToDB(event: NostrEvent): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(EVENT_STORE, "readwrite");
    const store = tx.objectStore(EVENT_STORE);
    store.put({ id: event.id, event, timestamp: Date.now() } as CachedEvent);
  } catch {
    // Ignore DB errors
  }
}

async function fetchServerEvent(eventId: string): Promise<NostrEvent | null> {
  try {
    const searchParams = new URLSearchParams({
      id: eventId,
    });
    const response = await fetch(`/api/event?${searchParams.toString()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { event?: NostrEvent | null };
    return data.event ?? null;
  } catch {
    return null;
  }
}

async function fetchServerProfile(pubkey: string): Promise<ProfileData | null> {
  try {
    const searchParams = new URLSearchParams({
      pubkey,
    });
    const response = await fetch(`/api/profile?${searchParams.toString()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { profile?: ProfileData | null };
    return data.profile ?? null;
  } catch {
    return null;
  }
}

async function fetchServerProfiles(pubkeys: string[]): Promise<Record<string, ProfileData | null>> {
  if (pubkeys.length === 0) {
    return {};
  }

  try {
    const searchParams = new URLSearchParams({
      pubkeys: pubkeys.join(","),
    });
    const response = await fetch(`/api/profiles?${searchParams.toString()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return {};
    }

    const data = (await response.json()) as { profiles?: Record<string, ProfileData | null> };
    return data.profiles ?? {};
  } catch {
    return {};
  }
}

export function NostrProvider({ children }: { children: React.ReactNode }) {
  const [signer, setSigner] = useState<NostrSigner | null>(null);
  const [currentUser, setCurrentUser] = useState<{ pubkey: string } | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const socketsRef = useRef<Map<string, WebSocket>>(new Map());
  const connectingSocketsRef = useRef<Map<string, Promise<WebSocket>>>(new Map());
  const pendingRequestsRef = useRef<Map<string, { 
    resolve: (events: NostrEvent[]) => void; 
    events: NostrEvent[];
    eventIds: Set<string>;
    eoseCount: number;
    totalRelays: number;
    relays: Set<string>;
    firstEoseReceived: boolean;
    eoseTimeout: ReturnType<typeof setTimeout> | null;
    overallTimeout: ReturnType<typeof setTimeout> | null;
  }>>(new Map());
  
  // In-memory profile cache
  const profileCacheRef = useRef<Map<string, { profile: ProfileData; timestamp: number }>>(new Map());
  // Track in-flight profile requests to avoid duplicate fetches
  const pendingProfilesRef = useRef<Map<string, Promise<ProfileData | null>>>(new Map());
  // In-memory event cache
  const eventCacheRef = useRef<Map<string, { event: NostrEvent; timestamp: number }>>(new Map());
  // Track in-flight event requests to avoid duplicate fetches
  const pendingEventsRef = useRef<Map<string, Promise<NostrEvent | null>>>(new Map());
  // In-memory media cache
  const mediaCacheRef = useRef<Map<string, { media: MediaItem[]; lastTimestamp: number | null; timestamp: number }>>(new Map());
  // Track which events we've already mirrored to the server cache to avoid noisy duplicate writes.
  const syncedServerEventIdsRef = useRef<Set<string>>(new Set());

  const cacheEvent = useCallback((event: NostrEvent): void => {
    eventCacheRef.current.set(event.id, { event, timestamp: Date.now() });
    void saveEventToDB(event);
  }, []);

  const syncEventsToServer = useCallback((events: NostrEvent[]): void => {
    const freshEvents = events.filter((event) => {
      if (!event?.id || syncedServerEventIdsRef.current.has(event.id)) {
        return false;
      }

      syncedServerEventIdsRef.current.add(event.id);
      return true;
    });

    if (freshEvents.length === 0) {
      return;
    }

    if (syncedServerEventIdsRef.current.size > 5000) {
      syncedServerEventIdsRef.current.clear();
      freshEvents.forEach((event) => {
        syncedServerEventIdsRef.current.add(event.id);
      });
    }

    void fetch("/api/cache/events", {
      body: JSON.stringify({ events: freshEvents.slice(0, 100) }),
      headers: {
        "Content-Type": "application/json",
      },
      keepalive: true,
      method: "POST",
    }).catch(() => {
      for (const event of freshEvents) {
        syncedServerEventIdsRef.current.delete(event.id);
      }
    });
  }, []);

  const finalizePendingRequest = useCallback((subId: string): void => {
    const pending = pendingRequestsRef.current.get(subId);
    if (!pending) return;

    if (pending.eoseTimeout) {
      clearTimeout(pending.eoseTimeout);
    }
    if (pending.overallTimeout) {
      clearTimeout(pending.overallTimeout);
    }

    pending.events.forEach(cacheEvent);
    syncEventsToServer(pending.events);
    pending.resolve(pending.events);
    pendingRequestsRef.current.delete(subId);

    socketsRef.current.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(["CLOSE", subId]));
      }
    });
  }, [cacheEvent, syncEventsToServer]);

  const getSocket = useCallback((url: string): Promise<WebSocket> => {
    const existing = socketsRef.current.get(url);
    if (existing && existing.readyState === WebSocket.OPEN) {
      return Promise.resolve(existing);
    }

    const pendingConnection = connectingSocketsRef.current.get(url);
    if (pendingConnection) {
      return pendingConnection;
    }

    const connectionPromise = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        socketsRef.current.set(url, ws);
        connectingSocketsRef.current.delete(url);
        setIsConnected(true);
        resolve(ws);
      };
      ws.onerror = () => {
        connectingSocketsRef.current.delete(url);
        reject(new Error(`Failed to connect to ${url}`));
      };
      ws.onclose = () => {
        socketsRef.current.delete(url);
        connectingSocketsRef.current.delete(url);
        if (socketsRef.current.size === 0) {
          setIsConnected(false);
        }
      };
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data[0] === "EVENT") {
            const subId = data[1];
            const event = data[2] as NostrEvent;
            const pending = pendingRequestsRef.current.get(subId);
            if (pending && !pending.eventIds.has(event.id)) {
              pending.eventIds.add(event.id);
              pending.events.push(event);
            }
          } else if (data[0] === "EOSE") {
            const subId = data[1];
            const pending = pendingRequestsRef.current.get(subId);
            if (!pending) return;

            pending.eoseCount++;

            if (!pending.firstEoseReceived) {
              pending.firstEoseReceived = true;
              const graceMs = pending.events.length > 0 ? 120 : 250;
              pending.eoseTimeout = setTimeout(() => {
                finalizePendingRequest(subId);
              }, graceMs);
            }

            if (pending.totalRelays > 0 && pending.eoseCount >= pending.totalRelays) {
              finalizePendingRequest(subId);
            }
          }
        } catch {
          // Ignore parse errors
        }
      };
    });

    connectingSocketsRef.current.set(url, connectionPromise);
    return connectionPromise;
  }, [finalizePendingRequest]);

  const query = useCallback(async (filters: Record<string, unknown>[], relayUrls: string[] = DEFAULT_RELAYS): Promise<NostrEvent[]> => {
    const subId = `sub_${Math.random().toString(36).slice(2, 10)}`;

    return new Promise((resolve) => {
      const uniqueRelayUrls = Array.from(new Set(relayUrls));
      let connectionAttempts = uniqueRelayUrls.length;
      let connectedRelayCount = 0;

      pendingRequestsRef.current.set(subId, {
        resolve,
        events: [],
        eventIds: new Set<string>(),
        eoseCount: 0,
        totalRelays: 0,
        relays: new Set<string>(),
        firstEoseReceived: false,
        eoseTimeout: null,
        overallTimeout: null,
      });

      const attachSocket = (socket: WebSocket) => {
        const pending = pendingRequestsRef.current.get(subId);
        if (!pending || pending.relays.has(socket.url) || socket.readyState !== WebSocket.OPEN) {
          return;
        }

        pending.relays.add(socket.url);
        pending.totalRelays = pending.relays.size;
        connectedRelayCount = pending.totalRelays;
        socket.send(JSON.stringify(["REQ", subId, ...filters]));
      };

      const failIfNoRelaysConnected = () => {
        connectionAttempts--;
        if (connectionAttempts <= 0 && connectedRelayCount === 0) {
          const pending = pendingRequestsRef.current.get(subId);
          if (pending) {
            if (pending.overallTimeout) {
              clearTimeout(pending.overallTimeout);
            }
            pending.resolve([]);
            pendingRequestsRef.current.delete(subId);
          }
        }
      };

      const pending = pendingRequestsRef.current.get(subId);
      if (pending) {
        pending.overallTimeout = setTimeout(() => {
          finalizePendingRequest(subId);
        }, 3500);
      }

      uniqueRelayUrls.forEach((url) => {
        const existing = socketsRef.current.get(url);
        if (existing && existing.readyState === WebSocket.OPEN) {
          attachSocket(existing);
          connectionAttempts--;
          return;
        }

        getSocket(url)
          .then((socket) => {
            attachSocket(socket);
            failIfNoRelaysConnected();
          })
          .catch(() => {
            failIfNoRelaysConnected();
          });
      });

      if (connectionAttempts === 0 && connectedRelayCount === 0) {
        const currentPending = pendingRequestsRef.current.get(subId);
        if (currentPending) {
          if (currentPending.overallTimeout) {
            clearTimeout(currentPending.overallTimeout);
          }
          currentPending.resolve([]);
          pendingRequestsRef.current.delete(subId);
        }
      }
    });
  }, [finalizePendingRequest, getSocket]);

  const publishEvent = useCallback(async (event: NostrEvent): Promise<void> => {
    await Promise.allSettled(
      DEFAULT_RELAYS.map(async (url) => {
        try {
          const socket = await getSocket(url);
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(["EVENT", event]));
          }
        } catch {
          // Skip failed connections
        }
      })
    );
  }, [getSocket]);

  const getCachedEvent = useCallback((eventId: string): NostrEvent | null => {
    const cached = eventCacheRef.current.get(eventId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.event;
    }
    return null;
  }, []);

  const getEvent = useCallback(async (eventId: string, relayUrls?: string[]): Promise<NostrEvent | null> => {
    const memoryCached = eventCacheRef.current.get(eventId);
    if (memoryCached && Date.now() - memoryCached.timestamp < CACHE_TTL) {
      return memoryCached.event;
    }

    const pending = pendingEventsRef.current.get(eventId);
    if (pending) {
      return pending;
    }

    const fetchPromise = (async (): Promise<NostrEvent | null> => {
      const serverEvent = await fetchServerEvent(eventId);
      if (serverEvent) {
        cacheEvent(serverEvent);
        return serverEvent;
      }

      const dbCached = await getEventFromDB(eventId);
      if (dbCached && Date.now() - dbCached.timestamp < CACHE_TTL) {
        eventCacheRef.current.set(eventId, { event: dbCached.event, timestamp: dbCached.timestamp });
        return dbCached.event;
      }

      try {
        const events = await query([{ ids: [eventId], limit: 1 }], relayUrls);
        const event = events.sort((a, b) => b.created_at - a.created_at)[0] || null;
        if (event) {
          cacheEvent(event);
        }
        return event;
      } catch {
        return null;
      }
    })();

    pendingEventsRef.current.set(eventId, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      pendingEventsRef.current.delete(eventId);
    }
  }, [cacheEvent, query]);

  // Get cached profile synchronously (memory only)
  const getCachedProfile = useCallback((pubkey: string): ProfileData | null => {
    const cached = profileCacheRef.current.get(pubkey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.profile;
    }
    return null;
  }, []);

  // Get profile with caching (memory -> IndexedDB -> relay)
  const getProfile = useCallback(async (pubkey: string): Promise<ProfileData | null> => {
    // Check memory cache first
    const memoryCached = profileCacheRef.current.get(pubkey);
    if (memoryCached && Date.now() - memoryCached.timestamp < CACHE_TTL) {
      return memoryCached.profile;
    }

    // Check if there's already a pending request for this profile
    const pending = pendingProfilesRef.current.get(pubkey);
    if (pending) {
      return pending;
    }

    // Create new request
    const fetchPromise = (async (): Promise<ProfileData | null> => {
      const serverProfile = await fetchServerProfile(pubkey);
      if (serverProfile) {
        profileCacheRef.current.set(pubkey, { profile: serverProfile, timestamp: Date.now() });
        saveToDB(pubkey, serverProfile);
        return serverProfile;
      }

      // Check IndexedDB
      const dbCached = await getFromDB(pubkey);
      if (dbCached && Date.now() - dbCached.timestamp < CACHE_TTL) {
        profileCacheRef.current.set(pubkey, { profile: dbCached.profile, timestamp: dbCached.timestamp });
        return dbCached.profile;
      }

      // Fetch from relay
      try {
        const events = await query([{ kinds: [0], authors: [pubkey], limit: 1 }]);
        if (events.length > 0) {
          const profile = JSON.parse(events[0].content) as ProfileData;
          profileCacheRef.current.set(pubkey, { profile, timestamp: Date.now() });
          saveToDB(pubkey, profile);
          return profile;
        }
      } catch {
        // Ignore errors
      }
      return null;
    })();

    pendingProfilesRef.current.set(pubkey, fetchPromise);
    
    try {
      return await fetchPromise;
    } finally {
      pendingProfilesRef.current.delete(pubkey);
    }
  }, [query]);

  // Get cached media synchronously (memory first, then async load from DB)
  const getCachedMedia = useCallback((pubkey: string): { media: MediaItem[]; lastTimestamp: number | null } | null => {
    const cached = mediaCacheRef.current.get(pubkey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return { media: cached.media, lastTimestamp: cached.lastTimestamp };
    }
    
    // Try to load from IndexedDB asynchronously
    getMediaFromDB(pubkey).then((dbCached) => {
      if (dbCached && Date.now() - dbCached.timestamp < CACHE_TTL) {
        mediaCacheRef.current.set(pubkey, {
          media: dbCached.media,
          lastTimestamp: dbCached.lastTimestamp,
          timestamp: dbCached.timestamp,
        });
      }
    });
    
    return null;
  }, []);

  // Cache media items
  const cacheMedia = useCallback((pubkey: string, media: MediaItem[], lastTimestamp: number | null): void => {
    mediaCacheRef.current.set(pubkey, { media, lastTimestamp, timestamp: Date.now() });
    saveMediaToDB(pubkey, media, lastTimestamp);
  }, []);

  // Prefetch multiple profiles at once (batch request)
  const prefetchProfiles = useCallback(async (pubkeys: string[]): Promise<void> => {
    // Filter out already cached profiles
    const uncached = pubkeys.filter(pk => {
      const cached = profileCacheRef.current.get(pk);
      return !cached || Date.now() - cached.timestamp >= CACHE_TTL;
    });

    if (uncached.length === 0) return;

    // Check IndexedDB for any we don't have in memory
    const needsFetch: string[] = [];
    await Promise.all(
      uncached.map(async (pk) => {
        const dbCached = await getFromDB(pk);
        if (dbCached && Date.now() - dbCached.timestamp < CACHE_TTL) {
          profileCacheRef.current.set(pk, { profile: dbCached.profile, timestamp: dbCached.timestamp });
        } else {
          needsFetch.push(pk);
        }
      })
    );

    if (needsFetch.length === 0) return;

    const serverProfiles = await fetchServerProfiles(needsFetch);
    const stillNeedsFetch: string[] = [];

    needsFetch.forEach((pk) => {
      const profile = serverProfiles[pk];
      if (profile) {
        profileCacheRef.current.set(pk, { profile, timestamp: Date.now() });
        saveToDB(pk, profile);
      } else {
        stillNeedsFetch.push(pk);
      }
    });

    if (stillNeedsFetch.length === 0) return;

    // Batch fetch from relays
    try {
      const events = await query([{ kinds: [0], authors: stillNeedsFetch }]);
      for (const event of events) {
        try {
          const profile = JSON.parse(event.content) as ProfileData;
          profileCacheRef.current.set(event.pubkey, { profile, timestamp: Date.now() });
          saveToDB(event.pubkey, profile);
        } catch {
          // Ignore parse errors
        }
      }
    } catch {
      // Ignore errors
    }
  }, [query]);

  // Load saved user on mount
  useEffect(() => {
    const savedPubkey = localStorage.getItem("nostr_pubkey");
    if (savedPubkey) {
      setCurrentUser({ pubkey: savedPubkey });
    }
  }, []);

  useEffect(() => {
    DEFAULT_RELAYS.forEach((url) => {
      void getSocket(url).catch(() => {
        // Preconnect opportunistically. Individual queries can still proceed without this relay.
      });
    });
  }, [getSocket]);

  return (
    <NostrContext.Provider
      value={{
        query,
        event: publishEvent,
        signer,
        setSigner,
        currentUser,
        setCurrentUser,
        isConnected,
        getEvent,
        getCachedEvent,
        getProfile,
        getCachedProfile,
        prefetchProfiles,
        getCachedMedia,
        cacheMedia,
      }}
    >
      {children}
    </NostrContext.Provider>
  );
}

export function useNostr() {
  const context = useContext(NostrContext);
  if (!context) {
    throw new Error("useNostr must be used within a NostrProvider");
  }
  return context;
}
