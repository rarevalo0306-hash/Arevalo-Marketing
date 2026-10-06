"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { type OnPageResult, setPageKeyword } from "@/app/actions-seo-onpage";
import { useT } from "@/components/I18n";

type Action = (prev: OnPageResult, f: FormData) => Promise<OnPageResult>;

/** Segundos desde que empezó a trabajar (se reinicia cada vez). */
function useSeconds(pending: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  return seconds;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** "Revisar mis páginas": todas las páginas, con el costo estimado, los pasos y el tiempo que lleva. */
export function OnPageRunButton({ action, pages, estimate, has }: { action: Action; pages: number; estimate: number; has: boolean }) {
  const { t, lang } = useT();
  const [result, run, pending] = useActionState(action, null);
  const seconds = useSeconds(pending);
  const cost = new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(estimate);
  const steps: [number, string][] = [
    [0, t("Leyendo tus páginas…", "Reading your pages…")],
    [6, t("Mirando quién gana en Google para cada palabra…", "Looking at who wins on Google for each keyword…")],
    [20, t("Leyendo las páginas que ganan…", "Reading the winning pages…")],
    [Math.max(45, pages * 9), t("Comparando y armando tu lista…", "Comparing and building your list…")],
  ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <form action={run} className="stack" style={{ gap: 12 }}>
      {/* El botón se esconde con display (no con hidden: .stack lo anula) para que el formulario siga montado. */}
      <div className="row" style={{ display: pending ? "none" : undefined }}>
        <button type="submit" className="btn ai">{has ? t("Revisar mis páginas otra vez", "Check my pages again") : t("Revisar mis páginas", "Check my pages")}</button>
        <span className="small muted">
          {t(
            `Hasta ${pages} ${pages === 1 ? "página" : "páginas"}: unos ${cost} de DataForSEO (US$0.002 por página).`,
            `Up to ${pages} ${pages === 1 ? "page" : "pages"}: about ${cost} of DataForSEO (US$0.002 per page).`,
          )}
        </span>
      </div>
      {pending && (
        <div className="stack" style={{ gap: 12 }} aria-live="polite">
          <ul className="magic-steps">
            {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
          </ul>
          <p className="small muted">
            {clock(seconds)} · {t("Suele tardar de 1 a 3 minutos. No cierres esta página.", "It usually takes 1 to 3 minutes. Don't close this page.")}
          </p>
        </div>
      )}
      {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}

/** "Volver a revisar esta página": solo esa página (unos US$0.002). */
export function RecheckButton({ action, url, primary }: { action: Action; url: string; primary?: boolean }) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  const seconds = useSeconds(pending);
  return (
    <form action={run} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="url" value={url} />
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className={primary ? "btn ai" : "btn"} disabled={pending}>
          {pending ? t("Revisando…", "Checking…") : t("Volver a revisar esta página", "Check this page again")}
        </button>
        {pending && <span className="small muted">{clock(seconds)} · {t("unos 20 a 40 segundos", "about 20 to 40 seconds")}</span>}
      </div>
      {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}

/** "Sugerir título y descripción con IA". */
export function SuggestButton({ action, has }: { action: Action; has: boolean }) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  const seconds = useSeconds(pending);
  return (
    <form action={run} className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn outline" disabled={pending}>
          {pending ? t("Escribiendo…", "Writing…") : has ? t("Sugerir otra vez con IA", "Suggest again with AI") : t("Sugerir título y descripción con IA", "Suggest title and description with AI")}
        </button>
        {pending && <span className="small muted">{clock(seconds)} · {t("unos segundos", "a few seconds")}</span>}
      </div>
      {result && !pending && !result.ok && <p className="note error" role="status">{result.message}</p>}
    </form>
  );
}

const OTHER = "__otra__";
const AUTO = "__auto__";

/** "Cambiar": elegir la palabra clave de la página de la lista (tus palabras y las del estudio) o escribir otra. */
export function KeywordPicker({ businessId, url, current, options, open: startOpen = false }: { businessId: string; url: string; current: string | null; options: string[]; open?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(startOpen);
  const list = current && !options.some((o) => o.toLowerCase() === current.toLowerCase()) ? [current, ...options] : options;
  const [choice, setChoice] = useState(current ?? (list[0] ?? OTHER));
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const keyword = choice === OTHER ? typed.trim() : choice === AUTO ? "" : choice;
  const id = `kw-${url.replace(/[^a-z0-9]+/gi, "-").slice(-40)}`;

  if (!open)
    return (
      <span className="stack" style={{ gap: 4 }}>
        <button type="button" className="btn link op-change" onClick={() => setOpen(true)}>
          {current ? t("Cambiar", "Change") : t("Elegir palabra clave", "Pick a keyword")}
        </button>
        {message && <span className={`small ${message.ok ? "muted" : "kw-error"}`} role="status">{message.text}</span>}
      </span>
    );

  return (
    <form
      className="op-picker"
      onSubmit={(e) => {
        e.preventDefault();
        if (choice === OTHER && keyword.length < 2) return;
        start(async () => {
          const r = await setPageKeyword(businessId, url, keyword);
          setMessage({ ok: r.ok, text: r.message });
          if (r.ok) setOpen(false);
        });
      }}
    >
      <label className="lbl" htmlFor={id}>{t("¿Por qué búsqueda debería salir esta página?", "Which search should this page show up for?")}</label>
      <select id={id} className="field" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={pending}>
        {list.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={OTHER}>{t("Escribir otra…", "Type another…")}</option>
        {current && <option value={AUTO}>{t("Que la elija la app", "Let the app pick")}</option>}
      </select>
      {choice === OTHER && (
        <input
          className="field"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={t("Ej.: cortinas metálicas Managua", "E.g. roof repair Miami")}
          maxLength={80}
          aria-label={t("Palabra clave", "Keyword")}
          autoComplete="off"
          disabled={pending}
        />
      )}
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn on" disabled={pending || (choice === OTHER && keyword.length < 2)}>
          {pending ? t("Guardando…", "Saving…") : t("Guardar", "Save")}
        </button>
        <button type="button" className="btn link" onClick={() => setOpen(false)} disabled={pending}>{t("Cancelar", "Cancel")}</button>
      </div>
      {message && !message.ok && <span className="small kw-error" role="alert">{message.text}</span>}
    </form>
  );
}
