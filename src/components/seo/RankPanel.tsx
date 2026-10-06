import Link from "next/link";
import { runRankCheck } from "@/app/actions-seo-rank";
import { RankButton } from "@/components/seo/RankButton";
import { db } from "@/lib/db";
import { intlLocale, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import { compareRuns, RANK_COST_PER_KEYWORD, RANK_DEPTH, rankSetup, readRankReport, type Change, type RankReport } from "@/lib/seo/rank";
import { latestReports } from "@/lib/seo/reports";
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
    select: { website: true, seoLocationCode: true, seoLocationName: true, seoKeywords: true, seoDaily: true },
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

  const saved = await latestReports(businessId, "rank", 10);
  const reports = saved.map((r) => ({ at: r.createdAt, report: readRankReport(r.data) }));
  const report = reports[0]?.report ?? null;
  const previous = reports[1]?.report ?? null;
  const changes = report ? compareRuns(report, previous) : {};
  const history = reports
    .map((r) => r.report)
    .filter((r): r is RankReport => r !== null)
    .reverse();

  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const short = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeZone: BUSINESS_TZ });
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  const one = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });
  const location = report?.location || b.seoLocationName || t("tu zona", "your area");

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

  return (
    <section className="card">
      {header}
      <p className="small muted">
        {reports[0] ? (
          <>
            {t("Última revisión:", "Last check:")} {fmt.format(reports[0].at)}
            {report && <> · {t("costó", "cost")} {money.format(report.cost)}</>}
            {" · "}
          </>
        ) : null}
        <span className={`pill ${b.seoDaily ? "done" : "draft"}`}>{b.seoDaily ? t("Revisión diaria encendida", "Daily check on") : t("Revisión diaria apagada", "Daily check off")}</span>
      </p>
      <RankButton action={runRankCheck.bind(null, businessId)} keywords={setup.keywords.length} perKeyword={RANK_COST_PER_KEYWORD} has={reports.length > 0} />

      {reports.length === 0 && (
        <p className="small muted">
          {t(
            "Todavía no has revisado tus posiciones. Presiona el botón, o enciende la revisión diaria en «Datos reales de Google» para que se haga sola cada día.",
            "You haven't checked your rankings yet. Press the button, or turn on the daily check in “Real Google data” so it runs on its own every day.",
          )}
        </p>
      )}
      {reports.length > 0 && !report && (
        <p className="note">{t("La última revisión tiene un formato viejo y no se puede mostrar. Vuelve a revisar.", "The last check is in an old format and can't be shown. Check again.")}</p>
      )}

      {report && (
        <>
          <p className="small muted">
            {t(
              `Resultados de Google en el celular (así buscan los clientes locales) en ${location}, primeros ${RANK_DEPTH} lugares. Las posiciones cambian un poco cada día: fíjate en la tendencia.`,
              `Google results on mobile (how local customers search) in ${location}, top ${RANK_DEPTH} spots. Rankings move a little every day: watch the trend.`,
            )}
          </p>

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

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Palabra clave", "Keyword")}</th>
                  <th>{t("Posición", "Position")}</th>
                  <th>{t("Mapa", "Map")}</th>
                  <th>{t("Tu página que sale", "Your page that ranks")}</th>
                  <th>{t("Tendencia", "Trend")}</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => {
                  const points = history.map((h) => {
                    const row = h.rows.find((x) => x.keyword.toLowerCase() === r.keyword.toLowerCase());
                    return !row || row.error ? undefined : row.position;
                  });
                  const label = t(
                    `Últimas posiciones: ${points.filter((p) => p !== undefined).map((p) => p ?? "—").join(", ")}`,
                    `Recent positions: ${points.filter((p) => p !== undefined).map((p) => p ?? "—").join(", ")}`,
                  );
                  return (
                    <tr key={r.keyword}>
                      <td><strong>{r.keyword}</strong></td>
                      <td className="rank-num">
                        {r.error ? (
                          <span className="pill failed" title={lang === "en" ? r.error.en : r.error.es}>{t("Falló", "Failed")}</span>
                        ) : (
                          <>
                            <strong title={r.position === null ? t(`No sales en los primeros ${RANK_DEPTH}`, `Not in the top ${RANK_DEPTH}`) : undefined}>{r.position ?? "—"}</strong> <Move c={changes[r.keyword]} t={t} />
                          </>
                        )}
                      </td>
                      <td className="rank-num">
                        {r.error ? "" : !r.localPack ? (
                          <span className="muted small" title={t("Google no mostró mapa para esta búsqueda", "Google didn't show a map for this search")}>{t("sin mapa", "no map")}</span>
                        ) : r.localPack.position !== null ? (
                          <strong>{r.localPack.position}</strong>
                        ) : (
                          <span className="muted" title={t("Hay mapa, pero no sales en él", "There's a map, but you're not in it")}>—</span>
                        )}
                      </td>
                      <td className="small rank-url">
                        {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{shortUrl(r.url)}</a> : <span className="muted">—</span>}
                      </td>
                      <td><Spark points={points} label={label} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            {t(
              `«—» = no sales en los primeros ${RANK_DEPTH}. «Mapa» = tu lugar entre los negocios del mapa de Google. ▲ subiste / ▼ bajaste lugares desde la revisión anterior.`,
              `“—” = not in the top ${RANK_DEPTH}. “Map” = your spot among the businesses on Google's map. ▲ moved up / ▼ moved down since the last check.`,
            )}
            {history.length > 1 && ` ${t("Tendencia desde", "Trend since")} ${short.format(new Date(history[0].createdAt))}.`}
          </p>

          <div className="stack" style={{ gap: 8 }}>
            <span className="lbl">{t("¿Quién está arriba de ti?", "Who is above you?")}</span>
            <div className="rank-details">
              {report.rows
                .filter((r) => !r.error)
                .map((r) => (
                  <details key={r.keyword}>
                    <summary>
                      <span>{r.keyword}</span>
                      <span className="small muted">{r.position === null ? t(`no sales en los primeros ${RANK_DEPTH}`, `not in the top ${RANK_DEPTH}`) : t(`sales en el lugar ${r.position}`, `you're #${r.position}`)}</span>
                    </summary>
                    <div className="stack" style={{ gap: 10, paddingTop: 8 }}>
                      {r.top.length > 0 ? (
                        <ol className="rank-top">
                          {r.top.map((x) => (
                            <li key={`${x.position}-${x.url}`} value={x.position} className={x.position === r.position ? "mine" : ""}>
                              <a href={x.url} target="_blank" rel="noopener noreferrer">{x.title || x.domain}</a>
                              <span className="muted small"> · {x.domain}</span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <span className="small muted">{t("Google no mostró resultados normales para esta búsqueda.", "Google didn't show regular results for this search.")}</span>
                      )}
                      {r.localPack && r.localPack.names.length > 0 && (
                        <span className="small">
                          <strong>{t("En el mapa:", "On the map:")}</strong> {r.localPack.names.join(" · ")}
                        </span>
                      )}
                      {r.features.length > 0 && (
                        <div className="tags">
                          {r.features.map((f) => <span key={f} className="tag">{featureLabel(f, t)}</span>)}
                        </div>
                      )}
                    </div>
                  </details>
                ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
