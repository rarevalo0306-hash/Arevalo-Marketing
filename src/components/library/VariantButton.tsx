"use client";

// «Crear otra versión» de una foto hecha con IA: mismo tema y estilo, otro ángulo (para no repetir la misma foto).
import { useActionState } from "react";
import { makePhotoVariant, type VariantResult } from "@/app/actions-library";
import { useT } from "@/components/I18n";
import s from "./Library.module.css";

export function VariantButton({ businessId, itemId, cents }: { businessId: string; itemId: string; cents: number }) {
  const { t } = useT();
  const [result, action, isPending] = useActionState<VariantResult, FormData>(() => makePhotoVariant(businessId, itemId), null);
  const price = (cents / 100).toFixed(2);
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <button type="submit" className="btn outline" disabled={isPending}>
        {isPending ? t("Creando otra versión…", "Making another version…") : t(`Crear otra versión (≈ US$${price})`, `Make another version (≈ US$${price})`)}
      </button>
      {isPending && (
        <p className={s.pending} role="status">
          <span className={s.spinner} aria-hidden="true" /> {t("La IA está haciendo la foto (unos segundos).", "The AI is making the photo (a few seconds).")}
        </p>
      )}
      {result && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}
