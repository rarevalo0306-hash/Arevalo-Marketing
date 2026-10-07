import Link from "next/link";
import { refreshDecay } from "@/app/actions-seo-decay";
import { AiPromptButton } from "@/components/seo/AiPromptButton";
import styles from "@/components/seo/Decay.module.css";
import { DecayButton } from "@/components/seo/DecayButton";
import { capClass, Fold } from "@/components/seo/Fold";
import { HowToRead } from "@/components/seo/HowToRead";
import { ShowMore } from "@/components/seo/ShowMore";
import { db } from "@/lib/db";
import { googleEnabled } from "@/lib/google-oauth";
import { intlLocale, type T, type UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import {
  compareLabel,
  decayActions,
  type DecayPage,
  latestDecayReports,
  readDecayReport,
  reasonLabel,
  reasonWhy,
  shortPath,
} from "@/lib/seo/decay";
import { GSC_CHANNEL } from "@/lib/seo/gsc";
import { loadPromptContext } from "@/lib/seo/prompt-context";
import { decayPrompt } from "@/lib/seo/prompts";
import { BUSINESS_TZ } from "@/lib/time";

function formats(lang: UiLang) {
  const locale = intlLocale(lang);
  const int = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const ctr = new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: BUSINESS_TZ });
  return {
    int: (v: number) => int.format(v),
    pos: (v: number) => (v > 0 ? one.format(v) : "—"),
    pct: (v: number) => pct.format(v),
    ctr: (v: number) => ctr.format(v),
    day: (iso: string) => {
      const d = new Date(`${iso}T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? iso : day.format(d);
    },
    when: (d: Date) => when.format(d),
  };
}
type Fmt = ReturnType<typeof formats>;

/** Cuántas páginas se ven antes de «Ver todas» (de la que más perdió a la que menos). */
const PAGES_SHOWN = 3;

const pillClass = { position: "pill failed", ctr: "pill partial", queries: "pill scheduled", demand: "pill" } as const;

function PageItem({ p, businessId, f, t, className }: { p: DecayPage; businessId: string; f: Fmt; t: T; className?: string }) {
  const drop = p.before.clicks ? p.clicksLost / p.before.clicks : 0;
  const kw = p.lostQueries[0]?.query;
  return (
    <li className={`${styles.item} ${styles[p.reason]}${className ? ` ${className}` : ""}`}>
      <div className={styles.head}>
        {/^https?:\/\//.test(p.url) ? (
          <a className={styles.url} href={p.url} target="_blank" rel="noopener noreferrer">
            {shortPath(p.url)}
          </a>
        ) : (
          <span className={styles.url}>{p.url}</span>
        )}
        <span className={pillClass[p.reason]}>{reasonLabel(p.reason, t)}</span>
      </div>

      <div className={styles.clicks}>
        <span className={styles.big}>
          {f.int(p.before.clicks)} → {f.int(p.now.clicks)}
        </span>
        <span>{t("clics", "clicks")}</span>
        {p.clicksLost > 0 && (
          <span className="gsc-down">
            ▼ {f.int(p.clicksLost)}
            {drop > 0 && ` (${f.pct(drop)})`}
          </span>
        )}
        <span className="small muted">{compareLabel(p.compare, t)}</span>
      </div>
      <div className={styles.nums}>
        {t("Veces en Google", "Times on Google")}: {f.int(p.before.impressions)} → {f.int(p.now.impressions)} · {t("Posición", "Position")}: {f.pos(p.before.position)} →{" "}
        {f.pos(p.now.position)} · {t("De cada 100, entran", "Out of 100, click")}: {f.ctr(p.before.ctr)} → {f.ctr(p.now.ctr)}
        {p.also && (
          <>
            {" · "}
            {t(
              `También bajó ${compareLabel(p.also.compare, t)}: ${f.int(p.also.clicksBefore)} → ${f.int(p.also.clicksNow)} clics`,
              `Also down ${compareLabel(p.also.compare, t)}: ${f.int(p.also.clicksBefore)} → ${f.int(p.also.clicksNow)} clicks`,
            )}
          </>
        )}
      </div>

      <p className={styles.why}>{reasonWhy(p, t)}</p>

      <div className={styles.todo}>
        <strong>{t("Qué hacer:", "What to do:")}</strong>
        <ul>
          {decayActions(p, t).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>

      {p.lostQueries.length > 0 && (
        <Fold inline summary={t(`Búsquedas que perdieron visitas (${p.lostQueries.length})`, `Searches that lost visits (${p.lostQueries.length})`)}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Búsqueda", "Search")}</th>
                  <th className={styles.num}>{t("Clics", "Clicks")}</th>
                  <th className={styles.num}>{t("Posición", "Position")}</th>
                </tr>
              </thead>
              <tbody>
                {p.lostQueries.map((q) => (
                  <tr key={q.query}>
                    <td className={styles.queryCell}>{q.query}</td>
                    <td className={styles.num}>
                      {f.int(q.clicksBefore)} → {f.int(q.clicksNow)}
                    </td>
                    <td className={styles.num}>
                      {f.pos(q.positionBefore)} → {q.impressionsNow ? f.pos(q.positionNow) : t("no sale", "not shown")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fold>
      )}

      {p.reason !== "demand" && kw && (
        <div className="row">
          <Link className="btn outline" href={`/b/${businessId}/seo/escribir?kw=${encodeURIComponent(kw)}`}>
            {t("Mejorar con el escritor", "Improve it with the writer")}
          </Link>
        </div>
      )}
    </li>
  );
}

/** "Páginas para actualizar": páginas que pierden visitas desde Google, el motivo y qué hacer (Search Console, gratis). */
export async function DecayPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const f = formats(lang);
  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Páginas para actualizar", "Pages to refresh")}</h2>
      <p className="small muted">
        {t(
          "Páginas de tu sitio que antes traían visitas desde Google y ahora traen menos. Te decimos por qué y qué hacer para recuperarlas.",
          "Pages on your site that used to bring visits from Google and now bring fewer. We tell you why and what to do to win them back.",
        )}
      </p>
    </div>
  );
  const help = (
    <HowToRead title={t("Cómo leer esto", "How to read this")}>
      <ul>
        <li>{t("«Clics»: cuántas personas entraron a tu página desde Google.", "“Clicks”: how many people went to your page from Google.")}</li>
        <li>
          {t(
            "«Veces en Google» (impresiones): cuántas veces apareció tu página en los resultados, aunque nadie hiciera clic.",
            "“Times on Google” (impressions): how many times your page showed up in the results, even if nobody clicked.",
          )}
        </li>
        <li>
          {t(
            "«Posición»: en qué lugar sale en promedio. 1 es el primero; del 1 al 10 es la primera página. Un número más alto es peor.",
            "“Position”: the spot it shows up in on average. 1 is the top; 1 to 10 is page one. A higher number is worse.",
          )}
        </li>
        <li>
          {t(
            "Comparamos los últimos 28 días con los 28 anteriores y con los mismos días de hace 3 meses (así vemos bajas lentas). Google entrega los datos con unos 3 días de retraso.",
            "We compare the last 28 days with the previous 28 and with the same days 3 months ago (to catch slow drops). Google delivers the data about 3 days late.",
          )}
        </li>
        <li>
          {t(
            "Por qué una página pierde visitas: otras páginas la pasaron (bajó de posición), la gente busca menos ese tema (temporada), el título ya no llama la atención (te ven pero no hacen clic) o dejó de salir para algunas búsquedas.",
            "Why a page loses visits: other pages passed it (it dropped in rankings), people search less for the topic (season), the title no longer catches the eye (people see it but don't click) or it stopped showing up for some searches.",
          )}
        </li>
        <li>
          {t(
            "Solo mostramos páginas que tenían al menos 10 clics o 200 veces en Google antes, para que los cambios pequeños no te distraigan.",
            "We only show pages that had at least 10 clicks or 200 times on Google before, so small changes don't distract you.",
          )}
        </li>
      </ul>
    </HowToRead>
  );
  const empty = (body: React.ReactNode) => (
    <section className="card" id="decay">
      {header}
      <p className="note">{body}</p>
      {help}
    </section>
  );

  if (!googleEnabled())
    return empty(
      t(
        "Para revisar tus páginas hace falta Search Console, y para eso hay que configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor.",
        "Checking your pages needs Search Console, which requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.",
      ),
    );

  const [conn, [row]] = await Promise.all([
    db.connection.findUnique({ where: { businessId_channel: { businessId, channel: GSC_CHANNEL } }, select: { label: true } }),
    latestDecayReports(businessId, 1),
  ]);
  if (!conn)
    return empty(
      <>
        {t(
          "Para ver qué páginas están perdiendo visitas, primero conecta Search Console (gratis, son tus datos reales de Google). ",
          "To see which pages are losing visits, first connect Search Console (free, it's your real Google data). ",
        )}
        <Link href={`/b/${businessId}/conexiones#c-gsc`}>{t("Conectar en Conexiones →", "Connect in Connections →")}</Link>
      </>,
    );

  const report = row ? readDecayReport(row.data) : null;
  const otherSite = report && report.siteUrl && conn.label && report.siteUrl !== conn.label;
  const ctx = report && !otherSite && report.pages.some((p) => p.reason !== "demand") ? await loadPromptContext(businessId) : null;

  return (
    <section className="card" id="decay">
      {header}
      {row && report && (
        <p className="small muted">
          {t("Última revisión:", "Last check:")} {f.when(row.createdAt)} · {t("del", "from")} {f.day(report.range.start)} {t("al", "to")} {f.day(report.range.end)} ·{" "}
          {t("Costo: US$0", "Cost: US$0")}
        </p>
      )}
      <DecayButton action={refreshDecay.bind(null, businessId)} has={Boolean(row)} />

      {!row && (
        <p className="small muted">
          {t(
            "Todavía no has revisado tus páginas. Presiona el botón: tarda unos segundos y no cuesta nada.",
            "You haven't checked your pages yet. Press the button: it takes a few seconds and costs nothing.",
          )}
        </p>
      )}
      {row && !report && <p className="note">{t("La última revisión tiene un formato viejo. Presiona «Revisar de nuevo».", "The last check is in an old format. Press “Check again”.")}</p>}
      {otherSite && (
        <p className="note">
          {t("Esta revisión es de otro sitio de Search Console. Presiona «Revisar de nuevo».", "This check is for a different Search Console site. Press “Check again”.")}
        </p>
      )}

      {report && !otherSite && (
        <>
          {report.pages.length === 0 ? (
            <div className={`note ok ${styles.good}`} role="status">
              <strong>{t("Ninguna página está perdiendo visitas", "No page is losing visits")}</strong>
              <span>
                {report.pagesChecked
                  ? t(
                      `Revisamos ${f.int(report.pagesChecked)} ${report.pagesChecked === 1 ? "página" : "páginas"} con visitas desde Google y todas se mantienen o suben. Vuelve a revisar el próximo mes.`,
                      `We checked ${f.int(report.pagesChecked)} ${report.pagesChecked === 1 ? "page" : "pages"} with visits from Google and they're all holding steady or growing. Check again next month.`,
                    )
                  : t(
                      "Todavía ninguna página tiene suficientes visitas desde Google para comparar. Vuelve a revisar en unas semanas.",
                      "No page has enough visits from Google to compare yet. Check again in a few weeks.",
                    )}
              </span>
            </div>
          ) : (
            <>
              <p className="small muted">
                {report.decaying > report.pages.length
                  ? t(
                      `${f.int(report.decaying)} de ${f.int(report.pagesChecked)} páginas perdieron visitas. Te mostramos las ${report.pages.length} que más perdieron.`,
                      `${f.int(report.decaying)} of ${f.int(report.pagesChecked)} pages lost visits. Here are the ${report.pages.length} that lost the most.`,
                    )
                  : t(
                      `${f.int(report.decaying)} de ${f.int(report.pagesChecked)} ${report.pagesChecked === 1 ? "página perdió" : "páginas perdieron"} visitas, de la que más perdió a la que menos.`,
                      `${f.int(report.decaying)} of ${f.int(report.pagesChecked)} ${report.pagesChecked === 1 ? "page" : "pages"} lost visits, from the most to the least.`,
                    )}
              </p>
              <ShowMore hidden={report.pages.length - PAGES_SHOWN} more={t(`Ver las ${report.pages.length} páginas`, `See all ${report.pages.length} pages`)}>
                <ul className={styles.list}>
                  {report.pages.map((p, i) => (
                    <PageItem key={p.url} p={p} businessId={businessId} f={f} t={t} className={capClass(i, PAGES_SHOWN)} />
                  ))}
                </ul>
              </ShowMore>
            </>
          )}
        </>
      )}
      {help}
      {ctx && report && <AiPromptButton text={decayPrompt(ctx, report, lang)} />}
    </section>
  );
}
