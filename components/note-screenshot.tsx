"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { toPng } from "html-to-image";
import {
  Camera,
  RefreshCw,
  Copy,
  X as XIcon,
  Linkedin,
  Facebook,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatTimestamp, toNpub, shortenNpub, type NostrEvent } from "@/lib/nostr/utils";

interface NoteScreenshotProps {
  event: NostrEvent;
  author: {
    name?: string;
    display_name?: string;
    picture?: string;
    nip05?: string;
  } | null;
  textContent: string;
  noteUrl: string;
  images?: string[];
  videos?: string[];
  youtube?: string[];
}

// Predefined gradient combinations
const GRADIENTS = [
  "linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)",
  "linear-gradient(135deg, #f093fb 0%, #f5576c 50%, #f093fb 100%)",
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
  "linear-gradient(135deg, #ff9a9e 0%, #fecfef 50%, #fecfef 100%)",
  "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
  "linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)",
  "linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)",
  "linear-gradient(135deg, #d299c2 0%, #fef9d7 100%)",
  "linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)",
  "linear-gradient(135deg, #fddb92 0%, #d1fdff 100%)",
  "linear-gradient(135deg, #9890e3 0%, #b1f4cf 100%)",
  "linear-gradient(135deg, #ebc0fd 0%, #d9ded8 100%)",
  "linear-gradient(135deg, #f794a4 0%, #fdd6bd 100%)",
];

export function NoteScreenshot({ event, author, textContent, noteUrl, images = [], videos = [], youtube = [] }: NoteScreenshotProps) {
  const [open, setOpen] = useState(false);
  const [gradientIndex, setGradientIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [proxyImages, setProxyImages] = useState<Record<string, string>>({});
  const [loadingImages, setLoadingImages] = useState(false);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const displayName = author?.display_name || author?.name || shortenNpub(toNpub(event.pubkey));
  const username = author?.name || shortenNpub(toNpub(event.pubkey));

  // Proxy images when dialog opens
  useEffect(() => {
    if (!open) return;

    const loadProxyImages = async () => {
      setLoadingImages(true);
      const imageMap: Record<string, string> = {};

      // Load note images
      const allImages = [...images.slice(0, 4)];
      
      // Add YouTube thumbnail if present
      if (youtube.length > 0 && images.length === 0) {
        allImages.push(`https://img.youtube.com/vi/${youtube[0]}/maxresdefault.jpg`);
      }

      // Load avatar
      if (author?.picture) {
        try {
          const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(author.picture)}`);
          const data = await res.json();
          if (data.dataUrl) {
            setAvatarDataUrl(data.dataUrl);
          }
        } catch (e) {
          console.error("Failed to proxy avatar:", e);
        }
      }

      // Load all images in parallel
      await Promise.all(
        allImages.map(async (url) => {
          try {
            const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
            const data = await res.json();
            if (data.dataUrl) {
              imageMap[url] = data.dataUrl;
            }
          } catch (e) {
            console.error("Failed to proxy image:", url, e);
          }
        })
      );

      setProxyImages(imageMap);
      setLoadingImages(false);
    };

    loadProxyImages();
  }, [open, images, youtube, author?.picture]);

  const regenerateGradient = useCallback(() => {
    setGradientIndex((prev) => (prev + 1) % GRADIENTS.length);
  }, []);

  const generateImage = useCallback(async (): Promise<Blob | null> => {
    if (!cardRef.current) return null;

    setIsGenerating(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        quality: 1,
        pixelRatio: 2,
        cacheBust: true,
      });

      // Convert to webp via canvas
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      
      return new Promise((resolve) => {
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(
              (blob) => resolve(blob),
              "image/webp",
              0.95
            );
          } else {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      });
    } catch (error) {
      console.error("Failed to generate image:", error);
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const copyImage = useCallback(async () => {
    const blob = await generateImage();
    if (!blob) {
      toast.error("Failed to generate image");
      return;
    }

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": blob,
        }),
      ]);
      toast.success("Image copied to clipboard");
    } catch {
      // Fallback: download the image
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nostr-note-${event.id.slice(0, 8)}.webp`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Image downloaded");
    }
  }, [generateImage, event.id]);

  const shareToX = useCallback(() => {
    const text = `${textContent.slice(0, 200)}${textContent.length > 200 ? "..." : ""}`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(noteUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [textContent, noteUrl]);

  const shareToLinkedIn = useCallback(() => {
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(noteUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [noteUrl]);

  const shareToFacebook = useCallback(() => {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(noteUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [noteUrl]);

  const shareByEmail = useCallback(() => {
    const subject = `Check out this note from ${displayName}`;
    const body = `${textContent}\n\nView on Nostr: ${noteUrl}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }, [displayName, textContent, noteUrl]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9 bg-transparent">
          <Camera className="h-4 w-4" />
          <span className="sr-only">Screenshot</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share Note Screenshot</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Preview */}
          <div
            ref={cardRef}
            className="rounded-xl overflow-hidden"
            style={{
              background: GRADIENTS[gradientIndex],
              padding: "32px",
            }}
          >
            {/* Note card */}
            <div
              className="rounded-xl p-4 shadow-xl"
              style={{
                backgroundColor: "rgba(0, 0, 0, 0.85)",
                color: "white",
              }}
            >
              {/* Author header */}
              <div className="flex items-center gap-3 mb-3">
                <Avatar className="h-10 w-10 border-2 border-white/20">
                  <AvatarImage src={avatarDataUrl || author?.picture || "/placeholder.svg"} />
                  <AvatarFallback className="bg-gray-700 text-white">
                    {displayName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white truncate">{displayName}</p>
                  <p className="text-sm text-gray-400 truncate">@{username}</p>
                </div>
                <span className="text-sm text-gray-400 shrink-0">
                  {formatTimestamp(event.created_at)}
                </span>
              </div>

              {/* Content */}
              {textContent && (
                <p className="text-white whitespace-pre-wrap break-words leading-relaxed">
                  {textContent.length > 500 ? `${textContent.slice(0, 500)}...` : textContent}
                </p>
              )}

              {/* Images */}
              {images.length > 0 && !loadingImages && (
                <div className={`${textContent ? "mt-3" : ""} grid gap-2 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                  {images.slice(0, 4).map((url, index) => (
                    <div 
                      key={url} 
                      className={`relative overflow-hidden rounded-lg ${images.length === 1 ? "max-h-64" : "aspect-square"}`}
                    >
                      <img
                        src={proxyImages[url] || url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                      {images.length > 4 && index === 3 && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <span className="text-white text-lg font-semibold">+{images.length - 4}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {images.length > 0 && loadingImages && (
                <div className={`${textContent ? "mt-3" : ""} grid gap-2 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                  {images.slice(0, 4).map((url) => (
                    <Skeleton key={url} className={`${images.length === 1 ? "h-40" : "aspect-square"} rounded-lg`} />
                  ))}
                </div>
              )}

              {/* YouTube thumbnail */}
              {youtube.length > 0 && images.length === 0 && !loadingImages && (
                <div className={`${textContent ? "mt-3" : ""} relative rounded-lg overflow-hidden`}>
                  <img
                    src={proxyImages[`https://img.youtube.com/vi/${youtube[0] || "/placeholder.svg"}/maxresdefault.jpg`] || `https://img.youtube.com/vi/${youtube[0]}/maxresdefault.jpg`}
                    alt="YouTube video"
                    className="w-full h-auto rounded-lg"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center">
                      <div className="w-0 h-0 border-t-[8px] border-t-transparent border-l-[14px] border-l-white border-b-[8px] border-b-transparent ml-1" />
                    </div>
                  </div>
                </div>
              )}
              {youtube.length > 0 && images.length === 0 && loadingImages && (
                <Skeleton className={`${textContent ? "mt-3" : ""} h-40 rounded-lg`} />
              )}

              {/* Branding */}
              <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
                <span className="text-xs text-gray-500">nlink.to</span>
                <span className="text-xs text-gray-500">via Nostr</span>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={regenerateGradient}
              disabled={isGenerating}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              New Gradient
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyImage}
              disabled={isGenerating}
            >
              <Copy className="h-4 w-4 mr-2" />
              {isGenerating ? "Generating..." : "Copy Image"}
            </Button>
          </div>

          {/* Share buttons */}
          <div className="border-t pt-4">
            <p className="text-sm text-muted-foreground mb-3">Share to:</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={shareToX}
                className="bg-transparent"
              >
                <XIcon className="h-4 w-4" />
                <span className="sr-only">Share to X</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={shareToLinkedIn}
                className="bg-transparent"
              >
                <Linkedin className="h-4 w-4" />
                <span className="sr-only">Share to LinkedIn</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={shareToFacebook}
                className="bg-transparent"
              >
                <Facebook className="h-4 w-4" />
                <span className="sr-only">Share to Facebook</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={shareByEmail}
                className="bg-transparent"
              >
                <Mail className="h-4 w-4" />
                <span className="sr-only">Share via Email</span>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
