"use client";

import { useActionState, useEffect, useState } from "react";
import type { DecayResult } from "@/app/actions-seo-decay";
import { useT } from "@/components/I18n";

type Props = {
  action: (prev: DecayResult, f: FormData) => Promise<DecayResult>;
  /** Ya hay una revisión guardada. */
  has: boolean;
};

/** Mientras se revisa: pasos aproximados y el tiempo que lleva. */
function Working({ pending }: { pending: boolean }) {
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
    [0, t("Trayendo tus visitas de Google de los últimos 28 días…", "Getting your Google visits from the last 28 days…")],
    [3, t("Comparando con el mes anterior y con hace 3 meses…", "Comparing with the previous month and with 3 months ago…")],
    [7, t("Buscando el motivo de cada baja…", "Finding the reason for each drop…")],
  ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · {t("Suele tardar unos segundos. No cierres esta página.", "It usually takes a few seconds. Don't close this page.")}
      </p>
    </div>
  );
}

/** "Revisar mis páginas": compara tus visitas de Search Console (gratis). */
export function DecayButton({ action, has }: Props) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 12 }}>
      <div className="row" style={pending ? { display: "none" } : undefined}>
        <button type="submit" className="btn ai">
          {has ? t("Revisar de nuevo", "Check again") : t("Revisar mis páginas", "Check my pages")}
        </button>
        <span className="small muted">{t("Gratis: usa tus datos de Search Console.", "Free: it uses your Search Console data.")}</span>
      </div>
      <Working pending={pending} />
      {result && !pending && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
          {result.needsGsc && (
            <>
              {" "}
              <a href="#search-console">{t("Ir a Search Console", "Go to Search Console")}</a>
            </>
          )}
        </p>
      )}
    </form>
  );
}
