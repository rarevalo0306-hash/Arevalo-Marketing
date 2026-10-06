"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { SuggestQuestionsResult, VisibilityRunResult } from "@/app/actions-seo-ai";
import { useT } from "@/components/I18n";

const MAX = 5;
const MAX_LEN = 200;

type Props = {
  action: (prev: VisibilityRunResult, f: FormData) => Promise<VisibilityRunResult>;
  suggest: () => Promise<SuggestQuestionsResult>;
  initial: string[];
  /** Nombres de las IAs que se van a consultar. */
  providers: string[];
};

/** Mientras las IAs contestan: pasos aproximados y el tiempo que lleva. */
function Working({ pending, providers, count }: { pending: boolean; providers: string[]; count: number }) {
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
    [0, t(`Preguntando a ${providers.join(", ")} (${count} preguntas, con búsqueda en internet)`, `Asking ${providers.join(", ")} (${count} questions, with web search)`)],
    [35, t("Buscando tu nombre y tu página en cada respuesta", "Looking for your name and website in each answer")],
    [60, t("Anotando qué competidores recomiendan las IAs", "Noting which competitors the AIs recommend")],
    [85, t("Escribiendo qué puedes hacer para aparecer más", "Writing what you can do to show up more")],
  ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} ·{" "}
        {t(
          "Puede tardar de 1 a 4 minutos (a Gemini le preguntamos de a una para no pasar su límite) y usa el saldo de tus cuentas de IA. No cierres esta página.",
          "It can take 1 to 4 minutes (we ask Gemini one question at a time to stay under its limit) and uses credit from your AI accounts. Don't close this page.",
        )}
      </p>
    </div>
  );
}

export function VisibilityForm({ action, suggest, initial, providers }: Props) {
  const { t } = useT();
  const [result, run, checking] = useActionState(action, null);
  const [questions, setQuestions] = useState<string[]>(initial.length ? initial.slice(0, MAX) : [""]);
  const [error, setError] = useState("");
  const [suggesting, startSuggest] = useTransition();
  const filled = questions.filter((q) => q.trim()).length;

  const setAt = (i: number, v: string) => setQuestions((qs) => qs.map((q, j) => (j === i ? v : q)));
  const remove = (i: number) => setQuestions((qs) => (qs.length > 1 ? qs.filter((_, j) => j !== i) : [""]));

  const ideas = () => {
    setError("");
    startSuggest(async () => {
      const r = await suggest();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.questions.length) setQuestions(r.questions.slice(0, MAX));
    });
  };

  return (
    <form action={run} className={`ai-box glow stack${checking ? " busy" : ""}`} style={{ gap: 14 }}>
      {/* Mientras las IAs contestan, el formulario se esconde sin desmontarse: así no se pierden las preguntas. */}
      <div className="stack" style={{ gap: 14, display: checking ? "none" : undefined }} aria-hidden={checking}>
        <div className="stack" style={{ gap: 4 }}>
          <strong className="ai-title">{t("Preguntas de tus clientes", "Your customers' questions")}</strong>
          <p className="small muted">
            {t(
              "Escribe lo que un cliente le preguntaría a una IA para encontrar un negocio como el tuyo, sin poner tu nombre. Hasta 5 preguntas.",
              "Write what a customer would ask an AI to find a business like yours, without your name. Up to 5 questions.",
            )}
          </p>
        </div>
        <ol className="vis-questions">
          {questions.map((q, i) => (
            <li key={i} className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
              <input
                name="question"
                className="field"
                maxLength={MAX_LEN}
                value={q}
                onChange={(e) => setAt(i, e.target.value)}
                placeholder={i === 0 ? t("Ej.: ¿Quién es el mejor ajustador público en Hialeah?", "E.g.: best public adjuster near Miami for roof damage") : ""}
                aria-label={`${t("Pregunta", "Question")} ${i + 1}`}
              />
              <button type="button" className="btn link" onClick={() => remove(i)} aria-label={`${t("Quitar pregunta", "Remove question")} ${i + 1}`} title={t("Quitar", "Remove")}>
                ✕
              </button>
            </li>
          ))}
        </ol>
        <div className="row">
          {questions.length < MAX && (
            <button type="button" className="btn" onClick={() => setQuestions((qs) => [...qs, ""])}>
              + {t("Agregar pregunta", "Add question")}
            </button>
          )}
          <button type="button" className="btn" onClick={ideas} disabled={suggesting}>
            {suggesting ? t("La IA está pensando preguntas…", "The AI is coming up with questions…") : `✦ ${t("Sugerir preguntas", "Suggest questions")}`}
          </button>
        </div>
        {error && <p className="note error" role="alert">{error}</p>}
        {result && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
        <div className="row">
          <button type="submit" className="btn ai" disabled={!filled || suggesting}>
            ✦ {t("Revisar si las IAs me recomiendan", "Check if AIs recommend me")}
          </button>
          <span className="small muted">
            {t(
              `${filled} pregunta(s) × ${providers.length} IA(s) = ${filled * providers.length} búsquedas`,
              `${filled} question(s) × ${providers.length} AI(s) = ${filled * providers.length} searches`,
            )}
          </span>
        </div>
      </div>
      <Working pending={checking} providers={providers} count={filled} />
    </form>
  );
}
