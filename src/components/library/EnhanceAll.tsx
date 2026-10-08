"use client";

// «Mejorar todas las fotos (N)»: la app mejora las fotos que faltan por tandas (cada tanda cabe en el tiempo que da el
// servidor) y sigue sola hasta terminar, mostrando el avance. Se puede parar.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { enhanceAllStep } from "@/app/actions-enhance";
import { useT } from "@/components/I18n";
import { errorText } from "@/lib/i18n";
import s from "./Enhance.module.css";

type Props = {
  businessId: string;
  /** Fotos listas sin mejorar. */
  pending: number;
  /** Fotos ya mejoradas. */
  enhanced: number;
  /** De las que faltan, cuántas necesitan a la IA para tapar datos privados. */
  aiPhotos: number;
  /** Costo aproximado de la IA por foto (US$). */
  aiCost: number;
  aiReady: boolean;
};

function SparkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5" />
    </svg>
  );
}

export function EnhanceAll({ businessId, pending, enhanced, aiPhotos, aiCost, aiReady }: Props) {
  const { lang, t } = useT();
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [total, setTotal] = useState(pending);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const stop = useRef(false);

  async function run() {
    stop.current = false;
    setRunning(true);
    setMsg(null);
    setDone(0);
    setFailed(0);
    setTotal(pending);
    let ok = 0;
    let bad = 0;
    let last = "";
    try {
      for (let round = 0; round < 200; round++) {
        const r = await enhanceAllStep(businessId);
        if (!r.ok) throw new Error(r.message);
        ok += r.done;
        bad += r.failed;
        if (r.message) last = r.message;
        setDone(ok);
        setFailed(bad);
        setTotal(Math.max(ok + bad + r.left, 1));
        // Terminó, se paró, o una tanda no pudo con ninguna (no seguir en vano).
        if (!r.left || stop.current || r.done + r.failed === 0) break;
      }
      const parts = [
        ok ? t(`Listo: ${ok} foto${ok === 1 ? "" : "s"} mejorada${ok === 1 ? "" : "s"}.`, `Done: ${ok} photo${ok === 1 ? "" : "s"} improved.`) : t("No se mejoró ninguna foto.", "No photo was improved."),
        bad ? t(`${bad} ${bad === 1 ? "no se pudo" : "no se pudieron"} mejorar${last ? ` (${last})` : ""}.`, `${bad} couldn't be improved${last ? ` (${last})` : ""}.`) : "",
        stop.current ? t("Paraste a la mitad: las que faltan siguen pendientes.", "You stopped halfway: the rest are still pending.") : "",
      ];
      setMsg({ ok: ok > 0 || !bad, text: parts.filter(Boolean).join(" ") });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e, lang) });
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  const pct = total ? Math.round(((done + failed) / total) * 100) : 0;
  const cost = aiPhotos * aiCost;
  return (
    <section className={`card ${s.all}`} aria-label={t("Fotos mejoradas", "Improved photos")}>
      <div className={s.allText}>
        <h2>
          <span className={s.allIcon}>
            <SparkIcon />
          </span>
          {t("Fotos mejoradas", "Improved photos")}
        </h2>
        <p>
          {t(
            "La app arregla la luz, el color, la nitidez y lo torcido, y tapa placas, direcciones y caras de clientes. Tu trabajo no se cambia y la foto original queda guardada.",
            "The app fixes light, color, sharpness and tilt, and hides license plates, addresses and customers' faces. Your work isn't changed and the original photo is kept.",
          )}
        </p>
        <p>
          <strong style={{ color: "var(--ink)" }}>{enhanced}</strong> {t(enhanced === 1 ? "mejorada" : "mejoradas", "improved")}
          {pending > 0 && (
            <>
              {" · "}
              <strong style={{ color: "var(--ink)" }}>{pending}</strong> {t("por mejorar", "to improve")}
            </>
          )}
        </p>
        <details className={s.how}>
          <summary>{t("¿Cuánto cuesta y qué hace?", "What does it cost and do?")}</summary>
          <ul>
            <li>{t("Luz, color, nitidez, enderezar y quitar bordes vacíos: gratis (lo hace la app, sin IA).", "Light, color, sharpness, straightening and removing empty borders: free (done by the app, no AI).")}</li>
            <li>
              {t(
                "Qué tapar lo dice la IA al revisar cada foto nueva (sin costo extra). Las fotos viejas con avisos de privacidad se le preguntan aparte",
                "What to hide is told by the AI when it reviews each new photo (no extra cost). Older photos with privacy warnings are asked separately",
              )}
              {aiPhotos > 0
                ? t(
                    `: ${aiPhotos} foto${aiPhotos === 1 ? "" : "s"}, unos US$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)} en total.`,
                    `: ${aiPhotos} photo${aiPhotos === 1 ? "" : "s"}, about US$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)} in total.`,
                  )
                : t(": ahora no hace falta ninguna.", ": none needed right now.")}
              {!aiReady && aiPhotos > 0 && t(" (La IA no está conectada: esas se mejoran sin tapar nada.)", " (AI isn't connected: those are improved without hiding anything.)")}
            </li>
            <li>{t("Las fotos nuevas se mejoran solas después de que la IA las revisa.", "New photos are improved on their own after the AI reviews them.")}</li>
            <li>{t("En cada foto puedes ver el antes y después y elegir cuál usar.", "On each photo you can see before and after and choose which one to use.")}</li>
          </ul>
        </details>
      </div>
      <div className={s.allActions}>
        {running ? (
          <div className={s.progress}>
            <p className={s.progressText} role="status">
              <span className={s.spinner} aria-hidden="true" />
              {t(`Mejorando… ${done + failed} de ${total}`, `Improving… ${done + failed} of ${total}`)}
            </p>
            <div className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("Avance", "Progress")}>
              <div className={s.barFill} style={{ width: `${pct}%` }} />
            </div>
            <button type="button" className="btn link" onClick={() => (stop.current = true)}>
              {t("Parar después de esta tanda", "Stop after this batch")}
            </button>
          </div>
        ) : pending > 0 ? (
          <button type="button" className="btn on" onClick={() => void run()}>
            {t(`Mejorar todas las fotos (${pending})`, `Improve all photos (${pending})`)}
          </button>
        ) : (
          <span className="pill good">{t("Todas mejoradas", "All improved")}</span>
        )}
        {msg && !running && (
          <p className={`note ${msg.ok ? "ok" : "error"} ${s.msg}`} role={msg.ok ? "status" : "alert"}>
            {msg.text}
          </p>
        )}
      </div>
    </section>
  );
}
