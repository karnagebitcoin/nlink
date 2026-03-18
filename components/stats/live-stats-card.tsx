"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { NostrCacheStats } from "@/lib/nostr/stats";

const POLL_INTERVAL_MS = 5_000;

function RollingDigit({ digit }: { digit: number }) {
  return (
    <span className="relative inline-flex h-[1em] w-[0.72em] overflow-hidden rounded-[0.16em] bg-foreground/6">
      <span
        className="transition-transform duration-700 ease-[cubic-bezier(0.18,0.9,0.22,1)]"
        style={{ transform: `translateY(-${digit}em)` }}
      >
        {Array.from({ length: 10 }, (_, value) => (
          <span
            key={value}
            className="flex h-[1em] items-center justify-center leading-none"
          >
            {value}
          </span>
        ))}
      </span>
    </span>
  );
}

function RollingNumber({ value }: { value: number }) {
  const formatted = useMemo(
    () => new Intl.NumberFormat("en-US").format(value),
    [value],
  );

  return (
    <div className="flex items-end justify-center gap-[0.06em] font-mono tabular-nums">
      {formatted.split("").map((character, index) =>
        /\d/.test(character) ? (
          <RollingDigit key={`${index}-${character}`} digit={Number(character)} />
        ) : (
          <span
            key={`${index}-${character}`}
            className="inline-flex h-[1em] w-[0.34em] items-end justify-center text-foreground/45"
          >
            {character}
          </span>
        ),
      )}
    </div>
  );
}

export function LiveStatsCard({ initialStats }: { initialStats: NostrCacheStats }) {
  const [stats, setStats] = useState(initialStats);
  const [isPopping, setIsPopping] = useState(false);
  const previousEventCountRef = useRef(initialStats.eventCount);

  useEffect(() => {
    let cancelled = false;

    async function refreshStats() {
      try {
        const response = await fetch("/api/stats", { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const nextStats = (await response.json()) as NostrCacheStats;
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setStats(nextStats);
        });
      } catch {
        // Keep the last visible snapshot on transient polling failures.
      }
    }

    const intervalId = window.setInterval(refreshStats, POLL_INTERVAL_MS);
    void refreshStats();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const previousCount = previousEventCountRef.current;
    const nextDelta = stats.eventCount - previousCount;

    if (nextDelta > 0) {
      setIsPopping(true);
      const timeoutId = window.setTimeout(() => {
        setIsPopping(false);
      }, 1400);

      previousEventCountRef.current = stats.eventCount;
      return () => window.clearTimeout(timeoutId);
    }

    previousEventCountRef.current = stats.eventCount;
  }, [stats.eventCount]);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_34%),radial-gradient(circle_at_bottom,rgba(16,185,129,0.14),transparent_32%)] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto flex max-w-5xl flex-col justify-center py-8 sm:min-h-[calc(100vh-6rem)]">
        <Card className="overflow-hidden border-border/60 bg-card/85 shadow-2xl shadow-black/20 backdrop-blur-sm">
          <CardContent className="relative px-6 py-10 sm:px-10 sm:py-14">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_38%,rgba(34,197,94,0.08))]" />
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />

            <div className="relative space-y-8 text-center">
              <div className="space-y-4">
                <div
                  className={`mx-auto w-fit text-[4rem] font-semibold leading-none tracking-tight sm:text-[5.5rem] lg:text-[8rem] ${
                    isPopping ? "scale-[1.02]" : "scale-100"
                  } transition-transform duration-500`}
                >
                  <RollingNumber value={stats.eventCount} />
                </div>
                <div className="text-sm uppercase tracking-[0.24em] text-muted-foreground">
                  Indexed Events
                </div>
              </div>

              <div className="mx-auto max-w-sm rounded-3xl border border-border/60 bg-background/65 px-6 py-5 backdrop-blur-sm">
                <div className="text-sm uppercase tracking-[0.24em] text-muted-foreground">
                  Profiles
                </div>
                <div className="mt-3 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
                  {stats.profileCount.toLocaleString("en-US")}
                </div>
              </div>

              {stats.error && (
                <p className="text-sm text-muted-foreground">
                  {stats.error}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
