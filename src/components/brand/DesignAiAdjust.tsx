"use client";

// «Ajustar»: mover y cambiar el tamaño de las cajas de la foto, del titular y del logo sobre el diseño (arrastrando con
// el dedo o el mouse, o con las barras), elegir el color de las letras, ver el resultado real y guardar.
import { useRef, useState } from "react";
import type { PreviewResult } from "@/app/actions-design-ai";
import type { Sample } from "@/components/brand/DesignAiPanel";
import { useT } from "@/components/I18n";
import type { MasterCandidate } from "@/lib/design-ai-run";
import type { Box } from "@/lib/design-shapes";
import s from "./DesignAi.module.css";

export type AdjustState = { photoBox: Box; textBox: Box; logoBox: Box | null; ink: "claro" | "oscuro" | "marca"; textAlign: "izquierda" | "centro" };
type Which = "photoBox" | "textBox" | "logoBox";

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const clampBox = (b: Box): Box => {
  const w = Math.min(1, Math.max(0.03, b.w));
  const h = Math.min(1, Math.max(0.03, b.h));
  return { x: r4(Math.min(1 - w, Math.max(0, b.x))), y: r4(Math.min(1 - h, Math.max(0, b.y))), w: r4(w), h: r4(h) };
};

export function DesignAiAdjust({ candidate: c, sample, initial, busy, preview, onSave, onCancel }: { candidate: MasterCandidate; sample: Sample; initial: AdjustState; busy: boolean; preview: (a: AdjustState) => Promise<PreviewResult>; onSave: (a: AdjustState) => void; onCancel: () => void }) {
  const { t } = useT();
  const [a, setA] = useState<AdjustState>(initial);
  const [which, setWhich] = useState<Which>("photoBox");
  const [real, setReal] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ which: Which; x: number; y: number; box: Box; resize: boolean } | null>(null);

  const LABEL: Record<Which, string> = { photoBox: t("Foto", "Photo"), textBox: t("Titular", "Headline"), logoBox: t("Logo", "Logo") };
  const setBox = (k: Which, b: Box) => {
    setA((cur) => ({ ...cur, [k]: clampBox(b) }));
    setReal("");
  };

  function down(e: React.PointerEvent, k: Which, resize = false) {
    const box = a[k];
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    setWhich(k);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { which: k, x: e.clientX, y: e.clientY, box, resize };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    const el = stage.current;
    if (!d || !el) return;
    const rect = el.getBoundingClientRect();
    const dx = (e.clientX - d.x) / rect.width;
    const dy = (e.clientY - d.y) / rect.height;
    setBox(d.which, d.resize ? { ...d.box, w: d.box.w + dx, h: d.box.h + dy } : { ...d.box, x: d.box.x + dx, y: d.box.y + dy });
  }
  const up = () => {
    drag.current = null;
  };

  async function seeReal() {
    setLoading(true);
    setErr("");
    const r = await preview(a);
    setLoading(false);
    if (r.ok && r.url) setReal(r.url);
    else setErr(r.message ?? t("No se pudo armar la vista previa.", "Couldn't build the preview."));
  }

  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const pos = (b: Box) => ({ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) });
  const ink = a.ink === "claro" ? "#ffffff" : a.ink === "oscuro" ? "#111827" : sample.color;
  const sel = a[which];
  const SLIDERS: [keyof Box, string][] = [
    ["x", t("Izquierda", "Left")],
    ["y", t("Arriba", "Top")],
    ["w", t("Ancho", "Width")],
    ["h", t("Alto", "Height")],
  ];

  return (
    <div className={s.adjust}>
      <div className={s.adjustCols}>
        <div className="stack" style={{ gap: 8, minWidth: 0 }}>
          <div ref={stage} className={s.stage} style={{ aspectRatio: `${c.w ?? 1} / ${c.h ?? 1}`, backgroundImage: `url("${c.url}")` }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <div
              className={`${s.zone} ${s.zonePhoto} ${which === "photoBox" ? s.zoneOn : ""}`}
              style={{ ...pos(a.photoBox), backgroundImage: `url("${sample.photo}")` }}
              onPointerDown={(e) => down(e, "photoBox")}
              role="button"
              tabIndex={0}
              aria-label={t("Caja de la foto (arrastra para mover)", "Photo box (drag to move)")}
              onFocus={() => setWhich("photoBox")}
            >
              <span className={s.handle} onPointerDown={(e) => down(e, "photoBox", true)} aria-hidden />
            </div>
            <div
              className={`${s.zone} ${s.zoneText} ${which === "textBox" ? s.zoneOn : ""}`}
              style={{ ...pos(a.textBox), color: ink, justifyContent: a.textAlign === "centro" ? "center" : "flex-start", textAlign: a.textAlign === "centro" ? "center" : "left" }}
              onPointerDown={(e) => down(e, "textBox")}
              role="button"
              tabIndex={0}
              aria-label={t("Caja del titular (arrastra para mover)", "Headline box (drag to move)")}
              onFocus={() => setWhich("textBox")}
            >
              <span className={s.headline}>{sample.headline}</span>
              <span className={s.handle} onPointerDown={(e) => down(e, "textBox", true)} aria-hidden />
            </div>
            {a.logoBox && (
              <div
                className={`${s.zone} ${s.zoneLogo} ${which === "logoBox" ? s.zoneOn : ""}`}
                style={{ ...pos(a.logoBox), backgroundImage: sample.logo ? `url("${sample.logo}")` : undefined }}
                onPointerDown={(e) => down(e, "logoBox")}
                role="button"
                tabIndex={0}
                aria-label={t("Caja del logo (arrastra para mover)", "Logo box (drag to move)")}
                onFocus={() => setWhich("logoBox")}
              >
                {!sample.logo && <span className="small">{t("Logo", "Logo")}</span>}
                <span className={s.handle} onPointerDown={(e) => down(e, "logoBox", true)} aria-hidden />
              </div>
            )}
          </div>
          <span className="small muted">{t("Arrastra cada caja para moverla; la esquina la agranda.", "Drag each box to move it; the corner resizes it.")}</span>
        </div>

        <div className="stack" style={{ gap: 14, minWidth: 0 }}>
          <fieldset className={s.group}>
            <legend className="lbl">{t("¿Qué quieres mover?", "What do you want to move?")}</legend>
            <div className={s.chips}>
              {(["photoBox", "textBox", "logoBox"] as Which[]).map((k) => (
                <label key={k} className={which === k ? `${s.chip} ${s.on}` : s.chip}>
                  <input type="radio" name="dai-which" checked={which === k} disabled={k === "logoBox" && !a.logoBox} onChange={() => setWhich(k)} />
                  {LABEL[k]}
                </label>
              ))}
            </div>
          </fieldset>
          {sel && (
            <div className={s.sliders}>
              {SLIDERS.map(([k, label]) => (
                <label key={k} className={s.slider}>
                  <span className="small">{label} <span className="muted">{Math.round(sel[k] * 100)}%</span></span>
                  <input type="range" min={k === "w" || k === "h" ? 3 : 0} max={100} step={0.5} value={Math.round(sel[k] * 1000) / 10} onChange={(e) => setBox(which, { ...sel, [k]: Number(e.target.value) / 100 })} />
                </label>
              ))}
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={!!a.logoBox} onChange={(e) => { setA((cur) => ({ ...cur, logoBox: e.target.checked ? (initial.logoBox ?? { x: 0.05, y: 0.04, w: 0.26, h: 0.07 }) : null })); if (!e.target.checked && which === "logoBox") setWhich("photoBox"); setReal(""); }} />
            <span className="small">{t("Poner mi logo", "Add my logo")}</span>
          </label>
          <fieldset className={s.group}>
            <legend className="lbl">{t("Letras del titular", "Headline letters")}</legend>
            <div className={s.chips}>
              {([["claro", t("Blancas", "White")], ["oscuro", t("Oscuras", "Dark")], ["marca", t("Color de mi marca", "My brand color")]] as const).map(([v, l]) => (
                <label key={v} className={a.ink === v ? `${s.chip} ${s.on}` : s.chip}>
                  <input type="radio" name="dai-ink" checked={a.ink === v} onChange={() => { setA((cur) => ({ ...cur, ink: v })); setReal(""); }} />
                  {l}
                </label>
              ))}
            </div>
            <div className={s.chips}>
              {([["izquierda", t("A la izquierda", "Left")], ["centro", t("Centrado", "Centered")]] as const).map(([v, l]) => (
                <label key={v} className={a.textAlign === v ? `${s.chip} ${s.on}` : s.chip}>
                  <input type="radio" name="dai-align" checked={a.textAlign === v} onChange={() => { setA((cur) => ({ ...cur, textAlign: v })); setReal(""); }} />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
          {real && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={real} alt={t("Así queda el post", "This is how the post looks")} className={s.real} />
          )}
          {err && <p className="note error">{err}</p>}
          <div className={s.actions}>
            <button type="button" className="btn" disabled={loading || busy} onClick={seeReal}>{loading ? t("Armando…", "Building…") : t("Ver cómo queda", "See how it looks")}</button>
            <button type="button" className="btn on" disabled={busy} onClick={() => onSave(a)}>{busy ? t("Guardando…", "Saving…") : t("Guardar como plantilla", "Save as template")}</button>
            <button type="button" className="btn link" disabled={busy} onClick={onCancel}>{t("Cancelar", "Cancel")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
