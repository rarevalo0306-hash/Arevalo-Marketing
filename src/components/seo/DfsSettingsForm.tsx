"use client";

import { useActionState, useState, useTransition } from "react";
import { searchSeoLocations, type SeoSettingsResult } from "@/app/actions-seo-dfs";
import { useT } from "@/components/I18n";
import type { DfsLocation } from "@/lib/seo/dataforseo";

const COUNTRIES = [
  ["us", "Estados Unidos", "United States"],
  ["pr", "Puerto Rico", "Puerto Rico"],
  ["mx", "México", "Mexico"],
  ["ni", "Nicaragua", "Nicaragua"],
  ["cr", "Costa Rica", "Costa Rica"],
  ["hn", "Honduras", "Honduras"],
  ["sv", "El Salvador", "El Salvador"],
  ["gt", "Guatemala", "Guatemala"],
  ["pa", "Panamá", "Panama"],
  ["do", "República Dominicana", "Dominican Republic"],
  ["co", "Colombia", "Colombia"],
  ["es", "España", "Spain"],
] as const;

type Props = {
  action: (prev: SeoSettingsResult, f: FormData) => Promise<SeoSettingsResult>;
  initial: { locationCode: number | null; locationName: string; language: "es" | "en"; keywords: string[]; daily: boolean };
  suggested: string[];
  fromStudy: boolean;
};

export function DfsSettingsForm({ action, initial, suggested, fromStudy }: Props) {
  const { t } = useT();
  const [result, run, saving] = useActionState(action, null);
  const [country, setCountry] = useState("us");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<DfsLocation[]>([]);
  const [error, setError] = useState("");
  const [location, setLocation] = useState<{ code: number | null; name: string }>({ code: initial.locationCode, name: initial.locationName });
  const [keywords, setKeywords] = useState(initial.keywords.join("\n"));
  const [searching, startSearch] = useTransition();

  const search = () =>
    startSearch(async () => {
      setError("");
      const r = await searchSeoLocations(country, query);
      if (r.ok) setFound(r.locations);
      else setError(r.error);
    });

  const count = keywords.split("\n").filter((k) => k.trim()).length;

  return (
    <form action={run} className="stack" style={{ gap: 14 }}>
      <input type="hidden" name="locationCode" value={location.code ?? ""} />
      <input type="hidden" name="locationName" value={location.name} />
      <div className="stack" style={{ gap: 6 }}>
        <span className="lbl">{t("Zona de Google", "Google area")}</span>
        {location.code ? (
          <div className="row">
            <span className="pill scheduled">{location.name}</span>
            <button type="button" className="btn link" onClick={() => setLocation({ code: null, name: "" })}>{t("Cambiar", "Change")}</button>
          </div>
        ) : (
          <>
            <div className="row" style={{ alignItems: "stretch" }}>
              <select className="field" style={{ width: "auto" }} value={country} onChange={(e) => setCountry(e.target.value)} aria-label={t("País", "Country")}>
                {COUNTRIES.map(([iso, es, en]) => <option key={iso} value={iso}>{t(es, en)}</option>)}
              </select>
              <input
                className="field"
                style={{ flex: 1, minWidth: 180 }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    search();
                  }
                }}
                placeholder={t("Ciudad, condado o estado. Ej.: Miami", "City, county or state. E.g.: Miami")}
                aria-label={t("Buscar zona", "Search area")}
              />
              <button type="button" className="btn" onClick={search} disabled={searching || query.trim().length < 2}>
                {searching ? t("Buscando…", "Searching…") : t("Buscar", "Search")}
              </button>
            </div>
            {error && <p className="note error" role="alert">{error}</p>}
            {found.length > 0 && (
              <div className="tags">
                {found.map((l) => (
                  <button key={l.code} type="button" className="opt" onClick={() => setLocation({ code: l.code, name: l.name })}>
                    {l.name} <span className="small muted">· {l.type}</span>
                  </button>
                ))}
              </div>
            )}
            {!searching && query.trim().length >= 2 && found.length === 0 && !error && (
              <span className="small muted">{t("Presiona Buscar para ver las zonas.", "Press Search to see the areas.")}</span>
            )}
          </>
        )}
      </div>
      <div className="grid-2" style={{ gap: 14 }}>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="dfs-language">{t("Idioma en que buscan", "Search language")}</label>
          <select id="dfs-language" name="language" className="field" defaultValue={initial.language}>
            <option value="es">{t("Español", "Spanish")}</option>
            <option value="en">{t("Inglés", "English")}</option>
          </select>
        </div>
        <label className="check" style={{ alignSelf: "end" }}>
          <input type="checkbox" name="daily" defaultChecked={initial.daily} />
          <span>
            <strong>{t("Revisar mis posiciones cada día", "Check my rankings every day")}</strong>
            <span className="small muted" style={{ display: "block" }}>
              {t("Usa saldo de DataForSEO cada día (unos centavos por palabra clave).", "Uses DataForSEO balance every day (a few cents per keyword).")}
            </span>
          </span>
        </label>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <label className="lbl" htmlFor="dfs-keywords">
          {t("Palabras clave que quieres seguir", "Keywords you want to track")} <span className="small muted">({count}/25)</span>
        </label>
        <textarea id="dfs-keywords" name="keywords" className="field" style={{ minHeight: 140 }} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={t("Una por línea. Ej.: cortinas metálicas managua", "One per line. E.g.: roll up doors miami")} />
        <span className="small muted">
          {fromStudy
            ? t("Estas salen de tu estudio del negocio. Cámbialas como quieras y guarda.", "These come from your business study. Change them as you like and save.")
            : t("Una por línea, como las escribe la gente en Google.", "One per line, the way people type them into Google.")}
          {suggested.length > 0 && !fromStudy && (
            <>
              {" "}
              <button type="button" className="btn link" style={{ minHeight: 0, padding: 0 }} onClick={() => setKeywords([...new Set([...keywords.split("\n").map((k) => k.trim()).filter(Boolean), ...suggested])].slice(0, 25).join("\n"))}>
                {t("+ Agregar las del estudio", "+ Add the ones from the study")}
              </button>
            </>
          )}
        </span>
      </div>
      {result && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
      <div>
        <button type="submit" className="btn on" disabled={saving || !location.code || count === 0}>
          {saving ? t("Guardando…", "Saving…") : t("Guardar", "Save")}
        </button>
        {!location.code && <span className="small muted" style={{ marginLeft: 10 }}>{t("Elige primero una zona.", "Pick an area first.")}</span>}
      </div>
    </form>
  );
}
