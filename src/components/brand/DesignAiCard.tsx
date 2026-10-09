"use client";

// Un diseño de la comparación: mientras se crea, una barra de avance; listo, el post de ejemplo ya armado (o el diseño
// vacío), con el modelo y el precio, y «Usar como plantilla», «Ajustar» y «Descartar».
import { useEffect, useState } from "react";
import { useT } from "@/components/I18n";
import type { MasterCandidate } from "@/lib/design-ai-run";
import s from "./DesignAi.module.css";

function Progress({ c }: { c: MasterCandidate }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.round((now - c.startedAt) / 1000));
  const pct = Math.min(95, Math.round((secs / Math.max(10, c.etaSec)) * 100));
  const left = Math.max(5, c.etaSec - secs);
  return (
    <div className={s.wait} role="status" aria-live="polite">
      <div className={s.bar} aria-hidden><span style={{ width: `${pct}%` }} /></div>
      <span className="small">
        {c.status === "storing" ? t("Guardando y buscando dónde va la foto…", "Saving and finding where the photo goes…") : secs > c.etaSec * 2 ? t("Está tardando más de lo normal…", "It's taking longer than usual…") : t(`Creando… unos ${left} s`, `Creating… about ${left} s`)}
      </span>
    </div>
  );
}

export function DesignAiCard({ c, preview, previewDone, shapeLabel, parentName, busy, onUse, onAdjust, onDiscard }: { c: MasterCandidate; preview?: string; previewDone: boolean; shapeLabel: string; parentName: string; busy: boolean; onUse: () => void; onAdjust: () => void; onDiscard: () => void }) {
  const { t } = useT();
  const [empty, setEmpty] = useState(false);
  const ratio = c.w && c.h ? `${c.w} / ${c.h}` : c.shape === "story" ? "9 / 16" : c.shape === "portrait" ? "4 / 5" : "1 / 1";
  const src = empty || !preview ? c.url : preview;
  return (
    <article className={s.card}>
      <div className={s.cardHead}>
        <strong>{c.source === "book" ? t(`Del manual · ${c.bookLabel ?? ""}`, `From brand book · ${c.bookLabel ?? ""}`) : c.modelName}</strong>
        <span className="small muted">{shapeLabel} · {c.usd ? `US$${c.usd.toFixed(2)}` : t("gratis", "free")}{c.source === "book" && c.modelName ? ` · ${c.modelName}` : ""}</span>
        {!!c.bookRefs && <span className="small muted">{t("Con el estilo de tu manual", "In your brand book's style")}</span>}
        {parentName && <span className="small muted">{t("Para:", "For:")} {parentName}</span>}
      </div>
      <div className={s.shot} style={{ aspectRatio: ratio }}>
        {c.status === "ready" && src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={empty || !preview ? t(`Diseño vacío de ${c.modelName}`, `Empty design by ${c.modelName}`) : t(`Post de ejemplo con el diseño de ${c.modelName}`, `Sample post with the design by ${c.modelName}`)} />
        ) : c.status === "failed" ? (
          <p className={s.failed}>{c.error || t("No se pudo crear.", "Couldn't create it.")}</p>
        ) : (
          <Progress c={c} />
        )}
        {c.status === "ready" && !previewDone && <span className={s.badge}>{t("Armando el ejemplo…", "Building the sample…")}</span>}
      </div>
      {c.status === "ready" && (
        <div className={s.cardBody}>
          {preview && (
            <button type="button" className="btn link small" onClick={() => setEmpty((v) => !v)} aria-pressed={empty}>
              {empty ? t("Ver con foto y titular", "See with photo and headline") : t("Ver el diseño vacío", "See the empty design")}
            </button>
          )}
          {c.areas?.needsAdjust && <p className="small note">{t("Revisa dónde van la foto y el titular con «Ajustar».", "Check where the photo and headline go with “Adjust”.")}</p>}
          {!!c.areas?.textInImage.length && (
            <p className="small note">{t(`La IA dibujó letras («${c.areas.textInImage.slice(0, 3).join(", ")}»). Si no te gustan, descártalo.`, `The AI drew letters (“${c.areas.textInImage.slice(0, 3).join(", ")}”). If you don't like them, discard it.`)}</p>
          )}
          <div className={s.actions}>
            <button type="button" className="btn on" disabled={busy} onClick={onUse}>{busy ? t("Guardando…", "Saving…") : t("Usar como plantilla", "Use as template")}</button>
            <button type="button" className="btn" disabled={busy} onClick={onAdjust}>{t("Ajustar", "Adjust")}</button>
            <button type="button" className="btn link danger" disabled={busy} onClick={onDiscard}>{t("Descartar", "Discard")}</button>
          </div>
        </div>
      )}
      {c.status === "failed" && (
        <div className={s.cardBody}>
          <button type="button" className="btn link" disabled={busy} onClick={onDiscard}>{t("Quitar", "Remove")}</button>
        </div>
      )}
    </article>
  );
}
