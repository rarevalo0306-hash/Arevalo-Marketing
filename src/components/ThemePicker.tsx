"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18n";
import s from "./AppPreferences.module.css";

const THEMES = [
  ["claro", "Claro", "Light"],
  ["noche", "Noche", "Night"],
  ["vidrio", "Vidrio", "Glass"],
] as const;
type Theme = (typeof THEMES)[number][0];

/** Cambia el estilo de la app («Claro» si nunca eligió). Se recuerda en este navegador. */
export function ThemePicker() {
  const { t } = useT();
  const [theme, setTheme] = useState<Theme>("claro");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("am-theme") as Theme | null;
      if (saved && THEMES.some(([id]) => id === saved)) setTheme(saved);
    } catch {}
  }, []);
  const pick = (t: Theme) => {
    setTheme(t);
    const w = window as unknown as { __amTheme?: (t: string) => void };
    if (w.__amTheme) w.__amTheme(t);
    else document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("am-theme", t);
    } catch {}
  };
  return (
    <div className={s.themes} role="group" aria-label={t("Estilo de la app", "App style")}>
      {THEMES.map(([id, es, en]) => (
        <button key={id} type="button" className={s.theme} aria-pressed={theme === id} onClick={() => pick(id)}>
          <span className={s.preview} data-preview={id} aria-hidden="true"><span className={s.previewSide} /><span className={s.previewBody}><i /><i /><i /></span></span>
          <span className={s.themeLabel}>{t(es, en)}{theme === id && <svg className={s.check} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>}</span>
        </button>
      ))}
    </div>
  );
}
