"use client";

import { useActionState, useEffect, useState } from "react";
import type { GapResult } from "@/app/actions-seo-gap";
import { useT } from "@/components/I18n";

type Props = {
  action: (prev: GapResult, f: FormData) => Promise<GapResult>;
  /** Ya hay un reporte guardado. */
  has: boolean;
  /** Cuántos competidores se comparan. */
  competitors: number;
  /** Costo máximo estimado en USD (gapCostEstimate). */
  estimate: number;
};

/** Mientras se compara: pasos aproximados y el tiempo que lleva. */
function Working({ pending, competitors }: { pending: boolean; competitors: number }) {
  const { t } = useT();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  if (!pending) return null;
  const steps: [number, string][] = [
    [
      0,
      competitors === 1
        ? t("Buscando las palabras de tu competidor que tú no tienes…", "Finding your competitor's keywords that you don't have…")
        : t(`Buscando las palabras de tus ${competitors} competidores que tú no tienes…`, `Finding your ${competitors} competitors' keywords that you don't have…`),
    ],
    [8, t("Revisando dónde ellos salen más arriba que tú…", "Checking where they rank above you…")],
    [18, t("Ordenando las mejores oportunidades…", "Sorting the best opportunities…")],
  ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · {t("Suele tardar menos de un minuto. No cierres esta página.", "It usually takes less than a minute. Don't close this page.")}
      </p>
    </div>
  );
}

/** Botón para buscar (o actualizar) las palabras que tu competencia tiene y tú no. */
export function GapButton({ action, has, competitors, estimate }: Props) {
  const { t, lang } = useT();
  const cost = new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(estimate);
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 12 }}>
      {!pending && (
        <div className="row">
          <button type="submit" className="btn ai">
            {has ? t("Actualizar", "Update") : t("Buscar palabras que me faltan", "Find the keywords I'm missing")}
          </button>
          <span className="small muted">
            {t(`Cuesta hasta unos ${cost} de tu saldo de DataForSEO.`, `Costs up to about ${cost} of your DataForSEO balance.`)}
          </span>
        </div>
      )}
      <Working pending={pending} competitors={competitors} />
      {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}
