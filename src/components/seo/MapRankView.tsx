"use client";

import { useState, useTransition } from "react";
import { loadMapReport } from "@/app/actions-seo-maprank";
import { useT } from "@/components/I18n";
import { MapRankMap } from "@/components/seo/MapRankMap";
import { intlLocale } from "@/lib/i18n";
import { NOT_FOUND_RANK, type MapReport, type MapTiles } from "@/lib/seo/maprank-shared";

/** Un mapa anterior en la lista (la fecha ya viene escrita desde el servidor). */
export type MapHistoryItem = { id: string; keyword: string; size: number; spacingKm: number; when: string; avgRank: number | null; top3Share: number; placeTitle: string };

type Props = {
  businessId: string;
  initial: MapReport & { id: string };
  history: MapHistoryItem[];
  /** Nombre actual del negocio en Google Maps (para avisar si un mapa viejo era de otro). */
  placeTitle: string;
  /** Las imágenes del mapa (CARTO con clave, o OpenStreetMap). */
  tiles: MapTiles;
};

export function MapRankView({ businessId, initial, history, placeTitle, tiles }: Props) {
  const { t, lang } = useT();
  const [report, setReport] = useState(initial);
  const [error, setError] = useState("");
  const [loading, startLoad] = useTransition();
  const one = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });
  const km = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 4 });

  const open = (id: string) => {
    if (id === report.id) return;
    startLoad(async () => {
      setError("");
      const r = await loadMapReport(businessId, id);
      if (r) setReport(r);
      else setError(t("No se pudo abrir ese mapa. Recarga la página.", "Couldn't open that map. Reload the page."));
    });
  };

  const checked = report.points.filter((p) => !p.error).length;
  const failed = report.points.length - checked;
  const meta = history.find((h) => h.id === report.id);
  const avg = report.avgRank === null ? "—" : report.avgRank >= NOT_FOUND_RANK ? "20+" : one.format(report.avgRank);
  const legend: [string, string][] = [
    ["top3", t("1-3: te ven primero", "1-3: seen first")],
    ["good", "4-7"],
    ["mid", "8-10"],
    ["low", "11-20"],
    ["none", t("20+: no sales", "20+: not shown")],
    ["error", t("!: no se pudo revisar", "!: couldn't check")],
  ];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 4 }}>
        <span className="lbl">
          «{report.keyword}» · {report.size}×{report.size} · {km.format(report.spacingKm)} km
        </span>
        <span className="small muted">
          {meta?.when}
          {report.place.title && report.place.title !== placeTitle && ` · ${t(`negocio: ${report.place.title}`, `business: ${report.place.title}`)}`}
        </span>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-label" title={t("Los puntos donde no sales cuentan como 21.", "Points where you don't show up count as 21.")}>
            {t("Lugar promedio", "Average position")}
          </span>
          <span className="stat-value">{avg}</span>
          <span className="stat-note">{t("Más bajo es mejor (1 = primero)", "Lower is better (1 = first)")}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("Del mapa en el top 3", "Of the map in the top 3")}</span>
          <span className="stat-value">
            {report.top3Share}
            <small>%</small>
          </span>
          <span className="stat-note">{t("Donde la gente te ve sin bajar", "Where people see you without scrolling")}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("Puntos donde apareces", "Points where you show up")}</span>
          <span className="stat-value">
            {report.found}
            <small> / {checked}</small>
          </span>
          <span className="stat-note">{t("En los 20 primeros", "In the top 20")}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("Costo", "Cost")}</span>
          <span className="stat-value">{money.format(report.cost)}</span>
          <span className="stat-note">{t(`${report.points.length} búsquedas en Google Maps`, `${report.points.length} Google Maps searches`)}</span>
        </div>
      </div>

      <div className="mr-legend" aria-label={t("Colores del mapa", "Map colors")}>
        {legend.map(([band, label]) => (
          <span key={band} className="mr-legend-item">
            <span className={`mr-dot mr-${band} mr-dot-sm`} aria-hidden="true" />
            {label}
          </span>
        ))}
        <span className="mr-legend-item">
          <span aria-hidden="true">📍</span>
          {t("tu negocio", "your business")}
        </span>
      </div>

      <div style={{ position: "relative", opacity: loading ? 0.6 : 1, transition: "opacity 0.15s" }}>
        <MapRankMap report={report} placeTitle={report.place.title || placeTitle} tiles={tiles} />
      </div>
      <p className="small muted">
        {t(
          "Toca un punto para ver quién sale primero ahí. En el celular, mueve el mapa con dos dedos.",
          "Tap a point to see who shows up first there. On a phone, move the map with two fingers.",
        )}
        {failed > 0 && t(` ${failed} puntos no se pudieron revisar («!»); no cuentan en los números.`, ` ${failed} points couldn't be checked (“!”); they don't count in the numbers.`)}
      </p>
      {error && <p className="note error">{error}</p>}

      <div className="stack" style={{ gap: 8 }}>
        <span className="lbl">{t("Quién te gana en el mapa", "Who beats you on the map")}</span>
        {report.competitors.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Negocio", "Business")}</th>
                  <th className="rank-num" title={t("En cuántos puntos sale en los 3 primeros", "How many points it shows up in the top 3")}>{t("En top 3", "In top 3")}</th>
                  <th className="rank-num" title={t("Su lugar promedio en esos puntos", "Its average position at those points")}>{t("Lugar prom.", "Avg. pos.")}</th>
                </tr>
              </thead>
              <tbody>
                {report.competitors.map((c) => (
                  <tr key={c.cid ?? c.title}>
                    <td><strong>{c.title}</strong></td>
                    <td className="rank-num">
                      {c.points} / {checked}
                    </td>
                    <td className="rank-num">{one.format(c.avgRank)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <span className="small muted">{t("Nadie más salió en los 3 primeros.", "No one else showed up in the top 3.")}</span>
        )}
      </div>

      {history.length > 1 && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="lbl">{t("Tus mapas anteriores", "Your earlier maps")}</span>
          <span className="small muted">{t("Haz el mismo mapa cada mes para ver si vas mejorando.", "Make the same map every month to see if you're improving.")}</span>
          <ul className="wr-list">
            {history.map((h) => (
              <li key={h.id} className={h.id === report.id ? "on" : ""}>
                <button type="button" className="mr-hist" onClick={() => open(h.id)} disabled={loading} aria-current={h.id === report.id ? "true" : undefined}>
                  <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                    <strong className="mr-wrap">«{h.keyword}»</strong>
                    <span className="small muted">
                      {h.size}×{h.size} · {km.format(h.spacingKm)} km · {h.when}
                    </span>
                  </span>
                  <span className="small mr-hist-nums">
                    {t("Prom.", "Avg.")} <strong>{h.avgRank === null ? "—" : h.avgRank >= NOT_FOUND_RANK ? "20+" : one.format(h.avgRank)}</strong> · {t("Top 3", "Top 3")}{" "}
                    <strong>{h.top3Share}%</strong>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
