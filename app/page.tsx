"use client";

import { SearchAutocomplete } from "@/components/search-autocomplete";
import { useI18n } from "@/lib/i18n/context";

export default function HomePage() {
  const { t } = useI18n();
  
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4">
      <div className="w-full max-w-xl space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            nLink
          </h1>
          <p className="text-muted-foreground">
            {t.browseProfiles}
          </p>
        </div>

        <SearchAutocomplete />

        <div className="text-center text-sm text-muted-foreground">
          <p>{t.searchHint}</p>
        </div>
      </div>
    </div>
  );
}
