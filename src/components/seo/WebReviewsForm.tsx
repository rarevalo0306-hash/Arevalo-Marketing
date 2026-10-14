"use client";

import { useActionState } from "react";
import type { WebReviewsResult } from "@/app/actions-seo-web-reviews";
import { useT } from "@/components/I18n";

/** «Traer reseñas» con el enlace (opcional) de la ficha de Tripadvisor. */
export function WebReviewsForm({ action, tripadvisor, has }: { action: (prev: WebReviewsResult, f: FormData) => Promise<WebReviewsResult>; tripadvisor: string; has: boolean }) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 8 }}>
      <details>
        <summary className="btn link" style={{ display: "inline-flex", padding: 0 }}>
          {t("¿Tienes ficha en Tripadvisor? (restaurantes, hoteles, tours)", "Do you have a Tripadvisor listing? (restaurants, hotels, tours)")}
        </summary>
        <label className="stack" style={{ gap: 4, marginTop: 8 }}>
          <span className="lbl">{t("Enlace de tu página en Tripadvisor", "Your Tripadvisor page link")}</span>
          <input name="tripadvisor" className="field" type="url" defaultValue={tripadvisor} placeholder="https://www.tripadvisor.com/Restaurant_Review-…html" maxLength={500} disabled={pending} />
        </label>
      </details>
      <div className="row">
        <button type="submit" className="btn ai" disabled={pending}>
          {pending ? t("Trayendo reseñas…", "Getting reviews…") : has ? t("Actualizar reseñas", "Update reviews") : t("Traer reseñas", "Get reviews")}
        </button>
        <span className="small muted">
          {pending
            ? t("Puede tardar hasta 2 minutos. No cierres esta página.", "It can take up to 2 minutes. Don't close this page.")
            : t("Cuesta unos centavos de tu saldo de DataForSEO (el costo real queda anotado).", "Costs a few cents from your DataForSEO balance (the real cost is recorded).")}
        </span>
      </div>
      {result && !pending && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}
