"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useT } from "@/components/I18n";
import { FollowButton } from "@/components/seo/KeywordsButton";
import { intlLocale } from "@/lib/i18n";
import { filterCounts, filterIdeas, type IdeaFilter, type IdeaRow, type IdeaSort, sortIdeas } from "@/lib/seo/ideas-shared";
import { DIFFICULTY_LABEL, difficultyLevel, INTENT_LABEL } from "@/lib/seo/labs-shared";

const PAGE = 25;

type Props = {
  businessId: string;
  rows: IdeaRow[];
  /** Las zonas del negocio (para el filtro «con tu zona»). */
  places: string[];
  /** Las palabras que ya sigue (minúsculas). */
  tracked: string[];
  full: boolean;
};

/** La tabla de ideas con filtros (preguntas, fáciles, para vender, con tu zona), palabras que incluir o quitar y orden. */
export function IdeasTable({ businessId, rows, places, tracked, full }: Props) {
  const { t, lang } = useT();
  const [filter, setFilter] = useState<IdeaFilter>("all");
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [minVolume, setMinVolume] = useState(0);
  const [sort, setSort] = useState<IdeaSort>("volume");
  const [limit, setLimit] = useState(PAGE);
  const number = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 0 });
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const counts = useMemo(() => filterCounts(rows, places), [rows, places]);
  const shown = useMemo(() => sortIdeas(filterIdeas(rows, { filter, include, exclude, minVolume, places }), sort), [rows, filter, include, exclude, minVolume, places, sort]);
  const trackedSet = new Set(tracked);
  const tabs: [IdeaFilter, string][] = [
    ["all", t("Todas", "All")],
    ["questions", t("Preguntas", "Questions")],
    ["easy", t("Fáciles", "Easy")],
    ["buyers", t("Para vender", "To sell")],
    ["local", t("Con tu zona", "With your area")],
  ];
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" role="tablist" aria-label={t("Filtros", "Filters")} style={{ gap: 6 }}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={`btn${filter === id ? " on" : ""}`}
            onClick={() => {
              setFilter(id);
              setLimit(PAGE);
            }}
          >
            {label} <span className="small muted">({counts[id]})</span>
          </button>
        ))}
      </div>
      <div className="ideas-controls">
        <label className="stack" style={{ gap: 4 }}>
          <span className="lbl">{t("Que tenga", "Must include")}</span>
          <input className="field" value={include} onChange={(e) => setInclude(e.target.value)} placeholder={t("ej.: precio", "e.g. price")} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="lbl">{t("Que no tenga", "Must not include")}</span>
          <input className="field" value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder={t("ej.: gratis", "e.g. free")} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="lbl">{t("Búsquedas al mes", "Monthly searches")}</span>
          <select className="field" value={minVolume} onChange={(e) => setMinVolume(Number(e.target.value))}>
            <option value={0}>{t("Cualquiera", "Any")}</option>
            <option value={10}>10+</option>
            <option value={50}>50+</option>
            <option value={100}>100+</option>
            <option value={500}>500+</option>
            <option value={1000}>1000+</option>
          </select>
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="lbl">{t("Ordenar por", "Sort by")}</span>
          <select className="field" value={sort} onChange={(e) => setSort(e.target.value as IdeaSort)}>
            <option value="volume">{t("Más buscadas", "Most searched")}</option>
            <option value="difficulty">{t("Más fáciles", "Easiest")}</option>
            <option value="cpc">{t("Las que más pagan en anuncios", "Highest ad cost")}</option>
          </select>
        </label>
      </div>
      <span className="small muted">{t(`${shown.length} de ${rows.length} ideas`, `${shown.length} of ${rows.length} ideas`)}</span>
      {shown.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("Búsqueda", "Search")}</th>
                <th className="kw-num">{t("Búsquedas al mes", "Monthly searches")}</th>
                <th>{t("Dificultad", "Difficulty")}</th>
                <th>{t("Qué buscan", "What they want")}</th>
                <th className="kw-num">CPC</th>
                <th>
                  <span className="sr-only">{t("Acciones", "Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, limit).map((r) => {
                const level = difficultyLevel(r.difficulty);
                return (
                  <tr key={r.keyword}>
                    <td>
                      <strong>{r.keyword}</strong>
                    </td>
                    <td className="kw-num">{r.volume !== null ? number.format(r.volume) : <span className="muted">—</span>}</td>
                    <td>
                      {level ? (
                        <span className={`pill ${DIFFICULTY_LABEL[level][0]}`} style={{ whiteSpace: "nowrap" }}>
                          {t(DIFFICULTY_LABEL[level][1], DIFFICULTY_LABEL[level][2])} · {r.difficulty}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="small">{r.intent ? t(INTENT_LABEL[r.intent].es, INTENT_LABEL[r.intent].en) : <span className="muted">—</span>}</td>
                    <td className="kw-num">{r.cpc !== null ? money.format(r.cpc) : <span className="muted">—</span>}</td>
                    <td>
                      <span className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
                        <Link href={`/b/${businessId}/inicio?${new URLSearchParams({ q: r.keyword })}`} className="btn link" style={{ whiteSpace: "nowrap" }}>
                          {t("Ver quién sale", "See who ranks")}
                        </Link>
                        {trackedSet.has(r.keyword) ? <span className="small muted">{t("Siguiendo ✓", "Tracking ✓")}</span> : <FollowButton businessId={businessId} keyword={r.keyword} full={full} />}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small muted">{t("Ninguna idea con esos filtros.", "No ideas with those filters.")}</p>
      )}
      {shown.length > limit && (
        <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE * 2)}>
          {t(`Ver más (${shown.length - limit} más)`, `See more (${shown.length - limit} more)`)}
        </button>
      )}
    </div>
  );
}
