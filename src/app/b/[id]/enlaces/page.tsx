import { notFound } from "next/navigation";
import { checkImportSpam, importToxicList, runToxicCheck, saveOwnSites, saveToxicDecision } from "@/app/actions-toxic";
import { PageHead } from "@/components/PageHead";
import { DecisionGuide } from "@/components/toxic/DecisionGuide";
import { ImportBox } from "@/components/toxic/ImportBox";
import { OwnSitesForm } from "@/components/toxic/OwnSitesForm";
import s from "@/components/toxic/Toxic.module.css";
import { ToxicCheckButton } from "@/components/toxic/ToxicCheckButton";
import { ToxicWorkspace } from "@/components/toxic/ToxicWorkspace";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { BACKLINKS_ACTIVATE_URL, BACKLINKS_PRICING_URL, bulkSpamCostEstimate, toxicFetchCostEstimate, TOXIC_REFERRING_LIMIT } from "@/lib/seo/backlinks";
import { normalizeDomain } from "@/lib/seo/competitors";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { OUTCOME_TEXT } from "@/lib/toxic-links";
import { loadToxicState, toRow } from "@/lib/toxic-links-data";

export const dynamic = "force-dynamic";

export default async function EnlacesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lang, t } = await getT();
  const st = await loadToxicState(id);
  if (!st) notFound();
  const b = st.business;
  const site = normalizeDomain(b.website) ?? "";
  const tx = (x: { es: string; en: string }) => (lang === "en" ? x.en : x.es);
  const nf = new Intl.NumberFormat(intlLocale(lang));
  const usd = (n: number) => new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(n);
  const dfs = dataForSeoEnabled();
  const hasData = st.rows.length > 0;
  const f = st.latestFetch;
  const imp = st.latestImport;
  const fetchSteps = [
    t("Buscando los sitios que te enlazan…", "Finding the sites that link to you…"),
    t("Leyendo los textos de los enlaces…", "Reading the link texts…"),
    t("Contando los sitios nuevos de este mes…", "Counting this month's new sites…"),
    t("Clasificando el riesgo de cada sitio…", "Rating each site's risk…"),
  ];

  return (
    <>
      <PageHead
        business={{ ...b, id }}
        prefix={t("Enlaces de", "Links for")}
        section={t("Enlaces dañinos", "Toxic links")}
        title={t("Enlaces dañinos", "Toxic links")}
        subtitle={t(
          "Revisa qué sitios te enlazan, cuáles parecen spam y si de verdad tienes que hacer algo. Casi siempre la respuesta es no.",
          "Check which sites link to you, which look like spam and whether you really need to do anything. Almost always the answer is no.",
        )}
      />

      <div className={s.tiles}>
        <a href="#lista" className={s.tile}>
          <span className={s.tileNum}>{hasData || st.totalDomains ? nf.format(st.totalDomains) : "—"}</span>
          <span className={s.tileLabel}>{t("dominios que te enlazan", "domains linking to you")}</span>
        </a>
        <a href="#lista" className={s.tile}>
          <span className={`${s.tileNum} ${st.counts.alto ? s.bad : hasData ? s.ok : ""}`}>{hasData ? nf.format(st.counts.alto) : "—"}</span>
          <span className={s.tileLabel}>{t("de riesgo alto", "high risk")}</span>
        </a>
        <a href="#lista" className={s.tile}>
          <span className={`${s.tileNum} ${st.counts.medio ? s.warn : ""}`}>{hasData ? nf.format(st.counts.medio) : "—"}</span>
          <span className={s.tileLabel}>{t("de riesgo medio", "medium risk")}</span>
        </a>
        <a href="#lista" className={s.tile}>
          <span className={`${s.tileNum} ${st.spike.level === "attack" ? s.bad : st.spike.level === "watch" ? s.warn : ""}`}>{hasData ? nf.format(st.newThisMonth) : "—"}</span>
          <span className={s.tileLabel}>
            {t("nuevos este mes", "new this month")}
            {st.spike.newRisky > 0 ? t(` (${st.spike.newRisky} de riesgo)`, ` (${st.spike.newRisky} risky)`) : ""}
          </span>
        </a>
      </div>

      {st.spike.level === "attack" && (
        <p className="note error" role="alert" style={{ marginBottom: 16 }}>
          {t(
            `Llegaron ${st.spike.newRisky} sitios nuevos de riesgo este mes, mucho más de lo normal. Puede ser un ataque de spam. Responde las dos preguntas de abajo antes de hacer nada.`,
            `${st.spike.newRisky} new risky sites arrived this month, far more than usual. It may be a spam attack. Answer the two questions below before doing anything.`,
          )}
        </p>
      )}

      <section className="card" id="guia">
        <div>
          <h2>{t("¿Necesito desautorizar?", "Do I need to disavow?")}</h2>
          <p className="small muted">{t("Dos preguntas y te decimos qué hacer.", "Two questions and we'll tell you what to do.")}</p>
        </div>
        <DecisionGuide
          action={saveToxicDecision.bind(null, id)}
          spike={st.spike.level}
          high={st.counts.alto}
          newRisky={st.spike.newRisky}
          saved={st.decision ? { manual: st.decision.manual, drop: st.decision.drop, at: fmtDate(st.decision.createdAt, lang) } : null}
          gscConnected={st.gscConnected}
        />
      </section>

      <section className="card" id="revisar">
        <div>
          <h2>{t("Revisar tus enlaces", "Check your links")}</h2>
          <p className="small muted">
            {f
              ? t(
                  `Última revisión: ${fmtDateTime(f.createdAt, "es")} · ${nf.format(f.items.length)} sitios revisados · costó ${usd(f.cost)}.`,
                  `Last check: ${fmtDateTime(f.createdAt, "en")} · ${nf.format(f.items.length)} sites checked · cost ${usd(f.cost)}.`,
                )
              : t(
                  `Revisamos hasta ${TOXIC_REFERRING_LIMIT} sitios que te enlazan (los de más spam primero) con DataForSEO, o puedes importar la lista que ya tienes (gratis).`,
                  `We check up to ${TOXIC_REFERRING_LIMIT} sites linking to you (most spam first) with DataForSEO, or you can import the list you already have (free).`,
                )}
          </p>
        </div>
        {f?.notes.map((n, i) => (
          <p key={i} className="note">
            {tx(n)}
          </p>
        ))}
        {st.locked ? (
          <div className="note">
            {t(
              "Tu cuenta de DataForSEO todavía no tiene activada la parte de Enlaces (Backlinks API). Mientras tanto, importa la lista que ya tienes. ",
              "Your DataForSEO account doesn't have the Links part (Backlinks API) turned on yet. Meanwhile, import the list you already have. ",
            )}
            <a href={BACKLINKS_ACTIVATE_URL} target="_blank" rel="noopener noreferrer">
              {t("Activarla en DataForSEO", "Turn it on in DataForSEO")}
            </a>{" "}
            ·{" "}
            <a href={BACKLINKS_PRICING_URL} target="_blank" rel="noopener noreferrer">
              {t("precios", "pricing")}
            </a>
          </div>
        ) : null}
        {!site ? (
          <p className="note">
            {t("Primero agrega la dirección de tu página web en ", "First add your website address in ")}
            <a href={`/b/${id}/negocio`}>{t("Mi negocio", "My business")}</a>.
          </p>
        ) : dfs ? (
          <ToxicCheckButton action={runToxicCheck.bind(null, id)} label={f ? t("Actualizar revisión", "Update check") : t("Revisar mis enlaces", "Check my links")} estimate={toxicFetchCostEstimate()} strong={!f} steps={fetchSteps} />
        ) : (
          <p className="small muted">{t("Para revisar con DataForSEO falta conectarlo (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel). Puedes importar tu lista abajo.", "To check with DataForSEO it needs to be connected (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel). You can import your list below.")}</p>
        )}
        {!hasData && (
          <p className="small muted">
            <a href="#importar">{t("O importa la lista de Semrush, Ahrefs o Search Console ↓", "Or import your Semrush, Ahrefs or Search Console list ↓")}</a>
          </p>
        )}
      </section>

      {hasData && <ToxicWorkspace businessId={id} rows={st.rows.map((r) => toRow(r, lang))} outcome={st.decision?.outcome ?? null} site={site} />}

      <section className="card" id="importar">
        <div>
          <h2>{t("Importar tu lista", "Import your list")}</h2>
          <p className="small muted">
            {t(
              "¿Ya tienes una lista de enlaces tóxicos (por ejemplo, la de Semrush)? Pégala o sube el archivo CSV o TXT exportado de Semrush, Ahrefs o Search Console. La revisamos con nuestras propias reglas: Semrush marca muchos sitios que Google ya ignora.",
              "Already have a toxic-links list (for example, Semrush's)? Paste it or upload the CSV or TXT exported from Semrush, Ahrefs or Search Console. We review it with our own rules: Semrush flags many sites Google already ignores.",
            )}
          </p>
        </div>
        {imp && (
          <p className="small">
            {t(
              `Lista importada el ${fmtDate(imp.createdAt, "es")}${imp.importName ? ` (${imp.importName})` : ""}: ${nf.format(imp.items.length)} dominios.`,
              `List imported ${fmtDate(imp.createdAt, "en")}${imp.importName ? ` (${imp.importName})` : ""}: ${nf.format(imp.items.length)} domains.`,
            )}{" "}
            {imp.spamChecked ? t("Ya tiene el nivel de spam de DataForSEO.", "It already has DataForSEO's spam level.") : ""}
          </p>
        )}
        {imp && !imp.spamChecked && dfs && !st.locked && (
          <ToxicCheckButton
            action={checkImportSpam.bind(null, id)}
            label={t("Revisar el spam de la lista importada", "Check the imported list's spam level")}
            estimate={bulkSpamCostEstimate(imp.items.length)}
            steps={[t("Pidiendo el nivel de spam de cada dominio…", "Asking for each domain's spam level…"), t("Clasificando el riesgo…", "Rating the risk…")]}
          />
        )}
        <ImportBox action={importToxicList.bind(null, id)} />
        <details className={s.more}>
          <summary>{t("¿Cómo exporto la lista?", "How do I export the list?")}</summary>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>{t("Semrush: Auditoría de backlinks → pestaña «Revisar» → Exportar (CSV o XLSX guardado como CSV).", "Semrush: Backlink Audit → “Review” tab → Export (CSV, or XLSX saved as CSV).")}</li>
            <li>{t("Ahrefs: Site Explorer → Dominios de referencia o Backlinks → Exportar (CSV).", "Ahrefs: Site Explorer → Referring domains or Backlinks → Export (CSV).")}</li>
            <li>{t("Search Console: Enlaces → «Sitios con más enlaces» → Exportar → Descargar CSV.", "Search Console: Links → “Top linking sites” → Export → Download CSV.")}</li>
            <li>{t("También sirve un archivo de desautorización anterior o una lista de dominios, uno por línea.", "A previous disavow file or a list of domains, one per line, also works.")}</li>
          </ul>
        </details>
      </section>

      <section className="card" id="historial">
        <div>
          <h2>{t("Historial", "History")}</h2>
          <p className="small muted">{t("Los archivos que armaste y tus respuestas. Nada de esto se subió a Google desde la app.", "The files you built and your answers. None of this was uploaded to Google from the app.")}</p>
        </div>
        {st.disavows.length === 0 && !st.decision ? (
          <p className={s.empty}>{t("Todavía no armaste ningún archivo. Bien: casi nunca hace falta.", "You haven't built any file yet. Good: it's almost never needed.")}</p>
        ) : (
          <ul className={s.history}>
            {st.decision && (
              <li>
                <span>
                  {t("Tu última respuesta: ", "Your last answer: ")}
                  <strong>{tx(OUTCOME_TEXT[st.decision.outcome])}</strong>
                </span>
                <span className="muted">{fmtDateTime(st.decision.createdAt, lang)}</span>
              </li>
            )}
            {st.disavows.slice(0, 15).map((d, i) => (
              <li key={i}>
                <span>
                  {d.empty
                    ? t("Archivo vacío (deshacer)", "Empty file (undo)")
                    : t(`Archivo con ${d.domains.length} ${d.domains.length === 1 ? "dominio" : "dominios"}`, `File with ${d.domains.length} ${d.domains.length === 1 ? "domain" : "domains"}`)}
                  {d.outcome ? <span className="muted"> · {tx(OUTCOME_TEXT[d.outcome])}</span> : null}
                  {d.domains.length > 0 && (
                    <span className="muted" style={{ display: "block", fontSize: 12, overflowWrap: "anywhere" }}>
                      {d.domains.slice(0, 4).join(", ")}
                      {d.domains.length > 4 ? t(` y ${d.domains.length - 4} más`, ` and ${d.domains.length - 4} more`) : ""}
                    </span>
                  )}
                </span>
                <span className="muted">{fmtDateTime(d.createdAt, lang)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" id="protegidos">
        <div>
          <h2>{t("Tus otros sitios y socios", "Your other sites and partners")}</h2>
          <p className="small muted">
            {t(
              `Nunca se marcan como dañinos ni entran al archivo. ${site ? `${site} ya está protegido. ` : ""}Agrega aquí tus otras páginas y las de proveedores o socios que te enlazan.`,
              `They're never flagged as harmful or put in the file. ${site ? `${site} is already protected. ` : ""}Add your other websites and those of suppliers or partners that link to you.`,
            )}
          </p>
        </div>
        <OwnSitesForm action={saveOwnSites.bind(null, id)} sites={st.ownSites} />
      </section>
    </>
  );
}
