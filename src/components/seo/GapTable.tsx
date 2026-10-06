"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/I18n";
import { TrackGapButton } from "@/components/seo/CompetitorsForm";
import type { GapIntent, GapRow, GapType } from "@/lib/seo/gap";
import { intlLocale } from "@/lib/i18n";

type Filter = "all" | "sell" | "easy";

type Props = {
  businessId: string;
  rows: GapRow[];
  /** Búsquedas que no tienen que ver con el negocio: ocultas, salvo que el dueño pida verlas. */
  offTopic?: GapRow[];
  /** Las palabras clave que ya sigue el negocio (minúsculas). */
  tracked: string[];
  track: (keyword: string) => Promise<{ ok: boolean; message: string }>;
};

const PAGE = 30;

/** Fácil (< 30), media (30 a 59) o difícil (60 o más): [estilo, español, inglés]. */
function difficultyBadge(d: number | null): [string, string, string] | null {
  if (d === null) return null;
  if (d < 30) return ["done", "fácil", "easy"];
  if (d < 60) return ["partial", "media", "medium"];
  return ["failed", "difícil", "hard"];
}

const INTENT: Record<GapIntent, [string, string]> = {
  transactional: ["quieren comprar", "ready to buy"],
  commercial: ["comparan opciones", "comparing options"],
  informational: ["buscan información", "looking for info"],
  navigational: ["buscan un sitio", "looking for a site"],
};

/** Las búsquedas de la competencia, con pestañas ("te faltan" / "estás más abajo") y filtros, sin recargar. */
export function GapTable({ businessId, rows: related, offTopic = [], tracked, track }: Props) {
  const { t, lang } = useT();
  const [showOff, setShowOff] = useState(false);
  const rows = showOff ? [...related, ...offTopic] : related;
  const offSet = new Set(offTopic.map((r) => r.keyword));
  const [tab, setTab] = useState<GapType>("missing");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const number = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 0 });
  const trackedSet = new Set(tracked);

  const byTab = (type: GapType) => rows.filter((r) => r.type === type);
  const counts = { missing: byTab("missing").length, weak: byTab("weak").length };
  const list = byTab(tab).filter((r) =>
    filter === "sell" ? r.intent === "commercial" || r.intent === "transactional" : filter === "easy" ? r.difficulty !== null && r.difficulty < 30 : true,
  );
  const shown = list.slice(0, limit);

  const post = (kw: string) =>
    `/b/${businessId}/publicar?${new URLSearchParams({ idea: t(`Escribe una publicación para competir por la búsqueda: ${kw}`, `Write a post to compete for the search: ${kw}`), magic: "1" })}`;
  const write = (kw: string) => `/b/${businessId}/seo/escribir?kw=${encodeURIComponent(kw)}`;

  const tabs: [GapType, string][] = [
    ["missing", t(`Te faltan (${counts.missing})`, `You're missing (${counts.missing})`)],
    ["weak", t(`Estás más abajo (${counts.weak})`, `You rank lower (${counts.weak})`)],
  ];
  const filters: [Filter, string][] = [
    ["all", t("Todas", "All")],
    ["sell", t("Para vender", "To sell")],
    ["easy", t("Fáciles", "Easy")],
  ];

  // Las mejores oportunidades salen solo de las búsquedas que tienen que ver con el negocio.
  const best = [...related].sort((a, b) => b.opportunity - a.opportunity).slice(0, 5);

  return (
    <div className="stack" style={{ gap: 16 }}>
      {best.length > 0 && (
        <div className="ai-box">
          <span className="lbl">{t("Empieza por aquí", "Start here")}</span>
          <span className="small muted">
            {t(
              "Las 5 mejores oportunidades: mucha gente las busca, no son tan difíciles y tu competencia ya gana clientes con ellas.",
              "The 5 best opportunities: lots of people search them, they're not too hard, and your competitors already win customers with them.",
            )}
          </span>
          <div className="gap-best">
            {best.map((r) => {
              const badge = difficultyBadge(r.difficulty);
              const top = r.competitors[0];
              return (
                <article key={r.keyword} className="gap-card">
                  <strong>{r.keyword}</strong>
                  <span className="small muted">
                    {[
                      r.volume !== null && t(`${number.format(r.volume)} búsquedas al mes`, `${number.format(r.volume)} searches a month`),
                      top && t(`${top.domain} sale #${top.position}`, `${top.domain} ranks #${top.position}`),
                      r.type === "weak" && r.yourPosition !== null ? t(`tú #${r.yourPosition}`, `you #${r.yourPosition}`) : t("tú no sales", "you don't show up"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="row" style={{ gap: 8 }}>
                    {badge && <span className={`pill ${badge[0]}`}>{t(badge[1], badge[2])}</span>}
                    {r.intent && <span className="small muted">{t(...INTENT[r.intent])}</span>}
                  </span>
                  <span className="row" style={{ gap: 8 }}>
                    <Link href={write(r.keyword)} className="btn link" style={{ minHeight: 0, padding: 0 }}>{t("Escribir artículo", "Write article")}</Link>
                    <Link href={post(r.keyword)} className="btn link" style={{ minHeight: 0, padding: 0 }}>{t("Crear post", "Create post")}</Link>
                  </span>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {offTopic.length > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          {t(
            `Ocultamos ${offTopic.length} ${offTopic.length === 1 ? "búsqueda que no tiene" : "búsquedas que no tienen"} que ver con tu negocio (por ejemplo, «${offTopic[0].keyword}»).`,
            `We hid ${offTopic.length} ${offTopic.length === 1 ? "search that has" : "searches that have"} nothing to do with your business (for example, “${offTopic[0].keyword}”).`,
          )}{" "}
          <button type="button" className="btn link" style={{ minHeight: 0, padding: 0 }} aria-pressed={showOff} onClick={() => setShowOff((v) => !v)}>
            {showOff ? t("Ocultarlas", "Hide them") : t("Mostrarlas igual", "Show them anyway")}
          </button>
        </p>
      )}

      <div className="tabs" role="tablist" aria-label={t("Tipo de oportunidad", "Opportunity type")}>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`tab${tab === key ? " on" : ""}`}
            onClick={() => {
              setTab(key);
              setLimit(PAGE);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="small muted">
        {tab === "missing"
          ? t("Búsquedas donde tu competencia sale en las primeras 2 páginas de Google y tú no sales.", "Searches where your competitors show up in Google's first 2 pages and you don't show up at all.")
          : t("Búsquedas donde sí sales, pero tu competencia está más arriba (y tú no estás en el top 3).", "Searches where you do show up, but your competitors rank higher (and you're not in the top 3).")}
      </span>
      <div className="row gap-filters" role="group" aria-label={t("Filtrar", "Filter")}>
        {filters.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            className={`btn${filter === key ? " on" : ""}`}
            onClick={() => {
              setFilter(key);
              setLimit(PAGE);
            }}
          >
            {label}
          </button>
        ))}
        <span className="small muted">
          {filter === "sell"
            ? t("Gente que compara o quiere comprar.", "People comparing or ready to buy.")
            : filter === "easy"
              ? t("Dificultad menor a 30: más fácil salir en la primera página.", "Difficulty under 30: easier to reach page one.")
              : t("Las mejores oportunidades primero.", "Best opportunities first.")}
        </span>
      </div>

      {list.length === 0 ? (
        <p className="small muted">
          {byTab(tab).length === 0
            ? tab === "missing"
              ? t("No encontramos búsquedas de tu competencia donde tú no salgas.", "We didn't find competitor searches where you don't show up.")
              : t("No encontramos búsquedas donde tu competencia esté más arriba que tú. ¡Bien!", "We didn't find searches where your competitors rank above you. Nice!")
            : t("Ninguna búsqueda cumple este filtro. Prueba con Todas.", "No searches match this filter. Try All.")}
        </p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Búsqueda", "Search")}</th>
                  <th className="kw-num">{t("Búsq./mes", "Searches/mo")}</th>
                  <th>{t("Dificultad", "Difficulty")}</th>
                  <th>{t("Tu competencia sale", "Competitors rank")}</th>
                  {tab === "weak" && <th className="kw-num">{t("Tú sales", "You rank")}</th>}
                  <th><span className="sr-only">{t("Acciones", "Actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const badge = difficultyBadge(r.difficulty);
                  return (
                    <tr key={r.keyword}>
                      <td>
                        <strong>{r.keyword}</strong>
                        {offSet.has(r.keyword) && <span className="small muted gap-intent">{t("no parece de tu negocio", "doesn't look related to your business")}</span>}
                        {r.intent && <span className="small muted gap-intent">{t(...INTENT[r.intent])}</span>}
                      </td>
                      <td className="kw-num">{r.volume === null ? <span className="muted">—</span> : number.format(r.volume)}</td>
                      <td>
                        {badge ? (
                          <span className={`pill ${badge[0]}`} title={t(`Dificultad ${r.difficulty} de 100`, `Difficulty ${r.difficulty} out of 100`)}>
                            {t(badge[1], badge[2])}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="small gap-comps">{r.competitors.map((c) => `${c.domain} #${c.position}`).join(" · ")}</td>
                      {tab === "weak" && <td className="kw-num">{r.yourPosition === null ? "—" : `#${r.yourPosition}`}</td>}
                      <td>
                        <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                          <Link href={post(r.keyword)} className="btn link" style={{ whiteSpace: "nowrap" }}>{t("Crear post", "Create post")}</Link>
                          <Link href={write(r.keyword)} className="btn link" style={{ whiteSpace: "nowrap" }}>{t("Escribir artículo", "Write article")}</Link>
                          <TrackGapButton action={track} keyword={r.keyword} tracked={trackedSet.has(r.keyword.toLowerCase())} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {list.length > shown.length && (
            <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setLimit((n) => n + PAGE)}>
              {t(`Ver más (${list.length - shown.length})`, `Show more (${list.length - shown.length})`)}
            </button>
          )}
        </>
      )}
    </div>
  );
}
