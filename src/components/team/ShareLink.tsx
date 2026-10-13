"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18n";
import s from "./Team.module.css";

/**
 * Un enlace (invitación o contraseña nueva) para mandarlo a mano: se ve completo, se copia con un botón o sale
 * directo a WhatsApp con un mensaje corto. `message` es el texto de WhatsApp (el enlace va al final).
 */
export function ShareLink({ link, message, copyLabel }: { link: string; message: string; copyLabel?: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  // El aviso «¡Copiado!» se borra solo; si se vuelve a tocar, el tiempo empieza de nuevo.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("ok");
    } catch {
      // Sin permiso para el portapapeles: el enlace queda a la vista para copiarlo a mano.
      setCopied("fail");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2500);
  };
  return (
    <div className={s.share}>
      <code className={s.link}>{link}</code>
      <div className={s.shareButtons}>
        <button type="button" className="btn" onClick={copy}>
          {copied === "ok" ? t("¡Copiado!", "Copied!") : (copyLabel ?? t("Copiar", "Copy"))}
        </button>
        <a className={`btn ${s.wa}`} href={`https://wa.me/?text=${encodeURIComponent(`${message}\n${link}`)}`} target="_blank" rel="noopener noreferrer">
          {t("Mandar por WhatsApp", "Send by WhatsApp")}
        </a>
      </div>
      <p className="small muted" aria-live="polite">
        {copied === "ok"
          ? t("Enlace copiado. Pégalo donde quieras mandarlo.", "Link copied. Paste it wherever you want to send it.")
          : copied === "fail"
            ? t("No se pudo copiar solo: mantén presionado el enlace y cópialo.", "Couldn't copy it automatically: press and hold the link and copy it.")
            : ""}
      </p>
    </div>
  );
}
