"use client";

import React from "react"

import { useState, useEffect } from "react";
import Image from "next/image";
import { ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface LinkPreviewProps {
  url: string;
}

interface LinkMetadata {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string;
  url: string;
}

// Simple in-memory cache for link previews
const linkCache = new Map<string, LinkMetadata>();

export function LinkPreview({ url }: LinkPreviewProps) {
  const [metadata, setMetadata] = useState<LinkMetadata | null>(() => linkCache.get(url) || null);
  const [loading, setLoading] = useState(!linkCache.has(url));
  const [error, setError] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (linkCache.has(url)) {
      setMetadata(linkCache.get(url)!);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchMetadata() {
      try {
        const response = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
        if (!response.ok) throw new Error("Failed to fetch");
        
        const data = await response.json();
        if (!cancelled) {
          linkCache.set(url, data);
          setMetadata(data);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchMetadata();

    return () => {
      cancelled = true;
    };
  }, [url]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return (
      <div className="mt-2 border border-border rounded-lg overflow-hidden">
        <div className="flex">
          <Skeleton className="w-24 h-24 shrink-0" />
          <div className="flex-1 p-3 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !metadata) {
    // Fallback: just show the URL as a simple link
    return (
      <div
        onClick={handleClick}
        onKeyDown={(e) => e.key === "Enter" && handleClick(e as unknown as React.MouseEvent)}
        role="link"
        tabIndex={0}
        className="mt-2 flex items-center gap-2 text-sm text-primary hover:underline cursor-pointer"
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{url}</span>
      </div>
    );
  }

  const hostname = new URL(url).hostname.replace("www.", "");

  return (
    <div
      onClick={handleClick}
      onKeyDown={(e) => e.key === "Enter" && handleClick(e as unknown as React.MouseEvent)}
      role="link"
      tabIndex={0}
      className="mt-2 border border-border rounded-lg overflow-hidden hover:bg-accent/30 transition-colors cursor-pointer"
    >
      <div className="flex">
        {/* Image */}
        {metadata.image && !imageError && (
          <div className="relative w-24 h-24 shrink-0 bg-muted">
            <Image
              src={metadata.image || "/placeholder.svg"}
              alt=""
              fill
              className="object-cover"
              unoptimized
              onError={() => setImageError(true)}
            />
          </div>
        )}
        
        {/* Content */}
        <div className="flex-1 p-3 min-w-0">
          {metadata.title && (
            <p className="text-sm font-medium line-clamp-1">{metadata.title}</p>
          )}
          {metadata.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
              {metadata.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <ExternalLink className="h-3 w-3" />
            {hostname}
          </p>
        </div>
      </div>
    </div>
  );
}
