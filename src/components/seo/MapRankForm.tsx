"use client";

import { useActionState, useEffect, useState } from "react";
import type { MapRankResult } from "@/app/actions-seo-maprank";
import { useT } from "@/components/I18n";
import { intlLocale } from "@/lib/i18n";
import { MAP_SIZES, MAP_SPACINGS, mapCostEstimate } from "@/lib/seo/maprank-shared";

type Props = {
  action: (prev: MapRankResult, f: FormData) => Promise<MapRankResult>;
  /** Palabras clave que sigue el negocio. */
  keywords: string[];
  /** La del último mapa (para empezar con la misma). */
  lastKeyword?: string;
  lastSize?: number;
  lastSpacing?: number;
  has: boolean;
};

function Working({ pending, points }: { pending: boolean; points: number }) {
  const { t } = useT();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  if (!pending) return null;
  // 8 búsquedas a la vez, unos 5 segundos cada tanda.
  const rounds = Math.ceil(points / 8);
  const steps: [number, string][] = [
    [0, t(`Buscando en Google Maps desde ${points} puntos alrededor de tu negocio…`, `Searching Google Maps from ${points} points around your business…`)],
    [Math.max(6, rounds * 3), t("Buscando tu negocio en cada punto…", "Finding your business at each point…")],
    [Math.max(12, rounds * 5), t("Viendo quién te gana en cada zona…", "Seeing who beats you in each area…")],
  ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} ·{" "}
        {points > 25
          ? t("Suele tardar alrededor de un minuto. No cierres esta página.", "It usually takes about a minute. Don't close this page.")
          : t("Suele tardar menos de un minuto. No cierres esta página.", "It usually takes less than a minute. Don't close this page.")}
      </p>
    </div>
  );
}

/** Elegir palabra clave, tamaño y distancia, y hacer el mapa. */
export function MapRankForm({ action, keywords, lastKeyword, lastSize, lastSpacing, has }: Props) {
  const { t, lang } = useT();
  const [result, run, pending] = useActionState(action, null);
  const startKeyword = lastKeyword && keywords.includes(lastKeyword) ? lastKeyword : keywords.length ? keywords[0] : "__custom";
  const [keyword, setKeyword] = useState(startKeyword);
  const [custom, setCustom] = useState(lastKeyword && !keywords.includes(lastKeyword) ? lastKeyword : "");
  const [size, setSize] = useState<number>(lastSize && (MAP_SIZES as readonly number[]).includes(lastSize) ? lastSize : 5);
  const [spacing, setSpacing] = useState<number>(lastSpacing && (MAP_SPACINGS as readonly number[]).includes(lastSpacing) ? lastSpacing : 1);
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  const km = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });
  const points = size * size;
  const width = (size - 1) * spacing;
  const ready = keyword !== "__custom" || custom.trim().length >= 2;

  return (
    <form action={run} className="stack" style={{ gap: 14 }}>
      <div className="mr-form">
        <label className="stack" style={{ gap: 6 }}>
          <span className="lbl">{t("Palabra clave", "Keyword")}</span>
          <select name="keyword" className="field" value={keyword} onChange={(e) => setKeyword(e.target.value)} disabled={pending}>
            {keywords.map((k) => <option key={k} value={k}>{k}</option>)}
            <option value="__custom">{t("Otra palabra…", "Another keyword…")}</option>
          </select>
        </label>
        {keyword === "__custom" && (
          <label className="stack" style={{ gap: 6 }}>
            <span className="lbl">{t("Escribe la palabra clave", "Type the keyword")}</span>
            <input
              name="customKeyword"
              className="field"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              maxLength={80}
              placeholder={t("Ej.: cortinas metálicas", "E.g.: roll-up doors")}
              disabled={pending}
            />
          </label>
        )}
        <label className="stack" style={{ gap: 6 }}>
          <span className="lbl">{t("Tamaño del mapa", "Map size")}</span>
          <select name="size" className="field" value={size} onChange={(e) => setSize(Number(e.target.value))} disabled={pending}>
            {MAP_SIZES.map((s) => (
              <option key={s} value={s}>
                {t(`${s}×${s} = ${s * s} búsquedas`, `${s}×${s} = ${s * s} searches`)}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 6 }}>
          <span className="lbl">{t("Distancia entre puntos", "Distance between points")}</span>
          <select name="spacing" className="field" value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} disabled={pending}>
            {MAP_SPACINGS.map((s) => <option key={s} value={s}>{km.format(s)} km</option>)}
          </select>
        </label>
      </div>
      {!pending && (
        <div className="row">
          <button type="submit" className="btn ai" disabled={!ready}>
            {has ? t("Hacer otro mapa", "Make another map") : t("Hacer mi mapa", "Make my map")}
          </button>
          <span className="small muted">
            {t(
              `Cubre unos ${km.format(width)} × ${km.format(width)} km alrededor de tu negocio. Cuesta ≈ ${money.format(mapCostEstimate(size))} (${points} búsquedas × ${money.format(mapCostEstimate(1))}) de tu saldo de DataForSEO.`,
              `Covers about ${km.format(width)} × ${km.format(width)} km around your business. Costs ≈ ${money.format(mapCostEstimate(size))} (${points} searches × ${money.format(mapCostEstimate(1))}) from your DataForSEO balance.`,
            )}
          </span>
        </div>
      )}
      <Working pending={pending} points={points} />
      {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}
