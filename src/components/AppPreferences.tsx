"use client";

import { useId, useState } from "react";
import { LangPicker, useT } from "./I18n";
import { ThemePicker } from "./ThemePicker";
import s from "./AppPreferences.module.css";

/** Global preferences live outside the navigation, including the Glass theme's blurred sidebar. */
export function AppPreferences() {
  const { t } = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className={s.root}>
      <button type="button" className={s.trigger} popoverTarget={id} aria-expanded={open} aria-controls={id} aria-label={t("Preferencias", "Preferences")}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h7m6 0h3M4 17h3m6 0h7" /><circle cx="14" cy="7" r="3" /><circle cx="10" cy="17" r="3" />
        </svg>
        <span>{t("Preferencias", "Preferences")}</span>
      </button>
      <div id={id} popover="auto" className={s.panel} onToggle={(event) => setOpen(event.currentTarget.matches(":popover-open"))} aria-label={t("Preferencias de la app", "App preferences")}>
        <div className={s.heading}>
          <h2>{t("Preferencias", "Preferences")}</h2>
          <button type="button" className={s.close} popoverTarget={id} popoverTargetAction="hide" aria-label={t("Cerrar preferencias", "Close preferences")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </div>
        <section className={s.section} aria-labelledby={`${id}-language`}>
          <h3 id={`${id}-language`}>{t("Idioma", "Language")}</h3>
          <LangPicker />
        </section>
        <section className={s.section} aria-labelledby={`${id}-appearance`}>
          <h3 id={`${id}-appearance`}>{t("Apariencia", "Appearance")}</h3>
          <ThemePicker />
        </section>
        <p className={s.note}>{t("Se guarda en este navegador.", "Saved in this browser.")}</p>
      </div>
    </div>
  );
}
