"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18n";

const THEMES = [
  ["claro", "Claro", "Light"],
  ["noche", "Noche", "Night"],
  ["vidrio", "Vidrio", "Glass"],
] as const;
type Theme = (typeof THEMES)[number][0];

/** Cambia el estilo de la app. Se recuerda en este navegador. */
export function ThemePicker() {
  const { t } = useT();
  const [theme, setTheme] = useState<Theme>("noche");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("am-theme") as Theme | null;
      if (saved) setTheme(saved);
    } catch {}
  }, []);
  const pick = (t: Theme) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("am-theme", t);
    } catch {}
  };
  return (
    <div className="theme-pick" role="group" aria-label={t("Estilo de la app", "App style")}>
      {THEMES.map(([id, es, en]) => (
        <button key={id} type="button" className={theme === id ? "on" : ""} aria-pressed={theme === id} onClick={() => pick(id)}>{t(es, en)}</button>
      ))}
    </div>
  );
}
