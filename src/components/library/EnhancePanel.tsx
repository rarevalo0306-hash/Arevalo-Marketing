"use client";

// En cada foto de «Tus fotos»: qué se le mejoró, «Antes y después» (ventana con comparación que funciona con el dedo),
// elegir la mejorada o la original para las publicaciones, y «Volver a mejorar». La original nunca se toca.
import { useActionState, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { chooseVersion, enhanceOne, type EnhanceActionResult } from "@/app/actions-enhance";
import { useT } from "@/components/I18n";
import type { LibraryCard } from "@/lib/library-match";
import { PRIVACY_LABEL, type PrivacyFlag } from "@/lib/library-shape";
import { costWords, coveredFlags, stepWords } from "@/lib/photo-enhance-shape";
import s from "./Enhance.module.css";

type Props = { c: LibraryCard; businessId: string };

/** «Mejorar» o «Volver a mejorar»: una foto (con la IA solo si tiene avisos de privacidad). */
function RedoForm({ businessId, itemId, label, cls = "btn outline" }: { businessId: string; itemId: string; label: string; cls?: string }) {
  const { t } = useT();
  const [state, action, isPending] = useActionState<EnhanceActionResult | null, FormData>(enhanceOne.bind(null, businessId, itemId), null);
  return (
    <div className={s.redo}>
      {isPending && (
        <p className={s.pending} role="status">
          <span className={s.spinner} aria-hidden="true" /> {t("Mejorando… unos segundos", "Improving… a few seconds")}
        </p>
      )}
      <form action={action} style={isPending ? { display: "none" } : undefined}>
        <button type="submit" className={cls} style={{ width: "100%" }}>
          {label}
        </button>
      </form>
      {state?.message && !isPending && (
        <p className={`note ${state.ok ? "ok" : "error"} ${s.note}`} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      )}
    </div>
  );
}

/** «Usar la mejorada» / «Usar la original». */
function ChooseForm({ businessId, itemId, useEnhanced }: { businessId: string; itemId: string; useEnhanced: boolean }) {
  const { t } = useT();
  const [state, action, isPending] = useActionState<EnhanceActionResult | null, FormData>(
    async (_prev, f) => chooseVersion(businessId, itemId, f.get("use") === "enhanced"),
    null,
  );
  return (
    <>
      {isPending && (
        <p className={s.pending} role="status">
          <span className={s.spinner} aria-hidden="true" /> {t("Guardando…", "Saving…")}
        </p>
      )}
      <form action={action} className={s.choose} style={isPending ? { display: "none" } : undefined}>
        <button type="submit" name="use" value="enhanced" className={`btn ${useEnhanced ? s.chosen : ""}`} aria-pressed={useEnhanced}>
          {useEnhanced ? "✓ " : ""}
          {t("Usar la mejorada", "Use the improved one")}
        </button>
        <button type="submit" name="use" value="original" className={`btn ${!useEnhanced ? s.chosen : ""}`} aria-pressed={!useEnhanced}>
          {!useEnhanced ? "✓ " : ""}
          {t("Usar la original", "Use the original")}
        </button>
      </form>
      {state?.message && !isPending && (
        <p className={`note ${state.ok ? "ok" : "error"} ${s.note}`} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      )}
    </>
  );
}

/** Antes y después: se arrastra con el dedo o el mouse sobre la foto, o con la barra de abajo (teclado). */
function Compare({ before, after, ratio }: { before: string; after: string; ratio: number }) {
  const { t } = useT();
  const [pos, setPos] = useState(50);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const move = (e: ReactPointerEvent) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    setPos(Math.round(Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100))));
  };
  return (
    <div className={s.compare}>
      <div
        ref={frame}
        className={s.frame}
        style={{ aspectRatio: String(ratio) }}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => dragging.current && move(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- copia guardada (Supabase, R2 o /media) */}
        <img src={before} alt={t("Foto original", "Original photo")} draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element -- copia guardada (Supabase, R2 o /media) */}
        <img src={after} alt={t("Foto mejorada", "Improved photo")} className={s.after} style={{ clipPath: `inset(0 0 0 ${pos}%)` }} draggable={false} />
        <span className={s.line} style={{ left: `${pos}%` }} aria-hidden="true">
          <span className={s.knob}>⇆</span>
        </span>
        <span className={`${s.tag} ${s.tagBefore}`}>{t("Antes", "Before")}</span>
        <span className={`${s.tag} ${s.tagAfter}`}>{t("Después", "After")}</span>
      </div>
      <label className="sr-only" htmlFor="enh-range">
        {t("Comparar antes y después", "Compare before and after")}
      </label>
      <input id="enh-range" className={s.range} type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} />
      <div className={s.toggle}>
        <button type="button" className="btn" onClick={() => setPos(100)}>
          {t("Ver la original", "See the original")}
        </button>
        <button type="button" className="btn" onClick={() => setPos(0)}>
          {t("Ver la mejorada", "See the improved one")}
        </button>
        <button type="button" className="btn link" onClick={() => setPos(50)}>
          {t("Mitad y mitad", "Half and half")}
        </button>
      </div>
    </div>
  );
}

function Dialog({ c, businessId, onClose }: Props & { onClose: () => void }) {
  const { lang, t } = useT();
  const info = c.enhance;
  const words = info ? stepWords(info.steps, lang) : [];
  const flags = c.privacy.filter((f): f is PrivacyFlag => f in PRIVACY_LABEL);
  const covered = coveredFlags(flags, info);
  const missing = flags.filter((f) => !covered.includes(f));
  const size = info?.enhanced.w && info.enhanced.h ? info.enhanced : info?.original.w && info.original.h ? info.original : { w: 4, h: 3 };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <>
      <div className={s.backdrop} onClick={onClose} aria-hidden="true" />
      <div className={s.sheet} role="dialog" aria-modal="true" aria-labelledby={`enh-${c.id}`}>
        <div className={s.head}>
          <div>
            <h2 id={`enh-${c.id}`}>{t("Antes y después", "Before and after")}</h2>
            <p>{t("Desliza sobre la foto para comparar. La original queda guardada siempre.", "Slide over the photo to compare. The original is always kept.")}</p>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label={t("Cerrar", "Close")}>
            ×
          </button>
        </div>
        <div className={s.scroll}>
          <Compare before={c.originalUrl} after={c.enhancedUrl} ratio={size.w / size.h} />
          <div className={s.side}>
            <div>
              <h3>{t("Lo que hizo la app", "What the app did")}</h3>
              {words.length ? (
                <ul className={s.done} style={{ marginTop: 8 }}>
                  {words.map((w) => (
                    <li key={w}>✓ {w}</li>
                  ))}
                </ul>
              ) : (
                <p className={s.small} style={{ marginTop: 6 }}>
                  {t("La foto ya estaba bien: casi no hubo que cambiar nada.", "The photo was already good: almost nothing needed changing.")}
                </p>
              )}
            </div>
            <p className={s.small}>
              {t(
                "Solo se arregla la luz, el color, la nitidez y lo torcido, y se tapan datos privados. Tu trabajo no se cambia ni se inventa nada.",
                "Only light, color, sharpness and tilt are fixed, and private data is hidden. Your work isn't changed and nothing is made up.",
              )}
            </p>
            {missing.length > 0 && (
              <p className={`note ${s.note}`}>
                {t("Sin tapar en la mejorada: ", "Not hidden in the improved one: ")}
                {missing.map((f) => PRIVACY_LABEL[f][lang].toLowerCase()).join("; ")}.{" "}
                {t("Por eso la IA no la usa sola hasta que la apruebes.", "That's why AI won't use it on its own until you approve it.")}
              </p>
            )}
            {covered.length > 0 && missing.length === 0 && c.choice === "" && (
              <p className={`note ok ${s.note}`}>
                {t(
                  "La mejorada ya tapa los datos privados que vio la IA. Revísala y, si está bien, apruébala en la tarjeta.",
                  "The improved one already hides the private data the AI saw. Check it and, if it's fine, approve it on the card.",
                )}
              </p>
            )}
            <div>
              <h3 style={{ marginBottom: 8 }}>{t("¿Cuál va en tus publicaciones?", "Which one goes in your posts?")}</h3>
              <ChooseForm businessId={businessId} itemId={c.id} useEnhanced={c.useEnhanced} />
            </div>
            <RedoForm businessId={businessId} itemId={c.id} label={t("Volver a mejorar", "Improve again")} />
            <p className={s.small}>
              {info?.enhanced.w ? `${info.enhanced.w} × ${info.enhanced.h} px · ` : ""}
              {costWords(info?.ai ?? null, lang)}
            </p>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** Lo que va en la tarjeta de cada foto. */
export function EnhancePanel({ c, businessId }: Props) {
  const { lang, t } = useT();
  const [open, setOpen] = useState(false);
  if (c.kind !== "photo" || c.status !== "ready" || !c.originalUrl) return null;
  const info = c.enhance;
  if (c.enhancedUrl) {
    const words = info ? stepWords(info.steps, lang) : [];
    return (
      <>
        {words.length > 0 && (
          <p className={s.cardLine}>
            <strong>{c.useEnhanced ? t("Mejorada:", "Improved:") : t("Usa la original. Mejorada:", "Uses the original. Improved:")}</strong> {words.slice(0, 2).join(" · ")}
            {words.length > 2 ? " …" : ""}
          </p>
        )}
        <button type="button" className={`btn outline ${s.open}`} onClick={() => setOpen(true)}>
          {t("Antes y después", "Before and after")}
        </button>
        {open && <Dialog c={c} businessId={businessId} onClose={() => setOpen(false)} />}
      </>
    );
  }
  if (info?.error) {
    return (
      <>
        <p className={`${s.cardLine} ${s.cardErr}`}>{info.error}</p>
        <RedoForm businessId={businessId} itemId={c.id} label={t("Intentar mejorarla otra vez", "Try improving it again")} cls="btn link" />
      </>
    );
  }
  return <RedoForm businessId={businessId} itemId={c.id} label={t("Mejorar esta foto", "Improve this photo")} cls="btn link" />;
}
