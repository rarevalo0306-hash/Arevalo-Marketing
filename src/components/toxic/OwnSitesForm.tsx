"use client";

import { useActionState } from "react";
import type { ToxicResult } from "@/app/actions-toxic";
import { useT } from "@/components/I18n";

/** Tus otros sitios y los de tus socios: nunca se marcan como dañinos ni entran al archivo. */
export function OwnSitesForm({ action, sites }: { action: (prev: ToxicResult, f: FormData) => Promise<ToxicResult>; sites: string[] }) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 8 }}>
      <label className="stack" style={{ gap: 4 }}>
        <span className="small muted">
          {t("Escribe sus direcciones separadas por comas o una por línea.", "Write their addresses separated by commas or one per line.")}
        </span>
        <textarea name="sites" className="field" style={{ minHeight: 80 }} defaultValue={sites.join("\n")} placeholder={"miotrositio.com\nsocio.com.ni"} spellCheck={false} />
      </label>
      <div className="row" style={{ display: pending ? "none" : undefined }}>
        <button type="submit" className="btn outline">
          {t("Guardar", "Save")}
        </button>
      </div>
      {pending && <p className="small muted">{t("Guardando…", "Saving…")}</p>}
      {result && !pending && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}
