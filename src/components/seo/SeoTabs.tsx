"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useT } from "@/components/I18n";
import { seoTabForHash } from "@/lib/seo/tab-routing";
import styles from "./SeoTabs.module.css";

export type SeoTab = { id: string; label: string; hint?: string; content?: React.ReactNode };

/** Only the selected server component crosses the RSC boundary. */
export function SeoTabs({ tabs, initial, children }: { tabs: SeoTab[]; initial: string; children: React.ReactNode }) {
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const open = () => {
      const tab = seoTabForHash(window.location.hash);
      if (tab && tab !== initial) {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", tab);
        router.replace(url.pathname + url.search + url.hash, { scroll: false });
      } else if (window.location.hash) {
        try { document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: "start" }); } catch { /* malformed fragment */ }
      }
    };
    open();
    window.addEventListener("hashchange", open);
    const click = (event: MouseEvent) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
      const link = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, location.href);
      const tab = seoTabForHash(url.hash);
      if (url.origin !== location.origin || url.pathname !== pathname || !tab || tab === initial) return;
      event.preventDefault();
      url.searchParams.set("tab", tab);
      router.push(url.pathname + url.search + url.hash, { scroll: false });
    };
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("hashchange", open); document.removeEventListener("click", click, true); };
  }, [initial, pathname, router]);
  return <div className={styles.root}>
    <div ref={barRef} className={styles.bar} role="tablist" aria-label={t("Secciones de SEO", "SEO sections")}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('[role="tab"]')];
        const current = links.indexOf(document.activeElement as HTMLAnchorElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + links.length) % links.length;
        event.preventDefault(); links[next]?.focus();
      }}>
      {tabs.map(tab => <Link key={tab.id} href={`${pathname}?tab=${tab.id}`} prefetch={false} scroll={false}
        role="tab" id={`tab-${tab.id}`} aria-selected={initial === tab.id} aria-controls={initial === tab.id ? `panel-${tab.id}` : undefined}
        tabIndex={initial === tab.id ? 0 : -1} className={`${styles.tab}${initial === tab.id ? ` ${styles.on}` : ""}`} title={tab.hint || undefined}>{tab.label}</Link>)}
    </div>
    <div key={initial} id={`panel-${initial}`} role="tabpanel" aria-labelledby={`tab-${initial}`} data-seo-tab={initial} className={`stack ${styles.panel}`} style={{ gap: 22 }}>
      {children}
    </div>
  </div>;
}
