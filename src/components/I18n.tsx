"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext } from "react";
import { LANG_COOKIE, translator, type UiLang } from "@/lib/i18n";

const LangContext = createContext<UiLang>("es");

export function I18nProvider({ lang, children }: { lang: UiLang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/** Idioma y traductor para componentes del navegador. */
export function useT() {
  const lang = useContext(LangContext);
  return { lang, t: translator(lang) };
}

/** Botones ES / EN. Se guarda en una cookie por un año y la página se vuelve a pintar en el idioma nuevo. */
export function LangPicker() {
  const { lang, t } = useT();
  const router = useRouter();
  const pick = (l: UiLang) => {
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    router.refresh();
  };
  return (
    <div className="theme-pick" role="group" aria-label={t("Idioma de la app", "App language")}>
      {(["es", "en"] as const).map((l) => (
        <button key={l} type="button" className={lang === l ? "on" : ""} aria-pressed={lang === l} onClick={() => pick(l)} lang={l}>
          {l === "es" ? "Español" : "English"}
        </button>
      ))}
    </div>
  );
}
