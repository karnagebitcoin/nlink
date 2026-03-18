"use client";

import React from "react";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { decodeNip19, resolveNip05, toNpub, toNevent, shortenNpub } from "@/lib/nostr/utils";
import type { ProfileSearchResult } from "@/lib/nostr/profile-search";
import { useI18n } from "@/lib/i18n/context";
import { toast } from "sonner";

type SearchResult = ProfileSearchResult;

async function searchProfiles(searchTerm: string): Promise<SearchResult[]> {
  try {
    const searchParams = new URLSearchParams({
      limit: "10",
      q: searchTerm,
    });
    const response = await fetch(`/api/search-profiles?${searchParams.toString()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as { results?: SearchResult[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

export function SearchAutocomplete() {
  const router = useRouter();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Check if input looks like a special identifier (not a username search)
  const isSpecialIdentifier = useCallback((input: string) => {
    const trimmed = input.trim();
    return (
      trimmed.startsWith("npub1") ||
      trimmed.startsWith("note1") ||
      trimmed.startsWith("nevent1") ||
      trimmed.startsWith("nprofile1") ||
      trimmed.startsWith("nsec1") ||
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed) ||
      /^[0-9a-f]{64}$/i.test(trimmed)
    );
  }, []);

  // Debounced search - triggers for any text that's not a special identifier
  useEffect(() => {
    const trimmed = query.trim();
    const searchTerm = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;

    // Don't search if empty, too short, or looks like a special identifier
    if (!searchTerm || searchTerm.length < 2 || isSpecialIdentifier(trimmed)) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setShowDropdown(true);
      try {
        const profiles = await searchProfiles(searchTerm);
        setResults(profiles);
      } catch (error) {
        console.error("Search error:", error);
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, isSpecialIdentifier]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectResult = (result: SearchResult) => {
    setShowDropdown(false);
    setQuery("");
    router.push(`/${toNpub(result.pubkey)}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      selectResult(results[selectedIndex]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmed = query.trim();
    if (!trimmed) return;

    // If selected from dropdown
    if (selectedIndex >= 0 && results[selectedIndex]) {
      selectResult(results[selectedIndex]);
      return;
    }

    setLoading(true);
    setShowDropdown(false);

    try {
      // Try decoding as NIP-19
      const decoded = decodeNip19(trimmed);

      if (decoded) {
        if (decoded.type === "npub" || decoded.type === "nprofile" || decoded.type === "hex") {
          const identifier = decoded.type === "hex"
            ? toNpub(decoded.data as string)
            : trimmed.startsWith("npub1") ? trimmed : toNpub(decoded.data as string);
          router.push(`/${identifier}`);
          return;
        }

        if (decoded.type === "note" || decoded.type === "nevent") {
          const identifier = toNevent(decoded.data as string);
          router.push(`/${identifier}`);
          return;
        }

        if (decoded.type === "nsec") {
          toast.error("That's a private key!", {
            description: "Never share your nsec with anyone. Use npub for public profiles.",
          });
          return;
        }
      }

      // Try NIP-05 lookup
      const nip05Pattern = trimmed.startsWith("@")
        ? trimmed.slice(1)
        : trimmed;

      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nip05Pattern) || /^[_a-z0-9-]+\.[a-z0-9.-]+$/i.test(nip05Pattern)) {
        const identifier = nip05Pattern.includes("@")
          ? nip05Pattern
          : `_@${nip05Pattern}`;

        const pubkey = await resolveNip05(identifier);

        if (pubkey) {
          router.push(`/${toNpub(pubkey)}`);
          return;
        }
      }

      const profiles = await searchProfiles(trimmed.startsWith("@") ? trimmed.slice(1) : trimmed);
      if (profiles.length > 0) {
        router.push(`/${toNpub(profiles[0].pubkey)}`);
        return;
      }

      toast.error("Could not find user", {
        description: "Try an npub, note1, NIP-05 address, or @username",
      });
    } catch (error) {
      toast.error("Search failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSearch} className="w-full relative">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="text"
            placeholder={t.searchInputPlaceholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(-1);
            }}
            onFocus={() => {
              if (results.length > 0) {
                setShowDropdown(true);
              }
            }}
            onKeyDown={handleKeyDown}
            className="pl-10 h-12 text-base"
            autoFocus
          />

          {/* Autocomplete Dropdown */}
          {showDropdown && (
            <div
              ref={dropdownRef}
              className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
            >
              {searching ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : results.length > 0 ? (
                <div className="py-1">
                  {results.map((result, index) => (
                    <button
                      key={result.pubkey}
                      type="button"
                      onClick={() => selectResult(result)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                        index === selectedIndex
                          ? "bg-accent"
                          : "hover:bg-accent/50"
                      }`}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={result.picture || "/placeholder.svg"} />
                        <AvatarFallback className="text-xs">
                          {(result.name || result.display_name || "?").charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {result.display_name || result.name || shortenNpub(toNpub(result.pubkey))}
                        </p>
                        {result.nip05 && (
                          <p className="text-xs text-muted-foreground truncate">
                            {result.nip05}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  No users found
                </div>
              )}
            </div>
          )}
        </div>
        <Button type="submit" disabled={loading || !query.trim()} className="h-12 px-6 w-full sm:w-auto">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Search"
          )}
        </Button>
      </div>
    </form>
  );
}
