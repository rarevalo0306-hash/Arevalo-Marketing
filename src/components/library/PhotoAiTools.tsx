"use client";

// «Editar con IA» en una foto de «Tus fotos»: recortar (quitar el fondo), agrandar sin inventar y arreglar los errores
// de una foto hecha con IA. Cada una hace una foto nueva; la original no se toca.
import { useActionState } from "react";
import { cutoutLibraryPhoto, fixLibraryAiPhoto, upscaleLibraryPhoto, type VariantResult } from "@/app/actions-library";
import { useT } from "@/components/I18n";
import s from "./Library.module.css";

type Tool = "cutout" | "upscale" | "fix";
const RUN: Record<Tool, (businessId: string, itemId: string) => Promise<VariantResult>> = { cutout: cutoutLibraryPhoto, upscale: upscaleLibraryPhoto, fix: fixLibraryAiPhoto };

function ToolButton({ tool, businessId, itemId, cents }: { tool: Tool; businessId: string; itemId: string; cents: number }) {
  const { t } = useT();
  const [result, action, isPending] = useActionState<VariantResult, FormData>(() => RUN[tool](businessId, itemId), null);
  const price = (cents / 100).toFixed(2);
  const label = {
    cutout: t("Recortar (quitar el fondo)", "Cut out (remove the background)"),
    upscale: t("Agrandar sin inventar", "Enlarge without inventing"),
    fix: t("Revisar y arreglar errores", "Check and fix errors"),
  }[tool];
  const help = {
    cutout: t("Deja a la persona u objeto sin fondo (PNG transparente).", "Leaves the person or object without a background (transparent PNG)."),
    upscale: t("Al doble de tamaño para que no se vea borrosa. No inventa detalles.", "Twice the size so it doesn't look blurry. It doesn't invent details."),
    fix: t("Manos raras, letras mal escritas u objetos derretidos.", "Odd hands, misspelled letters or melted objects."),
  }[tool];
  return (
    <form action={action} className="stack" style={{ gap: 4 }}>
      <button type="submit" className="btn outline" disabled={isPending}>
        {isPending ? t("La IA está trabajando…", "The AI is working…") : `${label} (≈ US$${price})`}
      </button>
      <span className="small muted">{help}</span>
      {isPending && (
        <p className={s.pending} role="status">
          <span className={s.spinner} aria-hidden="true" /> {t("Unos segundos.", "A few seconds.")}
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

/** Las herramientas que valen para esta foto. Si ninguna vale (o no hay claves), no se muestra nada. */
export function PhotoAiTools({ businessId, itemId, tools }: { businessId: string; itemId: string; tools: { tool: Tool; cents: number }[] }) {
  const { t } = useT();
  if (!tools.length) return null;
  return (
    <details className={s.aiTools}>
      <summary>{t("✦ Editar con IA", "✦ Edit with AI")}</summary>
      <div className="stack" style={{ gap: 10, marginTop: 8 }}>
        {tools.map((x) => (
          <ToolButton key={x.tool} tool={x.tool} businessId={businessId} itemId={itemId} cents={x.cents} />
        ))}
        <span className="small muted">{t("Cada una hace una foto nueva en «Hechas con IA», marcada como editada con IA. La original no cambia.", "Each one makes a new photo in “Made with AI”, marked as edited with AI. The original doesn't change.")}</span>
      </div>
    </details>
  );
}
