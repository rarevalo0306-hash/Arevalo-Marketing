import Link from "next/link";
import { runRankCheck } from "@/app/actions-seo-rank";
import { RankButton } from "@/components/seo/RankButton";
import { db } from "@/lib/db";
import { intlLocale, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, type Zone, zoneLabel } from "@/lib/seo/dataforseo";
import { compareRuns, RANK_COST_PER_KEYWORD, RANK_DEPTH, rankSetup, readRankReport, type Change, type RankReport, type RankRow } from "@/lib/seo/rank";
import { latestReports } from "@/lib/seo/reports";
import { groupByZone } from "@/lib/seo/zones";
import { BUSINESS_TZ } from "@/lib/time";

/** Nombres de lo que Google muestra además de los resultados normales. */
function featureLabel(f: string, t: T): string {
  const names: Record<string, string> = {
    local_pack: t("Mapa con negocios", "Map pack"),
    map: t("Mapa", "Map"),
    people_also_ask: t("Preguntas relacionadas", "People also ask"),
    featured_snippet: t("Respuesta destacada", "Featured snippet"),
    ads: t("Anuncios", "Ads"),
    ai_overview: t("Resumen con IA", "AI Overview"),
    images: t("Imágenes", "Images"),
    video: t("Videos", "Videos"),
    short_videos: t("Videos cortos", "Short videos"),
    top_stories: t("Noticias", "Top stories"),
    knowledge_graph: t("Ficha de Google", "Knowledge panel"),
    local_services: t("Servicios locales de Google", "Local Services ads"),
    related_searches: t("Búsquedas relacionadas", "Related searches"),
    shopping: t("Compras", "Shopping"),
    popular_products: t("Productos populares", "Popular products"),
    discussions_and_forums: t("Foros", "Forums"),
    perspectives: t("Opiniones", "Perspectives"),
    twitter: "X / Twitter",
    hotels_pack: t("Hoteles", "Hotels"),
    jobs: t("Empleos", "Jobs"),
  };
  return names[f] ?? f.replace(/_/g, " ");
}

/** Muestra corta de una dirección web: sin https:// ni www. */
const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || url;

/** Cambio de posición: ▲ subió, ▼ bajó (lugares). */
function Move({ c, t }: { c: Change | undefined; t: T }) {
  if (!c) return null;
  if (c.kind === "up") return <span className="rank-up" title={t(`Antes: ${c.previous}`, `Before: ${c.previous}`)}>▲{c.delta}</span>;
  if (c.kind === "down") return <span className="rank-down" title={t(`Antes: ${c.previous}`, `Before: ${c.previous}`)}>▼{Math.abs(c.delta ?? 0)}</span>;
  if (c.kind === "new") return <span className="rank-up">{t("nueva", "new")}</span>;
  if (c.kind === "lost") return <span className="rank-down">{t(`antes ${c.previous}`, `was ${c.previous}`)}</span>;
  return null;
}

/** Mini gráfica de las últimas revisiones (arriba = mejor). Las veces que no salió se marcan abajo. */
function Spark({ points, label }: { points: (number | null | undefined)[]; label: string }) {
  const known = points.filter((p) => p !== undefined);
  if (known.length < 2) return <span className="muted small">—</span>;
  const W = 84;
  const H = 26;
  const pad = 3;
  const max = RANK_DEPTH + 1;
  const x = (i: number) => (points.length === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (points.length - 1));
  const y = (p: number) => pad + ((Math.min(p, max) - 1) * (H - pad * 2)) / (max - 1);
  const segs: string[][] = [];
  let cur: string[] = [];
  points.forEach((p, i) => {
    if (typeof p === "number") cur.push(`${x(i).toFixed(1)},${y(p).toFixed(1)}`);
    else if (cur.length) {
      segs.push(cur);
      cur = [];
    }
  });
  if (cur.length) segs.push(cur);
  const lastIdx = points.length - 1;
  const last = points[lastIdx];
  return (
    <svg className="rank-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <title>{label}</title>
      <line x1={pad} x2={W - pad} y1={y(10.5)} y2={y(10.5)} className="rank-spark-mid" />
      {segs.map((s, i) => (s.length > 1 ? <polyline key={i} points={s.join(" ")} fill="none" /> : null))}
      {points.map((p, i) =>
        p === null ? <circle key={i} cx={x(i)} cy={H - pad} r={1.6} className="rank-spark-miss" /> : typeof p === "number" ? <circle key={i} cx={x(i)} cy={y(p)} r={1.4} /> : null,
      )}
      {typeof last === "number" && <circle cx={x(lastIdx)} cy={y(last)} r={2.6} className="rank-spark-last" />}
    </svg>
  );
}

export async function RankPanel({ businessId }: { businessId: string }) {
  if (!dataForSeoEnabled()) return null;
  const { lang, t } = await getT();
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoKeywords: true, seoDaily: true },
  });
  if (!b) return null;
  const setup = rankSetup(b);

  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Tus posiciones en Google", "Your Google rankings")}</h2>
      <p className="small muted">
        {t(
          "En qué lugar sales en Google para cada palabra clave que sigues, si apareces en el mapa y quién está arriba de ti.",
          "Where you show up on Google for each keyword you track, whether you're on the map, and who is above you.",
        )}
      </p>
    </div>
  );

  if (!setup.ok) {
    return (
      <section className="card">
        {header}
        <p className="note">
          {setup.missing === "website" ? (
            <>
              {t("Para ver tus posiciones, primero agrega la dirección de tu página web en ", "To see your rankings, first add your website address in ")}
              <Link href={`/b/${businessId}/negocio`}>{t("Ajustes del negocio", "Business settings")}</Link>.
            </>
          ) : setup.missing === "location" ? (
            t("Para ver tus posiciones, primero elige la zona donde buscan tus clientes en «Datos reales de Google», aquí arriba.", "To see your rankings, first pick the area where your customers search in “Real Google data” above.")
          ) : (
            t("Para ver tus posiciones, primero agrega las palabras clave que quieres seguir en «Datos reales de Google», aquí arriba.", "To see your rankings, first add the keywords you want to track in “Real Google data” above.")
          )}
        </p>
      </section>
    );
  }

  const zones = setup.zones;
  const multi = zones.length > 1;
  // Un reporte por zona y por revisión: se leen las últimas 10 revisiones de cada zona (máx. 50 filas).
  const saved = await latestReports(businessId, "rank", 10 * zones.length);
  const parsed = saved.map((r) => {
    const report = readRankReport(r.data);
    return report ? { ...report, savedAt: r.createdAt } : null;
  });
  const groups = groupByZone(parsed, zones);
  const perZone = zones.map((zone) => {
    const list = groups.get(zone.code) ?? [];
    return { zone, list, report: list[0] ?? null, changes: list[0] ? compareRuns(list[0], list[1]) : ({} as Record<string, Change>) };
  });
  const mainZone = perZone[0];
  const report = mainZone.report;
  const previous = mainZone.list[1] ?? null;
  const history = mainZone.list.slice(0, 10).reverse();
  const latest = perZone.flatMap((z) => (z.report ? [z.report] : []));
  const missing = perZone.filter((z) => !z.report).map((z) => z.zone);
  const newest = latest.reduce<Date | null>((a, r) => (!a || r.savedAt > a ? r.savedAt : a), null);
  // Costo de la última revisión: los reportes de las zonas guardados en la misma corrida.
  const lastRunCost = newest ? latest.filter((r) => newest.getTime() - r.savedAt.getTime() < 15 * 60_000).reduce((s, r) => s + r.cost, 0) : 0;

  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const short = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeZone: BUSINESS_TZ });
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  const one = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });
  const label = (z: Zone) => zoneLabel(z.name) || String(z.code);
  const location = multi ? t(`tus ${zones.length} zonas`, `your ${zones.length} areas`) : zoneLabel(report?.location || zones[0].name) || t("tu zona", "your area");

  // Todas las palabras de las últimas revisiones, en el orden de la zona principal.
  const keywords: string[] = [];
  for (const r of latest) for (const row of r.rows) if (!keywords.some((k) => k.toLowerCase() === row.keyword.toLowerCase())) keywords.push(row.keyword);
  const rowOf = (r: RankReport | null, keyword: string) => r?.rows.find((x) => x.keyword.toLowerCase() === keyword.toLowerCase());

  /** Cambio de un número del resumen. lowerIsBetter: para la posición promedio. */
  const delta = (cur: number | null, prev: number | null | undefined, lowerIsBetter = false, unit = "") => {
    if (!previous) return <span className="stat-note">{t("Sin revisión anterior para comparar", "No earlier check to compare")}</span>;
    if (cur === null || prev === null || prev === undefined) return <span className="stat-note">{t("Antes", "Before")}: {prev === null || prev === undefined ? "—" : `${one.format(prev)}${unit}`}</span>;
    const d = Math.round((cur - prev) * 10) / 10;
    if (d === 0) return <span className="stat-note">= {t("igual que la vez anterior", "same as last time")}</span>;
    const good = lowerIsBetter ? d < 0 : d > 0;
    return (
      <span className={`stat-note ${good ? "rank-up" : "rank-down"}`}>
        {d > 0 ? "▲" : "▼"} {one.format(Math.abs(d))}
        {unit} {t("vs. la vez anterior", "vs. last time")}
      </span>
    );
  };

  /** Posición orgánica + lugar en el mapa, compacto: "3 ▲1 · 📍2". */
  const cell = (row: RankRow | undefined, c: Change | undefined) => {
    if (!row) return <span className="muted small" title={t("Esta palabra todavía no se revisó en esta zona", "This keyword hasn't been checked in this area yet")}>·</span>;
    if (row.error) return <span className="pill failed" title={lang === "en" ? row.error.en : row.error.es}>{t("Falló", "Failed")}</span>;
    return (
      <>
        <strong title={row.position === null ? t(`No sales en los primeros ${RANK_DEPTH}`, `Not in the top ${RANK_DEPTH}`) : undefined}>{row.position ?? "—"}</strong> <Move c={c} t={t} />
        {row.localPack &&
          (row.localPack.position !== null ? (
            <span className="small" title={t("Tu lugar en el mapa de Google", "Your spot on Google's map")}> · 📍{row.localPack.position}</span>
          ) : (
            <span className="small muted" title={t("Hay mapa, pero no sales en él", "There's a map, but you're not in it")}> · 📍—</span>
          ))}
      </>
    );
  };

  /** Quién sale arriba en cada palabra (los 5 primeros, el mapa y lo demás que muestra Google). */
  const above = (r: RankReport) => (
    <div className="rank-details">
      {r.rows
        .filter((x) => !x.error)
        .map((x) => (
          <details key={x.keyword}>
            <summary>
              <span>{x.keyword}</span>
              <span className="small muted">{x.position === null ? t(`no sales en los primeros ${RANK_DEPTH}`, `not in the top ${RANK_DEPTH}`) : t(`sales en el lugar ${x.position}`, `you're #${x.position}`)}</span>
            </summary>
            <div className="stack" style={{ gap: 10, paddingTop: 8 }}>
              {x.top.length > 0 ? (
                <ol className="rank-top">
                  {x.top.map((y) => (
                    <li key={`${y.position}-${y.url}`} value={y.position} className={y.position === x.position ? "mine" : ""}>
                      <a href={y.url} target="_blank" rel="noopener noreferrer">{y.title || y.domain}</a>
                      <span className="muted small"> · {y.domain}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <span className="small muted">{t("Google no mostró resultados normales para esta búsqueda.", "Google didn't show regular results for this search.")}</span>
              )}
              {x.localPack && x.localPack.names.length > 0 && (
                <span className="small">
                  <strong>{t("En el mapa:", "On the map:")}</strong> {x.localPack.names.join(" · ")}
                </span>
              )}
              {x.features.length > 0 && (
                <div className="tags">
                  {x.features.map((f) => <span key={f} className="tag">{featureLabel(f, t)}</span>)}
                </div>
              )}
            </div>
          </details>
        ))}
    </div>
  );

  return (
    <section className="card">
      {header}
      <p className="small muted">
        {newest ? (
          <>
            {t("Última revisión:", "Last check:")} {fmt.format(newest)} · {t("costó", "cost")} {money.format(Math.round(lastRunCost * 10000) / 10000)}
            {" · "}
          </>
        ) : null}
        <span className={`pill ${b.seoDaily ? "done" : "draft"}`}>{b.seoDaily ? t("Revisión diaria encendida", "Daily check on") : t("Revisión diaria apagada", "Daily check off")}</span>
      </p>
      <RankButton action={runRankCheck.bind(null, businessId)} keywords={setup.keywords.length} zones={zones.length} perKeyword={RANK_COST_PER_KEYWORD} has={latest.length > 0} />

      {latest.length === 0 &&
        (saved.length === 0 ? (
          <p className="small muted">
            {t(
              "Todavía no has revisado tus posiciones. Presiona el botón, o enciende la revisión diaria en «Datos reales de Google» para que se haga sola cada día.",
              "You haven't checked your rankings yet. Press the button, or turn on the daily check in “Real Google data” so it runs on its own every day.",
            )}
          </p>
        ) : parsed.some(Boolean) ? (
          <p className="note">{t("Tus revisiones anteriores son de otra zona. Vuelve a revisar para ver tus zonas actuales.", "Your earlier checks are for another area. Check again to see your current areas.")}</p>
        ) : (
          <p className="note">{t("La última revisión tiene un formato viejo y no se puede mostrar. Vuelve a revisar.", "The last check is in an old format and can't be shown. Check again.")}</p>
        ))}

      {latest.length > 0 && (
        <>
          <p className="small muted">
            {t(
              `Resultados de Google en el celular (así buscan los clientes locales) en ${location}, primeros ${RANK_DEPTH} lugares. Las posiciones cambian un poco cada día: fíjate en la tendencia.`,
              `Google results on mobile (how local customers search) in ${location}, top ${RANK_DEPTH} spots. Rankings move a little every day: watch the trend.`,
            )}
          </p>
          {missing.length > 0 && (
            <p className="note">
              {t(`Todavía sin revisar: ${missing.map(label).join(", ")}. Presiona el botón para revisarlas.`, `Not checked yet: ${missing.map(label).join(", ")}. Press the button to check them.`)}
            </p>
          )}

          {report && (
            <div className="stack" style={{ gap: 8 }}>
              {multi && <span className="lbl">{t(`Zona principal: ${label(zones[0])}`, `Main area: ${label(zones[0])}`)}</span>}
              <div className="stats">
                <div className="stat">
                  <span className="stat-label">{t("Posición promedio", "Average position")}</span>
                  <span className="stat-value">{report.avgPosition === null ? "—" : one.format(report.avgPosition)}</span>
                  {delta(report.avgPosition, previous?.avgPosition, true)}
                </div>
                <div className="stat">
                  <span className="stat-label">{t("En los 3 primeros", "In the top 3")}</span>
                  <span className="stat-value">
                    {report.inTop3}
                    <small> / {report.rows.length}</small>
                  </span>
                  {delta(report.inTop3, previous?.inTop3)}
                </div>
                <div className="stat">
                  <span className="stat-label">{t("En la primera página (top 10)", "On page one (top 10)")}</span>
                  <span className="stat-value">
                    {report.inTop10}
                    <small> / {report.rows.length}</small>
                  </span>
                  {delta(report.inTop10, previous?.inTop10)}
                </div>
                <div className="stat">
                  <span className="stat-label" title={t("100 % = primer lugar en todas tus palabras clave. Pesa más salir arriba, porque ahí está la mayoría de los clics.", "100% = first place for all your keywords. Higher spots weigh more, since that's where most clicks go.")}>
                    {t("Visibilidad", "Visibility")}
                  </span>
                  <span className="stat-value">
                    {report.visibility}
                    <small>%</small>
                  </span>
                  {delta(report.visibility, previous?.visibility, false, "%")}
                </div>
              </div>
            </div>
          )}

          {multi && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="lbl">{t("Por zona", "By area")}</span>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Zona", "Area")}</th>
                      <th className="rank-num">{t("Promedio", "Average")}</th>
                      <th className="rank-num">{t("Top 3", "Top 3")}</th>
                      <th className="rank-num">{t("Top 10", "Top 10")}</th>
                      <th className="rank-num">{t("Visibilidad", "Visibility")}</th>
                      <th>{t("Revisión", "Checked")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perZone.map(({ zone, report: r }, i) => (
                      <tr key={zone.code}>
                        <td title={zone.name}>
                          <strong>{label(zone)}</strong>
                          {i === 0 && <span className="small muted"> ★</span>}
                        </td>
                        {r ? (
                          <>
                            <td className="rank-num">{r.avgPosition === null ? "—" : one.format(r.avgPosition)}</td>
                            <td className="rank-num">{r.inTop3} / {r.rows.length}</td>
                            <td className="rank-num">{r.inTop10} / {r.rows.length}</td>
                            <td className="rank-num">{r.visibility}%</td>
                            <td className="small muted" style={{ whiteSpace: "nowrap" }}>{short.format(r.savedAt)}</td>
                          </>
                        ) : (
                          <td colSpan={5} className="small muted">{t("Sin revisar todavía", "Not checked yet")}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Palabra clave", "Keyword")}</th>
                  {multi ? (
                    perZone.map(({ zone }, i) => (
                      <th key={zone.code} className="rank-num" title={zone.name}>
                        {label(zone)}
                        {i === 0 && <span className="small muted"> ★</span>}
                      </th>
                    ))
                  ) : (
                    <th>{t("Posición", "Position")}</th>
                  )}
                  <th>{t("Tu página que sale", "Your page that ranks")}</th>
                  <th>{multi ? t("Tendencia ★", "Trend ★") : t("Tendencia", "Trend")}</th>
                </tr>
              </thead>
              <tbody>
                {keywords.map((k) => {
                  const points = history.map((h) => {
                    const row = rowOf(h, k);
                    return !row || row.error ? undefined : row.position;
                  });
                  const spark = t(
                    `Últimas posiciones: ${points.filter((p) => p !== undefined).map((p) => p ?? "—").join(", ")}`,
                    `Recent positions: ${points.filter((p) => p !== undefined).map((p) => p ?? "—").join(", ")}`,
                  );
                  const url = rowOf(report, k)?.url ?? perZone.map((z) => rowOf(z.report, k)?.url).find(Boolean) ?? null;
                  return (
                    <tr key={k}>
                      <td><strong>{k}</strong></td>
                      {perZone.map((z) => {
                        const row = rowOf(z.report, k);
                        return <td key={z.zone.code} className="rank-num">{cell(row, row ? z.changes[row.keyword] : undefined)}</td>;
                      })}
                      <td className="small rank-url">
                        {url ? <a href={url} target="_blank" rel="noopener noreferrer">{shortUrl(url)}</a> : <span className="muted">—</span>}
                      </td>
                      <td><Spark points={points} label={spark} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            {t(
              `«—» = no sales en los primeros ${RANK_DEPTH}. «📍» = tu lugar entre los negocios del mapa de Google («📍—» hay mapa pero no sales; sin 📍, Google no mostró mapa). ▲ subiste / ▼ bajaste lugares desde la revisión anterior de esa zona.`,
              `“—” = not in the top ${RANK_DEPTH}. “📍” = your spot among the businesses on Google's map (“📍—” there's a map but you're not on it; no 📍, Google showed no map). ▲ moved up / ▼ moved down since that area's last check.`,
            )}
            {multi && t(" ★ = tu zona principal (la tendencia es de esa zona).", " ★ = your main area (the trend is for that area).")}
            {history.length > 1 && ` ${t("Tendencia desde", "Trend since")} ${short.format(history[0].savedAt)}.`}
          </p>

          <div className="stack" style={{ gap: 8 }}>
            <span className="lbl">
              {t("¿Quién está arriba de ti?", "Who is above you?")}
              {multi && report && ` · ${label(zones[0])}`}
            </span>
            {report ? above(report) : <span className="small muted">{t("Tu zona principal todavía no se revisó.", "Your main area hasn't been checked yet.")}</span>}
            {perZone.slice(1).map(({ zone, report: r }) =>
              r ? (
                <details key={zone.code}>
                  <summary className="btn link" style={{ display: "inline-flex", padding: 0 }}>
                    {t(`Ver quién está arriba en ${label(zone)}`, `See who is above you in ${label(zone)}`)}
                  </summary>
                  <div style={{ marginTop: 10 }}>{above(r)}</div>
                </details>
              ) : null,
            )}
          </div>
        </>
      )}
    </section>
  );
}
