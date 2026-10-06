"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { InterviewResult, StudyResult } from "@/app/actions";
import { useT } from "@/components/I18n";
import { GOALS, type Interview, type StudyInput } from "@/lib/study-shape";

type Props = {
  action: (prev: StudyResult, f: FormData) => Promise<StudyResult>;
  interview: (f: FormData) => Promise<InterviewResult>;
  input: StudyInput;
  /** Qué IA investiga en internet, o null si ninguna puede. */
  researcher: string | null;
  has: boolean;
};

type Basics = Omit<StudyInput, "answers">;

/** Mientras la IA trabaja: pasos aproximados y el tiempo que lleva. */
function Working({ research, pending }: { research: boolean; pending: boolean }) {
  const { t } = useT();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [pending]);
  if (!pending) return null;
  const steps: [number, string][] = [
    [0, t("Leyendo tu negocio, tus respuestas y tu página web", "Reading your business, your answers and your website")],
    ...(research
      ? ([[6, t("Investigando en internet a tu competencia y cómo te busca la gente", "Researching your competitors online and how people search for you")]] as [number, string][])
      : []),
    [research ? 50 : 10, t("Escogiendo tu público y las palabras clave para Google", "Choosing your audience and Google keywords")],
    [research ? 90 : 35, t("Escribiendo ideas de campaña con foto y video", "Writing campaign ideas with photo and video")],
  ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · {t("Suele tardar de 1 a 3 minutos. No cierres esta página.", "It usually takes 1 to 3 minutes. Don't close this page.")}
      </p>
    </div>
  );
}

export function StudyForm({ action, interview, input, researcher, has }: Props) {
  const { t } = useT();
  const [result, run, generating] = useActionState(action, null);
  const [step, setStep] = useState<"basico" | "preguntas">("basico");
  const [basics, setBasics] = useState<Basics>({
    services: input.services,
    customers: input.customers,
    zone: input.zone,
    competitors: input.competitors,
    different: input.different,
    goal: input.goal,
    lang: input.lang,
  });
  const [research, setResearch] = useState(!!researcher);
  const [questions, setQuestions] = useState<Interview["questions"]>([]);
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [thinking, startThinking] = useTransition();

  // Cuando el estudio queda listo, el formulario vuelve al principio.
  useEffect(() => {
    if (result?.ok) setStep("basico");
  }, [result]);

  const set = (k: keyof Basics) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setBasics((b) => ({ ...b, [k]: e.target.value }));

  const answers = questions
    .map((q, i) => ({ question: q.question, answer: [...(picks[i] ?? []), other[i]?.trim() ?? ""].filter(Boolean).join(", ") }))
    .filter((a) => a.answer);

  const toggle = (i: number, option: string, multiple: boolean) =>
    setPicks((p) => {
      const now = p[i] ?? [];
      const on = now.includes(option);
      return { ...p, [i]: on ? now.filter((o) => o !== option) : multiple ? [...now, option] : [option] };
    });

  const ask = () => {
    if (!basics.services.trim()) {
      setError(t("Cuéntale a la IA qué vendes o qué servicios das.", "Tell the AI what you sell or what services you offer."));
      return;
    }
    setError("");
    const f = new FormData();
    for (const [k, v] of Object.entries(basics)) f.set(k, v);
    startThinking(async () => {
      const r = await interview(f);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setQuestions(r.interview.questions);
      setPicks({});
      setOther({});
      setStep("preguntas");
    });
  };

  return (
    <form action={run} className="ai-box glow stack" style={{ gap: 16 }}>
      {Object.entries(basics).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="hidden" name="answers" value={JSON.stringify(answers)} />
      {research && <input type="hidden" name="research" value="on" />}

      {/* Mientras la IA genera, el formulario se esconde sin desmontarse: así no se pierde lo que contestó. */}
      <div className="stack" style={{ gap: 16, display: generating ? "none" : undefined }} aria-hidden={generating}>
        {step === "basico" ? (
          <>
            <div className="stack" style={{ gap: 4 }}>
              <span className="small muted">{t("Paso 1 de 2 · Lo básico", "Step 1 of 2 · The basics")}</span>
              <strong className="ai-title">{has ? t("Actualizar el estudio", "Update the study") : t("Cuéntale a la IA sobre tu negocio", "Tell the AI about your business")}</strong>
              <p className="small muted">
                {t(
                  "Con esto la IA lee tu negocio y te hace unas preguntas a la medida, con respuestas para tocar.",
                  "With this the AI reads your business and asks you a few tailored questions, with answers you can just tap.",
                )}
              </p>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl" htmlFor="services">{t("¿Qué vendes o qué servicios das?", "What do you sell or what services do you offer?")}</label>
              <textarea id="services" className="field" style={{ minHeight: 90 }} maxLength={2000} value={basics.services} onChange={set("services")} placeholder={t("Ej.: Fabricamos e instalamos cortinas metálicas para negocios y casas.", "E.g.: We make and install metal roll-up doors for businesses and homes.")} />
            </div>
            <div className="grid-2" style={{ gap: 14 }}>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="zone">{t("¿Dónde trabajas?", "Where do you work?")}</label>
                <input id="zone" className="field" maxLength={300} value={basics.zone} onChange={set("zone")} placeholder={t("Ciudad, departamento o país", "City, state or country")} />
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="customers">{t("¿Quién es tu cliente ideal?", "Who is your ideal customer?")}</label>
                <input id="customers" className="field" maxLength={1000} value={basics.customers} onChange={set("customers")} placeholder={t("Ej.: Dueños de negocios y de casas", "E.g.: Business owners and homeowners")} />
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="goal">{t("¿Qué quieres lograr?", "What do you want to achieve?")}</label>
                <select id="goal" className="field" value={basics.goal} onChange={set("goal")}>
                  {GOALS.map(([id, es, en]) => <option key={id} value={id}>{t(es, en)}</option>)}
                </select>
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="study-lang">{t("Tus clientes hablan", "Your customers speak")}</label>
                <select id="study-lang" className="field" value={basics.lang} onChange={set("lang")}>
                  <option value="es">{t("Español", "Spanish")}</option>
                  <option value="en">{t("Inglés", "English")}</option>
                  <option value="both">{t("Los dos", "Both")}</option>
                </select>
              </div>
            </div>
            {error && <p className="note error" role="alert">{error}</p>}
            {result && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
            <div className="row">
              <button type="button" className="btn ai" onClick={ask} disabled={thinking}>
                {thinking ? t("La IA está leyendo tu negocio…", "The AI is reading your business…") : t("Siguiente: la IA te pregunta →", "Next: the AI asks you →")}
              </button>
              <button type="submit" className="btn link" disabled={thinking || !basics.services.trim()}>{t("Generar sin preguntas", "Generate without questions")}</button>
            </div>
          </>
        ) : (
          <>
            <div className="stack" style={{ gap: 4 }}>
              <span className="small muted">{t("Paso 2 de 2 · La IA quiere saber más", "Step 2 of 2 · The AI wants to know more")}</span>
              <strong className="ai-title">{t("Unas preguntas sobre tu negocio", "A few questions about your business")}</strong>
              <p className="small muted">{t("Toca las respuestas que apliquen o escribe la tuya. Las que no sepas, déjalas en blanco.", "Tap the answers that apply or write your own. Leave blank any you don't know.")}</p>
            </div>
            {questions.map((q, i) => (
              <fieldset key={i} className="interview-q">
                <legend className="lbl">{q.question}</legend>
                <span className="small muted">{q.why}{q.multiple ? t(" · Puedes elegir varias.", " · You can pick several.") : ""}</span>
                <div className="opts">
                  {q.options.map((o) => {
                    const on = (picks[i] ?? []).includes(o);
                    return (
                      <button key={o} type="button" className={on ? "opt on" : "opt"} aria-pressed={on} onClick={() => toggle(i, o, q.multiple)}>
                        {o}
                      </button>
                    );
                  })}
                </div>
                <input className="field" maxLength={300} value={other[i] ?? ""} onChange={(e) => setOther((s) => ({ ...s, [i]: e.target.value }))} placeholder={t("Otra respuesta o más detalles…", "Another answer or more details…")} aria-label={`${t("Otra respuesta", "Another answer")}: ${q.question}`} />
              </fieldset>
            ))}
            <div className="grid-2" style={{ gap: 14 }}>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="different">{t("¿Qué te hace diferente?", "What makes you different?")} <span className="small muted">{t("(opcional)", "(optional)")}</span></label>
                <input id="different" className="field" maxLength={1000} value={basics.different} onChange={set("different")} placeholder={t("Ej.: Garantía, instalación el mismo día", "E.g.: Warranty, same-day installation")} />
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="competitors">{t("Competidores", "Competitors")} <span className="small muted">{t("(opcional)", "(optional)")}</span></label>
                <input id="competitors" className="field" maxLength={600} value={basics.competitors} onChange={set("competitors")} placeholder={t("Nombres o páginas web", "Names or websites")} />
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={research} onChange={(e) => setResearch(e.target.checked)} disabled={!researcher} />
              <span>
                <strong>{t("Investigar en internet", "Research online")}</strong>
                <span className="small muted" style={{ display: "block" }}>
                  {researcher
                    ? t(
                        `${researcher} busca en Google a tus competidores, cómo te busca la gente en tu zona y las temporadas de tu mercado.`,
                        `${researcher} searches Google for your competitors, how people in your area search for you and the seasons in your market.`,
                      )
                    : t(
                        "Para investigar en internet hace falta la clave de Gemini o de Claude. Sin ella, la IA usa lo que ya sabe.",
                        "Researching online needs the Gemini or Claude key. Without it, the AI uses what it already knows.",
                      )}
                </span>
              </span>
            </label>
            {result && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
            <div className="row">
              <button type="button" className="btn" onClick={() => setStep("basico")}>← {t("Atrás", "Back")}</button>
              <button type="submit" className="btn ai">✦ {has ? t("Actualizar estudio", "Update study") : t("Generar estudio", "Generate study")}</button>
              <span className="small muted">{t(`${answers.length} de ${questions.length} contestadas`, `${answers.length} of ${questions.length} answered`)}</span>
            </div>
          </>
        )}
      </div>
      <Working research={research} pending={generating} />
    </form>
  );
}
