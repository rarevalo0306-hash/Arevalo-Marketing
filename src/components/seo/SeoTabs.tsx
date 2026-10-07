"use client";

import { useSearchParams } from "next/navigation";
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

/** Pone ?tab= en la dirección (y el # si se pide) sin recargar. Next la toma y el menú marca la pestaña. */
function writeUrl(tab: string, hash: string | null, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  if (hash !== null) url.hash = hash;
  if (url.href === window.location.href) return;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

/**
 * Pestañas de la página de SEO. Todas las secciones vienen del servidor; aquí solo se muestra una.
 * Los enlaces con # (ej. «Ver posiciones ↓» o /seo#codigo-google desde el email) abren la pestaña
 * donde está esa sección y bajan hasta ella. Los enlaces del menú a otra pestaña (/seo?tab=web) la abren
 * aquí mismo, sin recargar la página.
 */
export function SeoTabs({ tabs, initial }: { tabs: SeoTab[]; initial: string }) {
  const { t } = useT();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const mapaParam = params.get("mapa");
  const [active, setActive] = useState(tabs.some((x) => x.id === initial) ? initial : tabs[0].id);
  const [target, setTarget] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const ids = tabs.map((x) => x.id).join(" ");
  const valid = useCallback((id: string | null): id is string => Boolean(id) && ids.split(" ").includes(id as string), [ids]);

  const openHash = useCallback((id: string) => {
    const tab = tabOf(id);
    if (!tab) return null;
    setActive(tab);
    setTarget(id);
    return tab;
  }, []);

  // Al entrar con #algo en la dirección, y cuando cambia el # sin recargar. La dirección queda con ?tab= de esa pestaña.
  useEffect(() => {
    const fromHash = () => {
      const tab = openHash(decodeURIComponent(window.location.hash.slice(1)));
      // Después de que Next prepare el historial (sus efectos corren después de los de esta página).
      if (tab) setTimeout(() => writeUrl(tab, null, "replace"), 0);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [openHash]);

  // Cambió ?tab= sin que esta página se vuelva a montar (menú, botón «Atrás»): abrir esa pestaña. Si la dirección
  // trae un # de una sección, manda la pestaña de esa sección.
  const lastParam = useRef(tabParam);
  useEffect(() => {
    if (lastParam.current === tabParam) return;
    lastParam.current = tabParam;
    const fromHash = tabOf(decodeURIComponent(window.location.hash.slice(1)));
    const next = fromHash ?? (valid(tabParam) ? tabParam : mapaParam && valid("local") ? "local" : tabs[0].id);
    setActive(next);
  }, [tabParam, mapaParam, valid, tabs]);

  // Clics a enlaces de esta misma página. Los <Link href="#x"> de Next no disparan hashchange.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
      const hashId = decodeURIComponent(url.hash.slice(1));
      // Solo cambia la pestaña (?tab=… y quizá #sección): se abre aquí, sin pedirle la página otra vez al servidor.
      if ([...url.searchParams.keys()].every((k) => k === "tab")) {
        const linkTab = url.searchParams.get("tab");
        const tab = (hashId && tabOf(hashId)) || (linkTab === null ? tabs[0].id : valid(linkTab) ? linkTab : null);
        if (!tab) return;
        e.preventDefault();
        setActive(tab);
        if (hashId && tabOf(hashId)) setTarget(hashId);
        else {
          const bar = barRef.current;
          if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: "start" });
        }
        writeUrl(tab, url.hash, "push");
        return;
      }
      if (hashId) openHash(hashId);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [openHash, valid, tabs]);

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
    writeUrl(id, "", "replace");
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
