"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Loader2, Copy, Download, Check, AlertTriangle, Eye, EyeOff, Camera, Trash2, User } from "lucide-react";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";
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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNostr } from "@/lib/nostr/context";
import { DEFAULT_BLOSSOM_RELAY, uploadBlobToBlossom } from "@/lib/nostr/blossom";
import { toast } from "sonner";

interface CreateAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignIn?: () => void;
}

type Step = "form" | "keys" | "done";

const MAX_PROFILE_IMAGE_BYTES = 10 * 1024 * 1024;

export function CreateAccountDialog({ open, onOpenChange, onSignIn }: CreateAccountDialogProps) {
  const { setCurrentUser, setSigner, event: publishEvent } = useNostr();
  const [step, setStep] = useState<Step>("form");
  const [loading, setLoading] = useState(false);
  const [showNsec, setShowNsec] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form fields
  const [username, setUsername] = useState("");
  const [about, setAbout] = useState("");
  const [profileImageFile, setProfileImageFile] = useState<File | null>(null);
  const [profileImagePreviewUrl, setProfileImagePreviewUrl] = useState<string | null>(null);

  // Generated keys
  const [keys, setKeys] = useState<{
    sk: Uint8Array;
    pk: string;
    nsec: string;
    npub: string;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (profileImagePreviewUrl) {
        URL.revokeObjectURL(profileImagePreviewUrl);
      }
    };
  }, [profileImagePreviewUrl]);

  const clearProfileImage = () => {
    if (profileImagePreviewUrl) {
      URL.revokeObjectURL(profileImagePreviewUrl);
    }

    setProfileImageFile(null);
    setProfileImagePreviewUrl(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const resetDialog = () => {
    setStep("form");
    setLoading(false);
    setShowNsec(false);
    setCopied(false);
    setUsername("");
    setAbout("");
    clearProfileImage();
    setKeys(null);
  };

  const handleProfileImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }

    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      toast.error("Profile image is too large", {
        description: "Please choose an image under 10MB.",
      });
      return;
    }

    if (profileImagePreviewUrl) {
      URL.revokeObjectURL(profileImagePreviewUrl);
    }

    setProfileImageFile(file);
    setProfileImagePreviewUrl(URL.createObjectURL(file));
  };

  const handleGenerate = async () => {
    if (!username.trim()) {
      toast.error("Username is required");
      return;
    }

    setLoading(true);
    try {
      // Generate new keypair
      const sk = generateSecretKey();
      const pk = getPublicKey(sk);
      const nsec = nip19.nsecEncode(sk);
      const npub = nip19.npubEncode(pk);

      setKeys({ sk, pk, nsec, npub });

      let pictureUrl = "";
      if (profileImageFile) {
        const upload = await uploadBlobToBlossom({
          file: profileImageFile,
          secretKey: sk,
        });
        pictureUrl = upload.url;
      }

      // Create and publish profile event
      const profileContent = JSON.stringify({
        name: username.trim(),
        ...(about.trim() && { about: about.trim() }),
        ...(pictureUrl && { picture: pictureUrl }),
      });

      const profileEvent = {
        kind: 0,
        content: profileContent,
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      };

      const signedEvent = finalizeEvent(profileEvent, sk);
      await publishEvent(signedEvent);

      setStep("keys");
      toast.success("Account created!", {
        description: "Please save your private key securely.",
      });
    } catch (error) {
      toast.error("Failed to create account", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!keys) return;
    
    const text = `nLink Account\n\nPublic Key (npub):\n${keys.npub}\n\nPrivate Key (nsec) - KEEP SECRET:\n${keys.nsec}`;
    
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Keys copied to clipboard");
  };

  const handleDownload = () => {
    if (!keys) return;

    const content = `nLink Account
==================

Public Key (npub):
${keys.npub}

Private Key (nsec) - KEEP THIS SECRET:
${keys.nsec}

IMPORTANT: 
- Never share your private key (nsec) with anyone
- Store this file in a secure location
- If you lose your private key, you lose access to your account forever
- There is no password recovery - your keys ARE your identity

Created: ${new Date().toISOString()}
`;

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nostr-keys-${keys.npub.slice(0, 12)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success("Keys downloaded");
  };

  const handleFinish = () => {
    if (!keys) return;

    // Create signer
    const nsecSigner = {
      getPublicKey: async () => keys.pk,
      signEvent: async (event: { kind: number; content: string; tags: string[][]; created_at: number }) => {
        return finalizeEvent(event, keys.sk);
      },
    };

    setSigner(nsecSigner);
    setCurrentUser({ pubkey: keys.pk });
    localStorage.setItem("nostr_pubkey", keys.pk);
    localStorage.setItem("nostr_nsec", keys.nsec);

    // Reset and close
    resetDialog();
    onOpenChange(false);
    
    toast.success("Welcome to nLink!");
  };

  const handleClose = () => {
    if (step === "keys") {
      // Warn user before closing
      if (!confirm("Have you saved your private key? You won't be able to recover it!")) {
        return;
      }
    }
    resetDialog();
    onOpenChange(false);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleClose();
    }
  };

  const handleSignIn = () => {
    resetDialog();
    onOpenChange(false);
    onSignIn?.();
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "form" && "Create Account"}
            {step === "keys" && "Save Your Keys"}
          </DialogTitle>
          <DialogDescription>
            {step === "form" && "Create a new Nostr identity"}
            {step === "keys" && "Store these securely - they cannot be recovered!"}
          </DialogDescription>
        </DialogHeader>

        {step === "form" && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleProfileImageChange}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Avatar className="h-24 w-24 border-2 border-background shadow-sm">
                  <AvatarImage
                    src={profileImagePreviewUrl || undefined}
                    alt={username ? `${username}'s profile photo` : "Profile photo preview"}
                  />
                  <AvatarFallback className="bg-background text-muted-foreground">
                    <User className="h-8 w-8" />
                  </AvatarFallback>
                </Avatar>
                <span className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border border-background bg-foreground text-background shadow-sm transition-transform group-hover:scale-105">
                  <Camera className="h-4 w-4" />
                </span>
              </button>

              <div className="space-y-1 text-center">
                <p className="text-sm font-medium">Profile photo</p>
                <p className="text-xs text-muted-foreground">
                  Upload an image to {new URL(DEFAULT_BLOSSOM_RELAY).host} when your account is created.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="bg-background"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {profileImageFile ? "Change photo" : "Upload photo"}
                </Button>
                {profileImageFile && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearProfileImage}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <Input
                id="username"
                placeholder="satoshi"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="about">About (optional)</Label>
              <Textarea
                id="about"
                placeholder="Tell us about yourself..."
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                rows={3}
              />
            </div>

            <Button
              onClick={handleGenerate}
              disabled={loading || !username.trim()}
              className="w-full"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generate Account Keys
            </Button>

            <div className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <button
                type="button"
                onClick={handleSignIn}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Sign In
              </button>
            </div>
          </div>
        )}

        {step === "keys" && keys && (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Save your private key NOW! It cannot be recovered if lost.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label>Public Key (npub)</Label>
              <div className="p-3 bg-muted rounded-md font-mono text-xs break-all">
                {keys.npub}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Private Key (nsec)</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowNsec(!showNsec)}
                >
                  {showNsec ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <div className="p-3 bg-muted rounded-md font-mono text-xs break-all">
                {showNsec ? keys.nsec : "•".repeat(63)}
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleCopy}
                className="flex-1 bg-transparent"
              >
                {copied ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                Copy
              </Button>
              <Button
                variant="outline"
                onClick={handleDownload}
                className="flex-1 bg-transparent"
              >
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>

            <Button onClick={handleFinish} className="w-full">
              I've Saved My Keys - Continue
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
