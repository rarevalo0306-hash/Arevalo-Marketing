"use client";

import { useState } from "react";
import { useT } from "@/components/I18n";
import styles from "@/components/seo/Fold.module.css";

/**
 * Corta una lista larga: los elementos marcados con `capClass(i, tope)` (de Fold) quedan escondidos hasta tocar
 * «Ver todas». `hidden` = cuántos quedan escondidos (si es 0 no sale el botón). `more` ya viene traducido y dice
 * qué y cuántos hay (ej. «Ver las 12 palabras»).
 */
export function ShowMore({ hidden, more, less, children, className }: { hidden: number; more: string; less?: string; children: React.ReactNode; className?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className={`${styles.showMore}${open || hidden <= 0 ? "" : ` ${styles.closed}`}${className ? ` ${className}` : ""}`}>
      {children}
      {hidden > 0 && (
        <button type="button" className={styles.moreBtn} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? `${less ?? t("Ver menos", "Show less")} ▴` : `${more} ▾`}
        </button>
      )}
    </div>
  );
}
