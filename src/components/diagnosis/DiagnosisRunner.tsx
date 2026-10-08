"use client";

// Diagnóstico guiado (pantalla): los 10 pasos con su estado, el costo antes de empezar y la corrida paso a paso
// desde el navegador (cada paso es una llamada al servidor, así cada una cabe en el tiempo de Vercel).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { approveDiagnosisSpend, type DiagnosisReply, type DiagnosisStop, diagnosisNext, skipDiagnosisStep, startDiagnosis } from "@/app/actions-diagnosis";
import { useT } from "@/components/I18n";
import type { DiagnosisView } from "@/components/diagnosis/load";
import {
  type Bi,
  estimateStep,
  isComplete,
  needsApproval,
  nextStep,
  planCost,
  planRun,
  progress,
  shouldRedo,
  type StepId,
  type StepView,
  stepDef,
  TOTAL_STEPS,
} from "@/lib/diagnosis";
import { intlLocale } from "@/lib/i18n";
import { usd } from "@/lib/seo/setup-shared";
import { BUSINESS_TZ } from "@/lib/time";
import s from "./DiagnosisRunner.module.css";

type Props = {
  initial: DiagnosisView;
  /** Aceptar zonas y palabras clave (SeoSetup), para el paso 3. */
  setupSlot?: React.ReactNode;
  /** Elegir el negocio en Google Maps (MapPlacePicker), para el paso 7. */
  mapSlot?: React.ReactNode;
  /** Negocio nuevo con página web: el paso 1 empieza solo. */
  autoStart?: boolean;
  /** Viene de «Volver a hacerlo». */
  redoAll?: boolean;
};

const STATUS_PILL: Record<StepView["status"], string> = {
  pending: "neutral",
  running: "info",
  done: "done",
  skipped: "skipped",
  "needs-you": "warn",
  error: "failed",
};

export function DiagnosisRunner({ initial, setupSlot, mapSlot, autoStart, redoAll: redoInitial }: Props) {
  const { lang, t } = useT();
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState<StepId | null>(null);
  const [stop, setStop] = useState<DiagnosisStop | null>(null);
  const [error, setError] = useState("");
  const [redoAll, setRedoAll] = useState(!!redoInitial);
  const [confirmOne, setConfirmOne] = useState<StepId | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [pausing, setPausing] = useState(false);
  const pauseRef = useRef(false);
  const autoRef = useRef(false);
  const id = view.business.id;
  const pick = (b: Bi) => (lang === "en" ? b.en : b.es);
  const money = (n: number) => usd(n, lang);

  // Lo que se ve: si hay un paso corriendo, se marca en la lista (el servidor solo avisa al terminar).
  const steps: StepView[] = view.steps.map((v) => (v.id === runningId && busy ? { ...v, status: "running" } : v));
  const prog = progress(steps);
  const run = view.state.run;
  const active = !!run && !run.finishedAt;
  const complete = !!view.state.completedAt && isComplete(view.steps);
  const plan = planRun(view.steps, { redoAll });
  const cost = planCost(plan, view.facts, view.prices);
  const now = Date.parse(view.now) || Date.now();
  const date = new Intl.DateTimeFormat(intlLocale(lang), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: BUSINESS_TZ,
  });
  const current = steps.find((v) => v.status === "running");

  useEffect(() => {
    if (!busy || !runningId) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, [busy, runningId]);

  const apply = (r: DiagnosisReply): boolean => {
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setView(r.view);
    return true;
  };

  /** Hace los pasos uno tras otro hasta terminar, detenerse en algo del dueño o pausar. */
  const loop = async (from: DiagnosisView = view) => {
    setBusy(true);
    setStop(null);
    setError("");
    pauseRef.current = false;
    setPausing(false);
    try {
      let latest = from;
      for (let guard = 0; guard < 40 && !pauseRef.current; guard++) {
        const r = latest.state.run;
        setRunningId(r && !r.finishedAt ? nextStep(latest.steps, r) : null);
        const res = await diagnosisNext(id);
        if (!apply(res) || !res.ok) break;
        latest = res.view;
        if (res.stop) {
          setStop(res.stop);
          if (res.stop.kind === "finished") router.refresh();
          if (res.stop.kind === "needs-you") document.getElementById(`paso-${res.stop.step}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          break;
        }
      }
    } catch {
      setError(
        t(
          "Se perdió la conexión con el servidor. Lo hecho quedó guardado: presiona «Continuar».",
          "The connection to the server was lost. What's done is saved: press “Continue”.",
        ),
      );
    } finally {
      setBusy(false);
      setRunningId(null);
    }
  };

  const begin = async (opts: { only?: StepId[]; approve: number | null }) => {
    setBusy(true);
    setError("");
    setStop(null);
    setConfirmOne(null);
    let started: DiagnosisView;
    try {
      const r = await startDiagnosis(id, {
        redoAll: opts.only ? false : redoAll,
        only: opts.only,
        approve: opts.approve,
      });
      if (!apply(r) || !r.ok) return setBusy(false);
      if (r.stop?.kind === "busy") {
        setStop(r.stop);
        return setBusy(false);
      }
      started = r.view;
    } catch {
      setError(t("No se pudo empezar. Revisa tu conexión e intenta de nuevo.", "Couldn't start. Check your connection and try again."));
      return setBusy(false);
    }
    await loop(started);
  };

  const approve = async (amount: number | null) => {
    setBusy(true);
    try {
      const r = await approveDiagnosisSpend(id, amount);
      if (!apply(r) || !r.ok) return setBusy(false);
      await loop(r.view);
    } catch {
      setError(t("No se pudo guardar. Intenta de nuevo.", "Couldn't save. Try again."));
      setBusy(false);
    }
  };

  const skip = async (step: StepId) => {
    setBusy(true);
    try {
      const r = await skipDiagnosisStep(id, step);
      if (!apply(r) || !r.ok) return setBusy(false);
      if (r.view.state.run && !r.view.state.run.finishedAt) return loop(r.view);
    } catch {
      setError(t("No se pudo guardar. Intenta de nuevo.", "Couldn't save. Try again."));
    }
    setBusy(false);
  };

  /** «Ya lo hice, seguir»: sigue la corrida; si no hay una abierta, empieza con lo que falta (pidiendo permiso si cuesta). */
  const resume = () => {
    if (active) return loop(view);
    document.getElementById("diagnostico-inicio")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /** Rehacer o intentar de nuevo un solo paso: si cuesta, primero se confirma. */
  const one = (step: StepId) => {
    const amount = needsApproval(step) || step === "audit" ? estimateStep(step, view.facts, view.prices) : 0;
    if (amount > 0) return setConfirmOne(step);
    void begin({ only: [step], approve: null });
  };

  useEffect(() => {
    if (!autoStart || autoRef.current) return;
    autoRef.current = true;
    void begin({ only: ["web"], approve: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runningDef = current ? stepDef(current.id) : null;
  const pct = Math.round((prog.finished / TOTAL_STEPS) * 100);
  const started = !!view.state.startedAt;
  const doneText = (v: StepView) => {
    if (!v.at) return v.status === "done" ? t("Ya está hecho", "Already done") : "";
    const hours = Math.max(0, Math.floor((now - Date.parse(v.at)) / 3_600_000));
    const days = Math.floor(hours / 24);
    const when =
      hours < 1
        ? t("hace un momento", "just now")
        : hours < 24
          ? t(`hace ${hours} ${hours === 1 ? "hora" : "horas"}`, `${hours} ${hours === 1 ? "hour" : "hours"} ago`)
          : days === 1
            ? t("hace 1 día", "1 day ago")
            : t(`hace ${days} días`, `${days} days ago`);
    return `${v.status === "done" ? t("Hecho el", "Done on") : t("El", "On")} ${date.format(new Date(v.at))} (${when})`;
  };
  const statusLabel = (v: StepView) =>
    ({
      pending: t("Por hacer", "To do"),
      running: t("Trabajando…", "Working…"),
      done: v.stale ? t("Hecho · conviene rehacer", "Done · worth redoing") : t("Hecho", "Done"),
      skipped: t("Saltado", "Skipped"),
      "needs-you": t("Te necesita", "Needs you"),
      error: t("No se pudo", "Didn't work"),
    })[v.status];

  // ---------- Arriba: avance y lo que sigue ----------
  let hero: React.ReactNode;
  if (busy && runningDef) {
    hero = (
      <div className="stack" style={{ gap: 6 }} aria-live="polite">
        <h2 className={s.heroTitle}>
          {t("Trabajando en:", "Working on:")} {pick(runningDef.title)}
        </h2>
        <p className="small muted">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} ·{" "}
          {t(
            "Algunos pasos tardan hasta 2 o 3 minutos. Puedes mirar la lista, pero no cierres esta página.",
            "Some steps take up to 2 or 3 minutes. You can look at the list, but don't close this page.",
          )}
        </p>
        <div className={s.actions}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              pauseRef.current = true;
              setPausing(true);
            }}
            disabled={pausing}
          >
            {pausing ? t("Se pausa al terminar este paso…", "Pausing after this step…") : t("Pausar al terminar este paso", "Pause after this step")}
          </button>
        </div>
      </div>
    );
  } else if (busy) {
    hero = (
      <p className="small muted" role="status">
        {t("Un momento…", "One moment…")}
      </p>
    );
  } else if (stop?.kind === "approval") {
    hero = (
      <div className="stack" style={{ gap: 10 }}>
        <h2 className={s.heroTitle}>{t("Lo que falta cuesta un poco más", "What's left costs a bit more")}</h2>
        <p className="small">
          {t(
            `Con lo que elegiste (zonas y palabras clave), los pasos que faltan cuestan ~${money(stop.amount)} de DataForSEO y de la IA. ¿Seguimos?`,
            `With what you chose (areas and keywords), the remaining steps cost ~${money(stop.amount)} of DataForSEO and AI. Shall we go on?`,
          )}
        </p>
        <div className={s.actions}>
          <button type="button" className="btn primary" onClick={() => approve(stop.amount)}>
            {t(`Sí, gastar ~${money(stop.amount)}`, `Yes, spend ~${money(stop.amount)}`)}
          </button>
          <button type="button" className="btn" onClick={() => approve(null)}>
            {t("Solo lo gratis", "Free steps only")}
          </button>
        </div>
      </div>
    );
  } else if (stop?.kind === "needs-you") {
    const d = stepDef(stop.step);
    hero = (
      <div className="stack" style={{ gap: 8 }}>
        <h2 className={s.heroTitle}>{t(`Te necesitamos en el paso ${d.n}: ${d.title.es}`, `We need you in step ${d.n}: ${d.title.en}`)}</h2>
        <p className="small muted">
          {t(
            "Cuando termines, presiona «Ya lo hice, seguir» y continuamos solos.",
            "When you're done, press “Done, continue” and we'll carry on by ourselves.",
          )}
        </p>
        <div className={s.actions}>
          <a className="btn primary" href={`#paso-${stop.step}`}>
            {t("Ir al paso", "Go to the step")} ↓
          </a>
        </div>
      </div>
    );
  } else if (active) {
    hero = (
      <div className="stack" style={{ gap: 10 }}>
        <h2 className={s.heroTitle}>{t("Tu diagnóstico quedó a medias", "Your diagnosis is half done")}</h2>
        <p className="small muted">{t("Lo hecho quedó guardado. Sigue donde quedó.", "What's done is saved. Pick up where it stopped.")}</p>
        <div className={s.actions}>
          <button type="button" className="btn primary" onClick={() => loop()}>
            {t(`Continuar — paso ${prog.current}`, `Continue — step ${prog.current}`)}
          </button>
        </div>
      </div>
    );
  } else {
    const paid = cost.items;
    const freeCount = plan.length - paid.length;
    const doneAny = view.steps.some((v) => v.status === "done" && v.id !== "plan");
    hero = (
      <div className="stack" style={{ gap: 12 }}>
        {complete && !redoAll ? (
          <>
            <h2 className={s.heroTitle}>{t("¡Tu diagnóstico está hecho!", "Your diagnosis is done!")}</h2>
            <p className="small muted">
              {t("Terminado el", "Finished on")} {date.format(new Date(view.state.completedAt!))}.{" "}
              {shouldRedo(view.state.completedAt, now)
                ? t("Ya pasó más de un mes: conviene volver a hacerlo.", "It's been over a month: it's worth doing it again.")
                : ""}
            </p>
            <div className={s.actions}>
              <Link className="btn primary" href={`/b/${id}/seo?tab=resumen`}>
                {t("Ver tu plan de acción →", "See your action plan →")}
              </Link>
              <button type="button" className="btn" onClick={() => setRedoAll(true)}>
                {t("Volver a hacerlo", "Do it again")}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className={s.heroTitle}>
              {started
                ? t("Sigue con lo que falta", "Continue with what's left")
                : t(`Que la IA conozca ${view.business.name}`, `Let the AI get to know ${view.business.name}`)}
            </h2>
            <p className="small muted">
              {plan.length === 1
                ? t(
                    "Todo está hecho y al día. Si quieres, volvemos a armar tu plan de acción con lo último (gratis), o marca «Rehacer» para repetir los estudios.",
                    "Everything is done and up to date. If you like, we rebuild your action plan with the latest data (free), or tick “Redo” to repeat the studies.",
                  )
                : t(
                    `Hacemos ${plan.length} ${plan.length === 1 ? "paso" : "pasos"} en orden, solos. Solo te preguntamos lo importante (tus zonas y palabras clave, y cuál es tu negocio en Google Maps). Lo que ya está hecho hace poco no se repite.`,
                    `We do ${plan.length} ${plan.length === 1 ? "step" : "steps"} in order, on our own. We only ask you what matters (your areas and keywords, and which one is your business on Google Maps). Anything done recently isn't repeated.`,
                  )}
            </p>
            {doneAny && (
              <label className={`check ${s.redo}`}>
                <input type="checkbox" checked={redoAll} onChange={(e) => setRedoAll(e.target.checked)} />
                <span className="stack" style={{ gap: 2 }}>
                  <strong>{t("Rehacer también lo que ya está hecho", "Also redo what's already done")}</strong>
                  <span className="small muted">{t("Para tener todo con fecha de hoy.", "To have everything dated today.")}</span>
                </span>
              </label>
            )}
            {cost.total > 0 ? (
              <div className={s.costBox}>
                <p className="small">
                  <strong>{t(`Costo estimado: ~${money(cost.total)}`, `Estimated cost: ~${money(cost.total)}`)}</strong>{" "}
                  {t(
                    `en ${paid.length} ${paid.length === 1 ? "paso pagado" : "pasos pagados"} (DataForSEO y la IA). ${freeCount ? `Los otros ${freeCount} son gratis.` : ""} Nunca gastamos sin tu permiso.`,
                    `on ${paid.length} paid ${paid.length === 1 ? "step" : "steps"} (DataForSEO and AI). ${freeCount ? `The other ${freeCount} are free.` : ""} We never spend without your OK.`,
                  )}
                </p>
                <details className={s.detail}>
                  <summary>{t("Ver el detalle", "See the breakdown")}</summary>
                  <ul>
                    {paid.map((x) => (
                      <li key={x.id}>
                        <span>
                          {stepDef(x.id).n}. {pick(stepDef(x.id).title)}
                        </span>
                        <span>~{money(x.amount)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="small muted">
                    {t(
                      "Son aproximados: las posiciones dependen de cuántas palabras y zonas elijas; las IAs, de cuántas tengas conectadas.",
                      "These are estimates: rankings depend on how many keywords and areas you choose; AIs, on how many are connected.",
                    )}
                  </p>
                </details>
                <div className={s.actions}>
                  <button type="button" className="btn primary" onClick={() => begin({ approve: cost.total })}>
                    {t(`Sí, gastar ~${money(cost.total)}`, `Yes, spend ~${money(cost.total)}`)}
                  </button>
                  <button type="button" className="btn" onClick={() => begin({ approve: null })}>
                    {t("Solo lo gratis", "Free steps only")}
                  </button>
                </div>
              </div>
            ) : (
              <div className={s.actions}>
                <button type="button" className="btn primary" onClick={() => begin({ approve: null })}>
                  {started ? t("Continuar diagnóstico", "Continue diagnosis") : t("Empezar diagnóstico", "Start diagnosis")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className={`card ${s.hero}`} id="diagnostico-inicio">
        <div className={s.progressHead}>
          <span className={s.kicker}>{t(`Paso ${prog.current} de ${TOTAL_STEPS}`, `Step ${prog.current} of ${TOTAL_STEPS}`)}</span>
          <span className="small muted">{t(`${prog.finished} de ${TOTAL_STEPS} listos`, `${prog.finished} of ${TOTAL_STEPS} ready`)}</span>
        </div>
        <div
          className={s.bar}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={TOTAL_STEPS}
          aria-valuenow={prog.finished}
          aria-label={t("Avance del diagnóstico", "Diagnosis progress")}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        {hero}
        {error && (
          <p className="note error" role="alert">
            {error}
          </p>
        )}
        {stop?.kind === "busy" && (
          <p className="note" role="status">
            {t(
              "Ya hay un paso trabajando (quizás en otra pestaña). Espera un momento y vuelve a cargar la página.",
              "A step is already working (maybe in another tab). Wait a moment and reload the page.",
            )}
          </p>
        )}
      </section>

      <ol className={s.steps}>
        {steps.map((v) => {
          const d = stepDef(v.id);
          const est = estimateStep(v.id, view.facts, view.prices);
          const isNow = v.status === "running" || (stop?.kind === "needs-you" && stop.step === v.id);
          const canRedo = !busy && v.status === "done" && v.id !== "setup";
          const showSlot = v.status === "needs-you" && !busy;
          return (
            <li key={v.id} id={`paso-${v.id}`} className={`${s.step} ${isNow ? s.now : ""} ${s[v.status.replace("-", "")] ?? ""}`}>
              <span className={s.num} aria-hidden>
                {v.status === "done" ? "✓" : v.status === "error" ? "!" : v.status === "skipped" ? "–" : v.status === "running" ? "" : d.n}
              </span>
              <div className={s.body}>
                <div className={s.head}>
                  <h3 className={s.title}>
                    <span className={s.srOnly}>{t(`Paso ${d.n}: `, `Step ${d.n}: `)}</span>
                    {pick(d.title)}
                  </h3>
                  <span className={`pill ${v.stale ? "warn" : STATUS_PILL[v.status]}`}>{statusLabel(v)}</span>
                </div>
                <p className={s.what}>{pick(d.what)}</p>
                <p className={s.why}>
                  <strong>{t("Por qué importa:", "Why it matters:")}</strong> {pick(d.why)}
                </p>
                <p className={s.meta}>
                  {(v.status === "done" || v.status === "skipped") && v.at && <span>{doneText(v)}</span>}
                  {v.status === "done" && !v.at && <span>{doneText(v)}</span>}
                  {v.status === "done" && v.cost !== null && v.cost > 0 && <span>{t(`Costó ${money(v.cost)}`, `Cost ${money(v.cost)}`)}</span>}
                  {v.status !== "done" && v.status !== "skipped" && (
                    <span>
                      {est > 0
                        ? v.id === "audit"
                          ? t(`Gratis · la revisión de tus páginas con Google ~${money(est)}`, `Free · checking your pages against Google ~${money(est)}`)
                          : t(`Costo: ~${money(est)}`, `Cost: ~${money(est)}`)
                        : t("Gratis", "Free")}
                    </span>
                  )}
                  {v.status === "done" && (v.stale || redoAll) && est > 0 && <span>{t(`Rehacerlo: ~${money(est)}`, `Redo it: ~${money(est)}`)}</span>}
                </p>
                {v.cut ? (
                  <p className="note error">
                    {t(
                      "Se cortó antes de terminar (se cerró la página o tardó demasiado). Intenta de nuevo.",
                      "It stopped before finishing (the page was closed or it took too long). Try again.",
                    )}
                  </p>
                ) : v.message && v.status !== "running" ? (
                  <p className={v.status === "error" ? "note error" : v.status === "needs-you" ? "note" : s.message}>{v.message}</p>
                ) : null}
                {v.status === "pending" && v.block && v.block.status !== "error" && !busy && <p className={s.hint}>{pick(v.block.reason)}</p>}

                {confirmOne === v.id && (
                  <div className={s.costBox}>
                    <p className="small">{t(`Esto usa servicios pagados: ~${money(est)}.`, `This uses paid services: ~${money(est)}.`)}</p>
                    <div className={s.actions}>
                      <button type="button" className="btn primary" onClick={() => begin({ only: [v.id], approve: est })}>
                        {t(`Sí, gastar ~${money(est)}`, `Yes, spend ~${money(est)}`)}
                      </button>
                      {v.id === "audit" && (
                        <button type="button" className="btn" onClick={() => begin({ only: [v.id], approve: null })}>
                          {t("Solo lo gratis", "Free part only")}
                        </button>
                      )}
                      <button type="button" className="btn" onClick={() => setConfirmOne(null)}>
                        {t("Cancelar", "Cancel")}
                      </button>
                    </div>
                  </div>
                )}

                <div className={s.actions}>
                  {(v.status === "done" || (v.id !== "plan" && view.facts.last[v.id])) && (
                    <Link className={`btn ${s.small}`} href={`/b/${id}${d.path}`}>
                      {t("Ver resultado →", "See result →")}
                    </Link>
                  )}
                  {canRedo && confirmOne !== v.id && (
                    <button type="button" className={`btn ${s.small}`} onClick={() => one(v.id)}>
                      ↻ {t("Rehacer", "Redo")}
                    </button>
                  )}
                  {v.status === "done" && v.id === "setup" && (
                    <Link className={`btn ${s.small}`} href={`/b/${id}/seo?tab=ajustes`}>
                      {t("Cambiar en Ajustes", "Change in Settings")}
                    </Link>
                  )}
                  {!busy && v.status === "error" && confirmOne !== v.id && (
                    <button type="button" className={`btn ${s.small}`} onClick={() => one(v.id)}>
                      ↻ {t("Intentar de nuevo", "Try again")}
                    </button>
                  )}
                  {!busy && v.ownerSkipped && confirmOne !== v.id && (
                    <button type="button" className={`btn ${s.small}`} onClick={() => one(v.id)}>
                      {t("Hacerlo ahora", "Do it now")}
                    </button>
                  )}
                </div>

                {showSlot && (
                  <div className={s.slot}>
                    {v.id === "setup" && setupSlot}
                    {v.id === "maps" && mapSlot}
                    {v.id === "web" && (
                      <div className={s.actions}>
                        <Link className="btn" href={`/b/${id}/negocio`}>
                          {t("Agregar mi página web", "Add my website")}
                        </Link>
                        <Link className="btn" href={`/b/${id}/estudio`}>
                          {t("Contarle a la IA a mano", "Tell the AI by hand")}
                        </Link>
                      </div>
                    )}
                    {v.id === "study" && (
                      <div className={s.actions}>
                        <Link className="btn" href={`/b/${id}/estudio`}>
                          {t("Abrir mi estudio", "Open my study")}
                        </Link>
                      </div>
                    )}
                    <div className={s.actions}>
                      <button type="button" className="btn primary" onClick={resume}>
                        {t("Ya lo hice, seguir →", "Done, continue →")}
                      </button>
                      <button type="button" className="btn" onClick={() => skip(v.id)}>
                        {v.id === "maps" ? t("Saltar (no estoy en Google Maps)", "Skip (I'm not on Google Maps)") : t("Saltar por ahora", "Skip for now")}
                      </button>
                    </div>
                  </div>
                )}

                {v.id === "plan" && v.status === "done" && (
                  <div className={s.actions}>
                    <Link className="btn primary" href={`/b/${id}/seo?tab=resumen`}>
                      {t("Ver tu plan de acción →", "See your action plan →")}
                    </Link>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="small muted">
        {t(
          "Todo queda guardado: puedes cerrar esta página entre pasos y seguir otro día. Los costos son de DataForSEO y de la IA, y se descuentan de tus cuentas con ellos.",
          "Everything is saved: you can close this page between steps and continue another day. Costs are from DataForSEO and the AI and come out of your accounts with them.",
        )}
      </p>
    </div>
  );
}
