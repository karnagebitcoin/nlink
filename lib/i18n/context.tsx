"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { translations, languages, type LanguageCode, type TranslationKeys } from "./translations";

interface I18nContextType {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: TranslationKeys;
  dir: "ltr" | "rtl";
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>("en");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Load saved language preference
    const saved = localStorage.getItem("language") as LanguageCode;
    if (saved && translations[saved]) {
      setLanguageState(saved);
    } else {
      // Try to detect browser language
      const browserLang = navigator.language;
      const langCode = browserLang.split("-")[0];
      
      // Check for exact match first (e.g., pt-BR)
      if (translations[browserLang as LanguageCode]) {
        setLanguageState(browserLang as LanguageCode);
      } else if (translations[langCode as LanguageCode]) {
        setLanguageState(langCode as LanguageCode);
      }
    }
    setMounted(true);
  }, []);

  const setLanguage = (lang: LanguageCode) => {
    setLanguageState(lang);
    localStorage.setItem("language", lang);
    
    // Update document direction for RTL languages
    const langConfig = languages.find(l => l.code === lang);
    if (langConfig) {
      document.documentElement.dir = langConfig.dir;
    }
  };

  // Set initial direction
  useEffect(() => {
    if (mounted) {
      const langConfig = languages.find(l => l.code === language);
      if (langConfig) {
        document.documentElement.dir = langConfig.dir;
      }
    }
  }, [mounted, language]);

  const t = translations[language];
  const dir = languages.find(l => l.code === language)?.dir || "ltr";

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, dir }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
