"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18n";
import styles from "./SeoTabs.module.css";

/** hint: qué hay en la pestaña (se ve al pasar el ratón por encima). */
export type SeoTab = { id: string; label: string; hint?: string; content: React.ReactNode };

/** La pestaña que contiene el elemento con ese id (ej. "posiciones" → "google"). */
function tabOf(id: string): string | null {
  if (!id) return null;
  const el = document.getElementById(id);
  return el?.closest<HTMLElement>("[data-seo-tab]")?.dataset.seoTab ?? null;
}

/**
 * Pestañas de la página de SEO. Todas las secciones vienen del servidor; aquí solo se muestra una.
 * Los enlaces con # (ej. «Ver posiciones ↓» o /seo#codigo-google desde el email) abren la pestaña
 * donde está esa sección y bajan hasta ella.
 */
export function SeoTabs({ tabs, initial }: { tabs: SeoTab[]; initial: string }) {
  const { t } = useT();
  const [active, setActive] = useState(tabs.some((x) => x.id === initial) ? initial : tabs[0].id);
  const [target, setTarget] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const openHash = useCallback((id: string) => {
    const tab = tabOf(id);
    if (!tab) return;
    setActive(tab);
    setTarget(id);
  }, []);

  // Al entrar con #algo en la dirección, y cuando cambia el # sin recargar.
  useEffect(() => {
    const fromHash = () => openHash(decodeURIComponent(window.location.hash.slice(1)));
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [openHash]);

  // Los <Link href="#x"> de Next no disparan hashchange: se miran los clics a enlaces de esta misma página.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, window.location.href);
      if (url.pathname !== window.location.pathname || !url.hash) return;
      openHash(decodeURIComponent(url.hash.slice(1)));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [openHash]);

  // Ya visible la pestaña: bajar a la sección pedida. El evento resize hace que el mapa (Leaflet) se redibuje.
  useEffect(() => {
    window.dispatchEvent(new Event("resize"));
    if (!target) return;
    const id = target;
    setTarget(null);
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [active, target]);

  // En el celular la barra se desliza de lado: que la pestaña abierta quede a la vista (sin mover la página).
  useEffect(() => {
    const bar = barRef.current;
    const btn = bar?.querySelector<HTMLElement>(`#tab-${CSS.escape(active)}`);
    if (!bar || !btn || bar.scrollWidth <= bar.clientWidth) return;
    const left = bar.scrollLeft + btn.getBoundingClientRect().left - bar.getBoundingClientRect().left - (bar.clientWidth - btn.offsetWidth) / 2;
    bar.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [active]);

  const pick = (id: string) => {
    setActive(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    url.hash = "";
    window.history.replaceState(window.history.state, "", url);
    const bar = barRef.current;
    if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: "start" });
  };

  return (
    <div className={styles.root}>
      <div ref={barRef} className={styles.bar} role="tablist" aria-label={t("Secciones de SEO", "SEO sections")}>
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`tab-${x.id}`}
            aria-selected={active === x.id}
            aria-controls={`panel-${x.id}`}
            className={`${styles.tab}${active === x.id ? ` ${styles.on}` : ""}`}
            onClick={() => pick(x.id)}
            title={x.hint || undefined}
          >
            {x.label}
          </button>
        ))}
      </div>
      {tabs.map((x) => (
        <div
          key={x.id}
          id={`panel-${x.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${x.id}`}
          data-seo-tab={x.id}
          className={`stack ${styles.panel}`}
          style={{ gap: 22, display: active === x.id ? undefined : "none" }}
        >
          {x.content}
        </div>
      ))}
    </div>
  );
}
