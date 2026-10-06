"use client";

import { useState, useTransition } from "react";
import { findMapPlace, saveMapPlace } from "@/app/actions-seo-maprank";
import { useT } from "@/components/I18n";
import { intlLocale } from "@/lib/i18n";
import type { MapCandidate } from "@/lib/seo/maprank";
import type { MapPlace } from "@/lib/seo/maprank-shared";

type Props = {
  businessId: string;
  /** El negocio ya elegido (null = todavía no). */
  current: MapPlace | null;
  /** Lo que se busca al empezar: el nombre del negocio. */
  defaultQuery: string;
  /** Zona principal donde se busca (para el texto de ayuda). */
  zoneName: string;
  /** Costo de una búsqueda (USD). */
  perSearch: number;
};

/** Paso único: encontrar el negocio en Google Maps y decir "este es el mío". */
export function MapPlacePicker({ businessId, current, defaultQuery, zoneName, perSearch }: Props) {
  const { t, lang } = useT();
  const [editing, setEditing] = useState(!current);
  const [query, setQuery] = useState(defaultQuery);
  const [found, setFound] = useState<MapCandidate[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();
  const one = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });
  const int = new Intl.NumberFormat(intlLocale(lang));
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 4 });

  const search = () =>
    startSearch(async () => {
      setMessage(null);
      const r = await findMapPlace(businessId, query);
      if (!r.ok) {
        setFound(null);
        setMessage({ ok: false, text: r.error });
        return;
      }
      // La opción cuya página web es la del negocio va primero.
      setFound([...r.candidates].sort((a, b) => Number(b.matchesWebsite) - Number(a.matchesWebsite)));
      if (!r.candidates.length)
        setMessage({ ok: false, text: t("Google Maps no mostró negocios con ese nombre en tu zona. Prueba con otro nombre o como lo escriben tus clientes.", "Google Maps showed no businesses with that name in your area. Try another name or how your customers write it.") });
    });

  const pick = (c: MapCandidate) =>
    startSave(async () => {
      const r = await saveMapPlace(businessId, c);
      setMessage({ ok: r.ok, text: r.message });
      if (r.ok) {
        setEditing(false);
        setFound(null);
      }
    });

  const stars = (p: MapPlace) =>
    p.rating !== null ? (
      <span className="small">
        ★ {one.format(p.rating)}
        {p.reviews !== null && <span className="muted"> ({t(`${int.format(p.reviews)} reseñas`, `${int.format(p.reviews)} reviews`)})</span>}
      </span>
    ) : (
      <span className="small muted">{t("Sin reseñas", "No reviews")}</span>
    );

  if (!editing && current) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="mr-place">
          <span className="mr-place-pin" aria-hidden="true">📍</span>
          <div className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
            <strong>{current.title}</strong>
            {current.address && <span className="small muted">{current.address}</span>}
            {stars(current)}
          </div>
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            {t("Cambiar", "Change")}
          </button>
        </div>
        {message && <p className={message.ok ? "note ok" : "note error"} role="status">{message.text}</p>}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="stack" style={{ gap: 4 }}>
        <span className="lbl">{current ? t("Cambiar tu negocio en Google Maps", "Change your business on Google Maps") : t("Primero, encuentra tu negocio en Google Maps", "First, find your business on Google Maps")}</span>
        <span className="small muted">
          {t(
            `Escribe el nombre como sale en Google Maps. Buscamos en ${zoneName} (cuesta ${money.format(perSearch)}). Se hace una sola vez.`,
            `Type the name as it shows on Google Maps. We search in ${zoneName} (costs ${money.format(perSearch)}). You only do this once.`,
          )}
        </span>
      </div>
      <div className="wr-start">
        <input
          className="field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          maxLength={80}
          placeholder={t("Nombre de tu negocio", "Your business name")}
          aria-label={t("Nombre de tu negocio en Google Maps", "Your business name on Google Maps")}
        />
        <button type="button" className="btn on" onClick={search} disabled={searching || query.trim().length < 2}>
          {searching ? t("Buscando…", "Searching…") : t("Buscar en Google Maps", "Search Google Maps")}
        </button>
        {current && (
          <button type="button" className="btn link" onClick={() => setEditing(false)} disabled={searching || saving}>
            {t("Cancelar", "Cancel")}
          </button>
        )}
      </div>
      {message && <p className={message.ok ? "note ok" : "note error"} role="status">{message.text}</p>}
      {found && found.length > 0 && (
        <>
          <span className="small muted">{t("¿Cuál es tu negocio?", "Which one is your business?")}</span>
          <div className="mr-cands">
            {found.map((c) => (
              <div key={`${c.cid}-${c.rank}`} className={`mr-cand${c.matchesWebsite ? " on" : ""}`}>
                <div className="stack" style={{ gap: 2 }}>
                  <strong>{c.title}</strong>
                  {c.category && <span className="small muted">{c.category}</span>}
                </div>
                {c.address && <span className="small">{c.address}</span>}
                {stars(c)}
                {c.domain && <span className="small muted mr-wrap">{c.domain}</span>}
                {c.matchesWebsite && <span className="tag" style={{ alignSelf: "flex-start" }}>{t("Tiene tu página web", "Has your website")}</span>}
                <button type="button" className={c.matchesWebsite ? "btn on" : "btn outline"} onClick={() => pick(c)} disabled={saving}>
                  {t("Este es mi negocio", "This is my business")}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
