"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { lookupNow, type LookupResult } from "@/app/actions-seo-lookup";
import { useT } from "@/components/I18n";
import { intlLocale } from "@/lib/i18n";
import { BUSINESS_TZ } from "@/lib/time";
import { DIFFICULTY_LABEL, difficultyLevel, INTENT_LABEL } from "@/lib/seo/labs-shared";
import type { DomainLookup, KeywordLookup, Lookup } from "@/lib/seo/lookup";
import { n } from "./fmt";
import s from "./Dashboard.module.css";
import l from "./LiveLookup.module.css";

type Props = {
  businessId: string;
  q: string;
  /** La búsqueda guardada más nueva de esto mismo (no gasta). */
  initial: Lookup | null;
  /** Lo que cuesta buscar en vivo (texto ya formateado). */
  price: string;
  /** Hay zona de Google elegida (sin zona no se puede buscar). */
  ready: boolean;
};

/** Nombres de lo que Google muestra además de los resultados normales. */
const FEATURES: Record<string, [string, string]> = {
  local_pack: ["Mapa con negocios", "Map pack"],
  people_also_ask: ["Preguntas relacionadas", "People also ask"],
  featured_snippet: ["Respuesta destacada", "Featured snippet"],
  ads: ["Anuncios", "Ads"],
  ai_overview: ["Resumen con IA", "AI Overview"],
  images: ["Imágenes", "Images"],
  video: ["Videos", "Videos"],
  short_videos: ["Videos cortos", "Short videos"],
  local_services: ["Servicios locales de Google", "Local Services ads"],
  related_searches: ["Búsquedas relacionadas", "Related searches"],
  discussions_and_forums: ["Foros", "Forums"],
  knowledge_graph: ["Ficha de Google", "Knowledge panel"],
};

/** «Ver quién sale ahora»: la búsqueda en vivo de una palabra o una página, debajo de lo que ya sabemos. */
export function LiveLookup({ businessId, q, initial, price, ready }: Props) {
  const { t, lang } = useT();
  const [state, setState] = useState<LookupResult>(initial ? { ok: true, lookup: initial, reused: true } : null);
  const [pending, start] = useTransition();
  const run = (again: boolean) =>
    start(async () => {
      try {
        setState(await lookupNow(businessId, q, again));
      } catch {
        setState({ ok: false, message: t("No se pudo buscar. Intenta de nuevo.", "Couldn't search. Try again.") });
      }
    });
  const lookup = state?.ok ? state.lookup : null;
  // Con la zona horaria fija: el servidor y el navegador escriben la misma fecha (si no, React se queja al hidratar).
  const date = (iso: string) => new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeStyle: "short", timeZone: BUSINESS_TZ }).format(new Date(iso));

  return (
    <div className={`stack ${l.live}`} aria-live="polite">
      <div className={l.liveHead}>
        <span className={l.badge}>{t("En vivo", "Live")}</span>
        {lookup ? (
          <span className="small muted">
            {lookup.type === "keyword"
              ? t(`Google en el celular en ${lookup.zone.name.split(",")[0]} · ${date(lookup.createdAt)}`, `Google on mobile in ${lookup.zone.name.split(",")[0]} · ${date(lookup.createdAt)}`)
              : t(`Datos de Google en ${lookup.country} · ${date(lookup.createdAt)}`, `Google data for ${lookup.country} · ${date(lookup.createdAt)}`)}
          </span>
        ) : (
          <span className="small muted">
            {t("Mira ahora mismo quién sale en Google, sin tener que seguirla antes.", "See right now who shows up on Google, without tracking it first.")}
          </span>
        )}
      </div>

      {!ready ? (
        <p className="small muted">
          {t("Para buscar en vivo, primero elige la zona donde buscan tus clientes en ", "To search live, first pick the area where your customers search in ")}
          <Link href={`/b/${businessId}/seo?tab=ajustes#dataforseo`}>{t("SEO → ⚙ Ajustes", "SEO → ⚙ Settings")}</Link>.
        </p>
      ) : (
        <div className={s.buttons}>
          <button type="button" className={`btn ${lookup ? "" : "ai"}`} disabled={pending} onClick={() => run(Boolean(lookup))}>
            {pending
              ? t("Buscando en Google…", "Searching Google…")
              : lookup
                ? t("Volver a revisar", "Check again")
                : looksDomain(q)
                  ? t("Ver sus números ahora", "See its numbers now")
                  : t("Ver quién sale ahora", "See who shows up now")}
          </button>
          {!pending && <span className="small muted">{t(`Cuesta ≈ ${price} de tu saldo de DataForSEO.`, `Costs ≈ ${price} from your DataForSEO balance.`)}</span>}
          {state?.ok && state.reused && !pending && <span className="small muted">{t("(esta es la que ya buscaste: no se cobró otra vez)", "(this is the one you already searched: not charged again)")}</span>}
        </div>
      )}

      {state && !state.ok && <p className="note error" role="status">{state.message}</p>}
      {lookup?.type === "keyword" && <KeywordView businessId={businessId} k={lookup} />}
      {lookup?.type === "domain" && <DomainView businessId={businessId} d={lookup} />}
      {lookup && lookup.notes.length > 0 && (
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          {lookup.notes.map((x, i) => (
            <li key={i}>{lang === "en" ? x.en : x.es}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const looksDomain = (q: string) => /^https?:\/\//i.test(q.trim()) || (!/\s/.test(q.trim()) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(q.trim()));

function KeywordView({ businessId, k }: { businessId: string; k: KeywordLookup }) {
  const { t, lang } = useT();
  const f = k.facts;
  const level = difficultyLevel(f?.difficulty);
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const writeHref = `/b/${businessId}/seo/escribir?${new URLSearchParams({ kw: k.keyword })}`;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className={s.facts}>
        <div className={s.fact}>
          <span className={s.factValue}>{k.yourPosition ? `#${k.yourPosition}` : t("No sales", "Not there")}</span>
          <span className={s.factLabel}>{k.yourPosition ? t("tu lugar en Google ahora", "your spot on Google now") : t("en la primera página de Google", "on Google's first page")}</span>
        </div>
        <div className={s.fact}>
          <span className={s.factValue}>{f?.volume != null ? n(f.volume, lang, 0) : "—"}</span>
          <span className={s.factLabel}>{t(`búsquedas al mes en ${f?.country || "tu país"}`, `searches a month in ${f?.country || "your country"}`)}</span>
        </div>
        <div className={s.fact}>
          <span className={s.factValue}>
            {level ? (
              <>
                {t(DIFFICULTY_LABEL[level][1], DIFFICULTY_LABEL[level][2])} <small className="muted">{f?.difficulty}/100</small>
              </>
            ) : (
              "—"
            )}
          </span>
          <span className={s.factLabel}>{t("qué tan difícil es salir en la primera página", "how hard it is to reach page one")}</span>
        </div>
        <div className={s.fact}>
          <span className={s.factValue} style={{ fontSize: 16 }}>{f?.intent ? t(INTENT_LABEL[f.intent].es, INTENT_LABEL[f.intent].en) : "—"}</span>
          <span className={s.factLabel}>
            {t("lo que quiere la gente", "what people want")}
            {f?.cpc ? t(` · los anuncios pagan ${money.format(f.cpc)} por clic`, ` · ads pay ${money.format(f.cpc)} per click`) : ""}
          </span>
        </div>
      </div>

      {k.localPack && (
        <p className="small">
          <strong>📍 {t("En el mapa:", "On the map:")}</strong> {k.localPack.names.join(" · ")}
          {k.localPack.you ? <span className="pill done" style={{ marginLeft: 8 }}>{t(`tú: ${k.localPack.you}°`, `you: #${k.localPack.you}`)}</span> : <span className="small muted"> · {t("tú no sales", "you're not there")}</span>}
        </p>
      )}

      {k.top.length > 0 ? (
        <div className="stack" style={{ gap: 6 }}>
          <span className="lbl">{t("Quién sale en Google ahora", "Who shows up on Google now")}</span>
          <ol className={l.serp}>
            {k.top.map((x) => (
              <li key={`${x.position}-${x.url}`} value={x.position} className={x.mine ? l.mine : undefined}>
                <a href={x.url} target="_blank" rel="noopener noreferrer">
                  {x.title || x.domain}
                </a>
                <span className="small muted">
                  {" · "}
                  {x.domain}
                  {x.mine ? t(" · tu página", " · your website") : x.directory ? t(" · directorio", " · directory") : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {k.ads && k.ads.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="lbl">{t("Quién paga anuncios en esta búsqueda", "Who pays for ads on this search")}</span>
          <ul className={l.comps}>
            {k.ads.map((a) => (
              <li key={a.domain}>
                <strong>{a.domain}</strong>
                {a.title ? <span className="small muted"> · {a.title}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {k.features.length > 0 && (
        <div className="tags">
          {k.features.map((x) => (
            <span key={x} className="tag">
              {FEATURES[x] ? t(...FEATURES[x]) : x.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}
      {k.questions.length > 0 && (
        <details>
          <summary className="btn link" style={{ display: "inline-flex", padding: 0 }}>
            {t(`Lo que también pregunta la gente (${k.questions.length})`, `What people also ask (${k.questions.length})`)}
          </summary>
          <ul className="small" style={{ marginTop: 6 }}>
            {k.questions.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </details>
      )}
      {!k.yourPosition && (
        <p className="small muted">
          {t("Para salir aquí, lo que más ayuda es una página o un artículo de tu web que hable justo de esto. ", "To show up here, what helps most is a page or article on your site about exactly this. ")}
          <Link href={writeHref}>{t("Escribir el artículo →", "Write the article →")}</Link>
        </p>
      )}
    </div>
  );
}

function DomainView({ businessId, d }: { businessId: string; d: DomainLookup }) {
  const { t, lang } = useT();
  const o = d.overview;
  // Sin «notation: compact»: el servidor (Node) y el navegador lo escriben distinto («41 mil» / «41,0 mil»).
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const compareHref = `/b/${businessId}/seo?${new URLSearchParams({ tab: "competencia", comparar: d.domain })}#comparar`;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className={s.facts}>
        <div className={s.fact}>
          <span className={s.factValue}>{o?.traffic != null ? n(Math.round(o.traffic), lang, 0) : "—"}</span>
          <span className={s.factLabel}>{t("visitas al mes desde Google (aprox.)", "monthly visits from Google (approx.)")}</span>
        </div>
        <div className={s.fact}>
          <span className={s.factValue}>{o?.keywords != null ? n(o.keywords, lang, 0) : "—"}</span>
          <span className={s.factLabel}>{t("búsquedas por las que sale", "searches it shows up for")}</span>
        </div>
        <div className={s.fact}>
          <span className={s.factValue}>{o?.top3 != null ? n(o.top3, lang, 0) : "—"}</span>
          <span className={s.factLabel}>{t("en los 3 primeros lugares", "in the top 3 spots")}</span>
        </div>
        <div className={s.fact}>
          <span className={s.factValue}>{o?.trafficValue != null ? money.format(o.trafficValue) : "—"}</span>
          <span className={s.factLabel}>{t("lo que costarían esas visitas en anuncios, al mes", "what those visits would cost in ads, per month")}</span>
        </div>
      </div>
      {o && (o.newKeywords != null || o.paidKeywords) ? (
        <p className="small muted">
          {o.newKeywords != null && o.lostKeywords != null
            ? t(`Este mes: +${n(o.newKeywords, lang, 0)} búsquedas nuevas, −${n(o.lostKeywords, lang, 0)} perdidas.`, `This month: +${n(o.newKeywords, lang, 0)} new searches, −${n(o.lostKeywords, lang, 0)} lost.`)
            : ""}
          {o.paidKeywords ? t(` Paga anuncios en Google en ${n(o.paidKeywords, lang, 0)} búsquedas.`, ` It pays for Google ads on ${n(o.paidKeywords, lang, 0)} searches.`) : ""}
        </p>
      ) : null}

      {d.top.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="lbl">{t("Sus búsquedas más buscadas en la primera página", "Its most searched keywords on page one")}</span>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Búsqueda", "Search")}</th>
                  <th className="kw-num">{t("Lugar", "Spot")}</th>
                  <th className="kw-num">{t("Búsquedas al mes", "Monthly searches")}</th>
                </tr>
              </thead>
              <tbody>
                {d.top.map((x) => (
                  <tr key={x.keyword}>
                    <td>
                      <Link href={`/b/${businessId}/inicio?${new URLSearchParams({ q: x.keyword })}`}>{x.keyword}</Link>
                    </td>
                    <td className="kw-num">#{x.position}</td>
                    <td className="kw-num">{x.volume != null ? n(x.volume, lang, 0) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {d.competitors.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="lbl">{t("Quién compite con esa página en Google", "Who competes with that website on Google")}</span>
          <ul className={l.comps}>
            {d.competitors.map((c) => (
              <li key={c.domain}>
                <Link href={`/b/${businessId}/inicio?${new URLSearchParams({ q: c.domain })}`}>{c.domain}</Link>
                <span className="small muted">
                  {c.overlap != null ? t(` · ${n(c.overlap, lang, 0)} búsquedas en común`, ` · ${n(c.overlap, lang, 0)} shared searches`) : ""}
                  {c.traffic != null ? t(` · ${n(Math.round(c.traffic), lang, 0)} visitas/mes`, ` · ${n(Math.round(c.traffic), lang, 0)} visits/mo`) : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={s.buttons}>
        <Link href={compareHref} className="btn">
          {t("Comparar con mi página →", "Compare with my website →")}
        </Link>
      </div>
    </div>
  );
}
