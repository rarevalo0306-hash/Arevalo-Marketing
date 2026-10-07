"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { CompetitorsResult } from "@/app/actions-seo-competitors";
import { useT } from "@/components/I18n";
import fold from "@/components/seo/Fold.module.css";

type Props = {
  action: (prev: CompetitorsResult, f: FormData) => Promise<CompetitorsResult>;
  /** Ya hay un reporte guardado. */
  has: boolean;
  /** Los sitios que escribió la vez anterior. */
  defaultDomains: string[];
};

/** Mientras se busca: pasos aproximados y el tiempo que lleva. */
function Working({ pending }: { pending: boolean }) {
  const { t } = useT();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  if (!pending) return null;
  const steps: [number, string][] = [
    [0, t("Buscando quién compite contigo en Google…", "Finding who competes with you on Google…")],
    [6, t("Leyendo las búsquedas por las que salen…", "Reading the searches they show up for…")],
    [18, t("Comparando con las tuyas…", "Comparing them with yours…")],
  ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · {t("Suele tardar menos de un minuto. No cierres esta página.", "It usually takes less than a minute. Don't close this page.")}
      </p>
    </div>
  );
}

export function CompetitorsForm({ action, has, defaultDomains }: Props) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 12 }}>
      {/* Ya buscó una vez: el campo opcional queda cerrado (cerrado igual se manda con el formulario). */}
      <details className={fold.inline} open={!has}>
        <summary>
          {defaultDomains.length
            ? t(`Sitios de tu competencia que escribiste (${defaultDomains.length})`, `Competitor websites you typed (${defaultDomains.length})`)
            : t("Escribir los sitios de tu competencia (opcional, hasta 3)", "Type your competitors' websites (optional, up to 3)")}
        </summary>
      <label className="stack" style={{ gap: 6 }}>
        <span className="lbl">{t("Sitios de tu competencia (opcional, hasta 3)", "Competitor websites (optional, up to 3)")}</span>
        <input
          name="domains"
          className="field"
          defaultValue={defaultDomains.join(", ")}
          placeholder={t("competencia1.com, competencia2.com", "competitor1.com, competitor2.com")}
          maxLength={300}
          disabled={pending}
          autoComplete="off"
        />
        <span className="small muted">
          {t(
            "Si ya sabes quiénes son, escríbelos. Si no, los buscamos nosotros con tus palabras clave.",
            "If you already know who they are, type them. If not, we find them with your keywords.",
          )}
        </span>
      </label>
      </details>
      {!pending && (
        <div className="row">
          <button type="submit" className="btn ai">
            {has ? t("Volver a buscar", "Search again") : t("Buscar mi competencia", "Find my competition")}
          </button>
          <span className="small muted">{t("Cuesta unos US$0.05 a 0.10 de tu saldo de DataForSEO.", "Costs about US$0.05 to 0.10 of your DataForSEO balance.")}</span>
        </div>
      )}
      <Working pending={pending} />
      {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}

/** Botón "+ Seguir": agrega la búsqueda a las palabras clave del negocio. */
export function TrackGapButton({ action, keyword, tracked }: { action: (keyword: string) => Promise<{ ok: boolean; message: string }>; keyword: string; tracked: boolean }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ ok: boolean; message: string } | null>(null);
  if (tracked || done?.ok) return <span className="pill done">{t("Siguiendo", "Tracking")}</span>;
  return (
    <span className="row" style={{ gap: 6 }}>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              setDone(await action(keyword));
            } catch {
              setDone({ ok: false, message: t("No se pudo guardar. Intenta de nuevo.", "Couldn't save. Try again.") });
            }
          })
        }
      >
        {pending ? t("Guardando…", "Saving…") : t("+ Seguir", "+ Track")}
      </button>
      {done && !done.ok && <span className="small" style={{ color: "var(--err-text)" }} role="status">{done.message}</span>}
    </span>
  );
}
