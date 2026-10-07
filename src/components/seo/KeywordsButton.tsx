"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { trackKeyword, type KeywordsResult } from "@/app/actions-seo-keywords";
import { useT } from "@/components/I18n";

type Props = {
  action: (prev: KeywordsResult, f: FormData) => Promise<KeywordsResult>;
  /** Cuántas zonas se van a medir (una llamada de volúmenes por zona). */
  zones?: number;
  /** Costo estimado en USD (keywordsCostEstimate). */
  estimate?: number;
};

/** Mientras se consulta a Google Ads: pasos aproximados y el tiempo que lleva. */
function Working({ pending, zones }: { pending: boolean; zones: number }) {
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
      zones > 1
        ? t(`Pidiendo a Google Ads cuánta gente busca cada palabra en tus ${zones} zonas…`, `Asking Google Ads how many people search each keyword in your ${zones} areas…`)
        : t("Pidiendo a Google Ads cuánta gente busca cada palabra…", "Asking Google Ads how many people search each keyword…"),
    ],
    [10, t("Buscando ideas de palabras nuevas…", "Looking for new keyword ideas…")],
    [Math.max(30, zones * 10), t("Guardando los reportes…", "Saving the reports…")],
  ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} ·{" "}
        {zones > 2
          ? t("Puede tardar uno o dos minutos. No cierres esta página.", "It can take a minute or two. Don't close this page.")
          : t("Suele tardar menos de un minuto. No cierres esta página.", "It usually takes less than a minute. Don't close this page.")}
      </p>
    </div>
  );
}

/** Botón para traer las búsquedas reales (cuesta unos centavos de DataForSEO). */
export function KeywordsButton({ action, zones = 1, estimate = 0.15 }: Props) {
  const { t, lang } = useT();
  const cost = new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(estimate);
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 12 }}>
      {!pending && (
        <div className="row">
          <button type="submit" className="btn ai">{t("Actualizar búsquedas", "Update searches")}</button>
          <span className="small muted">
            {zones > 1
              ? t(`Usa unos ${cost} de tu saldo de DataForSEO (${zones} zonas + ideas en la principal).`, `Uses about ${cost} of your DataForSEO balance (${zones} areas + ideas in the main one).`)
              : t(`Usa unos ${cost} de tu saldo de DataForSEO.`, `Uses about ${cost} of your DataForSEO balance.`)}
          </span>
        </div>
      )}
      <Working pending={pending} zones={zones} />
      {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}

/** "+ Seguir": agrega una idea a las palabras clave que sigue el negocio. */
export function FollowButton({ businessId, keyword, full }: { businessId: string; keyword: string; full: boolean }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <span className="stack" style={{ gap: 2, alignItems: "flex-start" }}>
      <button
        type="button"
        className="btn link"
        style={{ minHeight: 0, padding: 0, whiteSpace: "nowrap" }}
        disabled={pending || full}
        title={full ? t("Ya sigues 25 palabras clave. Quita alguna en la pestaña «⚙ Ajustes».", "You already track 25 keywords. Remove one in the “⚙ Settings” tab.") : undefined}
        onClick={() =>
          start(async () => {
            setError("");
            const r = await trackKeyword(businessId, keyword);
            if (!r.ok) setError(r.message);
          })
        }
      >
        {pending ? t("Agregando…", "Adding…") : t("+ Seguir", "+ Track")}
      </button>
      {error && <span className="small kw-error" role="alert">{error}</span>}
    </span>
  );
}
