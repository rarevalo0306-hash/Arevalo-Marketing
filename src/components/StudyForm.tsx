"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { InterviewResult, StudyResult } from "@/app/actions";
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
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [pending]);
  if (!pending) return null;
  const steps: [number, string][] = [
    [0, "Leyendo tu negocio, tus respuestas y tu página web"],
    ...(research ? ([[6, "Investigando en internet a tu competencia y cómo te busca la gente"]] as [number, string][]) : []),
    [research ? 50 : 10, "Escogiendo tu público y las palabras clave para Google"],
    [research ? 90 : 35, "Escribiendo ideas de campaña con foto y video"],
  ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · Suele tardar de 1 a 3 minutos. No cierres esta página.
      </p>
    </div>
  );
}

export function StudyForm({ action, interview, input, researcher, has }: Props) {
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
      setError("Cuéntale a la IA qué vendes o qué servicios das.");
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
              <span className="small muted">Paso 1 de 2 · Lo básico</span>
              <strong className="ai-title">{has ? "Actualizar el estudio" : "Cuéntale a la IA sobre tu negocio"}</strong>
              <p className="small muted">Con esto la IA lee tu negocio y te hace unas preguntas a la medida, con respuestas para tocar.</p>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl" htmlFor="services">¿Qué vendes o qué servicios das?</label>
              <textarea id="services" className="field" style={{ minHeight: 90 }} maxLength={2000} value={basics.services} onChange={set("services")} placeholder="Ej.: Fabricamos e instalamos cortinas metálicas para negocios y casas." />
            </div>
            <div className="grid-2" style={{ gap: 14 }}>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="zone">¿Dónde trabajas?</label>
                <input id="zone" className="field" maxLength={300} value={basics.zone} onChange={set("zone")} placeholder="Ciudad, departamento o país" />
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="customers">¿Quién es tu cliente ideal?</label>
                <input id="customers" className="field" maxLength={1000} value={basics.customers} onChange={set("customers")} placeholder="Ej.: Dueños de negocios y de casas" />
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="goal">¿Qué quieres lograr?</label>
                <select id="goal" className="field" value={basics.goal} onChange={set("goal")}>
                  {GOALS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="study-lang">Tus clientes hablan</label>
                <select id="study-lang" className="field" value={basics.lang} onChange={set("lang")}>
                  <option value="es">Español</option>
                  <option value="en">Inglés</option>
                  <option value="both">Los dos</option>
                </select>
              </div>
            </div>
            {error && <p className="note error" role="alert">{error}</p>}
            {result && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
            <div className="row">
              <button type="button" className="btn ai" onClick={ask} disabled={thinking}>
                {thinking ? "La IA está leyendo tu negocio…" : "Siguiente: la IA te pregunta →"}
              </button>
              <button type="submit" className="btn link" disabled={thinking || !basics.services.trim()}>Generar sin preguntas</button>
            </div>
          </>
        ) : (
          <>
            <div className="stack" style={{ gap: 4 }}>
              <span className="small muted">Paso 2 de 2 · La IA quiere saber más</span>
              <strong className="ai-title">Unas preguntas sobre tu negocio</strong>
              <p className="small muted">Toca las respuestas que apliquen o escribe la tuya. Las que no sepas, déjalas en blanco.</p>
            </div>
            {questions.map((q, i) => (
              <fieldset key={i} className="interview-q">
                <legend className="lbl">{q.question}</legend>
                <span className="small muted">{q.why}{q.multiple ? " · Puedes elegir varias." : ""}</span>
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
                <input className="field" maxLength={300} value={other[i] ?? ""} onChange={(e) => setOther((s) => ({ ...s, [i]: e.target.value }))} placeholder="Otra respuesta o más detalles…" aria-label={`Otra respuesta: ${q.question}`} />
              </fieldset>
            ))}
            <div className="grid-2" style={{ gap: 14 }}>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="different">¿Qué te hace diferente? <span className="small muted">(opcional)</span></label>
                <input id="different" className="field" maxLength={1000} value={basics.different} onChange={set("different")} placeholder="Ej.: Garantía, instalación el mismo día" />
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="competitors">Competidores <span className="small muted">(opcional)</span></label>
                <input id="competitors" className="field" maxLength={600} value={basics.competitors} onChange={set("competitors")} placeholder="Nombres o páginas web" />
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={research} onChange={(e) => setResearch(e.target.checked)} disabled={!researcher} />
              <span>
                <strong>Investigar en internet</strong>
                <span className="small muted" style={{ display: "block" }}>
                  {researcher
                    ? `${researcher} busca en Google a tus competidores, cómo te busca la gente en tu zona y las temporadas de tu mercado.`
                    : "Para investigar en internet hace falta la clave de Gemini o de Claude. Sin ella, la IA usa lo que ya sabe."}
                </span>
              </span>
            </label>
            {result && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
            <div className="row">
              <button type="button" className="btn" onClick={() => setStep("basico")}>← Atrás</button>
              <button type="submit" className="btn ai">✦ {has ? "Actualizar estudio" : "Generar estudio"}</button>
              <span className="small muted">{answers.length} de {questions.length} contestadas</span>
            </div>
          </>
        )}
      </div>
      <Working research={research} pending={generating} />
    </form>
  );
}
