"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { trackKeyword, type KeywordsResult } from "@/app/actions-seo-keywords";
import { useT } from "@/components/I18n";

type Props = {
  action: (prev: KeywordsResult, f: FormData) => Promise<KeywordsResult>;
};

/** Mientras se consulta a Google Ads: pasos aproximados y el tiempo que lleva. */
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
    [0, t("Pidiendo a Google Ads cuánta gente busca cada palabra…", "Asking Google Ads how many people search each keyword…")],
    [10, t("Buscando ideas de palabras nuevas…", "Looking for new keyword ideas…")],
    [30, t("Guardando el reporte…", "Saving the report…")],
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

/** Botón para traer las búsquedas reales (cuesta unos centavos de DataForSEO). */
export function KeywordsButton({ action }: Props) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 12 }}>
      {!pending && (
        <div className="row">
          <button type="submit" className="btn ai">{t("Actualizar búsquedas", "Update searches")}</button>
          <span className="small muted">{t("Usa unos $0.15 de tu saldo de DataForSEO.", "Uses about $0.15 of your DataForSEO balance.")}</span>
        </div>
      )}
      <Working pending={pending} />
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
        title={full ? t("Ya sigues 25 palabras clave. Quita alguna en el panel de arriba.", "You already track 25 keywords. Remove one in the panel above.") : undefined}
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
