"use client";

import { useActionState, useEffect, useState } from "react";
import type { ToxicResult } from "@/app/actions-toxic";
import { useT } from "@/components/I18n";
import s from "./Toxic.module.css";

type Props = {
  action: (prev: ToxicResult, f: FormData) => Promise<ToxicResult>;
  /** Texto del botón. */
  label: string;
  /** Costo máximo estimado en USD (se muestra antes de gastar). */
  estimate: number;
  /** Botón destacado (primera vez) o normal (actualizar). */
  strong?: boolean;
  /** Qué se va haciendo mientras tanto. */
  steps: string[];
};

/** Un botón que gasta saldo de DataForSEO: muestra el costo antes, el avance mientras tanto y el resultado. */
export function ToxicCheckButton({ action, label, estimate, strong, steps }: Props) {
  const { t, lang } = useT();
  const cost = new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(estimate);
  const [result, run, pending] = useActionState(action, null);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  const now = Math.min(steps.length - 1, Math.floor(seconds / 4));
  return (
    <form action={run} className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ display: pending ? "none" : undefined }}>
        <button type="submit" className={`${strong ? "btn ai" : "btn outline"} ${s.wrapBtn}`}>
          {label}
        </button>
        <span className="small muted">{t(`Cuesta hasta unos ${cost} de tu saldo de DataForSEO.`, `Costs up to about ${cost} of your DataForSEO balance.`)}</span>
      </div>
      {pending && (
        <div className="stack" style={{ gap: 10 }} aria-live="polite">
          <ul className="magic-steps">
            {steps.map((label, i) => (
              <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>
                {label}
              </li>
            ))}
          </ul>
          <p className="small muted">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · {t("Suele tardar menos de un minuto. No cierres esta página.", "It usually takes less than a minute. Don't close this page.")}
          </p>
        </div>
      )}
      {result && !pending && (
        <p className={result.ok ? "note ok" : result.locked ? "note" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}
