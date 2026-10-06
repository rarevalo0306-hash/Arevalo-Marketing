import Link from "next/link";
import { refreshKeywords } from "@/app/actions-seo-keywords";
import { FollowButton, KeywordsButton } from "@/components/seo/KeywordsButton";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readTrackedKeywords, readZones, type Zone, zoneLabel } from "@/lib/seo/dataforseo";
import {
  type Competition,
  costText,
  keywordsCostEstimate,
  type KwRow,
  MAX_TRACKED,
  mergeZoneRows,
  readKeywordsReport,
  trendDirection,
  volumeFormat,
  zoneTotal,
  type ZoneKwRow,
} from "@/lib/seo/keywords";
import { latestReports } from "@/lib/seo/reports";
import { latestByZone, zonesWithout } from "@/lib/seo/zones";
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
    select: { seoLocations: true, seoLocationCode: true, seoLocationName: true, seoKeywords: true },
  });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
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

  if (!zones.length || tracked.length === 0) {
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

  // Un reporte por zona y por actualización: con 20 alcanza para las últimas 4 corridas de 5 zonas.
  const rows = await latestReports(businessId, "keywords", 20);
  const parsed = rows.map((r) => {
    const report = readKeywordsReport(r.data);
    return report ? { ...report, savedAt: r.createdAt } : null;
  });
  const byZone = latestByZone(parsed, zones);
  const main = byZone.get(zones[0].code) ?? null;
  const missing = zonesWithout(zones, byZone);
  const shown = [...byZone.values()];
  // La zona principal da tendencia, competencia, CPC e ideas.
  const report = main ?? shown[0] ?? null;
  const trackedSet = new Set(tracked);
  const full = tracked.length >= MAX_TRACKED;
  const multi = zones.length > 1;

  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const number = volumeFormat(lang);
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pick = ([, es, en]: [string, string, string]) => t(es, en);
  const post = (kw: string) =>
    `/b/${businessId}/publicar?${new URLSearchParams({ idea: t(`Escribe una publicación para la búsqueda: ${kw}`, `Write a post for the search: ${kw}`), magic: "1" })}`;
  const label = (z: Zone) => zoneLabel(z.name) || String(z.code);

  const mine = mergeZoneRows(tracked, zones, byZone);
  const others = mergeZoneRows(
    (report?.keywords ?? []).map((r) => r.keyword).filter((k) => !trackedSet.has(k.toLowerCase())),
    zones,
    byZone,
  );
  // Las ideas solo se buscan en la zona principal: una sola columna de búsquedas.
  const ideas: ZoneKwRow[] = (main?.ideas ?? []).slice(0, IDEAS_SHOWN).map((row) => ({ row, volumes: [row.volume] }));
  const newest = shown.reduce<Date | null>((a, r) => (!a || r.savedAt > a ? r.savedAt : a), null);

  const volumeCell = (v: number | null | undefined, z: Zone) =>
    typeof v === "number" ? (
      number.format(v)
    ) : (
      <span
        className="muted"
        title={
          v === null
            ? t("Google no tiene datos de esta búsqueda", "Google has no data for this search")
            : byZone.has(z.code)
              ? t("Esta palabra no se midió en esa zona. Presiona Actualizar búsquedas.", "This keyword wasn't measured in that area. Press Update searches.")
              : t("Presiona Actualizar búsquedas para ver sus datos", "Press Update searches to see its data")
        }
      >
        —
      </span>
    );

  const table = (list: ZoneKwRow[], follow: boolean, cols: Zone[]) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t("Búsqueda", "Search")}</th>
            {cols.length > 1 || multi ? (
              cols.map((z, i) => (
                <th key={z.code} className="kw-num" title={z.name}>
                  {label(z)}
                  {i === 0 && cols.length > 1 && <span className="small muted"> ★</span>}
                  <br />
                  <span className="small muted" style={{ fontWeight: 400 }}>{t("búsq./mes", "searches/mo")}</span>
                </th>
              ))
            ) : (
              <th className="kw-num">{t("Búsquedas al mes", "Monthly searches")}</th>
            )}
            <th>{t("Últimos 12 meses", "Last 12 months")}</th>
            <th>{t("Competencia en anuncios", "Ad competition")}</th>
            <th className="kw-num">CPC</th>
            <th><span className="sr-only">{t("Acciones", "Actions")}</span></th>
          </tr>
        </thead>
        <tbody>
          {list.map(({ row: r, volumes }) => {
            const dir = trendDirection(r.trend);
            const spark = t(`Búsquedas de los últimos meses: ${r.trend.map((v) => number.format(v)).join(", ")}`, `Searches in recent months: ${r.trend.map((v) => number.format(v)).join(", ")}`);
            const isTracked = trackedSet.has(r.keyword.toLowerCase());
            return (
              <tr key={r.keyword}>
                <td><strong>{r.keyword}</strong></td>
                {cols.map((z, i) => <td key={z.code} className="kw-num">{volumeCell(volumes[i], z)}</td>)}
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
  const totals = mine.filter((m) => m.volumes.filter((v) => typeof v === "number").length > 1);

  return (
    <section className="card">
      {header}
      <p className="small muted">
        {multi ? t("Zonas:", "Areas:") : t("Zona:", "Area:")} {zones.map(label).join(" · ")}
        {newest && (
          <>
            {" · "}
            {t("Última actualización:", "Last update:")} {fmt.format(newest)} · {t("Costo:", "Cost:")} {costText(shown.reduce((s, r) => s + r.cost, 0))}
          </>
        )}
      </p>
      <KeywordsButton action={refreshKeywords.bind(null, businessId)} zones={zones.length} estimate={keywordsCostEstimate(zones.length)} />

      {shown.length === 0 && (
        <p className="small muted">
          {rows.length > 0
            ? parsed.some(Boolean)
              ? t("Los datos que tienes son de otra zona. Presiona Actualizar búsquedas para ver los de tus zonas.", "The data you have is for another area. Press Update searches to see your areas.")
              : t("El último reporte tiene un formato viejo y no se puede mostrar. Presiona Actualizar búsquedas.", "The last report is in an old format and can't be shown. Press Update searches.")
            : t("Todavía no has traído las búsquedas reales. Presiona el botón.", "You haven't fetched the real searches yet. Press the button.")}
        </p>
      )}

      {shown.length > 0 && missing.length > 0 && (
        <p className="note">
          {t(
            `Todavía no hay datos de: ${missing.map(label).join(", ")}. Presiona Actualizar búsquedas para medirlas.`,
            `No data yet for: ${missing.map(label).join(", ")}. Press Update searches to measure them.`,
          )}
        </p>
      )}

      {report && (
        <>
          <div className="stack" style={{ gap: 8 }}>
            <span className="lbl">{t(`Tus palabras clave (${mine.length})`, `Your keywords (${mine.length})`)}</span>
            {table(mine, false, zones)}
            <span className="small muted">
              {multi &&
                t(
                  `★ = tu zona principal: de ahí salen la tendencia, la competencia y el CPC. `,
                  `★ = your main area: the trend, competition and CPC come from there. `,
                )}
              {t(
                "CPC es lo que paga un anunciante en Google por cada clic. Si es alto, esa búsqueda trae clientes que valen dinero: vale la pena aparecer gratis con publicaciones y artículos.",
                "CPC is what an advertiser pays Google for each click. If it's high, that search brings customers worth money: it's worth showing up for free with posts and articles.",
              )}
            </span>
            {totals.length > 0 && (
              <details>
                <summary className="btn link" style={{ display: "inline-flex", padding: 0 }}>{t("Ver el total de búsquedas en tus zonas", "See total searches across your areas")}</summary>
                <ul className="small study-list" style={{ marginTop: 8 }}>
                  {totals.map((m) => (
                    <li key={m.row.keyword}>
                      <strong>{m.row.keyword}:</strong> {number.format(zoneTotal(m.volumes) ?? 0)} {t("al mes", "a month")}
                    </li>
                  ))}
                </ul>
                <span className="small muted">
                  {t("Si una zona está dentro de otra (una ciudad dentro de su país), esas búsquedas se cuentan dos veces.", "If one area is inside another (a city inside its country), those searches are counted twice.")}
                </span>
              </details>
            )}
          </div>

          {others.length > 0 && (
            <details>
              <summary className="btn link" style={{ display: "inline-flex", padding: 0 }}>
                {t(`Ver otras ${others.length} palabras de tu estudio`, `See ${others.length} more keywords from your study`)}
              </summary>
              <div style={{ marginTop: 10 }}>{table(others, true, zones)}</div>
            </details>
          )}

          <div className="stack" style={{ gap: 8 }}>
            <span className="lbl">{t("Ideas", "Ideas")}</span>
            {!main ? (
              <p className="small muted">
                {t(
                  `Las ideas se buscan en tu zona principal (${label(zones[0])}). Presiona Actualizar búsquedas.`,
                  `Ideas are looked up in your main area (${label(zones[0])}). Press Update searches.`,
                )}
              </p>
            ) : ideas.length > 0 ? (
              <>
                <span className="small muted">
                  {multi
                    ? t(
                        `Búsquedas parecidas que la gente hace en ${label(zones[0])}, las de más búsquedas primero. Síguelas para medirlas cada vez en todas tus zonas.`,
                        `Similar searches people make in ${label(zones[0])}, most searched first. Track them to measure them every time in all your areas.`,
                      )
                    : t(
                        "Búsquedas parecidas que la gente hace en tu zona, las de más búsquedas primero. Síguelas para medirlas cada vez.",
                        "Similar searches people make in your area, most searched first. Track them to measure them every time.",
                      )}
                  {full && t(` Ya sigues ${MAX_TRACKED}: quita alguna arriba para agregar otra.`, ` You already track ${MAX_TRACKED}: remove one above to add another.`)}
                </span>
                {table(ideas, true, [zones[0]])}
              </>
            ) : (
              <p className="small muted">
                {main.ideasFailed
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
