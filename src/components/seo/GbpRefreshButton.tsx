"use client";

import { useActionState, useEffect, useState } from "react";
import type { GbpResult } from "@/app/actions-seo-gbp";
import { useT } from "@/components/I18n";
import { intlLocale } from "@/lib/i18n";

type Props = {
  action: (prev: GbpResult, f: FormData) => Promise<GbpResult>;
  /** "profile" = perfil + competidores (~10 s); "reviews" = reseñas en la cola de Google (10-60 s, hasta 2 min). */
  kind: "profile" | "reviews";
  label: string;
  /** Costo estimado en USD (0 = no se cobra otra vez). */
  estimate: number;
  /** Competidores que se van a revisar (solo perfil). */
  competitors?: number;
  /** Botón principal (cuando todavía no hay datos). */
  primary?: boolean;
};

function Working({ pending, kind, competitors }: { pending: boolean; kind: Props["kind"]; competitors: number }) {
  const { t } = useT();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  const steps: [number, string][] =
    kind === "profile"
      ? [
          [0, t("Pidiendo tu perfil a Google Maps…", "Asking Google Maps for your profile…")],
          ...(competitors
            ? ([[2, t(`Revisando el perfil de ${competitors} ${competitors === 1 ? "competidor" : "competidores"}…`, `Checking ${competitors} ${competitors === 1 ? "competitor's profile" : "competitors' profiles"}…`)]] as [number, string][])
            : []),
          [8, t("Armando tu lista de pendientes…", "Building your to-do list…")],
        ]
      : [
          [0, t("Pidiendo tus reseñas a Google…", "Asking Google for your reviews…")],
          [6, t("Google las está juntando (suele tardar menos de un minuto)…", "Google is gathering them (usually under a minute)…")],
          [60, t("Sigue juntándolas, ya casi…", "Still gathering, almost there…")],
        ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12, display: pending ? undefined : "none" }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => (
          <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>
            {label}
          </li>
        ))}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} ·{" "}
        {kind === "profile"
          ? t("Suele tardar menos de 20 segundos. No cierres esta página.", "It usually takes less than 20 seconds. Don't close this page.")
          : t("Puede tardar hasta 2 minutos. No cierres esta página.", "It can take up to 2 minutes. Don't close this page.")}
      </p>
    </div>
  );
}

/** Botón para traer el perfil o las reseñas (cuesta centavos de DataForSEO), con pasos y reloj mientras trabaja. */
export function GbpRefreshButton({ action, kind, label, estimate, competitors = 0, primary }: Props) {
  const { t, lang } = useT();
  const [result, run, pending] = useActionState(action, null);
  const cost = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(estimate);
  return (
    <form action={run} className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ display: pending ? "none" : undefined }}>
        <button type="submit" className={primary ? "btn ai" : "btn outline"} disabled={pending}>
          {label}
        </button>
        <span className="small muted">
          {estimate > 0
            ? t(`Usa unos ${cost} de tu saldo de DataForSEO.`, `Uses about ${cost} of your DataForSEO balance.`)
            : t("No se cobra otra vez.", "You won't be charged again.")}
        </span>
      </div>
      <Working pending={pending} kind={kind} competitors={competitors} />
      {result && !pending && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}
