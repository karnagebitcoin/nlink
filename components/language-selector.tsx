"use client";

import { Globe, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n/context";
import { languages } from "@/lib/i18n/translations";

export function LanguageSelector() {
  const { language, setLanguage, t } = useI18n();
  
  const currentLang = languages.find((l) => l.code === language);
  const currentAbbr = currentLang?.abbr || "EN";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 gap-1.5 px-2">
          <Globe className="h-4 w-4" />
          <span className="text-xs font-medium">{currentAbbr}</span>
          <span className="sr-only">{t.selectLanguage}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => setLanguage(lang.code)}
            className="flex items-center justify-between gap-4"
          >
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-6">{lang.abbr}</span>
              <span>{lang.name}</span>
            </span>
            {language === lang.code && (
              <Check className="h-4 w-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
