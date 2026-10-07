import Form from "next/form";
import Link from "next/link";
import { looksLikeDomain, domainFacts, keywordFacts, loadSeoBits } from "@/lib/dashboard";
import { getT } from "@/lib/i18n-server";
import { compact, n } from "./fmt";
import { DashIcon } from "./DashIcon";
import { TrackButton } from "./TrackButton";
import s from "./Dashboard.module.css";

/** Lo más largo que se acepta en el buscador. */
export const MAX_Q = 120;

/**
 * El buscador del Tablero: una palabra clave o la página de un competidor. Va a /inicio?q=… (sin JavaScript también
 * funciona) y el Tablero muestra lo que ya sabemos de eso, con botones para seguir.
 */
export async function DashSearch({ businessId, q, example }: { businessId: string; q: string; example?: string }) {
  const { t } = await getT();
  const ex = example?.trim() || t("tu servicio + tu ciudad", "your service + your city");
  return (
    <Form action={`/b/${businessId}/inicio`} className={s.search} role="search">
      <div className={s.searchBox}>
        <DashIcon name="search" size={18} />
        <label htmlFor="dash-q" className="sr-only">
          {t("Busca una palabra clave o la web de un competidor", "Search a keyword or a competitor's website")}
        </label>
        <input
          id="dash-q"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={MAX_Q}
          autoComplete="off"
          enterKeyHint="search"
          placeholder={t("Palabra clave o web de un competidor", "Keyword or a competitor's website")}
        />
        <button type="submit" className="btn on" aria-label={t("Buscar", "Search")}>
          <span className={s.searchText}>{t("Buscar", "Search")}</span>
          <span className={s.searchArrow} aria-hidden="true">
            →
          </span>
        </button>
      </div>
      <span className={s.searchHint}>{t(`Ej.: «${ex}» o «competencia.com»`, `E.g. “${ex}” or “competitor.com”`)}</span>
    </Form>
  );
}

/** Lo que ya sabemos de lo que buscó (solo lo guardado) y a dónde ir. */
export async function SearchResult({ businessId, q }: { businessId: string; q: string }) {
  const { lang, t } = await getT();
  const seo = await loadSeoBits(businessId);
  if (!seo) return null;
  const base = `/b/${businessId}`;
  const close = (
    <Link href={`${base}/inicio`} className={s.close} scroll={false}>
      ✕ {t("Cerrar", "Close")}
    </Link>
  );

  if (looksLikeDomain(q)) {
    const d = domainFacts(seo, q);
    const compHref = `${base}/seo?${new URLSearchParams({ tab: "competencia", competidor: d.domain })}#competencia`;
    return (
      <section className={`card ${s.result}`} aria-labelledby="dash-result">
        <div className={s.resultHead}>
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <span className={s.resultKind}>{t("Página web", "Website")}</span>
            <h2 className={s.resultTitle} id="dash-result">
              {d.domain}
            </h2>
          </div>
          {close}
        </div>
        {d.own ? (
          <>
            <p className="small muted">{t("Esa es tu página. Mira qué arreglar para que Google la entienda mejor.", "That's your website. See what to fix so Google understands it better.")}</p>
            <div className={s.buttons}>
              <Link href={`${base}/seo#auditoria`} className="btn on">
                {t("Revisar mi página →", "Check my website →")}
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className={s.facts}>
              <div className={s.fact}>
                <span className={s.factValue}>{d.checked ? <>{d.beatsYouIn}<small className="muted"> / {d.checked}</small></> : "—"}</span>
                <span className={s.factLabel}>{t("de tus búsquedas donde sale entre los 5 primeros", "of your searches where it's in the top 5")}</span>
              </div>
              {d.traffic !== null && (
                <div className={s.fact}>
                  <span className={s.factValue}>{compact(d.traffic, lang)}</span>
                  <span className={s.factLabel}>{t("visitas al mes desde Google (aprox.)", "monthly visits from Google (approx.)")}</span>
                </div>
              )}
              {d.keywords !== null && (
                <div className={s.fact}>
                  <span className={s.factValue}>{compact(d.keywords, lang)}</span>
                  <span className={s.factLabel}>{t("búsquedas por las que sale", "searches it shows up for")}</span>
                </div>
              )}
            </div>
            <p className="small muted">
              {d.known
                ? t("Ya está en tu revisión de competencia. Ábrela para ver qué palabras tiene y tú no.", "It's already in your competitor check. Open it to see which keywords it has and you don't.")
                : t(
                    "Todavía no lo revisamos a fondo. En Competencia, escríbelo en «Sitios de tu competencia» y toca «Volver a buscar».",
                    "We haven't looked at it closely yet. In Competitors, type it in “Competitor websites” and tap “Search again”.",
                  )}
            </p>
            <div className={s.buttons}>
              <Link href={compHref} className="btn on">
                {t("Ver búsquedas y competencia →", "See searches and competitors →")}
              </Link>
              <Link href={`${base}/seo#enlaces`} className="btn">
                {t("Comparar enlaces", "Compare links")}
              </Link>
            </div>
          </>
        )}
      </section>
    );
  }

  const k = keywordFacts(seo, q);
  const writeHref = `${base}/seo/escribir?${new URLSearchParams({ kw: k.keyword })}`;
  const seeHref = k.seen === "gap" ? `${base}/seo#gap` : k.seen === "rank" ? `${base}/seo#posiciones` : `${base}/seo#palabras`;
  const nothing = k.volume === null && k.position === undefined;
  return (
    <section className={`card ${s.result}`} aria-labelledby="dash-result">
      <div className={s.resultHead}>
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <span className={s.resultKind}>{t("Palabra clave", "Keyword")}</span>
          <h2 className={s.resultTitle} id="dash-result">
            «{k.keyword}»
          </h2>
        </div>
        {close}
      </div>
      {nothing ? (
        <p className="small muted">
          {t(
            "Todavía no tenemos datos de esta búsqueda. Síguela para revisar en qué lugar sales, o escribe un artículo para salir en Google.",
            "We don't have data for this search yet. Track it to check where you rank, or write an article to show up on Google.",
          )}
        </p>
      ) : (
        <div className={s.facts}>
          <div className={s.fact}>
            <span className={s.factValue}>{k.volume !== null ? n(k.volume, lang, 0) : "—"}</span>
            <span className={s.factLabel}>{t("búsquedas al mes", "searches a month")}</span>
          </div>
          <div className={s.fact}>
            <span className={s.factValue}>{k.position === undefined ? "—" : k.position === null ? t("No sales", "Not found") : `#${k.position}`}</span>
            <span className={s.factLabel}>{k.position === undefined ? t("tu lugar (todavía no la revisas)", "your spot (not tracked yet)") : t("tu lugar en Google", "your spot on Google")}</span>
          </div>
          {k.leader && (
            <div className={s.fact}>
              <span className={s.factValue} style={{ fontSize: 16 }}>
                {k.leader}
              </span>
              <span className={s.factLabel}>{t("el competidor que sale más arriba", "the competitor ranking highest")}</span>
            </div>
          )}
        </div>
      )}
      <div className={s.buttons}>
        <Link href={writeHref} className="btn on">
          {t("Escribir un artículo →", "Write an article →")}
        </Link>
        <Link href={seeHref} className="btn">
          {t("Ver búsquedas y competencia", "See searches and competitors")}
        </Link>
        {k.tracked ? <span className="pill done">{t("Ya la sigues", "You track it")}</span> : <TrackButton businessId={businessId} keyword={k.keyword} />}
      </div>
    </section>
  );
}
