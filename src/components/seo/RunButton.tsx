"use client";

import { useActionState } from "react";
import { useT } from "@/components/I18n";

export type RunResult = { ok: boolean; message: string } | null;

type Props = {
  action: (prev: RunResult, f: FormData) => Promise<RunResult>;
  /** El texto del botón. */
  label: string;
  /** Mientras trabaja ("Buscando…"). */
  busy: string;
  /** Al lado del botón: lo que cuesta o de dónde salen los datos. */
  note?: string;
  /** Botón de IA (morado) en vez del normal. */
  ai?: boolean;
};

/** Un botón que corre una acción del servidor y muestra el resultado (para las herramientas de SEO de un solo paso). */
export function RunButton({ action, label, busy, note, ai }: Props) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 8 }}>
      <div className="row">
        <button type="submit" className={`btn${ai ? " ai" : ""}`} disabled={pending}>
          {pending ? busy : label}
        </button>
        {note && (
          <span className="small muted" style={pending ? { display: "none" } : undefined}>
            {note}
          </span>
        )}
        {pending && <span className="small muted">{t("No cierres esta página.", "Don't close this page.")}</span>}
      </div>
      {result && !pending && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}
