"use client";

import { useActionState, useEffect, useState } from "react";
import type { BacklinksResult } from "@/app/actions-seo-backlinks";
import { useT } from "@/components/I18n";

type Props = {
  action: (prev: BacklinksResult, f: FormData) => Promise<BacklinksResult>;
  /** Ya hay un reporte guardado. */
  has: boolean;
  /** Cuántos competidores se comparan (0 = solo tu página). */
  competitors: number;
  /** Costo máximo estimado en USD (backlinksCostEstimate). */
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
    [0, t("Contando los enlaces hacia tu página…", "Counting the links to your website…")],
    [3, t("Viendo qué sitios te enlazan…", "Checking which sites link to you…")],
  ];
  if (competitors > 0) {
    steps.push([7, t("Comparando con tu competencia…", "Comparing with your competitors…")]);
    steps.push([13, t("Buscando dónde consiguen enlaces ellos y tú no…", "Finding where they get links and you don't…")]);
  }
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

/** Botón "Revisar mis enlaces" (o Actualizar) con el costo estimado y el avance. */
export function BacklinksButton({ action, has, competitors, estimate }: Props) {
  const { t, lang } = useT();
  const cost = new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(estimate);
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ display: pending ? "none" : undefined }}>
        <button type="submit" className="btn ai">
          {has ? t("Actualizar", "Update") : t("Revisar mis enlaces", "Check my links")}
        </button>
        <span className="small muted">
          {t(`Cuesta hasta unos ${cost} de tu saldo de DataForSEO.`, `Costs up to about ${cost} of your DataForSEO balance.`)}
        </span>
      </div>
      <Working pending={pending} competitors={competitors} />
      {result && !pending && <p className={result.ok ? "note ok" : result.locked ? "note" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}
