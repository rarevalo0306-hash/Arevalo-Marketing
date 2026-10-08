"use client";

import { useActionState, useState } from "react";
import type { StopActionResult } from "@/app/actions-campaign";
import { useT } from "@/components/I18n";
import s from "./Campaign.module.css";

/**
 * Botón rojo «Parar» / «Parar todo» con confirmación en la misma pantalla (sin ventanas del navegador).
 * `question`: lo que se pregunta antes de parar, en palabras sencillas.
 */
export function StopButton({
  action,
  label,
  question,
  big,
}: {
  action: (prev: StopActionResult) => Promise<StopActionResult>;
  label: string;
  question: string;
  big?: boolean;
}) {
  const { t } = useT();
  const [asking, setAsking] = useState(false);
  const [result, run, isPending] = useActionState(action, null);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {!asking && (
        <div>
          <button type="button" className={`${s.stop} ${big ? s.big : ""}`} onClick={() => setAsking(true)} disabled={isPending}>
            <span aria-hidden="true">■</span> {label}
          </button>
        </div>
      )}
      {asking && (
        <div className={s.confirm} role="alertdialog" aria-label={label}>
          <p>{question}</p>
          <form
            action={() => {
              setAsking(false);
              run();
            }}
            className="row"
          >
            <button type="submit" className={s.stop} disabled={isPending}>
              {t("Sí, parar ahora", "Yes, stop now")}
            </button>
            <button type="button" className="btn" onClick={() => setAsking(false)}>
              {t("No, volver", "No, go back")}
            </button>
          </form>
        </div>
      )}
      {isPending && <p className="small muted" role="status">{t("Parando…", "Stopping…")}</p>}
      {!isPending && result && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </div>
  );
}
