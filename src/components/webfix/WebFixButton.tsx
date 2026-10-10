"use client";

import { useState, useTransition } from "react";
import { startWebFixAction } from "@/app/actions-webfix";
import { useT } from "@/components/I18n";
import { useWebFix } from "@/components/webfix/WebFixContext";
import { estimateForInstructions, isOpen } from "@/lib/webfix-shape";
import styles from "./WebFix.module.css";

type Props = {
  /** El mismo texto que copia el botón de instrucciones. */
  text: string;
  /** Qué arregla (ej. «Advertencias»): va en el título del cambio. */
  title: string;
  kind?: "audit" | "prompt";
  issueIds?: string[];
  urls?: string[];
};

/**
 * «Arréglalo por mí»: al lado de cada botón de instrucciones para la IA de la web. Muestra qué hará y cuánto cuesta,
 * y con un «Sí» Matya prepara los cambios en una copia aparte (pull request). La web no cambia hasta «Publicar».
 * Solo aparece si la web está conectada (Conexiones → Sitio web).
 */
export function WebFixButton({ text, title, kind = "prompt", issueIds = [], urls = [] }: Props) {
  const { t } = useT();
  const fix = useWebFix();
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!fix?.connected || !text.trim()) return null;
  const open = fix.job ? isOpen(fix.job, new Date()) : false;
  const cents = estimateForInstructions(text.length, fix.fileBudget);
  const money = t(`hasta ${cents} ${cents === 1 ? "centavo" : "centavos"} de dólar`, `up to ${cents} US ${cents === 1 ? "cent" : "cents"}`);

  if (open && !message?.ok)
    return (
      <p className={styles.waiting} role="status">
        <span aria-hidden="true">🛠</span> {t("Ya hay arreglos esperando tu revisión.", "There are fixes waiting for your review.")} <a href={fix.reviewHref}>{t("Ver los arreglos", "See the fixes")}</a>
      </p>
    );

  const run = () =>
    start(async () => {
      const r = await startWebFixAction(fix.businessId, { source: { kind, title, issueIds, urls }, instructions: text });
      setMessage({ ok: r.ok, text: r.message });
      if (r.job) fix.setJob(r.job);
      if (r.ok) setAsking(false);
    });

  return (
    <div className={styles.fixRow}>
      {!asking && !message?.ok && (
        <div className={styles.fixTop}>
          <button type="button" className="btn on" onClick={() => setAsking(true)}>
            🛠 {t("Arréglalo por mí", "Fix it for me")}
          </button>
          <span className={styles.hint}>{t(`Matya hace estos cambios en tu web y tú solo apruebas. Costo: ${money}.`, `Matya makes these changes on your website and you just approve. Cost: ${money}.`)}</span>
        </div>
      )}
      {asking && (
        <div className={styles.confirm} role="group" aria-label={t("Arréglalo por mí", "Fix it for me")}>
          <strong>{t("Esto es lo que va a pasar:", "Here's what will happen:")}</strong>
          <ol className={styles.confirmSteps}>
            <li>{t("Matya lee el código de tu web y la IA prepara los cambios, sin inventar datos.", "Matya reads your website's code and the AI prepares the changes, without making up facts.")}</li>
            <li>{t("Los guarda en una copia aparte: tu web no cambia todavía.", "It saves them in a separate copy: your website doesn't change yet.")}</li>
            <li>{t("Ves cómo queda y, si te gusta, presionas «Publicar en mi web».", "You see how it looks and, if you like it, press “Publish on my website”.")}</li>
          </ol>
          <p className={styles.cost}>
            {t("Costo estimado de la IA: ", "Estimated AI cost: ")}
            <strong>{money}</strong>
          </p>
          {!pending ? (
            <div className="row">
              <button type="button" className="btn on" onClick={run}>
                {t("Sí, prepararlos", "Yes, prepare them")}
              </button>
              <button type="button" className="btn" onClick={() => setAsking(false)}>
                {t("Cancelar", "Cancel")}
              </button>
            </div>
          ) : (
            <p className="small muted" aria-live="polite">{t("Empezando…", "Starting…")}</p>
          )}
        </div>
      )}
      {message && (
        <p className={message.ok ? "note ok" : "note error"} role="status">
          {message.text}
          {message.ok && (
            <>
              {" "}
              <a href={fix.reviewHref}>{t("Ver el avance", "See the progress")}</a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
