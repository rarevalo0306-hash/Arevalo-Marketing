"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18n";
import styles from "@/components/seo/AiPrompt.module.css";

/** Copia un texto (con un respaldo para navegadores sin permiso de portapapeles). */
async function copyText(text: string, fallback: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!fallback) return false;
    fallback.focus();
    fallback.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

type Props = {
  /** El texto ya armado (prompts.ts). Vacío = no hay nada que pedir y no se muestra nada. */
  text: string;
  /**
   * "ai" = instrucciones para la IA que maneja la página web (Claude u otra);
   * "owner" = lista de tareas para el dueño (lo que la IA de la página no puede hacer).
   */
  variant?: "ai" | "owner";
  /** Texto del botón (si no, el de siempre). */
  label?: string;
  /** Una línea al lado del botón. */
  hint?: string;
};

/**
 * "Copiar instrucciones para la IA de tu web": abre una vista previa del texto (solo lectura) con un botón para copiarlo.
 * El dueño lo pega en el chat de la IA que maneja su página y ella hace los cambios.
 */
export function AiPromptButton({ text, variant = "ai", label, hint }: Props) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 4000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!text.trim()) return null;
  const ai = variant === "ai";
  const lines = text.split("\n").length;
  const onCopy = async () => setCopied((await copyText(text, area.current)) ? "ok" : "fail");

  return (
    <div className={styles.wrap}>
      <div className={styles.top}>
        <button type="button" className={ai ? "btn ai" : "btn outline"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {ai ? "🤖 " : "✓ "}
          {label ?? (ai ? t("Copiar instrucciones para la IA de tu web", "Copy instructions for your website's AI") : t("Copiar tu lista de tareas", "Copy your to-do list"))}
        </button>
        <span className={styles.hint}>
          {hint ??
            (ai
              ? t("Un texto con cada cambio, la página exacta y cómo hacerlo, listo para pegar.", "A text with each change, the exact page and how to do it, ready to paste.")
              : t("Esto lo haces tú: la IA de tu web no puede hacerlo.", "This one is for you: your website's AI can't do it."))}
        </span>
      </div>
      {open && (
        <div className={styles.box}>
          {ai ? (
            <>
              <p className={styles.how}>
                <strong>{t("Cómo usarlo:", "How to use it:")}</strong>
              </p>
              <ol className={styles.steps}>
                <li>{t("Presiona «Copiar».", "Press “Copy”.")}</li>
                <li>{t("Abre el chat de la IA que maneja tu página web (por ejemplo, Claude).", "Open the chat of the AI that manages your website (for example, Claude).")}</li>
                <li>{t("Pega el texto y envíalo. La IA hace los cambios; tú solo revisas que todo sea cierto.", "Paste the text and send it. The AI makes the changes; you just check that everything is true.")}</li>
              </ol>
            </>
          ) : (
            <p className={styles.how}>
              {t(
                "Cópiala y guárdala en tus notas o mándatela por WhatsApp. Ve marcando cada casilla [ ] cuando la termines.",
                "Copy it and save it in your notes or send it to yourself. Tick each box [ ] as you finish it.",
              )}
            </p>
          )}
          <textarea
            ref={area}
            className={styles.text}
            readOnly
            value={text}
            rows={Math.min(18, Math.max(8, lines))}
            aria-label={ai ? t("Instrucciones para la IA de tu web", "Instructions for your website's AI") : t("Tu lista de tareas", "Your to-do list")}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className={styles.actions}>
            <button type="button" className="btn on" onClick={onCopy}>
              {copied === "ok" ? t("¡Copiado! ✓", "Copied! ✓") : t("Copiar", "Copy")}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              {t("Cerrar", "Close")}
            </button>
            <span className={styles.meta}>{t(`${lines} líneas`, `${lines} lines`)}</span>
            {copied === "ok" && <span className={styles.ok} role="status">{ai ? t("Ahora pégalo en el chat de tu IA.", "Now paste it in your AI's chat.") : t("Ahora pégalo en tus notas.", "Now paste it in your notes.")}</span>}
            {copied === "fail" && (
              <span className={styles.fail} role="status">
                {t("No se pudo copiar solo: el texto quedó marcado, cópialo a mano.", "Couldn't copy automatically: the text is selected, copy it by hand.")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
