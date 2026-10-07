"use client";

import { useEffect, useState, useTransition } from "react";
import type { TemplatesResult } from "@/app/actions";
import { useT } from "@/components/I18n";
import { onBrandSaved } from "@/lib/brand-events";

/**
 * Las plantillas salen de la marca: al guardar cambios de colores, letras o logo, la IA propone plantillas nuevas
 * sola. El botón queda para pedir otras.
 */
export function TemplatesAuto({ businessId, propose, has }: { businessId: string; propose: () => Promise<TemplatesResult>; has: boolean }) {
  const { t } = useT();
  const [result, setResult] = useState<TemplatesResult>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      try {
        setResult(await propose());
      } catch {
        setResult({ ok: false, message: t("No se pudo conectar. Revisa tu internet e intenta de nuevo.", "Couldn't connect. Check your internet and try again.") });
      }
    });

  // Sin lista de dependencias a propósito: así el aviso siempre usa la versión más nueva de `run`.
  useEffect(() => onBrandSaved((d) => {
    if (d.businessId === businessId && d.visual) run();
  }));

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div>
        <button type="button" className="btn ai" disabled={pending} onClick={run}>
          {pending
            ? t("La IA está diseñando tus plantillas… (unos segundos)", "The AI is designing your templates… (a few seconds)")
            : has
              ? t("✦ Proponer otras plantillas", "✦ Suggest other templates")
              : t("✦ Proponer plantillas con mi marca", "✦ Suggest templates with my brand")}
        </button>
      </div>
      {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </div>
  );
}
