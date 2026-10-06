"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { WriterResult } from "@/app/actions-seo-writer";
import { useT } from "@/components/I18n";

type Props = {
  businessId: string;
  action: (prev: WriterResult, f: FormData) => Promise<WriterResult>;
  defaultKeyword: string;
  defaultLanguage: "es" | "en";
  /** Zona principal de Google, para explicar dónde se busca. */
  zone: string;
  /** Costo de DataForSEO por artículo (USD). */
  serpCost: number;
};

/** Mientras se escribe: pasos aproximados y el tiempo que lleva. */
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
    [0, t("Mirando los 10 primeros de Google…", "Looking at Google's top 10…")],
    [6, t("Leyendo las páginas que ganan…", "Reading the winning pages…")],
    [16, t("Escribiendo tu artículo…", "Writing your article…")],
    [95, t("Revisando que cumpla todo…", "Checking that it ticks every box…")],
  ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} ·{" "}
        {t("Suele tardar de 1 a 2 minutos. No cierres esta página.", "It usually takes 1 to 2 minutes. Don't close this page.")}
      </p>
    </div>
  );
}

/** Formulario para escribir un artículo: la búsqueda, el idioma y el botón. */
export function WriterForm({ businessId, action, defaultKeyword, defaultLanguage, zone, serpCost }: Props) {
  const { t, lang } = useT();
  const router = useRouter();
  const [result, run, pending] = useActionState(action, null);
  const [keyword, setKeyword] = useState(defaultKeyword);
  const cost = new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(serpCost);

  // Al terminar, se abre el artículo nuevo.
  useEffect(() => {
    if (result?.ok && result.id) router.replace(`/b/${businessId}/seo/escribir?a=${encodeURIComponent(result.id)}`, { scroll: false });
  }, [result, businessId, router]);

  return (
    <form action={run} className="stack" style={{ gap: 14 }}>
      {/* El formulario se queda montado mientras trabaja (con display, no con hidden: .stack lo anula). */}
      <div className="stack" style={{ gap: 14, display: pending ? "none" : undefined }}>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="wr-keyword">{t("¿Para qué búsqueda quieres salir en Google?", "Which search do you want to show up for on Google?")}</label>
          <input
            id="wr-keyword"
            name="keyword"
            className="field"
            required
            minLength={2}
            maxLength={80}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t("Ej.: reparación de techos en Miami", "E.g. roof repair in Miami")}
            autoComplete="off"
          />
          <span className="small muted">
            {t(`Buscamos en Google desde tu zona principal: ${zone}.`, `We search Google from your main area: ${zone}.`)}
          </span>
        </div>
        <div className="stack" style={{ gap: 6, maxWidth: 260 }}>
          <label className="lbl" htmlFor="wr-language">{t("Idioma del artículo", "Article language")}</label>
          <select id="wr-language" name="language" className="field" defaultValue={defaultLanguage}>
            <option value="es">{t("Español", "Spanish")}</option>
            <option value="en">{t("Inglés", "English")}</option>
          </select>
        </div>
        <div className="row">
          <button type="submit" className="btn ai" disabled={keyword.trim().length < 2}>{t("Escribir artículo", "Write article")}</button>
          <span className="small muted">
            {t(`Usa unos ${cost} de DataForSEO más lo que cobre tu IA (unos centavos).`, `Uses about ${cost} of DataForSEO plus what your AI charges (a few cents).`)}
          </span>
        </div>
      </div>
      <Working pending={pending} />
      {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}
