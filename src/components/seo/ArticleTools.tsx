"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import type { WriterResult } from "@/app/actions-seo-writer";
import { useT } from "@/components/I18n";

/** Copia un texto al portapapeles y avisa por 2 segundos. */
export function CopyButton({ text, label, className = "btn" }: { text: string; label: string; className?: string }) {
  const { t } = useT();
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      setState("fail");
    }
  };
  return (
    <button type="button" className={className} onClick={copy} aria-live="polite">
      {state === "ok" ? t("Copiado ✓", "Copied ✓") : state === "fail" ? t("No se pudo copiar", "Couldn't copy") : label}
    </button>
  );
}

/** "Mejorar con IA": reescribe el artículo para arreglar lo que falta. */
export function ImproveButton({ action, failing }: { action: (prev: WriterResult, f: FormData) => Promise<WriterResult>; failing: number }) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  return (
    <form action={run} className="stack" style={{ gap: 8 }}>
      <div className="row">
        <button type="submit" className="btn ai" disabled={pending}>
          {pending ? t("Mejorando…", "Improving…") : t("Mejorar con IA", "Improve with AI")}
        </button>
        <span className="small muted">
          {pending
            ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} · ${t("Suele tardar de 1 a 2 minutos.", "It usually takes 1 to 2 minutes.")}`
            : t(
                `La IA reescribe el artículo para arreglar ${failing === 1 ? "el punto que falta" : `los ${failing} puntos que faltan`}. No vuelve a consultar Google.`,
                `The AI rewrites the article to fix ${failing === 1 ? "the missing item" : `the ${failing} missing items`}. It doesn't query Google again.`,
              )}
        </span>
      </div>
      {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}

/** Borra un artículo (con confirmación). */
export function DeleteArticleButton({ action, keyword, redirectTo }: { action: () => Promise<{ ok: boolean }>; keyword: string; redirectTo?: string }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn link danger"
      style={{ minHeight: 0, padding: 0, color: "var(--err-text)" }}
      disabled={pending}
      onClick={() => {
        if (!confirm(t(`¿Borrar el artículo "${keyword}"?`, `Delete the article "${keyword}"?`))) return;
        start(async () => {
          await action();
          if (redirectTo) router.replace(redirectTo, { scroll: false });
        });
      }}
    >
      {pending ? t("Borrando…", "Deleting…") : t("Borrar", "Delete")}
    </button>
  );
}
