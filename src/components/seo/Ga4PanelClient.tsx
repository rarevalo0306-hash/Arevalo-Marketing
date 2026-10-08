"use client";

import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { Ga4Result } from "@/app/actions-ga4";
import { useT } from "@/components/I18n";
import s from "./Ga4Panel.module.css";

/** «Actualizar»: vuelve a pedir los últimos 28 días a Google Analytics. */
export function Ga4RefreshButton({ action }: { action: (prev: Ga4Result, f: FormData) => Promise<Ga4Result> }) {
  const { t } = useT();
  const [result, run, isPending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 10 }}>
      <div>
        <button type="submit" className="btn outline" disabled={isPending}>
          {isPending ? t("Consultando a Google…", "Asking Google…") : t("Actualizar", "Refresh")}
        </button>
      </div>
      {result?.message && !isPending && (
        <p className={result.ok ? "note ok" : "note error"} role={result.ok ? "status" : "alert"}>
          {result.message}
        </p>
      )}
    </form>
  );
}

/**
 * Cuando el panel se ve en pantalla y los datos tienen más de un día, los trae solo (una vez al día como máximo;
 * el servidor vuelve a revisar). Mientras tanto se ve lo que ya estaba guardado.
 */
export function Ga4AutoRefresh({ action, stale }: { action: () => Promise<{ refreshed: boolean }>; stale: boolean }) {
  const { t } = useT();
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  const [pending, start] = useTransition();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!stale || !el || done.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        setVisible(true);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [stale]);
  useEffect(() => {
    if (!visible || done.current) return;
    done.current = true;
    start(async () => {
      await action();
    });
  }, [visible, action]);
  return (
    <span ref={ref} className={s.auto} role="status">
      {pending ? t("Trayendo los datos de hoy de Google Analytics…", "Getting today's data from Google Analytics…") : ""}
    </span>
  );
}

/** Aviso al volver de Google (?ga4=ok · ?ga4=choose · ?ga4=error&msg=…). */
export function Ga4Notice() {
  const { t } = useT();
  const q = useSearchParams();
  const status = q.get("ga4");
  if (status === "ok") return <p className="note ok" role="status">{t("Listo: Google Analytics quedó conectado.", "Done: Google Analytics is now connected.")}</p>;
  if (status === "error")
    return (
      <p className="note error" role="alert">
        {(q.get("msg") ?? "").slice(0, 400) || t("No se pudo conectar Google Analytics.", "Couldn't connect Google Analytics.")}
      </p>
    );
  return null;
}

/** Botón con confirmación (desconectar). */
export function Ga4ConfirmButton({ action, label, question, className = "btn danger" }: { action: () => Promise<void>; label: string; question?: string; className?: string }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() => {
        if (!question || confirm(question)) start(() => action());
      }}
    >
      {pending ? t("Un momento…", "One moment…") : label}
    </button>
  );
}
