"use client";

import { useEffect, useState } from "react";

const THEMES = [
  ["claro", "Claro"],
  ["noche", "Noche"],
  ["vidrio", "Vidrio"],
] as const;
type Theme = (typeof THEMES)[number][0];

/** Cambia el estilo de la app. Se recuerda en este navegador. */
export function ThemePicker() {
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
    <div className="theme-pick" role="group" aria-label="Estilo de la app">
      {THEMES.map(([id, label]) => (
        <button key={id} type="button" className={theme === id ? "on" : ""} aria-pressed={theme === id} onClick={() => pick(id)}>{label}</button>
      ))}
    </div>
  );
}
