import Link from "next/link";
import { refreshKeywords } from "@/app/actions-seo-keywords";
import { FollowButton, KeywordsButton } from "@/components/seo/KeywordsButton";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readTrackedKeywords } from "@/lib/seo/dataforseo";
import { byVolume, type Competition, costText, type KwRow, MAX_TRACKED, readKeywordsReport, reportLookup, trendDirection, volumeFormat } from "@/lib/seo/keywords";
import { latestReports } from "@/lib/seo/reports";
import { BUSINESS_TZ } from "@/lib/time";

const IDEAS_SHOWN = 30;

// [estilo, español, inglés]
const COMPETITION: Record<Competition, [string, string, string]> = {
  high: ["failed", "alta", "high"],
  medium: ["partial", "media", "medium"],
  low: ["done", "baja", "low"],
};

/** Barritas con las búsquedas de cada mes (del más viejo al más nuevo). */
function Spark({ trend, label }: { trend: number[]; label: string }) {
  if (trend.length < 2) return <span className="muted">—</span>;
  const max = Math.max(...trend, 1);
  const w = 4;
  const gap = 1.5;
  const h = 20;
  const width = trend.length * (w + gap) - gap;
  return (
    <svg className="kw-spark" width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={label}>
      <title>{label}</title>
      {trend.map((v, i) => {
        const bh = Math.max(1.5, (v / max) * h);
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={1} className={i === trend.length - 1 ? "last" : undefined} />;
      })}
    </svg>
  );
}

/** Búsquedas reales de Google Ads (DataForSEO) para las palabras clave del negocio, e ideas nuevas. */
export async function KeywordsPanel({ businessId }: { businessId: string }) {
  if (!dataForSeoEnabled()) return null; // El panel de configuración ya explica cómo conectarlo.
  const { lang, t } = await getT();
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { seoLocationCode: true, seoLocationName: true, seoKeywords: true },
  });
  if (!b) return null;
  const tracked = readTrackedKeywords(b.seoKeywords).map((k) => k.toLowerCase());

  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Palabras clave con datos reales", "Keywords with real data")}</h2>
      <p className="small muted">
        {t(
          "Cuánta gente busca cada palabra en Google al mes en tu zona, si sube o baja, y cuánto pagan los anunciantes por cada clic. Los datos vienen de Google Ads.",
          "How many people search each keyword on Google per month in your area, whether it's going up or down, and how much advertisers pay per click. The data comes from Google Ads.",
        )}
      </p>
    </div>
  );

  if (!b.seoLocationCode || tracked.length === 0) {
    return (
      <section className="card">
        {header}
        <p className="note">
          {t(
            "Para ver las búsquedas reales, elige tu zona de Google y escribe tus palabras clave en el panel de arriba (Datos reales de Google) y guarda.",
            "To see real searches, pick your Google area and enter your keywords in the panel above (Real Google data) and save.",
          )}
        </p>
      </section>
    );
  }

  const rows = await latestReports(businessId, "keywords", 1);
  const report = rows[0] ? readKeywordsReport(rows[0].data) : null;
  const lookup = reportLookup(report);
  const trackedSet = new Set(tracked);
  const full = tracked.length >= MAX_TRACKED;

  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const number = volumeFormat(lang);
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pick = ([, es, en]: [string, string, string]) => t(es, en);
  const post = (kw: string) =>
    `/b/${businessId}/publicar?${new URLSearchParams({ idea: t(`Escribe una publicación para la búsqueda: ${kw}`, `Write a post for the search: ${kw}`), magic: "1" })}`;

  const empty = (keyword: string): KwRow => ({ keyword, volume: null, cpc: null, competition: null, competitionIndex: null, trend: [] });
  const mine = tracked.map((k) => lookup.get(k) ?? empty(k)).sort(byVolume);
  const others = (report?.keywords ?? []).filter((r) => !trackedSet.has(r.keyword.toLowerCase()));
  const ideas = (report?.ideas ?? []).slice(0, IDEAS_SHOWN);

  const table = (list: KwRow[], follow: boolean) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t("Búsqueda", "Search")}</th>
            <th className="kw-num">{t("Búsquedas al mes", "Monthly searches")}</th>
            <th>{t("Últimos 12 meses", "Last 12 months")}</th>
            <th>{t("Competencia en anuncios", "Ad competition")}</th>
            <th className="kw-num">CPC</th>
            <th><span className="sr-only">{t("Acciones", "Actions")}</span></th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const dir = trendDirection(r.trend);
            const spark = t(`Búsquedas de los últimos meses: ${r.trend.map((v) => number.format(v)).join(", ")}`, `Searches in recent months: ${r.trend.map((v) => number.format(v)).join(", ")}`);
            const isTracked = trackedSet.has(r.keyword.toLowerCase());
            return (
              <tr key={r.keyword}>
                <td><strong>{r.keyword}</strong></td>
                <td className="kw-num">
                  {r.volume !== null ? number.format(r.volume) : <span className="muted" title={report && lookup.has(r.keyword) ? t("Google no tiene datos de esta búsqueda", "Google has no data for this search") : t("Presiona Actualizar búsquedas para ver sus datos", "Press Update searches to see its data")}>—</span>}
                </td>
                <td>
                  <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                    <Spark trend={r.trend} label={spark} />
                    {dir === "up" && <span className="kw-up" title={t("Subiendo: más búsquedas en los últimos 3 meses", "Rising: more searches in the last 3 months")}>▲</span>}
                    {dir === "down" && <span className="kw-down" title={t("Bajando: menos búsquedas en los últimos 3 meses", "Falling: fewer searches in the last 3 months")}>▼</span>}
                  </span>
                </td>
                <td>{r.competition ? <span className={`pill ${COMPETITION[r.competition][0]}`}>{pick(COMPETITION[r.competition])}</span> : <span className="muted">—</span>}</td>
                <td className="kw-num">{r.cpc !== null ? money.format(r.cpc) : <span className="muted">—</span>}</td>
                <td>
                  <span className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
                    <Link href={post(r.keyword)} className="btn link" style={{ whiteSpace: "nowrap" }}>{t("Crear post", "Create post")}</Link>
                    {follow && (isTracked ? <span className="small muted" style={{ whiteSpace: "nowrap" }}>{t("Siguiendo ✓", "Tracking ✓")}</span> : <FollowButton businessId={businessId} keyword={r.keyword} full={full} />)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="card">
      {header}
      <p className="small muted">
        {t("Zona:", "Area:")} {b.seoLocationName || b.seoLocationCode}
        {report && rows[0] && (
          <>
            {" · "}
            {t("Última actualización:", "Last update:")} {fmt.format(rows[0].createdAt)} · {t("Costo:", "Cost:")} {costText(report.cost)}
          </>
        )}
      </p>
      <KeywordsButton action={refreshKeywords.bind(null, businessId)} />

      {!report && (
        <p className="small muted">
          {rows.length > 0
            ? t("El último reporte tiene un formato viejo y no se puede mostrar. Presiona Actualizar búsquedas.", "The last report is in an old format and can't be shown. Press Update searches.")
            : t("Todavía no has traído las búsquedas reales. Presiona el botón.", "You haven't fetched the real searches yet. Press the button.")}
        </p>
      )}

      {report && (
        <>
          {report.locationCode > 0 && report.locationCode !== b.seoLocationCode && (
            <p className="note">
              {t(
                `Estos datos son de ${report.location || "otra zona"}. Cambiaste la zona: actualiza para ver los de la nueva.`,
                `This data is for ${report.location || "another area"}. You changed the area: update to see the new one.`,
              )}
            </p>
          )}
          <div className="stack" style={{ gap: 8 }}>
            <span className="lbl">{t(`Tus palabras clave (${mine.length})`, `Your keywords (${mine.length})`)}</span>
            {table(mine, false)}
            <span className="small muted">
              {t(
                "CPC es lo que paga un anunciante en Google por cada clic. Si es alto, esa búsqueda trae clientes que valen dinero: vale la pena aparecer gratis con publicaciones y artículos.",
                "CPC is what an advertiser pays Google for each click. If it's high, that search brings customers worth money: it's worth showing up for free with posts and articles.",
              )}
            </span>
          </div>

          {others.length > 0 && (
            <details>
              <summary className="btn link" style={{ display: "inline-flex", padding: 0 }}>
                {t(`Ver otras ${others.length} palabras de tu estudio`, `See ${others.length} more keywords from your study`)}
              </summary>
              <div style={{ marginTop: 10 }}>{table(others, true)}</div>
            </details>
          )}

          <div className="stack" style={{ gap: 8 }}>
            <span className="lbl">{t("Ideas", "Ideas")}</span>
            {ideas.length > 0 ? (
              <>
                <span className="small muted">
                  {t(
                    "Búsquedas parecidas que la gente hace en tu zona, las de más búsquedas primero. Síguelas para medirlas cada vez.",
                    "Similar searches people make in your area, most searched first. Track them to measure them every time.",
                  )}
                  {full && t(` Ya sigues ${MAX_TRACKED}: quita alguna arriba para agregar otra.`, ` You already track ${MAX_TRACKED}: remove one above to add another.`)}
                </span>
                {table(ideas, true)}
              </>
            ) : (
              <p className="small muted">
                {report.ideasFailed
                  ? t("Las ideas no se pudieron traer esta vez. Vuelve a actualizar en un minuto.", "Ideas couldn't be fetched this time. Update again in a minute.")
                  : t("Google no devolvió ideas nuevas para estas palabras.", "Google didn't return new ideas for these keywords.")}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
