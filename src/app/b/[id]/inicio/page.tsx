import Link from "next/link";
import { Suspense } from "react";
import { ApprovalBand } from "@/components/dashboard/ApprovalBand";
import { DashSearch, MAX_Q, SearchResult } from "@/components/dashboard/DashSearch";
import s from "@/components/dashboard/Dashboard.module.css";
import { HealthStrip, HealthStripSkeleton } from "@/components/dashboard/HealthStrip";
import { QuickPostCard, RecentPosts } from "@/components/dashboard/SocialRow";
import { TodayList, TodayListSkeleton } from "@/components/dashboard/TodayList";
import { ToolkitGrid, ToolkitGridSkeleton } from "@/components/dashboard/ToolkitGrid";
import { loadApprovals } from "@/lib/approvals";
import { approvalTotal } from "@/lib/approvals-shape";
import { businessTz } from "@/lib/business-tz";
import { db } from "@/lib/db";
import type { T, UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { readTrackedKeywords } from "@/lib/seo/dataforseo";

/** «Buenos días / tardes / noches» según la hora del negocio. */
function greeting(t: T, tz: string, now: Date): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  return h >= 5 && h < 12 ? t("Buenos días", "Good morning") : h >= 12 && h < 19 ? t("Buenas tardes", "Good afternoon") : t("Buenas noches", "Good evening");
}

/** «Sábado, 11 de octubre» en la hora del negocio. */
function today(lang: UiLang, tz: string, now: Date): string {
  const d = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-US", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now);
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/**
 * Inicio: el saludo con lo que la IA dejó listo, «Listo para tu aprobación» (solo si hay algo), la salud del negocio
 * en internet con «Para hoy» al lado, tus herramientas y, al final, publicar rápido y lo más reciente. Solo lee la
 * base de datos; cada parte lenta se carga en su propio Suspense para que no frene lo demás.
 */
export default async function InicioPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string | string[] }> }) {
  const { id } = await params;
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_Q);
  const { lang, t } = await getT();
  const [b, approvals] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id }, select: { name: true, color: true, website: true, seoKeywords: true, ownerName: true, timezone: true } }),
    loadApprovals(id),
  ]);
  const site = b.website.trim();
  const tz = businessTz(b);
  const now = new Date();
  const first = b.ownerName.trim().split(/\s+/)[0] ?? "";
  const n = approvalTotal(approvals);

  return (
    <>
      <header className={s.top}>
        <div className={s.topRow}>
          <div className={s.who}>
            <p className={s.date}>{today(lang, tz, now)}</p>
            <h1 className={s.name}>
              {greeting(t, tz, now)}, {first || b.name}
            </h1>
            <p className={s.lead}>
              {n === 0
                ? t("Todo al día.", "All caught up.")
                : n === 1
                  ? t("La IA dejó 1 cosa lista. Tú solo apruebas.", "The AI left 1 thing ready. You just approve.")
                  : t(`La IA dejó ${n} cosas listas. Tú solo apruebas.`, `The AI left ${n} things ready. You just approve.`)}
            </p>
            <p className={s.meta}>
              {/* El nombre del negocio, si el saludo usa el nombre del dueño */}
              {first && (
                <span className={s.metaBiz}>
                  <i style={{ background: b.color }} aria-hidden="true" />
                  {b.name}
                </span>
              )}
              {site ? (
                <a href={/^https?:\/\//i.test(site) ? site : `https://${site}`} target="_blank" rel="noopener noreferrer" className={s.site}>
                  {site.replace(/^https?:\/\//i, "").replace(/\/$/, "")} ↗
                </a>
              ) : (
                <Link href={`/b/${id}/negocio`} className={s.siteAdd}>
                  {t("+ Agregar tu página web", "+ Add your website")}
                </Link>
              )}
            </p>
          </div>
          <Link href={`/b/${id}/publicar`} className={`btn on ${s.create}`}>
            {t("+ Crear publicación", "+ Create post")}
          </Link>
        </div>
        <DashSearch businessId={id} q={q} example={readTrackedKeywords(b.seoKeywords)[0]} />
      </header>

      {q && (
        <Suspense key={q} fallback={<span className={`${s.skel} ${s.skelKit}`} aria-busy="true" />}>
          <SearchResult businessId={id} q={q} />
        </Suspense>
      )}

      <ApprovalBand items={approvals} />

      <div className={s.main}>
        <div className={s.healthCol}>
          <Suspense fallback={<HealthStripSkeleton />}>
            <HealthStrip businessId={id} />
          </Suspense>
        </div>
        <div className={s.todayCol}>
          <Suspense fallback={<TodayListSkeleton />}>
            <TodayList businessId={id} />
          </Suspense>
        </div>
      </div>

      <section className={s.kitsCol} aria-labelledby="dash-tools">
        <div className={s.sectionHead}>
          <h2 id="dash-tools">{t("Tus herramientas", "Your tools")}</h2>
          <span className={s.sectionHint}>{t("Lo último de cada una", "The latest from each one")}</span>
        </div>
        <Suspense fallback={<ToolkitGridSkeleton />}>
          <ToolkitGrid businessId={id} />
        </Suspense>
      </section>

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
