"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, User, Plus, LogOut, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { LoginDialog } from "@/components/auth/login-dialog";
import { CreateAccountDialog } from "@/components/auth/create-account-dialog";
import { LanguageSelector } from "@/components/language-selector";
import { useNostr } from "@/lib/nostr/context";
import { useI18n } from "@/lib/i18n/context";
import { toNpub } from "@/lib/nostr/utils";

export function Navbar() {
  const { setTheme, resolvedTheme } = useTheme();
  const { currentUser, setCurrentUser, setSigner, getCachedProfile, getProfile } = useNostr();
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<{ picture?: string; name?: string } | null>(null);

  // Wait for client-side hydration before showing theme-dependent UI
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch user profile when logged in
  useEffect(() => {
    if (!currentUser) {
      setUserProfile(null);
      return;
    }

    // Try cache first
    const cached = getCachedProfile(currentUser.pubkey);
    if (cached) {
      setUserProfile(cached);
      return;
    }

    // Then fetch
    getProfile(currentUser.pubkey).then((profile) => {
      if (profile) {
        setUserProfile(profile);
      }
    });
  }, [currentUser, getCachedProfile, getProfile]);

  const handleLogout = () => {
    setCurrentUser(null);
    setSigner(null);
    localStorage.removeItem("nostr_pubkey");
    localStorage.removeItem("nostr_nsec");
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-sm">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground">
            <Plug className="h-4 w-4 text-background" />
          </div>
          <span className="font-semibold tracking-tight">nLink</span>
        </Link>

        <div className="flex items-center gap-1">
          <LanguageSelector />
          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="h-9 w-9"
            >
              {resolvedTheme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
              <span className="sr-only">{t.toggleTheme}</span>
            </Button>
          )}

          {currentUser ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full p-0">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={userProfile?.picture || "/placeholder.svg"} />
                    <AvatarFallback className="text-xs">
                      {(userProfile?.name || "U").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link href={`/${toNpub(currentUser.pubkey)}`}>
                    <User className="mr-2 h-4 w-4" />
                    {t.viewProfile}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {t.signOut}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 bg-transparent"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4" />
              <span>{t.createAccount}</span>
            </Button>
          )}
        </div>
      </div>

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
      <CreateAccountDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSignIn={() => setLoginOpen(true)}
      />
    </header>
  );
}
