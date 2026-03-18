"use client";

import { ExternalLink, Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getClientUrls, isMobile } from "@/lib/nostr/utils";
import { useI18n } from "@/lib/i18n/context";

interface OpenInClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "profile" | "note";
  identifier: string;
}

const WEB_CLIENTS = [
  { name: "Primal", key: "primal" },
  { name: "Damus", key: "damus" },
  { name: "X21", key: "x21" },
  { name: "Jumble", key: "jumble" },
  { name: "Snort", key: "snort" },
  { name: "Coracle", key: "coracle" },
  { name: "Nostrudel", key: "nostrudel" },
  { name: "Iris", key: "iris" },
] as const;

export function OpenInClientDialog({
  open,
  onOpenChange,
  type,
  identifier,
}: OpenInClientDialogProps) {
  const { t } = useI18n();
  const urls = getClientUrls(type, identifier);
  const mobile = isMobile();

  const openInNativeApp = () => {
    window.location.href = urls.nostrScheme;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.openInNostrClient}</DialogTitle>
          <DialogDescription>
            {mobile
              ? t.openInFavoriteApp
              : t.chooseWebClient}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mobile ? (
            <>
              <Button
                onClick={openInNativeApp}
                className="w-full"
                size="lg"
              >
                <Smartphone className="mr-2 h-4 w-4" />
                {t.openInNostrApp}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                {t.willOpenDefaultApp}
              </p>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {WEB_CLIENTS.map((client) => (
                <Button
                  key={client.key}
                  variant="outline"
                  asChild
                  className="justify-start bg-transparent"
                >
                  <a
                    href={urls[client.key as keyof typeof urls]}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {client.name}
                  </a>
                </Button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
