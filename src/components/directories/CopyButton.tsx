"use client";

import { useState } from "react";
import { useT } from "@/components/I18n";
import s from "./Directories.module.css";

/** Copia un texto (con un respaldo para navegadores sin permiso de portapapeles). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Botón «Copiar» que dice «¡Copiado!» un momento. `label` es para lectores de pantalla (qué se copia). */
export function CopyButton({ text, label, onCopied, className }: { text: string; label: string; onCopied?: () => void; className?: string }) {
  const { t } = useT();
  const [done, setDone] = useState<"ok" | "fail" | null>(null);
  return (
    <button
      type="button"
      className={`btn ${className ?? ""} ${s.copy}`}
      disabled={!text}
      aria-label={t(`Copiar ${label}`, `Copy ${label}`)}
      onClick={async () => {
        const ok = await copyText(text);
        setDone(ok ? "ok" : "fail");
        if (ok) onCopied?.();
        setTimeout(() => setDone(null), 1800);
      }}
    >
      <span aria-live="polite">{done === "ok" ? t("¡Copiado!", "Copied!") : done === "fail" ? t("No se pudo", "Couldn't copy") : t("Copiar", "Copy")}</span>
    </button>
  );
}
