"use client";

import { useState, useTransition } from "react";
import { trackKeyword } from "@/app/actions-seo-keywords";
import { useT } from "@/components/I18n";

/** "+ Seguir esta búsqueda": la agrega a las palabras clave del negocio (solo guarda; no gasta nada). */
export function TrackButton({ businessId, keyword }: { businessId: string; keyword: string }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ ok: boolean; message: string } | null>(null);
  if (done?.ok) return <span className="pill done">{t("Siguiendo: la revisamos en la próxima revisión", "Tracking: we'll check it next time")}</span>;
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              setDone(await trackKeyword(businessId, keyword));
            } catch {
              setDone({ ok: false, message: t("No se pudo guardar. Intenta de nuevo.", "Couldn't save. Try again.") });
            }
          })
        }
      >
        {pending ? t("Guardando…", "Saving…") : t("+ Seguir esta búsqueda", "+ Track this search")}
      </button>
      {done && !done.ok && (
        <span className="small" style={{ color: "var(--err-text)" }} role="status">
          {done.message}
        </span>
      )}
    </>
  );
}
