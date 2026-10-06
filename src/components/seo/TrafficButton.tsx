"use client";

import { useActionState, useEffect, useState } from "react";
import type { TrafficResult } from "@/app/actions-seo-traffic";
import { useT } from "@/components/I18n";

type Props = {
  action: (prev: TrafficResult, f: FormData) => Promise<TrafficResult>;
  /** Ya hay un reporte guardado. */
  has: boolean;
  /** Cuántos competidores se revisan (0 = solo tu página). */
  competitors: number;
  /** Costo máximo estimado en USD (trafficCostEstimate). */
  estimate: number;
};

/** Mientras se revisa: pasos aproximados y el tiempo que lleva. */
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
      competitors === 0
        ? t("Buscando cuántas visitas recibe tu página desde Google…", "Looking up how many visits your website gets from Google…")
        : t(`Buscando cuántas visitas reciben tu página y la de tus ${competitors === 1 ? "competidor" : `${competitors} competidores`}…`, `Looking up how many visits your website and your ${competitors === 1 ? "competitor" : `${competitors} competitors`} get…`),
    ],
    [5, t("Leyendo el historial de los últimos 12 meses…", "Reading the history for the last 12 months…")],
    ...(competitors ? ([[12, t("Buscando sus páginas que más clientes les traen…", "Finding their pages that bring them the most customers…")]] as [number, string][]) : []),
  ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · {t("Suele tardar menos de 30 segundos. No cierres esta página.", "It usually takes less than 30 seconds. Don't close this page.")}
      </p>
    </div>
  );
}

/** Botón para revisar (o actualizar) las visitas de tu página y de tu competencia. */
export function TrafficButton({ action, has, competitors, estimate }: Props) {
  const { t, lang } = useT();
  const cost = new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(estimate);
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 12 }}>
      <div className="row" style={pending ? { display: "none" } : undefined}>
        <button type="submit" className="btn ai" disabled={pending}>
          {has ? t("Actualizar visitas", "Update visits") : t("Revisar visitas", "Check visits")}
        </button>
        <span className="small muted">{t(`Cuesta hasta unos ${cost} de tu saldo de DataForSEO.`, `Costs up to about ${cost} of your DataForSEO balance.`)}</span>
      </div>
      <Working pending={pending} competitors={competitors} />
      {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}
