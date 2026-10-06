import Link from "next/link";
import { runCannibal } from "@/app/actions-seo-cannibal";
import { CannibalButton } from "@/components/seo/CannibalButton";
import styles from "@/components/seo/CannibalPanel.module.css";
import { HowToRead } from "@/components/seo/HowToRead";
import { intlLocale, type T, type UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import {
  buildCannibal,
  type CannibalIssue,
  type CannibalPage,
  fixText,
  issueKey,
  issueWhy,
  latestCannibalReports,
  loadCannibalInput,
  RANK_WINDOW_DAYS,
  severityLabel,
} from "@/lib/seo/cannibal";
import { BUSINESS_TZ } from "@/lib/time";

/** Cuántas búsquedas se muestran antes de "Ver más". */
const SHOWN = 8;

const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || url;

function formats(lang: UiLang) {
  const locale = intlLocale(lang);
  const int = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  return {
    int: (v: number) => int.format(v),
    one: (v: number) => one.format(v),
    pct: (v: number) => pct.format(v),
    day: (iso: string) => {
      const d = new Date(`${iso}T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? iso : day.format(d);
    },
    when: (d: Date) => when.format(d),
  };
}
type Fmt = ReturnType<typeof formats>;

/** Los números de una página, en una línea. */
function pageNumbers(p: CannibalPage, issue: CannibalIssue, f: Fmt, t: T): string {
  const parts: string[] = [];
  if (issue.source === "gsc") {
    parts.push(t(`${f.int(p.clicks ?? 0)} clics`, `${f.int(p.clicks ?? 0)} clicks`));
    parts.push(t(`${f.int(p.impressions ?? 0)} veces vista`, `${f.int(p.impressions ?? 0)} impressions`));
    if (p.position) parts.push(t(`posición ${f.one(p.position)}`, `position ${f.one(p.position)}`));
    if (p.share !== null) parts.push(t(`${f.pct(p.share)} de las veces`, `${f.pct(p.share)} of the time`));
  } else if (issue.source === "rank") {
    if (p.seen !== null && issue.checks)
      parts.push(t(`salió ${p.seen} de ${issue.checks} ${issue.checks === 1 ? "vez" : "veces"}`, `showed up ${p.seen} of ${issue.checks} ${issue.checks === 1 ? "time" : "times"}`));
    if (p.position) parts.push(t(`mejor posición ${f.int(p.position)}`, `best position ${f.int(p.position)}`));
    if (p.zones.length) parts.push(p.zones.map((z) => z.split(",")[0]).join(", "));
  }
  return parts.join(" · ");
}

function IssueItem({ issue, businessId, isNew, f, t }: { issue: CannibalIssue; businessId: string; isNew: boolean; f: Fmt; t: T }) {
  const sevPill = issue.severity === "alta" ? "pill failed" : issue.severity === "media" ? "pill partial" : "pill";
  const sourceLabel =
    issue.source === "gsc" ? "Search Console" : issue.source === "rank" ? t("Tus posiciones", "Your rankings") : t("Revisión de tu página", "Website check");
  return (
    <li className={`${styles.issue} ${styles[issue.severity]}`}>
      <div className={styles.head}>
        <span className={sevPill}>{severityLabel(issue.severity, t)}</span>
        <span className={styles.query}>«{issue.query}»</span>
        {isNew && <span className="pill scheduled">{t("Nuevo", "New")}</span>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {issueWhy(issue, t)}{" "}
        {issue.totalImpressions !== null && (
          <>
            {t(
              `En total: ${f.int(issue.totalImpressions)} veces vista y ${f.int(issue.totalClicks ?? 0)} clics.`,
              `In total: ${f.int(issue.totalImpressions)} impressions and ${f.int(issue.totalClicks ?? 0)} clicks.`,
            )}{" "}
          </>
        )}
        <span>({t("según", "from")} {sourceLabel})</span>
      </p>
      <ul className={styles.pages}>
        {issue.pages.map((p) => (
          <li key={p.url} className={styles.page}>
            <div className={styles.pageTop}>
              <a className={styles.url} href={p.url} target="_blank" rel="noopener noreferrer">
                {shortUrl(p.url)}
              </a>
              {p.main && <span className="pill done">{t("La principal", "The main one")}</span>}
            </div>
            {p.title && <div className={styles.title}>{p.title}</div>}
            {issue.source !== "audit" && <div className={styles.nums}>{pageNumbers(p, issue, f, t)}</div>}
            {p.share !== null && (
              <div className={`${styles.bar} ${p.main ? styles.mainBar : ""}`} aria-hidden="true">
                <span style={{ width: `${Math.max(3, Math.min(100, Math.round(p.share * 100)))}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className={styles.fix}>
        <strong>{t("Qué hacer: ", "What to do: ")}</strong>
        {fixText(issue, t)}
      </p>
      {issue.fix !== "zones" && (
        <div className="row">
          <Link className="btn outline" href={`/b/${businessId}/seo/escribir?kw=${encodeURIComponent(issue.query)}`}>
            {issue.fix === "merge"
              ? t("Escribir la página unida con el escritor", "Write the merged page with the writer")
              : t("Mejorar la principal con el escritor", "Improve the main page with the writer")}
          </Link>
        </div>
      )}
    </li>
  );
}

/** Páginas que compiten entre sí (canibalización): se calcula al abrir la página con los últimos reportes guardados. */
export async function CannibalPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const f = formats(lang);
  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Páginas que compiten entre sí", "Pages competing with each other")}</h2>
      <p className="small muted">
        {t(
          "Cuando dos páginas tuyas salen para la misma búsqueda, Google no sabe cuál mostrar y las dos pierden fuerza.",
          "When two of your pages show up for the same search, Google doesn't know which one to show and both lose strength.",
        )}
      </p>
    </div>
  );
  const help = (
    <HowToRead title={t("Cómo leer esto", "How to read this")}>
      <ul>
        <li>{t("Cada caja es una búsqueda de Google donde salen dos o más páginas de tu sitio.", "Each box is a Google search where two or more pages of your site show up.")}</li>
        <li>
          {t(
            "«La principal» es la que más clics trae (o la que sale más arriba). Es la que conviene dejar para esa búsqueda; las otras deben ayudarla, no competir con ella.",
            "“The main one” is the page that gets the most clicks (or ranks highest). That's the one to keep for that search; the others should help it, not compete with it.",
          )}
        </li>
        <li>
          {t(
            "«Veces vista» (impresiones) = cuántas veces apareció en Google. La barra muestra qué parte de esas veces le tocó a cada página: si están parejas, se están quitando visitas.",
            "“Impressions” = how many times it appeared on Google. The bar shows each page's share of those times: if they're even, they're taking visits from each other.",
          )}
        </li>
        <li>
          {t(
            "Urgente: las dos salen en las primeras 2 páginas de Google y se reparten casi igual. Conviene arreglar: se reparten algo. Leve: una casi no sale, o es solo una sospecha.",
            "Urgent: both show up on Google's first 2 pages and split almost evenly. Worth fixing: they split somewhat. Minor: one barely shows up, or it's just a hint.",
          )}
        </li>
        <li>
          {t(
            "Qué hacer: unir las páginas (y redirigir la otra con un 301, que manda a la gente y a Google a la buena), cambiar el tema de la otra, o poner un enlace hacia la principal. Si cada página es para una ciudad distinta, está bien: solo que cada título diga su ciudad.",
            "What to do: merge the pages (and redirect the other with a 301, which sends people and Google to the right one), change the other page's topic, or add a link to the main one. If each page is for a different city, that's fine: just make each title say its city.",
          )}
        </li>
        <li>
          {t(
            "No contamos las búsquedas con el nombre de tu negocio (ahí es normal que salgan varias páginas) ni páginas con menos de 3 apariciones o menos del 5 % de las veces.",
            "We don't count searches with your business name (it's normal for several pages to show up there) or pages with fewer than 3 impressions or under 5% of the time.",
          )}
        </li>
      </ul>
    </HowToRead>
  );

  const input = await loadCannibalInput(businessId);
  if (!input) return null;
  const report = buildCannibal(input);
  const [last] = await latestCannibalReports(businessId, 1);
  const known = last?.report ? new Set(last.report.issues.map(issueKey)) : null;

  const connectGsc = (
    <>
      {t(
        "Para ver esto con datos reales de Google, conecta Search Console: es gratis y muestra qué páginas tuyas salen para cada búsqueda. ",
        "To see this with real Google data, connect Search Console: it's free and shows which of your pages show up for each search. ",
      )}
      <a href="#search-console">{t("Ir a Search Console", "Go to Search Console")}</a>.
    </>
  );

  if (!report.source)
    return (
      <section className="card stack" id="canibalizacion" style={{ gap: 12 }}>
        {header}
        <p className="note">{connectGsc}</p>
        {help}
      </section>
    );

  const sourceLine =
    report.source === "gsc" && report.gscRange
      ? t(
          `Según Search Console, del ${f.day(report.gscRange.start)} al ${f.day(report.gscRange.end)}.`,
          `From Search Console, ${f.day(report.gscRange.start)} to ${f.day(report.gscRange.end)}.`,
        )
      : report.source === "rank"
        ? t(`Según tus revisiones de posiciones de los últimos ${RANK_WINDOW_DAYS} días.`, `From your ranking checks over the last ${RANK_WINDOW_DAYS} days.`)
        : t("Según la última revisión de tu página.", "From your latest website check.");
  const shown = report.issues.slice(0, SHOWN);
  const rest = report.issues.slice(SHOWN);
  const item = (i: CannibalIssue) => <IssueItem key={issueKey(i)} issue={i} businessId={businessId} isNew={Boolean(known && !known.has(issueKey(i)))} f={f} t={t} />;
  const urgent = report.issues.filter((i) => i.severity === "alta").length;

  return (
    <section className="card stack" id="canibalizacion" style={{ gap: 12 }}>
      {header}
      <p className="small muted" style={{ margin: 0 }}>
        {sourceLine}
        {last && <> · {t("Última revisión guardada:", "Last saved check:")} {f.when(last.createdAt)}</>}
      </p>
      {!input.hasGsc && <p className="note">{connectGsc}</p>}
      {input.gscOld && (
        <p className="note">
          {t(
            "Tus datos de Search Console son de una versión anterior. Presiona «Actualizar datos» en Search Console para ver qué páginas salen en cada búsqueda.",
            "Your Search Console data is from an older version. Press “Refresh data” in Search Console to see which pages show up for each search.",
          )}{" "}
          <a href="#search-console">{t("Ir a Search Console", "Go to Search Console")}</a>
        </p>
      )}

      {report.issues.length === 0 ? (
        <p className="note ok">
          {t(
            "¡Bien! Ninguna de tus páginas compite con otra por la misma búsqueda. Cada una tiene su tema claro.",
            "Nice! None of your pages compete with each other for the same search. Each one has a clear topic.",
          )}
        </p>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            {t(
              `${report.issues.length} ${report.issues.length === 1 ? "búsqueda tiene" : "búsquedas tienen"} varias páginas tuyas compitiendo`,
              `${report.issues.length} ${report.issues.length === 1 ? "search has" : "searches have"} several of your pages competing`,
            )}
            {urgent > 0 && t(` (${urgent} urgente${urgent === 1 ? "" : "s"})`, ` (${urgent} urgent)`)}.
          </p>
          <ul className={styles.list}>{shown.map(item)}</ul>
          {rest.length > 0 && (
            <details className={styles.more}>
              <summary>{t(`Ver ${rest.length} más`, `Show ${rest.length} more`)}</summary>
              <ul className={styles.list}>{rest.map(item)}</ul>
            </details>
          )}
        </>
      )}

      <CannibalButton action={runCannibal.bind(null, businessId)} />
      {help}
    </section>
  );
}
