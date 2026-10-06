"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import type { GscResult } from "@/app/actions-seo-gsc";
import { useT } from "@/components/I18n";

/** "Actualizar datos": vuelve a pedir los últimos 28 días a Search Console. */
export function SearchConsoleButton({ action }: { action: (prev: GscResult, f: FormData) => Promise<GscResult> }) {
  const { t } = useT();
  const [result, run, isPending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 10 }}>
      <div>
        <button type="submit" className="btn on" disabled={isPending}>
          {isPending ? t("Consultando a Google…", "Asking Google…") : t("Actualizar datos", "Refresh data")}
        </button>
      </div>
      {result && !isPending && (
        <p className={result.ok ? "note ok" : "note error"} role={result.ok ? "status" : "alert"}>
          {result.message}
        </p>
      )}
    </form>
  );
}

/** Aviso al volver de Google (?gsc=ok o ?gsc=error&msg=…). */
export function SearchConsoleNotice() {
  const { t } = useT();
  const q = useSearchParams();
  const status = q.get("gsc");
  if (status === "ok")
    return <p className="note ok" role="status">{t("Listo: Search Console quedó conectado.", "Done: Search Console is now connected.")}</p>;
  if (status === "error")
    return (
      <p className="note error" role="alert">
        {(q.get("msg") ?? "").slice(0, 400) || t("No se pudo conectar Search Console.", "Couldn't connect Search Console.")}
      </p>
    );
  return null;
}
