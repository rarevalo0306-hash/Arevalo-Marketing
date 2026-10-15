import { findMentions } from "@/app/actions-seo-mentions";
import { aiEnabled } from "@/lib/ai";
import { HowToRead } from "@/components/seo/HowToRead";
import { OutreachProvider, OutreachRow } from "@/components/seo/OutreachDrafts";
import { RunButton } from "@/components/seo/RunButton";
import { ShowMore } from "@/components/seo/ShowMore";
import { capClass } from "@/components/seo/Fold";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { linkHint } from "@/lib/seo/backlinks";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import { costText } from "@/lib/seo/keywords";
import { type Mention, MENTIONS_COST_ESTIMATE, MENTIONS_KIND, mentionsSummary, readMentionsReport } from "@/lib/seo/mentions";
import { OUTREACH_KIND, readOutreachStore } from "@/lib/seo/outreach";
import { latestReports } from "@/lib/seo/reports";
import { BUSINESS_TZ } from "@/lib/time";

const SHOWN = 8;

/** «Quién habla de ti»: páginas que nombran al negocio, si hablan bien o mal y cuáles no lo enlazan. */
export async function MentionsPanel({ businessId }: { businessId: string }) {
  if (!dataForSeoEnabled()) return null;
  const { lang, t } = await getT();
  const [[row], [outreachRow]] = await Promise.all([latestReports(businessId, MENTIONS_KIND, 1), latestReports(businessId, OUTREACH_KIND, 1)]);
  const report = row ? readMentionsReport(row.data) : null;
  const drafts = readOutreachStore(outreachRow?.data).drafts;
  const date = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeZone: BUSINESS_TZ });
  const s = report ? mentionsSummary(report.mentions) : null;
  // Primero las que hablan mal, luego las que no te enlazan, luego el resto (cada grupo, de la más nueva a la más vieja).
  const order = (m: Mention) => (m.sentiment === "negative" ? 0 : m.linked === false ? 1 : 2);
  const list = report ? [...report.mentions].sort((a, b) => order(a) - order(b)) : [];
  const SENT: Record<string, [string, string, string]> = {
    positive: ["done", "habla bien", "positive"],
    negative: ["failed", "habla mal", "negative"],
    neutral: ["draft", "neutral", "neutral"],
  };
  const TYPE: Record<string, [string, string]> = {
    news: ["noticia", "news"],
    blogs: ["blog", "blog"],
    "message-boards": ["foro", "forum"],
    ecommerce: ["tienda", "store"],
    organization: ["organización", "organization"],
  };

  return (
    <section className="card" id="menciones">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Quién habla de ti en internet", "Who talks about you online")}</h2>
        <p className="small muted">
          {t(
            "Noticias, blogs, foros y directorios que nombran a tu negocio. Ves si hablan bien o mal, y cuáles te nombran sin poner un enlace a tu página: pedírselo es de lo más fácil, porque ya te conocen.",
            "News, blogs, forums and directories that name your business. See whether they're positive or negative, and which ones name you without linking to your site: asking them is one of the easiest wins, because they already know you.",
          )}
        </p>
      </div>
      <RunButton
        action={findMentions.bind(null, businessId)}
        label={report ? t("Buscar otra vez", "Search again") : t("Buscar quién habla de ti", "Find who talks about you")}
        busy={t("Buscando en internet y revisando sus páginas…", "Searching the web and checking their pages…")}
        note={t(`Cuesta ≈ ${costText(MENTIONS_COST_ESTIMATE)} de tu saldo de DataForSEO (el costo real queda anotado).`, `Costs ≈ ${costText(MENTIONS_COST_ESTIMATE)} from your DataForSEO balance (the real cost is recorded).`)}
      />
      {report && row && s && (
        <>
          <p className="small muted">
            {t(`Buscamos ${report.query}`, `We searched ${report.query}`)} · {date.format(row.createdAt)} · {t("costó", "cost")} {costText(report.cost)}
          </p>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">{t("Páginas que te nombran", "Pages that name you")}</span>
              <span className="stat-value">{s.total}</span>
            </div>
            <div className="stat">
              <span className="stat-label">{t("Sin enlace a tu página", "Without a link to your site")}</span>
              <span className="stat-value">{s.unlinked}</span>
              <span className="stat-note">{t("oportunidades fáciles", "easy opportunities")}</span>
            </div>
            <div className="stat">
              <span className="stat-label">{t("Hablan mal", "Negative")}</span>
              <span className={`stat-value${s.negative ? " rank-down" : ""}`}>{s.negative}</span>
            </div>
            <div className="stat">
              <span className="stat-label">{t("Hablan bien", "Positive")}</span>
              <span className="stat-value">{s.positive}</span>
            </div>
          </div>
          {list.length > 0 ? (
            <OutreachProvider businessId={businessId} aiReady={aiEnabled()} initial={drafts}>
              <ShowMore hidden={list.length - SHOWN} more={t(`Ver las ${list.length}`, `See all ${list.length}`)}>
                <div className="stack" style={{ gap: 10 }}>
                  {list.map((m, i) => (
                    <article key={m.url} className={["mention", capClass(i, SHOWN)].filter(Boolean).join(" ")}>
                      <div className="mention-head">
                        <a href={m.url} target="_blank" rel="noopener noreferrer">
                          <strong>{m.title || m.url}</strong>
                        </a>
                        <span className="tags">
                          {m.sentiment && <span className={`pill ${SENT[m.sentiment][0]}`}>{t(SENT[m.sentiment][1], SENT[m.sentiment][2])}</span>}
                          {m.linked === true && <span className="pill done">{t("te enlaza ✓", "links to you ✓")}</span>}
                          {m.linked === false && <span className="pill partial">{t("sin enlace", "no link")}</span>}
                        </span>
                      </div>
                      <span className="small muted">
                        {m.domain}
                        {m.pageType && TYPE[m.pageType] ? ` · ${t(...TYPE[m.pageType])}` : ""}
                        {m.date ? ` · ${date.format(new Date(m.date))}` : ""}
                      </span>
                      {m.snippet && <span className="small">{m.snippet}</span>}
                      {m.linked === false && <OutreachRow domain={m.domain} hint={linkHint(m.domain)} mentionUrl={m.url} />}
                    </article>
                  ))}
                </div>
              </ShowMore>
            </OutreachProvider>
          ) : (
            <p className="small muted">{t("Todavía no encontramos páginas que te nombren. Vuelve a buscar en unas semanas.", "We haven't found pages that name you yet. Search again in a few weeks.")}</p>
          )}
          {report.notes.length > 0 && (
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {report.notes.map((n, i) => (
                <li key={i}>{lang === "en" ? n.en : n.es}</li>
              ))}
            </ul>
          )}
          <HowToRead title={t("Qué hacer con las menciones", "What to do with mentions")}>
            <ul>
              <li>{t("«Sin enlace»: te nombran pero no ponen un enlace a tu página. «Pedir el enlace» prepara un correo corto que agradece y lo pide.", "“No link”: they name you but don't link to your site. “Ask for a link” prepares a short email that thanks them and asks for it.")}</li>
              <li>{t("«Habla mal»: léela con calma. Si es un cliente, contesta con respeto y ofrece hablar en privado; nunca discutas en público.", "“Negative”: read it calmly. If it's a customer, reply respectfully and offer to talk privately; never argue in public.")}</li>
              <li>{t("Si encuentras una que no es tu negocio (otro con un nombre parecido), ignórala.", "If you find one that isn't your business (another with a similar name), ignore it.")}</li>
              <li>{t("Revisamos si te enlazan abriendo las 25 páginas más nuevas; en las demás usamos tu último reporte de enlaces.", "We check whether they link to you by opening the 25 newest pages; for the rest we use your latest links report.")}</li>
            </ul>
          </HowToRead>
        </>
      )}
    </section>
  );
}
