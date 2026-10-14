import { HowToRead } from "@/components/seo/HowToRead";
import { LogUpload } from "@/components/seo/LogUpload";
import { ShowMore } from "@/components/seo/ShowMore";
import { capClass } from "@/components/seo/Fold";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { readAuditReport } from "@/lib/seo/audit";
import { botDef, LOG_BOTS, pathOf, readLogReport } from "@/lib/seo/logs";
import { latestReports } from "@/lib/seo/reports";
import { BUSINESS_TZ } from "@/lib/time";

/** Barras de visitas por día: Google (azul) y las IAs (morado). */
function DayBars({ days, label }: { days: { day: string; google: number; ai: number }[]; label: string }) {
  if (days.length < 2) return null;
  const max = Math.max(1, ...days.map((d) => d.google + d.ai));
  const W = 6;
  const GAP = 2;
  const H = 56;
  const width = days.length * (W + GAP) - GAP;
  return (
    <svg className="log-bars" width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={label}>
      <title>{label}</title>
      {days.map((d, i) => {
        const g = (d.google / max) * H;
        const a = (d.ai / max) * H;
        return (
          <g key={d.day}>
            <rect x={i * (W + GAP)} y={H - g} width={W} height={g} className="log-google" />
            <rect x={i * (W + GAP)} y={H - g - a} width={W} height={a} className="log-ai" />
          </g>
        );
      })}
    </svg>
  );
}

/** «Visitas de Google y de las IAs a tu web»: lo que dice el registro de visitas del servidor. */
export async function LogsPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const [[row], [auditRow]] = await Promise.all([latestReports(businessId, "logs", 1), latestReports(businessId, "audit", 1)]);
  const report = row ? readLogReport(row.data) : null;
  const audit = auditRow ? readAuditReport(auditRow.data) : null;
  // Las páginas buenas de tu web (de la auditoría), para ver cuáles no visitó Google.
  const sitePaths = [...new Set((audit?.pages ?? []).filter((p) => p.status >= 200 && p.status < 300 && !p.error).map((p) => pathOf(p.finalUrl || p.url)))].slice(0, 300);
  const number = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 0 });
  const date = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeZone: "UTC" });
  const when = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  const name = (id: string) => {
    const d = botDef(id);
    return d ? (id === "seo" ? t("Herramientas de SEO", "SEO tools") : id === "other" ? t("Otros robots", "Other bots") : d.name) : id;
  };

  const google = report?.bots.find((b) => b.id === "google") ?? null;
  const ai = report?.bots.filter((b) => botDef(b.id)?.kind === "ai") ?? [];
  const aiHits = ai.reduce((s, b) => s + b.hits, 0);
  const span = report?.from && report.to ? Math.max(1, Math.round((Date.parse(report.to) - Date.parse(report.from)) / 86_400_000) + 1) : null;
  const errors = report?.errors ?? [];

  return (
    <section className="card" id="registro">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Visitas de Google y de las IAs a tu web", "Google and AI visits to your website")}</h2>
        <p className="small muted">
          {t(
            "Tu servidor anota cada visita, también las de los robots de Google, ChatGPT, Claude y Perplexity. Sube ese registro y te decimos cada cuánto te visita Google, qué páginas lee, cuáles le dan error y cuáles nunca visitó.",
            "Your server writes down every visit, including those from Google's, ChatGPT's, Claude's and Perplexity's bots. Upload that log and we'll tell you how often Google visits, which pages it reads, which ones give it errors and which it never visited.",
          )}
        </p>
      </div>
      <LogUpload businessId={businessId} sitePaths={sitePaths} />
      <details>
        <summary className="btn link" style={{ display: "inline-flex", padding: 0 }}>
          {t("¿Dónde consigo ese archivo?", "Where do I get that file?")}
        </summary>
        <ul className="small" style={{ marginTop: 6 }}>
          <li>{t("En el panel de tu hosting busca «Access logs», «Registros de acceso» o «Raw Access Logs» y descarga el archivo (.log o .gz). Mientras más días tenga, mejor (ideal: 30).", "In your hosting panel look for “Access logs” or “Raw Access Logs” and download the file (.log or .gz). The more days it covers, the better (ideally 30).")}</li>
          <li>{t("Si usas Cloudflare, Vercel o Netlify, exporta los registros como JSON: también se leen.", "If you use Cloudflare, Vercel or Netlify, export the logs as JSON: they work too.")}</li>
          <li>{t("Wix, Squarespace y otras plataformas cerradas no dan este archivo: ahí usa Search Console (más abajo).", "Wix, Squarespace and other closed platforms don't provide this file: there use Search Console (below).")}</li>
        </ul>
      </details>

      {report && row && (
        <>
          <p className="small muted">
            {report.from && report.to ? t(`Registro del ${date.format(new Date(report.from))} al ${date.format(new Date(report.to))}`, `Log from ${date.format(new Date(report.from))} to ${date.format(new Date(report.to))}`) : t("Registro sin fechas", "Log without dates")}
            {" · "}
            {t(`${number.format(report.parsed)} visitas leídas`, `${number.format(report.parsed)} visits read`)} · {t("subido", "uploaded")} {when.format(row.createdAt)}
          </p>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">{t("Visitas de Google", "Google visits")}</span>
              <span className="stat-value">{number.format(google?.hits ?? 0)}</span>
              <span className="stat-note">{span && google ? t(`unas ${number.format(google.hits / span)} al día`, `about ${number.format(google.hits / span)} a day`) : t("en todo el registro", "in the whole log")}</span>
            </div>
            <div className="stat">
              <span className="stat-label">{t("Páginas que leyó Google", "Pages Google read")}</span>
              <span className="stat-value">{number.format(google?.pages ?? 0)}</span>
              <span className="stat-note">
                {google && google.hits ? t(`${Math.round((google.mobile / google.hits) * 100)} % como celular`, `${Math.round((google.mobile / google.hits) * 100)}% as mobile`) : "—"}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">{t("Visitas de las IAs", "AI visits")}</span>
              <span className="stat-value">{number.format(aiHits)}</span>
              <span className="stat-note">{ai.length ? ai.slice(0, 3).map((b) => `${name(b.id)} ${number.format(b.hits)}`).join(" · ") : t("ninguna", "none")}</span>
            </div>
            <div className="stat">
              <span className="stat-label">{t("Errores que vieron los robots", "Errors the bots saw")}</span>
              <span className="stat-value">{number.format(errors.reduce((s, e) => s + e.hits, 0))}</span>
              <span className="stat-note">{t(`en ${errors.length} ${errors.length === 1 ? "dirección" : "direcciones"}`, `on ${errors.length} ${errors.length === 1 ? "address" : "addresses"}`)}</span>
            </div>
          </div>
          {report.days.length > 1 && (
            <div className="stack" style={{ gap: 4 }}>
              <DayBars days={report.days} label={t(`Visitas por día de Google y de las IAs, ${report.days.length} días`, `Visits per day from Google and AIs, ${report.days.length} days`)} />
              <span className="small muted">
                <span className="log-key log-key-google" aria-hidden="true" /> {t("Google", "Google")} · <span className="log-key log-key-ai" aria-hidden="true" /> {t("IAs", "AIs")} · {t(`por día, ${report.days.length} días`, `per day, ${report.days.length} days`)}
              </span>
            </div>
          )}

          {!google && (
            <p className="note">
              {t(
                "Google no aparece en este registro. Puede ser que el archivo sea de muy pocos días, que tu web esté bloqueando a Google (revisa la auditoría) o que el registro no guarde quién visita (user agent).",
                "Google doesn't show up in this log. The file may cover very few days, your site may be blocking Google (check the audit), or the log doesn't store who visits (user agent).",
              )}
            </p>
          )}

          {report.missed.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="lbl">{t(`Páginas de tu web que Google no visitó (${report.missed.length} de ${report.checked})`, `Pages of your site Google didn't visit (${report.missed.length} of ${report.checked})`)}</span>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {report.missed.slice(0, 10).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <span className="small muted">
                {t(
                  "Ponles enlaces desde tu página de inicio o tu menú, agrégalas al sitemap y pide que las revisen en Search Console («Inspeccionar URL»).",
                  "Link to them from your home page or menu, add them to the sitemap and request indexing in Search Console (“URL Inspection”).",
                )}
              </span>
            </div>
          )}

          {errors.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="lbl">{t("Direcciones que les dieron error a los robots", "Addresses that gave the bots an error")}</span>
              <ShowMore hidden={errors.length - 6} more={t(`Ver las ${errors.length}`, `See all ${errors.length}`)}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Dirección", "Address")}</th>
                        <th className="kw-num">{t("Error", "Error")}</th>
                        <th className="kw-num">{t("Veces", "Times")}</th>
                        <th>{t("Quién", "Who")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {errors.map((e, i) => (
                        <tr key={`${e.status}-${e.path}`} className={capClass(i, 6)}>
                          <td className="small" style={{ overflowWrap: "anywhere" }}>{e.path}</td>
                          <td className="kw-num">
                            <span className={`pill ${e.status >= 500 ? "failed" : "partial"}`}>{e.status}</span>
                          </td>
                          <td className="kw-num">{number.format(e.hits)}</td>
                          <td className="small">{e.bots.map(name).join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ShowMore>
              <span className="small muted">
                {t(
                  "404 = la página no existe: si antes existía, ponle una redirección 301 a la página nueva. 500 o más = tu servidor falló: avísale a quien maneja tu web.",
                  "404 = the page doesn't exist: if it used to, add a 301 redirect to the new page. 500 or higher = your server failed: tell whoever runs your site.",
                )}
              </span>
            </div>
          )}

          <details>
            <summary className="btn link" style={{ display: "inline-flex", padding: 0 }}>
              {t("Ver todos los robots y las páginas que más leen", "See all bots and the pages they read most")}
            </summary>
            <div className="stack" style={{ gap: 12, marginTop: 10 }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Robot", "Bot")}</th>
                      <th className="kw-num">{t("Visitas", "Visits")}</th>
                      <th className="kw-num">{t("Páginas", "Pages")}</th>
                      <th className="kw-num">{t("Errores", "Errors")}</th>
                      <th>{t("Última visita", "Last visit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.bots]
                      .sort((a, b) => b.hits - a.hits)
                      .map((b) => (
                        <tr key={b.id}>
                          <td>
                            <strong>{name(b.id)}</strong>
                            <span className="small muted"> · {botDef(b.id)?.owner || t("varios", "various")}</span>
                          </td>
                          <td className="kw-num">{number.format(b.hits)}</td>
                          <td className="kw-num">{number.format(b.pages)}</td>
                          <td className="kw-num">{number.format(b.clientErrors + b.serverErrors)}</td>
                          <td className="small">{b.lastSeen ? date.format(new Date(b.lastSeen)) : "—"}</td>
                        </tr>
                      ))}
                    <tr>
                      <td>
                        <strong>{t("Personas", "People")}</strong>
                        <span className="small muted"> · {t("y lo que no es un robot conocido", "and anything that isn't a known bot")}</span>
                      </td>
                      <td className="kw-num">{number.format(report.people)}</td>
                      <td colSpan={3} />
                    </tr>
                  </tbody>
                </table>
              </div>
              {report.topGoogle.length > 0 && (
                <div className="stack" style={{ gap: 4 }}>
                  <span className="lbl">{t("Lo que más lee Google", "What Google reads most")}</span>
                  <ol className="small" style={{ margin: 0, paddingLeft: 22 }}>
                    {report.topGoogle.map((p) => (
                      <li key={p.path} style={{ overflowWrap: "anywhere" }}>
                        {p.path} <span className="muted">· {number.format(p.hits)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {report.topAi.length > 0 && (
                <div className="stack" style={{ gap: 4 }}>
                  <span className="lbl">{t("Lo que más leen las IAs", "What AIs read most")}</span>
                  <ol className="small" style={{ margin: 0, paddingLeft: 22 }}>
                    {report.topAi.map((p) => (
                      <li key={p.path} style={{ overflowWrap: "anywhere" }}>
                        {p.path} <span className="muted">· {number.format(p.hits)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </details>
          <HowToRead title={t("Cómo leer las visitas de los robots", "How to read bot visits")}>
            <ul>
              <li>{t("Si Google te visita poco (menos de unas pocas veces al día) o no lee tus páginas importantes, tardará en ver tus cambios.", "If Google visits rarely (less than a few times a day) or doesn't read your important pages, it will take longer to see your changes.")}</li>
              <li>
                {t(
                  `ChatGPT, Claude y Perplexity leen tu web para responder lo que les preguntan. Si no aparecen, revisa en la auditoría que tu robots.txt no los bloquee.`,
                  `ChatGPT, Claude and Perplexity read your site to answer what people ask them. If they don't show up, check in the audit that your robots.txt doesn't block them.`,
                )}
              </li>
              {google && report.googleParams > google.hits * 0.2 && (
                <li>
                  {t(
                    `${number.format(report.googleParams)} visitas de Google fueron a direcciones con «?» (filtros, búsquedas internas). Eso gasta su tiempo en tu web: bloquéalas en robots.txt si no sirven.`,
                    `${number.format(report.googleParams)} Google visits went to addresses with “?” (filters, internal searches). That wastes its time on your site: block them in robots.txt if they're not useful.`,
                  )}
                </li>
              )}
              <li>{t("Cualquiera puede decir que es Googlebot: estos números cuentan lo que cada visita dice ser.", "Anyone can claim to be Googlebot: these numbers count what each visit says it is.")}</li>
              <li>{t(`Robots que reconocemos: ${LOG_BOTS.filter((b) => b.kind !== "other" && b.kind !== "seo").map((b) => b.name).join(", ")}.`, `Bots we recognize: ${LOG_BOTS.filter((b) => b.kind !== "other" && b.kind !== "seo").map((b) => b.name).join(", ")}.`)}</li>
            </ul>
          </HowToRead>
        </>
      )}
    </section>
  );
}
