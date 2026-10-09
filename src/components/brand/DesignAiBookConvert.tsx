"use client";

// «Convertir en plantilla» una pieza de redes del manual: 1) elegir cómo limpiarla (un modelo de edición, con su precio
// y confirmación, o gratis tapando el texto), 2) esperar, 3) «Ajustar» con una foto y un titular de ejemplo y guardar.
import { useEffect, useRef, useState } from "react";
import type { CheckResult, ConvertResult, PreviewResult, SaveResult } from "@/app/actions-design-ai";
import { DesignAiAdjust, type AdjustState } from "@/components/brand/DesignAiAdjust";
import type { Sample } from "@/components/brand/DesignAiPanel";
import { useT } from "@/components/I18n";
import type { MasterCandidate } from "@/lib/design-ai-run";
import s from "./DesignAi.module.css";

export type EditModel = { id: string; name: string; usd: number; approx: boolean; etaSec: number };
export type ConvertActions = {
  models: EditModel[];
  cap: number;
  sample: Sample;
  start: (assetId: string, model: string) => Promise<ConvertResult>;
  check: (id: string) => Promise<CheckResult>;
  preview: (id: string, adjust?: AdjustState) => Promise<PreviewResult>;
  save: (id: string, adjust?: AdjustState) => Promise<SaveResult>;
};

export function DesignAiBookConvert({ asset, actions: p, onDone, onClose }: { asset: { id: string; url: string; label: string }; actions: ConvertActions; onDone: (message: string) => void; onClose: () => void }) {
  const { t } = useT();
  const [model, setModel] = useState(p.models[0]?.id ?? "none");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [c, setC] = useState<MasterCandidate | null>(null);
  const polling = useRef(false);
  const chosen = p.models.find((m) => m.id === model);
  const money = (v: number) => `US$${v.toFixed(2)}`;

  // Mientras se limpia: pregunta cada 4 segundos.
  const waiting = c && (c.status === "pending" || c.status === "storing");
  useEffect(() => {
    if (!waiting || !c) return;
    const id = setInterval(async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const r = await p.check(c.id);
        if (r.ok && r.candidate) setC(r.candidate);
      } finally {
        polling.current = false;
      }
    }, 4000);
    return () => clearInterval(id);
  }, [waiting, c, p]);

  async function go() {
    setBusy(true);
    setError("");
    setConfirm(false);
    const r = await p.start(asset.id, model);
    if (!r.ok || !r.id) {
      setBusy(false);
      setError(r.message);
      return;
    }
    const first = await p.check(r.id);
    setBusy(false);
    if (first.ok && first.candidate) setC(first.candidate);
    else setError(first.message ?? t("No se pudo empezar.", "Couldn't start."));
  }

  async function save(a: AdjustState) {
    if (!c) return;
    setBusy(true);
    const r = await p.save(c.id, a);
    setBusy(false);
    if (r.ok) onDone(r.message);
    else setError(r.message);
  }

  const ready = c?.status === "ready" && c.areas;
  const failed = c?.status === "failed";

  return (
    <div className={s.convert} role="region" aria-label={t(`Convertir «${asset.label}» en plantilla`, `Turn “${asset.label}” into a template`)}>
      <div className="row between" style={{ gap: 8 }}>
        <h4 className={s.stepTitle}>
          <span aria-hidden className={s.spark}>✦</span> {t(`Convertir en plantilla: ${asset.label}`, `Turn into a template: ${asset.label}`)}
        </h4>
        <button type="button" className="btn link" onClick={onClose}>{t("Cerrar", "Close")}</button>
      </div>

      {!c && (
        <div className={s.convertCols}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.url} alt={asset.label} className={s.convertThumb} />
          <div className="stack" style={{ gap: 12, minWidth: 0 }}>
            <p className="small" style={{ margin: 0 }}>
              {t(
                "La IA quita el texto de ejemplo y deja libre el espacio de la foto. Tu logo, tus colores, el botón y las formas del diseñador quedan igual. Después cada post pone su foto y su titular ahí.",
                "The AI removes the example text and frees the photo area. Your logo, colors, button and the designer's shapes stay the same. Then every post puts its own photo and headline there.",
              )}
            </p>
            <fieldset className={s.group}>
              <legend className="lbl">{t("¿Cómo la limpiamos?", "How should we clean it?")}</legend>
              <div className="stack" style={{ gap: 8 }}>
                {p.models.map((m) => (
                  <label key={m.id} className={model === m.id ? `${s.model} ${s.on}` : s.model}>
                    <input type="radio" name={`conv-${asset.id}`} checked={model === m.id} onChange={() => { setModel(m.id); setConfirm(false); }} />
                    <span className={s.modelBody}>
                      <span className={s.modelTop}>
                        <strong>{m.name}</strong>
                        <span className={s.price}>{m.approx ? "≈" : ""}{money(m.usd)}</span>
                      </span>
                      <span className="small muted">{m.id === p.models[0]?.id ? t("Recomendado: el que mejor respeta el diseño", "Recommended: keeps the design most faithfully") : t("Otra IA de edición", "Another edit AI")}</span>
                    </span>
                  </label>
                ))}
                <label className={model === "none" ? `${s.model} ${s.on}` : s.model}>
                  <input type="radio" name={`conv-${asset.id}`} checked={model === "none"} onChange={() => { setModel("none"); setConfirm(false); }} />
                  <span className={s.modelBody}>
                    <span className={s.modelTop}>
                      <strong>{t("Sin IA de edición", "Without an edit AI")}</strong>
                      <span className={s.price}>{t("Gratis", "Free")}</span>
                    </span>
                    <span className="small muted">{t("Tapamos el texto de ejemplo con el color de alrededor. En fondos con dibujo se puede notar.", "We cover the example text with the surrounding color. On patterned backgrounds it may show.")}</span>
                  </span>
                </label>
              </div>
            </fieldset>
            {!p.models.length && (
              <p className="small muted" style={{ margin: 0 }}>{t("Para limpiarla con IA, agrega IDEOGRAM_API_KEY o FAL_KEY en Vercel.", "To clean it with AI, add IDEOGRAM_API_KEY or FAL_KEY in Vercel.")}</p>
            )}
            {busy ? (
              <p className={s.progressText} role="status"><span className={s.spinner} aria-hidden /> {model === "none" ? t("Preparando tu plantilla…", "Preparing your template…") : t("Mandando el pedido…", "Sending the request…")}</p>
            ) : confirm && chosen ? (
              <div className={s.confirm} role="group" aria-label={t("Confirmar el gasto", "Confirm the cost")}>
                <span className="small">{t(`Se cobrarán ~${money(chosen.usd)} a tu cuenta de ${chosen.name}. ¿Seguimos?`, `About ${money(chosen.usd)} will be charged to your ${chosen.name} account. Continue?`)}</span>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn on" onClick={go}>{t("Sí, limpiar", "Yes, clean it")}</button>
                  <button type="button" className="btn" onClick={() => setConfirm(false)}>{t("Cancelar", "Cancel")}</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn ai" style={{ alignSelf: "flex-start" }} disabled={!!chosen && chosen.usd > p.cap} onClick={() => (chosen ? setConfirm(true) : go())}>
                {chosen ? t(`Limpiar con ${chosen.name} (~${money(chosen.usd)})`, `Clean with ${chosen.name} (~${money(chosen.usd)})`) : t("Convertir gratis", "Convert for free")}
              </button>
            )}
          </div>
        </div>
      )}

      {c && waiting && (
        <div className={s.wait} role="status" aria-live="polite" style={{ width: "100%", alignItems: "flex-start" }}>
          <p className={s.progressText}><span className={s.spinner} aria-hidden /> {c.status === "storing" ? t("Guardando y buscando dónde van la foto y el titular…", "Saving and finding where the photo and headline go…") : t(`Limpiando la pieza con ${c.modelName}… (unos ${c.etaSec} s)`, `Cleaning the piece with ${c.modelName}… (about ${c.etaSec} s)`)}</p>
        </div>
      )}

      {failed && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="note error">{c.error || t("No se pudo limpiar.", "Couldn't clean it.")}</p>
          <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setC(null)}>{t("Probar de otra forma", "Try another way")}</button>
        </div>
      )}

      {ready && (
        <>
          {c.fallback === "undetected" && <p className="note">{t("No pudimos ver dónde estaba el texto de ejemplo, así que sigue en el diseño: mueve la caja del titular a un lugar limpio o usa una IA de edición.", "We couldn't see where the example text was, so it's still in the design: move the headline box to a clean spot or use an edit AI.")}</p>}
          {c.fallback === "uneven" && <p className="note">{t("Tapamos el texto de ejemplo, pero el fondo tiene dibujo y se puede notar. Con una IA de edición queda más limpio.", "We covered the example text, but the background has a pattern and it may show. An edit AI gives a cleaner result.")}</p>}
          {c.fallback === "clean" && <p className="note info">{t("Tapamos el texto de ejemplo con el color de fondo. Revisa que no se note.", "We covered the example text with the background color. Check that it doesn't show.")}</p>}
          <DesignAiAdjust
            candidate={c}
            sample={p.sample}
            initial={{ photoBox: c.areas!.photoBox, textBox: c.areas!.textBox, logoBox: c.areas!.logoBox, ink: c.ink ?? "claro", textAlign: c.areas!.textAlign }}
            busy={busy}
            preview={(a) => p.preview(c.id, a)}
            onSave={save}
            onCancel={onClose}
          />
        </>
      )}
      {error && <p className="note error" role="alert">{error}</p>}
    </div>
  );
}
