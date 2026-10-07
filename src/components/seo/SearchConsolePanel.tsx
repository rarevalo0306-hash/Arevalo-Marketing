import Link from "next/link";
import { Suspense } from "react";
import { disconnectSearchConsole, refreshSearchConsole } from "@/app/actions-seo-gsc";
import { capClass, Fold } from "@/components/seo/Fold";
import { SearchConsoleButton, SearchConsoleNotice } from "@/components/seo/SearchConsoleButton";
import { ShowMore } from "@/components/seo/ShowMore";
import { db } from "@/lib/db";
import { googleEnabled } from "@/lib/google-oauth";
import { intlLocale, type T, type UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { asGscReport, GSC_CHANNEL, siteLabel, type GscRow, type GscTotals } from "@/lib/seo/gsc";
import { latestReports } from "@/lib/seo/reports";

/** Cuántas filas se ven antes de «Ver todas»: búsquedas y páginas. */
const QUERIES_SHOWN = 10;
const PAGES_SHOWN = 5;

// Search Console da los países con código de 3 letras; Intl los nombra con el de 2.
const ISO3: Record<string, string> = {
  usa: "US", mex: "MX", can: "CA", esp: "ES", col: "CO", arg: "AR", chl: "CL", per: "PE", ven: "VE", ecu: "EC", gtm: "GT", hnd: "HN",
  slv: "SV", nic: "NI", cri: "CR", pan: "PA", dom: "DO", pri: "PR", cub: "CU", bol: "BO", pry: "PY", ury: "UY", bra: "BR", gbr: "GB",
  irl: "IE", fra: "FR", deu: "DE", ita: "IT", prt: "PT", nld: "NL", bel: "BE", che: "CH", aut: "AT", swe: "SE", nor: "NO", dnk: "DK",
  pol: "PL", ind: "IN", phl: "PH", aus: "AU", nzl: "NZ", jpn: "JP", kor: "KR", chn: "CN", zaf: "ZA", nga: "NG", are: "AE", isr: "IL",
};

function fmt(lang: UiLang) {
  const locale = intlLocale(lang);
  const n0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct0 = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  let regions: Intl.DisplayNames | null = null;
  try {
    regions = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    regions = null;
  }
  return {
    int: (v: number) => n0.format(v),
    pos: (v: number) => (v > 0 ? n1.format(v) : "—"),
    one: (v: number) => n1.format(v),
    ctr: (v: number) => pct.format(v),
    share: (v: number) => pct0.format(v),
    day: (iso: string) => {
      const d = new Date(`${iso}T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? iso : date.format(d);
    },
    when: (iso: string) => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? "—" : dateTime.format(d);
    },
    country: (code: string) => {
      const two = ISO3[code.toLowerCase()];
      try {
        return (two && regions?.of(two)) || code.toUpperCase();
      } catch {
        return code.toUpperCase();
      }
    },
  };
}
type Fmt = ReturnType<typeof fmt>;

/** Cambio contra los 28 días anteriores, con flecha y color (verde = mejor). */
function Change({ cur, prev, kind, f, t }: { cur: number; prev: number; kind: "count" | "ctr" | "position"; f: Fmt; t: T }) {
  const vs = t("vs. los 28 días anteriores", "vs. the previous 28 days");
  if (kind === "position") {
    if (!prev || !cur) return <span className="stat-note">{t("Sin datos para comparar", "No data to compare")}</span>;
    const better = prev - cur; // posición más baja = más arriba en Google
    if (Math.abs(better) < 0.05) return <span className="stat-note">= {vs}</span>;
    return (
      <span className={`stat-note ${better > 0 ? "gsc-up" : "gsc-down"}`}>
        {better > 0
          ? t(`▲ ${f.one(better)} lugares más arriba`, `▲ ${f.one(better)} spots higher`)
          : t(`▼ ${f.one(-better)} lugares más abajo`, `▼ ${f.one(-better)} spots lower`)}
      </span>
    );
  }
  if (kind === "ctr") {
    const pts = (cur - prev) * 100;
    if (Math.abs(pts) < 0.05) return <span className="stat-note">= {vs}</span>;
    return (
      <span className={`stat-note ${pts > 0 ? "gsc-up" : "gsc-down"}`}>
        {pts > 0 ? "▲" : "▼"} {f.one(Math.abs(pts))} {t("puntos", "points")} {vs}
      </span>
    );
  }
  if (!prev) return <span className="stat-note">{cur ? t("Antes: 0", "Before: 0") : t("Sin datos para comparar", "No data to compare")}</span>;
  if (cur === prev) return <span className="stat-note">= {vs}</span>;
  return (
    <span className={`stat-note ${cur > prev ? "gsc-up" : "gsc-down"}`}>
      {cur > prev ? "▲" : "▼"} {f.share(Math.abs(cur - prev) / prev)} {vs}
    </span>
  );
}

function Stats({ totals, previous, f, t }: { totals: GscTotals; previous: GscTotals; f: Fmt; t: T }) {
  return (
    <div className="stats">
      <div className="stat">
        <span className="stat-label">{t("Clics", "Clicks")}</span>
        <span className="stat-value">{f.int(totals.clicks)}</span>
        <Change cur={totals.clicks} prev={previous.clicks} kind="count" f={f} t={t} />
      </div>
      <div className="stat">
        <span className="stat-label">{t("Impresiones (veces que apareciste)", "Impressions (times you showed up)")}</span>
        <span className="stat-value">{f.int(totals.impressions)}</span>
        <Change cur={totals.impressions} prev={previous.impressions} kind="count" f={f} t={t} />
      </div>
      <div className="stat">
        <span className="stat-label">{t("CTR (de cada 100 que te ven, cuántos entran)", "CTR (out of 100 who see you, how many click)")}</span>
        <span className="stat-value">{f.ctr(totals.ctr)}</span>
        <Change cur={totals.ctr} prev={previous.ctr} kind="ctr" f={f} t={t} />
      </div>
      <div className="stat">
        <span className="stat-label">{t("Posición promedio", "Average position")}</span>
        <span className="stat-value">{f.pos(totals.position)}</span>
        <Change cur={totals.position} prev={previous.position} kind="position" f={f} t={t} />
      </div>
    </div>
  );
}

/** Enlace a Publicar con la idea lista para que la IA escriba el post. */
const createHref = (id: string, query: string, t: T) =>
  `/b/${id}/publicar?${new URLSearchParams({
    idea: t(`Escribe una publicación que responda a la búsqueda: "${query}"`, `Write a post that answers the search: "${query}"`),
    magic: "1",
  })}`;

function QueryList({ rows, id, f, t, tip }: { rows: GscRow[]; id: string; f: Fmt; t: T; tip: string }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="small muted">{tip}</p>
      <ul className="gsc-list">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="stack" style={{ gap: 2 }}>
              <strong>{r.key}</strong>
              <span className="small muted">
                {t("Posición", "Position")} {f.pos(r.position)} · {f.int(r.impressions)} {t("impresiones", "impressions")} · {f.ctr(r.ctr)} CTR
              </span>
            </span>
            <Link className="btn link" href={createHref(id, r.key, t)}>{t("Crear post", "Create post")}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function pagePath(url: string) {
  try {
    const u = new URL(url);
    return decodeURI(u.pathname + u.search) || "/";
  } catch {
    return url;
  }
}

export async function SearchConsolePanel({ businessId }: { businessId: string }) {
  const id = businessId;
  const { lang, t } = await getT();
  const head = (
    <div className="stack" style={{ gap: 6 }}>
      <h2>{t("Tus búsquedas en Google (Search Console)", "Your Google searches (Search Console)")}</h2>
      <p className="small muted">
        {t(
          "Datos reales y gratis de Google sobre tu página web: con qué búsquedas apareces, cuántas veces te vieron, cuántos hicieron clic y en qué lugar sales.",
          "Real, free data from Google about your website: which searches you show up for, how many times people saw you, how many clicked, and where you rank.",
        )}
      </p>
    </div>
  );
  const notice = (
    <Suspense fallback={null}>
      <SearchConsoleNotice />
    </Suspense>
  );

  if (!googleEnabled())
    return (
      <section className="card">
        {head}
        {notice}
        <p className="note">
          {t(
            "Para usar Search Console hay que configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor (el mismo cliente de Google que usa \"Conectar con Google\").",
            "To use Search Console, set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server (the same Google client used by \"Connect with Google\").",
          )}
        </p>
      </section>
    );

  const [business, conn, reports] = await Promise.all([
    db.business.findUnique({ where: { id }, select: { website: true } }),
    db.connection.findUnique({ where: { businessId_channel: { businessId: id, channel: GSC_CHANNEL } }, select: { label: true } }),
    latestReports(id, "gsc", 1),
  ]);

  if (!conn)
    return (
      <section className="card">
        {head}
        {notice}
        <div>
          <a className="btn on" href={`/api/gsc/start?b=${id}`}>{t("Conectar Search Console", "Connect Search Console")}</a>
        </div>
        {!business?.website.trim() && (
          <p className="note">
            {t("Agrega la página web en ", "Add the website in ")}
            <Link href={`/b/${id}/negocio`}>{t("los datos del negocio", "the business details")}</Link>
            {t(" para que la app encuentre tu sitio en Search Console sola.", " so the app can find your site in Search Console automatically.")}
          </p>
        )}
        <div className="stack" style={{ gap: 6 }}>
          <strong className="small">{t("Antes de conectar:", "Before you connect:")}</strong>
          <ul className="small muted gsc-help">
            <li>
              {t("Tu página tiene que estar agregada y verificada en ", "Your website must be added and verified in ")}
              <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">Search Console</a>
              {t(" con la misma cuenta de Google con la que vas a entrar.", " with the same Google account you'll sign in with.")}
            </li>
            <li>
              {t(
                "En Google Cloud, en el mismo proyecto de GOOGLE_CLIENT_ID, activa la \"Google Search Console API\".",
                "In Google Cloud, in the same project as GOOGLE_CLIENT_ID, turn on the \"Google Search Console API\".",
              )}
            </li>
            <li>
              {t(
                "Si la pantalla de permisos (OAuth consent screen) está en modo de prueba, agrega tu correo como usuario de prueba. En ese modo Google vence el permiso cada 7 días.",
                "If the OAuth consent screen is in testing mode, add your email as a test user. In that mode Google expires access every 7 days.",
              )}
            </li>
          </ul>
        </div>
      </section>
    );

  const f = fmt(lang);
  const saved = reports[0] ? asGscReport(reports[0].data) : null;
  // Si se cambió de sitio, el reporte viejo no corresponde.
  const report = saved && (!saved.siteUrl || saved.siteUrl === conn.label) ? saved : null;
  const totalDeviceClicks = report?.devices.reduce((s, d) => s + d.clicks, 0) ?? 0;
  const device = (key: string) =>
    ({ MOBILE: t("Celular", "Mobile"), DESKTOP: t("Computadora", "Desktop"), TABLET: t("Tableta", "Tablet") })[key.toUpperCase()] ?? key;

  return (
    <section className="card">
      {head}
      {notice}
      <div className="row between">
        <div className="stack" style={{ gap: 4 }}>
          <span className="small muted">{t("Sitio conectado", "Connected site")}</span>
          <strong style={{ overflowWrap: "anywhere" }}>{siteLabel(conn.label, t)}</strong>
          <span className="small muted">
            {report
              ? t(
                  `Actualizado: ${f.when(report.fetchedAt)} · del ${f.day(report.range.start)} al ${f.day(report.range.end)}`,
                  `Updated: ${f.when(report.fetchedAt)} · ${f.day(report.range.start)} to ${f.day(report.range.end)}`,
                )
              : t("Todavía no hay datos.", "No data yet.")}
          </span>
        </div>
        <SearchConsoleButton action={refreshSearchConsole.bind(null, id)} />
      </div>

      {!report ? (
        <p className="note">{t("Presiona \"Actualizar datos\" para traer tus búsquedas de los últimos 28 días.", "Click \"Refresh data\" to get your searches from the last 28 days.")}</p>
      ) : (
        <>
          <Stats totals={report.totals} previous={report.previous} f={f} t={t} />
          <p className="small muted">
            {t(
              "Google muestra los datos con unos 3 días de retraso y oculta las búsquedas muy poco comunes por privacidad.",
              "Google shows data with about a 3-day delay and hides very rare searches for privacy.",
            )}
          </p>

          {report.opportunities.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <h3>{t("Oportunidades: casi en la primera página", "Opportunities: almost on page one")}</h3>
              <QueryList
                rows={report.opportunities}
                id={id}
                f={f}
                t={t}
                tip={t(
                  "Apareces entre los lugares 4 y 20 para estas búsquedas. Un post o una página que las responda bien te puede subir a los primeros lugares.",
                  "You show up between spots 4 and 20 for these searches. A post or page that answers them well can move you to the top.",
                )}
              />
            </div>
          )}

          {report.lowCtr.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <h3>{t("Sales arriba, pero casi nadie entra", "You rank high, but few people click")}</h3>
              <QueryList
                rows={report.lowCtr}
                id={id}
                f={f}
                t={t}
                tip={t(
                  "Estás entre los primeros 5 lugares, pero menos de 2 de cada 100 personas hacen clic. Mejora el título y la descripción de esa página para que den ganas de entrar.",
                  "You're in the top 5, but fewer than 2 in 100 people click. Improve that page's title and description so people want to click.",
                )}
              />
            </div>
          )}

          <div className="stack" style={{ gap: 8 }}>
            <h3>{t("Búsquedas con las que te encuentran", "Searches people find you with")}</h3>
            {report.queries.length === 0 ? (
              <p className="small muted">{t("Google todavía no tiene búsquedas para tu página en estas fechas.", "Google doesn't have searches for your website in these dates yet.")}</p>
            ) : (
              <ShowMore hidden={report.queries.length - QUERIES_SHOWN} more={t(`Ver las ${report.queries.length} búsquedas`, `See all ${report.queries.length} searches`)}>
              <div className="table-wrap gsc-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Búsqueda", "Search")}</th>
                      <th className="gsc-num">{t("Clics", "Clicks")}</th>
                      <th className="gsc-num">{t("Impresiones", "Impressions")}</th>
                      <th className="gsc-num">CTR</th>
                      <th className="gsc-num">{t("Posición", "Position")}</th>
                      <th><span className="sr-only">{t("Acción", "Action")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.queries.map((r, i) => (
                      <tr key={r.key} className={capClass(i, QUERIES_SHOWN)}>
                        <td style={{ overflowWrap: "anywhere" }}>{r.key}</td>
                        <td className="gsc-num">{f.int(r.clicks)}</td>
                        <td className="gsc-num">{f.int(r.impressions)}</td>
                        <td className="gsc-num">{f.ctr(r.ctr)}</td>
                        <td className="gsc-num">{f.pos(r.position)}</td>
                        <td><Link className="btn link" href={createHref(id, r.key, t)}>{t("Crear post", "Create post")}</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </ShowMore>
            )}
          </div>

          {report.pages.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <h3>{t("Tus páginas más visitadas desde Google", "Your top pages from Google")}</h3>
              <ShowMore hidden={report.pages.length - PAGES_SHOWN} more={t(`Ver las ${report.pages.length} páginas`, `See all ${report.pages.length} pages`)}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Página", "Page")}</th>
                      <th className="gsc-num">{t("Clics", "Clicks")}</th>
                      <th className="gsc-num">{t("Impresiones", "Impressions")}</th>
                      <th className="gsc-num">CTR</th>
                      <th className="gsc-num">{t("Posición", "Position")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.pages.map((r, i) => (
                      <tr key={r.key} className={capClass(i, PAGES_SHOWN)}>
                        <td style={{ overflowWrap: "anywhere" }}>
                          {/^https?:\/\//.test(r.key) ? (
                            <a href={r.key} target="_blank" rel="noopener noreferrer">{pagePath(r.key)}</a>
                          ) : (
                            r.key
                          )}
                        </td>
                        <td className="gsc-num">{f.int(r.clicks)}</td>
                        <td className="gsc-num">{f.int(r.impressions)}</td>
                        <td className="gsc-num">{f.ctr(r.ctr)}</td>
                        <td className="gsc-num">{f.pos(r.position)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </ShowMore>
            </div>
          )}

          {(report.devices.length > 0 || report.countries.length > 0) && (
            <Fold
              summary={t("Desde qué aparato y qué país te buscan", "Which devices and countries people search from")}
              note={t(`${report.devices.length} aparatos · ${report.countries.length} países`, `${report.devices.length} devices · ${report.countries.length} countries`)}
            >
            <div className="grid-2">
              {report.devices.length > 0 && (
                <div className="stack" style={{ gap: 8 }}>
                  <h3>{t("Desde qué aparato", "Which device")}</h3>
                  <ul className="gsc-list">
                    {report.devices.map((d) => (
                      <li key={d.key}>
                        <strong>{device(d.key)}</strong>
                        <span className="small muted">
                          {f.int(d.clicks)} {t("clics", "clicks")}
                          {totalDeviceClicks > 0 && ` (${f.share(d.clicks / totalDeviceClicks)})`} · {f.int(d.impressions)} {t("impresiones", "impressions")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {report.countries.length > 0 && (
                <div className="stack" style={{ gap: 8 }}>
                  <h3>{t("Desde qué país", "Which country")}</h3>
                  <ul className="gsc-list">
                    {report.countries.map((c) => (
                      <li key={c.key}>
                        <strong>{f.country(c.key)}</strong>
                        <span className="small muted">
                          {f.int(c.clicks)} {t("clics", "clicks")} · {f.int(c.impressions)} {t("impresiones", "impressions")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            </Fold>
          )}
        </>
      )}

      <form action={disconnectSearchConsole.bind(null, id)}>
        <button type="submit" className="btn danger">{t("Desconectar Search Console", "Disconnect Search Console")}</button>
      </form>
    </section>
  );
}
