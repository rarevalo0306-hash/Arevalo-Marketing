"use client";

import { useActionState, useState } from "react";
import type { ToxicResult } from "@/app/actions-toxic";
import { useT } from "@/components/I18n";
import { MANUAL_ACTIONS_URL, OUTCOME_TEXT, wizardOutcome, type Answer, type Outcome, type SpikeLevel } from "@/lib/toxic-links-shape";
import s from "./Toxic.module.css";

type Props = {
  action: (prev: ToxicResult, f: FormData) => Promise<ToxicResult>;
  spike: SpikeLevel;
  high: number;
  newRisky: number;
  /** Lo que el dueño respondió la última vez (y cuándo, ya escrito). */
  saved: { manual: Answer; drop: Answer; at: string } | null;
  gscConnected: boolean;
};

const RESULT_CLASS: Record<Outcome, string> = { nothing: s.resultNothing, watch: s.resultWatch, prepare: s.resultPrepare };

function Question({ name, value, onChange, legend, help }: { name: string; value: Answer | null; onChange: (a: Answer) => void; legend: string; help: React.ReactNode }) {
  const { t } = useT();
  const opts: [Answer, string][] = [
    ["yes", t("Sí", "Yes")],
    ["no", t("No", "No")],
    ["unsure", t("No sé", "Not sure")],
  ];
  return (
    <fieldset className={s.q}>
      <legend>{legend}</legend>
      <p className={s.qHelp}>{help}</p>
      <div className={s.answers} role="radiogroup">
        {opts.map(([v, label]) => (
          <label key={v} className={`${s.answer} ${value === v ? s.answerOn : ""}`}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** «¿Necesito desautorizar?»: dos preguntas y, con los datos, uno de tres resultados (por defecto «No hagas nada»). */
export function DecisionGuide({ action, spike, high, newRisky, saved, gscConnected }: Props) {
  const { t, lang } = useT();
  const [manual, setManual] = useState<Answer | null>(saved?.manual ?? null);
  const [drop, setDrop] = useState<Answer | null>(saved?.drop ?? null);
  const [result, run, pending] = useActionState(action, null);
  const w = wizardOutcome({ manual, drop, spike, high });
  const answered = manual !== null && drop !== null;
  const changed = !saved || saved.manual !== manual || saved.drop !== drop;
  const tx = (b: { es: string; en: string }) => (lang === "en" ? b.en : b.es);

  return (
    <form action={run} className="stack" style={{ gap: 12 }}>
      <div className={s.calm}>
        <span className={s.calmIcon} aria-hidden="true">✓</span>
        <span>
          {t(
            "Lo más importante: Google ya ignora solo casi todos los enlaces de spam. Desautorizar enlaces por error te puede bajar en Google, así que solo se hace en dos casos.",
            "Most important: Google already ignores almost all spam links on its own. Disavowing links by mistake can push you down on Google, so it's only done in two cases.",
          )}
        </span>
      </div>

      <Question
        name="manual"
        value={manual}
        onChange={setManual}
        legend={t("1. ¿Search Console te muestra una «Acción manual» por enlaces no naturales?", "1. Does Search Console show a “Manual action” for unnatural links?")}
        help={
          <>
            <a href={MANUAL_ACTIONS_URL} target="_blank" rel="noopener noreferrer">
              {t("Abre «Acciones manuales» en Search Console", "Open “Manual actions” in Search Console")}
            </a>
            {t(". Si dice «No se han detectado problemas», la respuesta es No.", ". If it says “No issues detected”, the answer is No.")}
            {gscConnected
              ? t(
                  " Aunque tu Search Console está conectado, Google no deja que las apps lean esta parte: confírmalo tú con el enlace.",
                  " Even though your Search Console is connected, Google doesn't let apps read this part: confirm it yourself with the link.",
                )
              : ""}
          </>
        }
      />
      <Question
        name="drop"
        value={drop}
        onChange={setDrop}
        legend={t("2. ¿Bajaste fuerte en Google de repente y ves muchos enlaces nuevos raros?", "2. Did you suddenly drop hard on Google and see lots of odd new links?")}
        help={
          newRisky > 0
            ? t(
                `Según nuestra revisión, este mes llegaron ${newRisky} ${newRisky === 1 ? "sitio nuevo" : "sitios nuevos"} de riesgo.`,
                `According to our check, ${newRisky} new risky ${newRisky === 1 ? "site" : "sites"} arrived this month.`,
              )
            : t("Según nuestra revisión, no llegaron sitios nuevos de riesgo este mes.", "According to our check, no new risky sites arrived this month.")
        }
      />

      <div className={`${s.result} ${RESULT_CLASS[w.outcome]}`} aria-live="polite">
        <span className={s.resultTag}>{answered ? t("Nuestra recomendación", "Our recommendation") : t("Por ahora", "For now")}</span>
        <span className={s.resultTitle}>{tx(OUTCOME_TEXT[w.outcome])}</span>
        <ul className={s.why}>
          {w.why.map((x, i) => (
            <li key={i}>{tx(x)}</li>
          ))}
        </ul>
        {w.outcome === "prepare" && (
          <p className="small" style={{ margin: 0, color: "var(--err-text)", fontWeight: 700 }}>
            {t(
              "Aun así: pon solo los sitios claramente dañinos (los de riesgo alto que revisaste uno por uno). Si tienes dudas, pide ayuda a alguien que sepa de SEO antes de subirlo.",
              "Even so: include only clearly harmful sites (the high-risk ones you reviewed one by one). If in doubt, ask someone who knows SEO before uploading it.",
            )}
          </p>
        )}
      </div>

      <div className="row" style={{ display: pending ? "none" : undefined }}>
        <button type="submit" className="btn outline" disabled={!answered || !changed}>
          {t("Guardar mis respuestas", "Save my answers")}
        </button>
        {saved && <span className="small muted">{t(`Última vez: ${saved.at}.`, `Last time: ${saved.at}.`)}</span>}
      </div>
      {pending && <p className="small muted">{t("Guardando…", "Saving…")}</p>}
      {result && !pending && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}
