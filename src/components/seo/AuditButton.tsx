"use client";

import { useActionState, useEffect, useState } from "react";
import type { AuditResult } from "@/app/actions-seo-audit";
import { useT } from "@/components/I18n";

type Props = {
  action: (prev: AuditResult, f: FormData) => Promise<AuditResult>;
  /** Ya hay un reporte guardado. */
  has: boolean;
  /** Cuántas páginas se revisan como máximo. */
  maxPages?: number;
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
    [0, t("Leyendo tus páginas…", "Reading your pages…")],
    [15, t("Midiendo la velocidad con Google…", "Measuring speed with Google…")],
    [35, t("Revisando datos para Google, archivos para IAs y páginas viejas…", "Checking data for Google, AI files and old pages…")],
    [70, t("Probando enlaces y fotos, y buscando problemas…", "Testing links and images, and looking for problems…")],
  ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · {t("Puede tardar de 1 a 3 minutos. No cierres esta página.", "It can take 1 to 3 minutes. Don't close this page.")}
      </p>
    </div>
  );
}

export function AuditButton({ action, has, maxPages = 60 }: Props) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 12 }}>
      {!pending && (
        <div className="row">
          <button type="submit" className="btn ai">
            {has ? t("Volver a revisar", "Check again") : t("Revisar mi página", "Check my website")}
          </button>
          <span className="small muted">{t(`Gratis. Revisa hasta ${maxPages} páginas.`, `Free. Checks up to ${maxPages} pages.`)}</span>
        </div>
      )}
      <Working pending={pending} />
      {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}
