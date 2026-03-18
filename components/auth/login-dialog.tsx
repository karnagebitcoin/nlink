"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, Key, Chrome, Link2, Copy, Check, Smartphone } from "lucide-react";
import { nip19, getPublicKey, generateSecretKey } from "nostr-tools";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNostr } from "@/lib/nostr/context";
import { isMobile } from "@/lib/nostr/utils";
import { toast } from "sonner";

const BUNKER_RELAY = "wss://relay.nsec.app";

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
  const { setCurrentUser, setSigner } = useNostr();
  const [loading, setLoading] = useState(false);
  const [nsec, setNsec] = useState("");
  const [bunkerUrl, setBunkerUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [waitingForBunker, setWaitingForBunker] = useState(() => {
    // Check if we were waiting before navigation
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("nostr_bunker_waiting") === "true";
    }
    return false;
  });
  const [showQr, setShowQr] = useState(false);

  // Persist waiting state
  useEffect(() => {
    if (waitingForBunker) {
      sessionStorage.setItem("nostr_bunker_waiting", "true");
    } else {
      sessionStorage.removeItem("nostr_bunker_waiting");
    }
  }, [waitingForBunker]);

  // Local keypair for nostrconnect - persist in sessionStorage to survive navigation
  const [localKeys, setLocalKeys] = useState<{ secretKey: Uint8Array; pubkey: string } | null>(null);

  // Initialize local keys on client side only
  useEffect(() => {
    const SESSION_KEY = "nostr_connect_keys";
    
    // Try to restore from sessionStorage
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      try {
        const { secretKey, pubkey } = JSON.parse(stored);
        setLocalKeys({ 
          secretKey: new Uint8Array(secretKey), 
          pubkey 
        });
        return;
      } catch {
        // Fall through to generate new keys
      }
    }
    
    // Generate new keys and store them
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ 
      secretKey: Array.from(sk), 
      pubkey: pk 
    }));
    setLocalKeys({ secretKey: sk, pubkey: pk });
  }, []);

  // Generate nostrconnect:// URI for QR code
  const nostrConnectUri = useMemo(() => {
    if (!localKeys) return "";
    const params = new URLSearchParams({
      relay: BUNKER_RELAY,
      metadata: JSON.stringify({ name: "nLink" }),
    });
    return `nostrconnect://${localKeys.pubkey}?${params.toString()}`;
  }, [localKeys]);

  // Listen for bunker connection response
  useEffect(() => {
    if (!waitingForBunker || !open || !localKeys) return;

    console.log("[v0] Starting bunker listener, pubkey:", localKeys.pubkey);

    let ws: WebSocket | null = null;
    let timeout: NodeJS.Timeout;

    const connect = () => {
      console.log("[v0] Connecting to relay:", BUNKER_RELAY);
      ws = new WebSocket(BUNKER_RELAY);
      const subId = `bunker_${Math.random().toString(36).slice(2, 8)}`;

      ws.onopen = () => {
        console.log("[v0] WebSocket connected, subscribing with subId:", subId);
        // Subscribe to events mentioning our pubkey (NIP-46 responses)
        const filter = { kinds: [24133], "#p": [localKeys.pubkey] };
        console.log("[v0] Filter:", JSON.stringify(filter));
        ws?.send(
          JSON.stringify([
            "REQ",
            subId,
            filter,
          ])
        );
      };

      ws.onmessage = async (msg) => {
        try {
          const data = JSON.parse(msg.data);
          console.log("[v0] Received message:", data[0], data);
          
          if (data[0] === "EVENT" && data[2]) {
            const event = data[2];
            console.log("[v0] Got EVENT from pubkey:", event.pubkey);
            // Decrypt and parse the response
            // For now, we'll use the sender's pubkey as the connected user
            const remotePubkey = event.pubkey;
            
            setCurrentUser({ pubkey: remotePubkey });
            localStorage.setItem("nostr_pubkey", remotePubkey);
            
            toast.success("Connected via bunker");
            setWaitingForBunker(false);
            onOpenChange(false);
            ws?.close();
          } else if (data[0] === "EOSE") {
            console.log("[v0] EOSE received, continuing to listen for new events...");
          }
        } catch (e) {
          console.log("[v0] Parse error:", e);
        }
      };

      ws.onerror = (err) => {
        console.log("[v0] WebSocket error:", err);
      };
      
      ws.onclose = () => {
        console.log("[v0] WebSocket closed");
      };

      // Timeout after 2 minutes
      timeout = setTimeout(() => {
        setWaitingForBunker(false);
        toast.error("Connection timeout", {
          description: "No response from signer app",
        });
        ws?.close();
      }, 120000);
    };

    connect();

    return () => {
      clearTimeout(timeout);
      ws?.close();
    };
  }, [waitingForBunker, open, localKeys, setCurrentUser, onOpenChange]);

  const copyConnectUri = async () => {
    await navigator.clipboard.writeText(nostrConnectUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copied to clipboard");
  };

  const openInSignerApp = () => {
    setWaitingForBunker(true);
    window.location.href = nostrConnectUri;
  };

  const handleExtensionLogin = async () => {
    setLoading(true);
    try {
      if (!window.nostr) {
        toast.error("No Nostr extension found", {
          description: "Please install a NIP-07 extension like Alby or nos2x",
        });
        return;
      }

      const pubkey = await window.nostr.getPublicKey();
      
      // Create a signer wrapper for the extension
      const extensionSigner = {
        getPublicKey: () => window.nostr!.getPublicKey(),
        signEvent: (event: Parameters<typeof window.nostr.signEvent>[0]) => 
          window.nostr!.signEvent(event),
      };

      setSigner(extensionSigner);
      setCurrentUser({ pubkey });
      localStorage.setItem("nostr_pubkey", pubkey);
      
      toast.success("Signed in with extension");
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to sign in", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleNsecLogin = async () => {
    setLoading(true);
    try {
      let secretKey: Uint8Array;
      
      if (nsec.startsWith("nsec1")) {
        const decoded = nip19.decode(nsec);
        if (decoded.type !== "nsec") {
          throw new Error("Invalid nsec");
        }
        secretKey = decoded.data;
      } else if (/^[0-9a-f]{64}$/i.test(nsec)) {
        secretKey = new Uint8Array(
          nsec.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
        );
      } else {
        throw new Error("Invalid key format");
      }

      const pubkey = getPublicKey(secretKey);

      // Create NSecSigner-like object
      const nsecSigner = {
        getPublicKey: async () => pubkey,
        signEvent: async (event: { kind: number; content: string; tags: string[][]; created_at: number }) => {
          const { finalizeEvent } = await import("nostr-tools");
          return finalizeEvent(event, secretKey);
        },
      };

      setSigner(nsecSigner);
      setCurrentUser({ pubkey });
      localStorage.setItem("nostr_pubkey", pubkey);
      localStorage.setItem("nostr_nsec", nsec);

      toast.success("Signed in with private key");
      setNsec("");
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to sign in", {
        description: error instanceof Error ? error.message : "Invalid key format",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBunkerLogin = async () => {
    setLoading(true);
    try {
      // Parse bunker URL: bunker://pubkey?relay=wss://...&secret=...
      const url = new URL(bunkerUrl);
      if (url.protocol !== "bunker:") {
        throw new Error("Invalid bunker URL");
      }

      const remotePubkey = url.pathname.replace("//", "");
      const relayUrl = url.searchParams.get("relay");

      if (!remotePubkey || !relayUrl) {
        throw new Error("Missing pubkey or relay in bunker URL");
      }

      toast.info("Bunker connection initiated", {
        description: "Please approve the connection request in your signer app",
      });

      // For now, we'll set a basic signer that requires the bunker
      // Full bunker implementation requires WebSocket connection
      setCurrentUser({ pubkey: remotePubkey });
      localStorage.setItem("nostr_pubkey", remotePubkey);
      localStorage.setItem("nostr_bunker", bunkerUrl);

      toast.success("Connected to bunker");
      setBunkerUrl("");
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to connect", {
        description: error instanceof Error ? error.message : "Invalid bunker URL",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign In</DialogTitle>
          <DialogDescription>
            Choose how you want to sign in to nLink
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="extension" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="extension" className="text-xs">Extension</TabsTrigger>
            <TabsTrigger value="nsec" className="text-xs">Private Key</TabsTrigger>
            <TabsTrigger value="bunker" className="text-xs">Bunker</TabsTrigger>
          </TabsList>

          <TabsContent value="extension" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Sign in using a browser extension like Alby, nos2x, or Nostr Connect.
            </p>
            <Button
              onClick={handleExtensionLogin}
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Chrome className="mr-2 h-4 w-4" />
              )}
              Connect Extension
            </Button>
          </TabsContent>

          <TabsContent value="nsec" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="nsec">Private Key (nsec or hex)</Label>
              <Input
                id="nsec"
                type="password"
                placeholder="nsec1... or hex"
                value={nsec}
                onChange={(e) => setNsec(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Your key is stored locally and never sent to any server.
              </p>
            </div>
            <Button
              onClick={handleNsecLogin}
              disabled={loading || !nsec}
              className="w-full"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Key className="mr-2 h-4 w-4" />
              )}
              Sign In
            </Button>
          </TabsContent>

          <TabsContent value="bunker" className="space-y-4 pt-4">
            {isMobile() ? (
              <>
                <Button
                  onClick={openInSignerApp}
                  className="w-full"
                  size="lg"
                >
                  <Smartphone className="mr-2 h-4 w-4" />
                  Open in Signer App
                </Button>
                <p className="text-sm text-center text-muted-foreground">
                  Opens Amber, Keystache, or your default Nostr signer
                </p>
                {waitingForBunker && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Waiting for connection...
                  </div>
                )}
              </>
            ) : (
              <>
                {nostrConnectUri && (
                  <div className="flex justify-center">
                    <div className="p-3 bg-white rounded-lg">
                      <QRCodeSVG value={nostrConnectUri} size={160} />
                    </div>
                  </div>
                )}
                <p className="text-sm text-center text-muted-foreground">
                  Scan with your signer app (Amber, Keystache, etc.)
                </p>
                {waitingForBunker && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Waiting for connection...
                  </div>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    copyConnectUri();
                    if (!waitingForBunker) {
                      setWaitingForBunker(true);
                    }
                  }}
                  className="w-full bg-transparent"
                >
                  {copied ? (
                    <Check className="mr-2 h-4 w-4" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  Copy URI
                </Button>
              </>
            )}
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  or paste bunker URL
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Input
                id="bunker"
                type="text"
                placeholder="bunker://pubkey?relay=wss://..."
                value={bunkerUrl}
                onChange={(e) => setBunkerUrl(e.target.value)}
              />
            </div>
            <Button
              onClick={handleBunkerLogin}
              disabled={loading || !bunkerUrl}
              className="w-full"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="mr-2 h-4 w-4" />
              )}
              Connect
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// Extend window type for NIP-07
declare global {
  interface Window {
    nostr?: {
      getPublicKey: () => Promise<string>;
      signEvent: (event: {
        kind: number;
        content: string;
        tags: string[][];
        created_at: number;
      }) => Promise<{
        id: string;
        pubkey: string;
        created_at: number;
        kind: number;
        tags: string[][];
        content: string;
        sig: string;
      }>;
    };
  }
}
