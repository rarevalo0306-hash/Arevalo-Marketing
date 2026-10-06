"use client";

import { useActionState } from "react";
import type { CannibalResult } from "@/app/actions-seo-cannibal";
import { useT } from "@/components/I18n";

/** "Revisar de nuevo": guarda una foto de la revisión (no cuesta nada, no llama a Google). */
export function CannibalButton({ action }: { action: (prev: CannibalResult, f: FormData) => Promise<CannibalResult> }) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 8 }}>
      <div className="row">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? t("Revisando…", "Checking…") : t("Revisar de nuevo", "Check again")}
        </button>
        <span className="small muted" style={pending ? { display: "none" } : undefined}>
          {t("Gratis: usa los datos que ya tienes guardados.", "Free: it uses the data you already have saved.")}
        </span>
      </div>
      {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}
