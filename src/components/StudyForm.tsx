"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { InterviewResult, PrefillResult, StudyResult } from "@/app/actions-study";
import { useT } from "@/components/I18n";
import { StudyCustomers } from "@/components/StudyCustomers";
import { type CustomerOption, GOALS, type IdealCustomer, idealCustomersOf, type Interview, type StudyInput } from "@/lib/study-shape";
import s from "./StudyForm.module.css";

type Props = {
  generate: (prev: StudyResult, f: FormData) => Promise<StudyResult>;
  interview: (f: FormData) => Promise<InterviewResult>;
  prefill: () => Promise<PrefillResult>;
  input: StudyInput;
  /** Qué IA investiga en internet, o null si ninguna puede. */
  researcher: string | null;
  has: boolean;
  website: string;
  hasProfile: boolean;
  /** Leer la página web apenas se abre (negocio recién creado, o sin respuestas guardadas). */
  autoRead: boolean;
  settingsHref: string;
};

type Basics = Pick<StudyInput, "services" | "zone" | "competitors" | "different" | "goal" | "lang">;
type Step = 1 | 2 | 3;

/** Lista de pasos con el tiempo que lleva la IA (aproximado). */
function Progress({ steps, pending, note }: { steps: [number, string][]; pending: boolean; note: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  if (!pending) return null;
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · {note}
      </p>
    </div>
  );
}

/** Los 3 pasos arriba del formulario. Se puede volver a un paso anterior tocándolo. */
function Stepper({ step, go, labels }: { step: Step; go: (s: Step) => void; labels: [string, string, string] }) {
  return (
    <ol className={s.stepper}>
      {labels.map((label, i) => {
        const n = (i + 1) as Step;
        const state = n === step ? s.now : n < step ? s.done : "";
        return (
          <li key={label} className={`${s.stepItem} ${state}`}>
            <button type="button" className={s.stepBtn} onClick={() => go(n)} disabled={n > step} aria-current={n === step ? "step" : undefined}>
              <span className={s.stepNum}>{n < step ? "✓" : n}</span>
              <span className={s.stepLabel}>{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function StudyForm({ generate, interview, prefill, input, researcher, has, website, hasProfile, autoRead, settingsHref }: Props) {
  const { t } = useT();
  // Si la conexión se corta mientras la IA trabaja, se avisa en vez de mostrar una página de error.
  const [result, run, generating] = useActionState(async (prev: StudyResult, f: FormData): Promise<StudyResult> => {
    try {
      return await generate(prev, f);
    } catch {
      return {
        ok: false,
        message: t(
          "Se cortó la conexión mientras la IA trabajaba. Recarga la página: si el estudio no aparece, genéralo otra vez (tus respuestas quedaron guardadas).",
          "The connection dropped while the AI was working. Reload the page: if the study isn't there, generate it again (your answers were saved).",
        ),
      };
    }
  }, null);
  const [step, setStep] = useState<Step>(1);
  const [basics, setBasics] = useState<Basics>({
    services: input.services,
    zone: input.zone,
    competitors: input.competitors,
    different: input.different,
    goal: input.goal,
    lang: input.lang,
  });
  const [chosen, setChosen] = useState<IdealCustomer[]>(() => idealCustomersOf(input));
  const [options, setOptions] = useState<CustomerOption[]>(input.customerOptions);
  const [research, setResearch] = useState(!!researcher);
  const [questions, setQuestions] = useState<Interview["questions"]>([]);
  const [askedFor, setAskedFor] = useState("");
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [askError, setAskError] = useState("");
  const [read, setRead] = useState<Extract<PrefillResult, { ok: true }> | null>(null);
  const [readError, setReadError] = useState("");
  const [thinking, startThinking] = useTransition();
  const [reading, startReading] = useTransition();
  const top = useRef<HTMLDivElement>(null);

  // Cuando el estudio queda listo, el formulario vuelve al principio.
  useEffect(() => {
    if (result?.ok) setStep(1);
  }, [result]);

  const set = (k: keyof Basics) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setBasics((b) => ({ ...b, [k]: e.target.value }));

  const go = (n: Step) => {
    setStep(n);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const readWeb = () => {
    setReadError("");
    startReading(async () => {
      let r: PrefillResult;
      try {
        r = await prefill();
      } catch {
        r = { ok: false, error: t("No se pudo leer tu página. Intenta de nuevo.", "Your website couldn't be read. Please try again.") };
      }
      if (!r.ok) {
        setReadError(r.error);
        return;
      }
      setRead(r);
      setBasics((b) => ({ ...b, services: r.input.services, zone: r.input.zone, lang: r.input.lang, goal: r.input.goal, different: r.input.different }));
      setChosen(idealCustomersOf(r.input));
      setOptions(r.input.customerOptions);
    });
  };

  // Negocio nuevo o sin respuestas: la IA lee la página web sola, una vez.
  const autoDone = useRef(false);
  useEffect(() => {
    if (autoRead && !autoDone.current && (website || hasProfile)) {
      autoDone.current = true;
      readWeb();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRead]);

  const answers = questions
    .map((q, i) => ({ question: q.question, answer: [...(picks[i] ?? []).filter((p) => q.options.includes(p)), other[i]?.trim() ?? ""].filter(Boolean).join(", ") }))
    .filter((a) => a.answer);
  // Si no se hicieron preguntas esta vez, se mandan las respuestas guardadas.
  const sentAnswers = questions.length ? answers : input.answers;

  const fields = (): FormData => {
    const f = new FormData();
    for (const [k, v] of Object.entries(basics)) f.set(k, v);
    f.set("idealCustomers", JSON.stringify(chosen));
    f.set("customerOptions", JSON.stringify(options));
    f.set("customers", chosen.map((c) => c.name).join(", "));
    return f;
  };
  const key = JSON.stringify([basics.services, basics.zone, basics.lang, chosen.map((c) => c.name)]);

  const toQuestions = () => {
    if (!basics.services.trim()) {
      setError(t("Cuéntale a la IA qué vendes o qué servicios das (o toma la información de tu web).", "Tell the AI what you sell or what services you offer (or take the info from your website)."));
      return;
    }
    setError("");
    go(2);
    if (askedFor === key && questions.length) return;
    setAskError("");
    const f = fields();
    startThinking(async () => {
      let r: InterviewResult;
      try {
        r = await interview(f);
      } catch {
        r = { ok: false, error: t("Se cortó la conexión. Intenta de nuevo.", "The connection dropped. Please try again.") };
      }
      if (!r.ok) {
        setAskError(r.error);
        return;
      }
      setQuestions(r.interview.questions);
      setAskedFor(key);
      setPicks({});
      setOther({});
    });
  };

  const skip = () => {
    if (!basics.services.trim()) {
      setError(t("Cuéntale a la IA qué vendes o qué servicios das.", "Tell the AI what you sell or what services you offer."));
      return;
    }
    setError("");
    go(3);
  };

  const toggle = (i: number, option: string, multiple: boolean) =>
    setPicks((p) => {
      const now = p[i] ?? [];
      const on = now.includes(option);
      return { ...p, [i]: on ? now.filter((o) => o !== option) : multiple ? [...now, option] : [option] };
    });

  const langs: [StudyInput["lang"], string][] = [
    ["es", t("Español", "Spanish")],
    ["en", t("Inglés", "English")],
    ["both", t("Los dos", "Both")],
  ];
  const stepLabels: [string, string, string] = [t("Tu negocio", "Your business"), t("Preguntas de la IA", "AI questions"), t("Tu estudio", "Your study")];
  const resultNote = result && (
    <p className={result.ok ? (result.warning ? "note" : "note ok") : "note error"} role="status">
      {result.message}
    </p>
  );

  return (
    <form
      action={run}
      className="ai-box glow stack"
      style={{ gap: 18 }}
      onKeyDown={(e) => {
        // Enter en un campo no genera el estudio por accidente.
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
      }}
    >
      {Object.entries(basics).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="hidden" name="idealCustomers" value={JSON.stringify(chosen)} />
      <input type="hidden" name="customerOptions" value={JSON.stringify(options)} />
      <input type="hidden" name="customers" value={chosen.map((c) => c.name).join(", ")} />
      <input type="hidden" name="answers" value={JSON.stringify(sentAnswers)} />
      {research && <input type="hidden" name="research" value="on" />}

      <div ref={top} className={s.anchor} />
      {/* Mientras la IA genera, el formulario se esconde sin desmontarse: así no se pierde lo que contestó. */}
      <div className="stack" style={{ gap: 18, display: generating ? "none" : undefined }} aria-hidden={generating}>
        <Stepper step={step} go={go} labels={stepLabels} />

        {step === 1 && (
          <>
            <div className="stack" style={{ gap: 4 }}>
              <span className="small muted">{t("Paso 1 de 3", "Step 1 of 3")}</span>
              <strong className="ai-title">{has ? t("Revisa los datos de tu negocio", "Check your business details") : t("Lo que la IA sabe de tu negocio", "What the AI knows about your business")}</strong>
              <p className="small muted">
                {t(
                  "Solo revisa y corrige. Si algo ya está en tu página web, la IA lo toma de ahí: no tienes que escribirlo.",
                  "Just check and fix. If something is already on your website, the AI takes it from there: you don't have to type it.",
                )}
              </p>
            </div>

            {website || hasProfile ? (
              <div className={s.webBox}>
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <strong>{website ? t("Tomar la información de mi web", "Take the info from my website") : t("Llenar con el perfil de mi negocio", "Fill in from my business profile")}</strong>
                  <span className="small muted">
                    {website
                      ? t(
                          `La IA lee ${website.replace(/^https?:\/\//, "").replace(/\/$/, "")} (inicio, servicios, nosotros y contacto) y llena qué vendes, dónde trabajas, tus clientes y su idioma.`,
                          `The AI reads ${website.replace(/^https?:\/\//, "").replace(/\/$/, "")} (home, services, about and contact) and fills in what you sell, where you work, your customers and their language.`,
                        )
                      : t("La IA lee el perfil que guardaste y llena estos datos.", "The AI reads the profile you saved and fills in these details.")}
                  </span>
                </div>
                <button type="button" className="btn ai" onClick={readWeb} disabled={reading}>
                  ✦ {reading ? t("Leyendo…", "Reading…") : read ? t("Leer otra vez", "Read again") : website ? t("Tomar de mi web", "Take from my website") : t("Llenar", "Fill in")}
                </button>
              </div>
            ) : (
              <p className="note">
                {t("¿Tienes página web? Ponla en ", "Do you have a website? Add it in ")}
                <Link href={settingsHref}>{t("Ajustes del negocio", "Business settings")}</Link>
                {t(" y la IA llenará todo esto por ti.", " and the AI will fill all of this in for you.")}
              </p>
            )}

            <Progress
              pending={reading}
              note={t("Suele tardar menos de un minuto.", "It usually takes less than a minute.")}
              steps={[
                [0, t("Abriendo tu página web", "Opening your website")],
                [4, t("Leyendo servicios, zonas y contacto", "Reading services, areas and contact")],
                [12, t("Anotando qué vendes, dónde y a quién", "Noting what you sell, where and to whom")],
              ]}
            />
            {readError && <p className="note error" role="alert">{readError}</p>}
            {read && !reading && (
              <div className="note ok" role="status">
                {read.pages.length
                  ? t(`Listo: la IA leyó ${read.pages.length} ${read.pages.length === 1 ? "página" : "páginas"} de tu web.`, `Done: the AI read ${read.pages.length} ${read.pages.length === 1 ? "page" : "pages"} of your website.`)
                  : t("Listo: la IA leyó el perfil de tu negocio.", "Done: the AI read your business profile.")}{" "}
                {read.profileSaved && t("También armó y guardó el perfil de tu negocio. ", "It also wrote and saved your business profile. ")}
                {t("Revisa abajo y corrige lo que haga falta.", "Check below and fix anything that's needed.")}
                {read.pages.length > 0 && (
                  <details className={s.pages}>
                    <summary>{t("Ver las páginas que leyó", "See the pages it read")}</summary>
                    <ul>
                      {read.pages.map((p) => (
                        <li key={p.url}>
                          <a href={p.url} target="_blank" rel="noopener noreferrer">{p.title || p.url}</a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            <div className="stack" style={{ gap: 18, display: reading ? "none" : undefined }}>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="services">{t("¿Qué vendes o qué servicios das?", "What do you sell or what services do you offer?")}</label>
                <textarea id="services" className="field" style={{ minHeight: 110 }} maxLength={2000} value={basics.services} onChange={set("services")} placeholder={t("Escribe tus servicios principales, uno por línea. Ej.: reparación de techos, instalación, mantenimiento…", "Write your main services, one per line. E.g.: roof repair, installation, maintenance…")} />
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <label className="lbl" htmlFor="zone">{t("¿Dónde trabajas?", "Where do you work?")}</label>
                <input id="zone" className="field" maxLength={300} value={basics.zone} onChange={set("zone")} placeholder={t("Ciudades, condados o país que atiendes", "Cities, counties or country you serve")} />
              </div>
              <StudyCustomers
                chosen={chosen}
                options={options}
                onChange={(c, o) => {
                  setChosen(c);
                  setOptions(o);
                }}
              />
              <div className="grid-2" style={{ gap: 18 }}>
                <fieldset className={s.plain}>
                  <legend className="lbl">{t("Tus clientes hablan", "Your customers speak")}</legend>
                  <div className="opts" style={{ marginTop: 6 }}>
                    {langs.map(([id, label]) => (
                      <button key={id} type="button" className={basics.lang === id ? "opt on" : "opt"} aria-pressed={basics.lang === id} onClick={() => setBasics((b) => ({ ...b, lang: id }))}>
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="stack" style={{ gap: 4 }}>
                  <label className="lbl" htmlFor="goal">{t("¿Qué quieres lograr?", "What do you want to achieve?")}</label>
                  <select id="goal" className="field" value={basics.goal} onChange={set("goal")}>
                    {GOALS.map(([id, es, en]) => <option key={id} value={id}>{t(es, en)}</option>)}
                  </select>
                </div>
              </div>
              {error && <p className="note error" role="alert">{error}</p>}
              {resultNote}
              <div className={s.actions}>
                <button type="button" className="btn ai" onClick={toQuestions} disabled={reading}>
                  {t("Siguiente: preguntas de la IA →", "Next: AI questions →")}
                </button>
                <button type="button" className="btn link" onClick={skip} disabled={reading}>
                  {t("Saltar las preguntas", "Skip the questions")}
                </button>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="stack" style={{ gap: 4 }}>
              <span className="small muted">{t("Paso 2 de 3", "Step 2 of 3")}</span>
              <strong className="ai-title">{t("La IA quiere saber un poco más", "The AI wants to know a bit more")}</strong>
              <p className="small muted">{t("Solo pregunta lo que no está en tu web. Toca las respuestas que apliquen o escribe la tuya; las que no sepas, déjalas en blanco.", "It only asks what isn't on your website. Tap the answers that apply or write your own; leave blank any you don't know.")}</p>
            </div>
            <Progress
              pending={thinking}
              note={t("Suele tardar unos segundos.", "It usually takes a few seconds.")}
              steps={[
                [0, t("Leyendo lo que ya sabe de tu negocio", "Reading what it already knows about your business")],
                [5, t("Preparando preguntas solo sobre lo que falta", "Preparing questions only about what's missing")],
              ]}
            />
            {askError && !thinking && (
              <div className="stack" style={{ gap: 10 }}>
                <p className="note error" role="alert">{askError}</p>
                <div className={s.actions}>
                  <button type="button" className="btn" onClick={toQuestions}>{t("Intentar otra vez", "Try again")}</button>
                  <button type="button" className="btn link" onClick={() => go(3)}>{t("Seguir sin preguntas →", "Continue without questions →")}</button>
                </div>
              </div>
            )}
            {!thinking &&
              questions.map((q, i) => (
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
                  <input className="field" maxLength={300} value={other[i] ?? ""} onChange={(e) => setOther((v) => ({ ...v, [i]: e.target.value }))} placeholder={t("Otra respuesta o más detalles…", "Another answer or more details…")} aria-label={`${t("Otra respuesta", "Another answer")}: ${q.question}`} />
                </fieldset>
              ))}
            {!thinking && (
              <div className={s.actions}>
                <button type="button" className="btn" onClick={() => go(1)}>← {t("Atrás", "Back")}</button>
                {!askError && (
                  <button type="button" className="btn ai" onClick={() => go(3)}>
                    {t("Siguiente: hacer el estudio →", "Next: make the study →")}
                  </button>
                )}
                {questions.length > 0 && <span className="small muted">{t(`${answers.length} de ${questions.length} contestadas`, `${answers.length} of ${questions.length} answered`)}</span>}
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <div className="stack" style={{ gap: 4 }}>
              <span className="small muted">{t("Paso 3 de 3", "Step 3 of 3")}</span>
              <strong className="ai-title">{has ? t("Actualizar tu estudio", "Update your study") : t("Hacer tu estudio", "Make your study")}</strong>
              <p className="small muted">
                {t(
                  "La IA arma tu estudio con esto y lo guarda solo: tus clientes, tu mercado, las búsquedas de Google y las ideas para publicar.",
                  "The AI builds your study with this and saves it automatically: your customers, your market, Google searches and post ideas.",
                )}
              </p>
            </div>
            <dl className={s.summary}>
              <div>
                <dt>{t("Vendes", "You sell")}</dt>
                <dd>{basics.services.trim().slice(0, 160) || "—"}{basics.services.trim().length > 160 ? "…" : ""}</dd>
              </div>
              <div>
                <dt>{t("Dónde", "Where")}</dt>
                <dd>{basics.zone.trim() || "—"}</dd>
              </div>
              <div>
                <dt>{t("Clientes", "Customers")}</dt>
                <dd>{chosen.length ? chosen.map((c, i) => `${i + 1}. ${c.name}`).join(" · ") : "—"}</dd>
              </div>
              <div>
                <dt>{t("Idioma", "Language")}</dt>
                <dd>{langs.find(([id]) => id === basics.lang)?.[1]}</dd>
              </div>
            </dl>
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
            {resultNote}
            <div className={s.actions}>
              <button type="button" className="btn" onClick={() => go(questions.length || askError ? 2 : 1)}>← {t("Atrás", "Back")}</button>
              <button type="submit" className="btn ai">✦ {has ? t("Actualizar mi estudio", "Update my study") : t("Hacer mi estudio", "Make my study")}</button>
            </div>
          </>
        )}
      </div>
      <Progress
        pending={generating}
        note={t("Suele tardar de 1 a 3 minutos. No cierres esta página: el estudio se guarda solo al terminar.", "It usually takes 1 to 3 minutes. Don't close this page: the study saves itself when it's done.")}
        steps={[
          [0, t("Leyendo tu negocio, tus respuestas y tu página web", "Reading your business, your answers and your website")],
          ...(research ? ([[8, t("Investigando en internet a tu competencia y cómo te busca la gente", "Researching your competitors online and how people search for you")]] as [number, string][]) : []),
          [research ? 50 : 12, t("Ordenando tus clientes y las palabras para Google", "Ordering your customers and Google keywords")],
          [research ? 90 : 35, t("Escribiendo ideas para publicar con foto y video", "Writing post ideas with photo and video")],
          [research ? 140 : 70, t("Guardando tu estudio", "Saving your study")],
        ]}
      />
    </form>
  );
}
