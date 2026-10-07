import Link from "next/link";
import { Suspense } from "react";
import { DashSearch, MAX_Q, SearchResult } from "@/components/dashboard/DashSearch";
import s from "@/components/dashboard/Dashboard.module.css";
import { HealthStrip, HealthStripSkeleton } from "@/components/dashboard/HealthStrip";
import { QuickPostCard, RecentPosts } from "@/components/dashboard/SocialRow";
import { TodayList, TodayListSkeleton } from "@/components/dashboard/TodayList";
import { ToolkitGrid, ToolkitGridSkeleton } from "@/components/dashboard/ToolkitGrid";
import { db } from "@/lib/db";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { readTrackedKeywords } from "@/lib/seo/dataforseo";
import { BUSINESS_TZ } from "@/lib/time";

function greeting(t: T): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: BUSINESS_TZ }).format(new Date()));
  return h >= 5 && h < 12 ? t("Buenos días", "Good morning") : h >= 12 && h < 19 ? t("Buenas tardes", "Good afternoon") : t("Buenas noches", "Good evening");
}

/**
 * Tablero: el negocio de un vistazo. Arriba el buscador (palabra clave o competidor), la salud del negocio en internet,
 * qué hacer hoy y una tarjeta por herramienta; abajo, publicar rápido y lo más reciente. Solo lee la base de datos;
 * cada parte se carga en su propio Suspense para que lo lento no frene lo demás.
 */
export default async function InicioPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string | string[] }> }) {
  const { id } = await params;
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_Q);
  const { t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id }, select: { name: true, color: true, website: true, seoKeywords: true } });
  const site = b.website.trim();

  return (
    <>
      <header className={s.top}>
        <div className={s.who}>
          <span className={s.hello}>
            <i style={{ background: b.color }} />
            {greeting(t)} · {t("Tablero", "Dashboard")}
          </span>
          <h1 className={s.name}>{b.name}</h1>
          {site ? (
            <a href={/^https?:\/\//i.test(site) ? site : `https://${site}`} target="_blank" rel="noopener noreferrer" className={s.site}>
              {site.replace(/^https?:\/\//i, "").replace(/\/$/, "")} ↗
            </a>
          ) : (
            <Link href={`/b/${id}/negocio`} className={s.siteAdd}>
              {t("+ Agregar tu página web", "+ Add your website")}
            </Link>
          )}
        </div>
        <DashSearch businessId={id} q={q} example={readTrackedKeywords(b.seoKeywords)[0]} />
      </header>

      {q && (
        <Suspense key={q} fallback={<span className={`${s.skel} ${s.skelKit}`} aria-busy="true" />}>
          <SearchResult businessId={id} q={q} />
        </Suspense>
      )}

      <Suspense fallback={<HealthStripSkeleton />}>
        <HealthStrip businessId={id} />
      </Suspense>

      <div className={s.main}>
        <div className={s.todayCol}>
          <Suspense fallback={<TodayListSkeleton />}>
            <TodayList businessId={id} />
          </Suspense>
        </div>
        <div className={s.kitsCol}>
          <div className={s.sectionHead}>
            <h2>{t("Tus herramientas", "Your tools")}</h2>
            <span className={s.sectionHint}>{t("Lo último de cada una", "The latest from each one")}</span>
          </div>
          <Suspense fallback={<ToolkitGridSkeleton />}>
            <ToolkitGrid businessId={id} />
          </Suspense>
        </div>
      </div>

      <div className={s.socialRow}>
        <Suspense fallback={<span className={`${s.skel} ${s.skelKit}`} aria-busy="true" />}>
          <QuickPostCard businessId={id} />
        </Suspense>
        <Suspense fallback={<span className={`${s.skel} ${s.skelKit}`} aria-busy="true" />}>
          <RecentPosts businessId={id} />
        </Suspense>
      </div>
    </>
  );
}
