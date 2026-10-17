"use client";
// La sección «Modo equipo» de la configuración del Centro MATYA: el interruptor, la hora del plan de la mañana, los permisos, la IA y el
// precio de cada agente, el aviso del llamado de cada minuto y «Pausar todo». Todo lo que el servidor manda (estados, problemas, nombres)
// se pinta como texto: React lo escapa. Vive dentro del formulario de AgentSettings: lo que cambia aquí se guarda con «Guardar configuración»,
// salvo la pausa, que se aplica al momento y por eso sus botones nunca envían el formulario.
import { useEffect, useId, useState } from "react";
import { useT } from "@/components/I18n";
import { MODEL_CATALOG, catalogEntry, catalogId, catalogUsd } from "@/lib/agent/model-catalog";
import type { Settings } from "@/lib/agent/schema";
import { RATE_MAX, formatRate, readModelName, readPrice, setAgentModel } from "@/lib/agent/settings-input";
import { isTickStale, type TeamAgentView } from "@/lib/agent/team-view";
import { businessTz } from "@/lib/business-tz";
import { businessTzLabel, fmtDateTime } from "@/lib/time";
import type { Snapshot } from "./types";
import s from "./AgentCenter.module.css";
import tm from "./Team.module.css";

/** The agents that make AI calls, in the order the settings list them (Diseño and Video use the library and the templates). */
export const AI_AGENTS = [
  { key: "director", es: "Director", en: "Director" },
  { key: "seo", es: "SEO e investigación", en: "SEO and research" },
  { key: "strategy", es: "Estrategia de contenido", en: "Content strategy" },
  { key: "copy", es: "Redacción", en: "Copywriting" },
  { key: "review", es: "Revisión editorial", en: "Editorial review" },
] as const;
type AiKey = (typeof AI_AGENTS)[number]["key"];

const PROVIDERS = [
  { id: "openai", name: "OpenAI" },
  { id: "claude", name: "Claude" },
  { id: "gemini", name: "Gemini" },
] as const;
type Provider = (typeof PROVIDERS)[number]["id"];

/** 7 → "7:00 a. m." (en: "7:00 AM"); 0 → "12:00 a. m.", 12 → "12:00 p. m.". The Hoy screen tells the plan's hour the same way. */
export function hourText(hour: number, lang: "es" | "en"): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const pm = hour >= 12;
  return lang === "en" ? `${h}:00 ${pm ? "PM" : "AM"}` : `${h}:00 ${pm ? "p. m." : "a. m."}`;
}

/**
 * Tells the form that a field cannot be saved as it is, under `key`, for as long as `bad` is true (and takes the mark back when the
 * field goes away). `onInvalid` must keep its identity between renders.
 */
function useReportInvalid(key: string, bad: boolean, onInvalid: (key: string, bad: boolean) => void) {
  useEffect(() => {
    onInvalid(key, bad);
  }, [key, bad, onInvalid]);
  useEffect(() => () => onInvalid(key, false), [key, onInvalid]);
}

/**
 * One side of a model's price, in dollars per million tokens. The text stays as typed; the pair is saved once both sides read. The
 * error shows only once the owner has been in the field (edited or left it) or tried to save: a new row starts quiet, so it does not
 * flash red and push the page down while the owner is still typing the model above it. «Guardar» waits for it either way.
 */
function RateField({
  label,
  side,
  text,
  reveal,
  onText,
}: {
  label: string;
  side: keyof typeof RATE_MAX;
  text: string;
  reveal: boolean;
  onText: (text: string) => void;
}) {
  const { t } = useT();
  const id = useId();
  const [touched, setTouched] = useState(false);
  const value = readPrice(text, side);
  const marked = value === null && (touched || reveal);
  return (
    <div className={s.numberField}>
      <label htmlFor={id}>{label}</label>
      <span className={s.money}>
        <span aria-hidden="true">$</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          aria-required="true"
          aria-invalid={marked}
          aria-describedby={marked ? `${id}-error` : undefined}
          onChange={(e) => {
            setTouched(true);
            onText(e.target.value);
          }}
          onBlur={() => {
            setTouched(true);
            if (value !== null) onText(formatRate(value));
          }}
        />
      </span>
      {marked && (
        <p id={`${id}-error`} className={s.fieldError}>
          {t(
            `Escribe el precio en dólares entre $0.0001 y $${RATE_MAX[side]}, por ejemplo 0.15 o 3.`,
            `Enter the price in dollars between $0.0001 and $${RATE_MAX[side]}, for example 0.15 or 3.`,
          )}
        </p>
      )}
    </div>
  );
}

/** The two prices of one `provider:model`. Both must read before they reach the settings; until then «Guardar» waits. */
function PriceRow({
  id,
  users,
  initial,
  reveal,
  onPrice,
  onInvalid,
}: {
  id: string;
  users: string;
  initial: { input: number; output: number } | undefined;
  /** The owner tried to save: show what is missing even in the fields not touched yet. */
  reveal: boolean;
  onPrice: (id: string, price: { input: number; output: number }) => void;
  onInvalid: (key: string, bad: boolean) => void;
}) {
  const { t } = useT();
  const nameId = useId();
  const [input, setInput] = useState(initial ? formatRate(initial.input) : "");
  const [output, setOutput] = useState(initial ? formatRate(initial.output) : "");
  useReportInvalid(`price:${id}:input`, readPrice(input, "input") === null, onInvalid);
  useReportInvalid(`price:${id}:output`, readPrice(output, "output") === null, onInvalid);
  const change = (nextInput: string, nextOutput: string) => {
    setInput(nextInput);
    setOutput(nextOutput);
    const i = readPrice(nextInput, "input");
    const o = readPrice(nextOutput, "output");
    if (i !== null && o !== null) onPrice(id, { input: i, output: o });
  };
  return (
    <li className={tm.priceRow} data-model={id}>
      <div>
        <strong id={nameId} className={tm.priceId}>
          {id}
        </strong>
        <p className={tm.note}>{users}</p>
      </div>
      <div className={tm.priceFields} role="group" aria-labelledby={nameId}>
        <RateField
          label={t("Entrada (USD por millón de tokens)", "Input (USD per million tokens)")}
          side="input"
          text={input}
          reveal={reveal}
          onText={(text) => change(text, output)}
        />
        <RateField
          label={t("Salida (USD por millón de tokens)", "Output (USD per million tokens)")}
          side="output"
          text={output}
          reveal={reveal}
          onText={(text) => change(input, text)}
        />
      </div>
    </li>
  );
}

/** The value of the AI select for «Otro modelo», where the owner picks the provider and types the model. */
export const OTHER_MODEL = "other";

/** What the AI select shows for a saved choice: the default model (""), a model of the list (its "provider:model") or «Otro modelo». */
export function pickFor(choice: { provider: string; model: string } | undefined): string {
  if (!choice) return "";
  const id = catalogId(choice);
  return catalogEntry(id) ? id : OTHER_MODEL;
}

/**
 * What the settings get when the owner picks `pick` in the list: a model of the list, «Otro modelo» with the provider and the name
 * typed (while the name reads), or null, which is the default model.
 */
export function choiceFor(pick: string, provider: Provider, text: string): { provider: Provider; model: string } | null {
  if (pick === OTHER_MODEL) {
    const model = readModelName(text);
    return model ? { provider, model } : null;
  }
  const entry = catalogEntry(pick);
  return entry ? { provider: entry.provider, model: entry.model } : null;
}

/** The list grouped by provider, in the order of PROVIDERS; a provider with no model on the list has no group. */
const CATALOG_GROUPS = PROVIDERS.map((p) => ({ ...p, models: MODEL_CATALOG.filter((m) => m.provider === p.id) })).filter(
  (g) => g.models.length > 0,
);

/**
 * The AI of one agent, picked from one list: "Modelo por defecto", a model of the list (with its price and what it is for, and no
 * price to type) or «Otro modelo», which shows the provider and a field for the model's name. The settings get the choice only while
 * it is complete, and «Guardar» waits while «Otro modelo» has no readable name.
 */
function ModelRow({
  agentKey,
  name,
  choice,
  view,
  onChoice,
  onInvalid,
}: {
  agentKey: AiKey;
  name: string;
  choice: Settings["agentModels"][AiKey];
  view: TeamAgentView | undefined;
  onChoice: (choice: { provider: Provider; model: string } | null) => void;
  onInvalid: (key: string, bad: boolean) => void;
}) {
  const { t } = useT();
  const id = useId();
  const [pick, setPick] = useState(pickFor(choice));
  // What «Otro modelo» starts with: the saved choice when it is not on the list, else OpenAI and an empty name.
  const typed = choice && pickFor(choice) === OTHER_MODEL ? choice : undefined;
  const [provider, setProvider] = useState<Provider>(typed?.provider ?? "openai");
  const [text, setText] = useState(typed?.model ?? "");
  const bad = pick === OTHER_MODEL && readModelName(text) === null;
  useReportInvalid(`model:${agentKey}`, bad, onInvalid);
  const commitOther = (nextProvider: Provider, nextText: string) => {
    setProvider(nextProvider);
    setText(nextText);
    onChoice(choiceFor(OTHER_MODEL, nextProvider, nextText));
  };
  const choose = (next: string) => {
    setPick(next);
    onChoice(choiceFor(next, provider, text));
  };
  const listed = catalogEntry(pick);
  const ready = view ? view.ready && !view.problem : false;
  return (
    <li className={tm.aiRow} data-agent={agentKey}>
      <strong id={`${id}-name`} className={tm.aiName}>
        {name}
      </strong>
      <div className={tm.aiFields} role="group" aria-labelledby={`${id}-name`}>
        <label>
          {t("IA", "AI")}
          <select value={pick} aria-describedby={listed ? `${id}-use` : undefined} onChange={(e) => choose(e.target.value)}>
            <option value="">{t("Modelo por defecto", "Default model")}</option>
            {CATALOG_GROUPS.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.models.map((m) => (
                  <option key={m.model} value={catalogId(m)}>
                    {`${m.name} · ${catalogUsd(m.input)} / ${catalogUsd(m.output)}${m.recommended ? ` · ${t("recomendado", "recommended")}` : ""}`}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={OTHER_MODEL}>{t("Otro modelo (escribir el nombre)", "Other model (type its name)")}</option>
          </select>
        </label>
        {listed && (
          <p id={`${id}-use`} className={tm.note}>
            {t(listed.use.es, listed.use.en)}{" "}
            {t(
              `Precio oficial por millón de tokens: entrada ${catalogUsd(listed.input)}, salida ${catalogUsd(listed.output)}.`,
              `Official price per million tokens: input ${catalogUsd(listed.input)}, output ${catalogUsd(listed.output)}.`,
            )}
          </p>
        )}
        {pick === OTHER_MODEL && (
          <label>
            {t("Proveedor de IA", "AI provider")}
            <select value={provider} onChange={(e) => commitOther(e.target.value as Provider, text)}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {pick === OTHER_MODEL && (
          <div className={s.numberField}>
            <label htmlFor={`${id}-model`}>{t("Modelo", "Model")}</label>
            <input
              id={`${id}-model`}
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={text}
              aria-invalid={bad}
              aria-describedby={bad ? `${id}-error` : undefined}
              onChange={(e) => commitOther(provider, e.target.value)}
              onBlur={() => {
                const model = readModelName(text);
                if (model !== null && model !== text) setText(model);
              }}
            />
            {bad && (
              <p id={`${id}-error`} className={s.fieldError}>
                {t(
                  "Escribe el nombre del modelo, solo con letras, números y . _ : - (hasta 100).",
                  "Enter the model name, with letters, numbers and . _ : - only (up to 100).",
                )}
              </p>
            )}
          </div>
        )}
      </div>
      <div className={tm.aiStatus}>
        {!view ? (
          <span className={tm.note}>{t("Se comprueba después de guardar.", "Checked after you save.")}</span>
        ) : ready ? (
          <span className={tm.state} data-state="done">
            {t("Listo", "Ready")}
          </span>
        ) : (
          <p className={tm.error}>{view.problem || t("No está listo.", "Not ready.")}</p>
        )}
      </div>
    </li>
  );
}

type PauseKind = "pause" | "resume";
type PauseResult = "cancelled" | "ok" | "failed";

/** Sends one pause action: asks first when `confirm` is given (no → nothing is sent); `act` resolves to whether it went through. */
async function sendPause(
  action: "pause_all" | "resume_all",
  act: (body: Record<string, unknown>) => Promise<boolean>,
  confirm?: () => boolean,
): Promise<PauseResult> {
  if (confirm && !confirm()) return "cancelled";
  try {
    return (await act({ action })) ? "ok" : "failed";
  } catch {
    return "failed";
  }
}
/** «Pausar todo»: after the owner confirms. */
export const pauseAll = (act: (body: Record<string, unknown>) => Promise<boolean>, confirm: () => boolean) => sendPause("pause_all", act, confirm);
/** «Reanudar»: no question, the owner is undoing a stop. */
export const resumeAll = (act: (body: Record<string, unknown>) => Promise<boolean>) => sendPause("resume_all", act);

/**
 * The pause block: «Pausar todo», or «En pausa desde …» with «Reanudar». Its buttons never submit the form. While a request runs
 * (`pending`) the button says what it is doing, and a request that failed (`failed`) says so here, next to the button.
 */
export function PauseBlock({
  paused,
  since,
  busy,
  pending,
  failed,
  onPause,
  onResume,
}: {
  paused: boolean;
  /** When the pause began, already written in the business's time zone. */
  since: string;
  busy: boolean;
  pending: PauseKind | null;
  failed: PauseKind | null;
  onPause: () => void;
  onResume: () => void;
}) {
  const { t } = useT();
  const id = useId();
  // The failure of the other kind is old news (the pause went through meanwhile, or was lifted): it is not shown.
  const failure = failed === (paused ? "resume" : "pause") ? failed : null;
  return (
    <div className={tm.pauseBlock} role="group" aria-labelledby={`${id}-pause`}>
      <div className={tm.pauseText}>
        <h3 id={`${id}-pause`}>{t("Pausa", "Pause")}</h3>
        {paused ? (
          <>
            <p>
              <strong>{t(`En pausa desde ${since}`, `Paused since ${since}`)}</strong>
            </p>
            <p className={tm.note}>
              {t(
                "MATYA no empieza trabajo nuevo ni publica. Lo que se canceló no vuelve solo.",
                "MATYA starts no new work and publishes nothing. What was cancelled does not come back on its own.",
              )}
            </p>
          </>
        ) : (
          <p>
            {t(
              "Detiene todo el trabajo de MATYA de una vez. Se aplica al momento, sin esperar a «Guardar configuración».",
              "Stops all of MATYA's work at once. It applies right away, without waiting for «Save settings».",
            )}
          </p>
        )}
        {failure && (
          <p role="alert" className={tm.error}>
            {failure === "pause"
              ? t("No se pudo pausar. Intenta de nuevo.", "Could not pause. Try again.")
              : t("No se pudo reanudar. Intenta de nuevo.", "Could not resume. Try again.")}
          </p>
        )}
      </div>
      {paused ? (
        <button type="button" className="btn on" disabled={busy || pending !== null} onClick={onResume}>
          {pending === "resume" ? t("Reanudando…", "Resuming…") : t("Reanudar", "Resume")}
        </button>
      ) : (
        <button type="button" className="btn danger" disabled={busy || pending !== null} onClick={onPause}>
          {pending === "pause" ? t("Pausando…", "Pausing…") : t("Pausar todo", "Pause everything")}
        </button>
      )}
    </div>
  );
}

export function TeamSettings({
  value,
  set,
  data,
  busy,
  act,
  onInvalid,
  revealErrors = false,
}: {
  value: Settings;
  set: <K extends keyof Settings>(key: K, v: Settings[K]) => void;
  data: Snapshot;
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<boolean>;
  /** Marks (or clears) a field that cannot be saved as it is; the form's «Guardar» waits while any is marked. Keep its identity stable. */
  onInvalid: (key: string, bad: boolean) => void;
  /** The owner tried to save while a field was marked: the price fields show their errors even if untouched. */
  revealErrors?: boolean;
}) {
  const { t, lang } = useT();
  const id = useId();
  const server = data.settings;
  const tz = data.team?.tz ?? businessTz(data.business);
  const views = data.team?.agents ?? [];
  // The warning follows the switch as it is in the form, so the owner sees it before saving.
  const tickStale = value.teamMode && isTickStale(data.capturedAt, server?.tickAt);
  const paused = !!server?.pausedAt;
  const agents = AI_AGENTS.map((a) => {
    const view = views.find((v) => v.key === a.key);
    return { key: a.key, name: view ? t(view.label.es, view.label.en) : t(a.es, a.en), view, choice: value.agentModels[a.key] };
  });
  // One pair of price fields per model chosen, in the order of the first agent that uses it. A model of the list has its official
  // price already: nothing to type.
  const models = new Map<string, string[]>();
  for (const a of agents) {
    if (!a.choice) continue;
    const model = catalogId(a.choice);
    if (catalogEntry(model)) continue;
    models.set(model, [...(models.get(model) ?? []), a.name]);
  }
  const setPrice = (model: string, price: { input: number; output: number }) =>
    set("modelPrices", { ...value.modelPrices, [model]: price });
  // The pause is not part of the form: its own request, its own wait and its own error, shown by the button (the form's save error is
  // at the foot of a long page and worded as a failed save).
  const [pending, setPending] = useState<PauseKind | null>(null);
  const [failed, setFailed] = useState<PauseKind | null>(null);
  const run = async (kind: PauseKind) => {
    setFailed(null);
    setPending(kind);
    const result =
      kind === "pause"
        ? await pauseAll(act, () =>
            window.confirm(
              t(
                "Se cancela todo lo abierto y lo programado vuelve a borrador. ¿Pausar?",
                "Everything open is cancelled and scheduled posts go back to draft. Pause?",
              ),
            ),
          )
        : await resumeAll(act);
    setPending(null);
    if (result === "failed") setFailed(kind);
  };
  return (
    <section className={tm.config} aria-labelledby={`${id}-title`}>
      <div className={s.sectionTitle}>
        <h2 id={`${id}-title`}>{t("Modo equipo", "Team mode")}</h2>
        <p>
          {t(
            "Cuándo empieza el equipo su día, qué puede publicar y qué IA usa cada agente.",
            "When the team starts its day, what it may publish and which AI each agent uses.",
          )}
        </p>
      </div>
      <div className={tm.switchBlock}>
        <div className={s.checks}>
          <label>
            <input
              type="checkbox"
              checked={value.teamMode}
              aria-describedby={`${id}-team-mode`}
              onChange={(e) => set("teamMode", e.target.checked)}
            />
            {t("Modo equipo", "Team mode")}
          </label>
        </div>
        <p id={`${id}-team-mode`} className={tm.note}>
          {t(
            "El Director arma un plan cada mañana y reparte las piezas entre los agentes.",
            "The Director builds a plan every morning and hands the pieces out to the agents.",
          )}
        </p>
      </div>
      {tickStale && (
        <div className={tm.notice} role="status" data-tone="warn">
          <p>
            {t(
              "El llamado de cada minuto no está activo. Sin él no avanza ningún paso ni llega el plan de la mañana.",
              "The every-minute call is not active. Without it no step moves forward and the morning plan does not arrive.",
            )}
          </p>
        </div>
      )}
      <div className={tm.hourBlock}>
        <label>
          {t("Hora del plan de la mañana", "Morning plan time")}
          <select value={value.dailyHour} onChange={(e) => set("dailyHour", Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {hourText(hour, lang)}
              </option>
            ))}
          </select>
        </label>
        <p className={tm.note}>{t(`Zona del negocio: ${businessTzLabel(lang, tz)}.`, `Business time zone: ${businessTzLabel(lang, tz)}.`)}</p>
      </div>
      <fieldset>
        <legend>{t("Qué puede publicar el equipo", "What the team may publish")}</legend>
        <div className={s.checks}>
          <label>
            <input type="checkbox" checked={value.allowSocial} onChange={(e) => set("allowSocial", e.target.checked)} />
            {t("Publicar en redes sociales", "Publish on social media")}
          </label>
          <label>
            <input type="checkbox" checked={value.allowWebArticles} onChange={(e) => set("allowWebArticles", e.target.checked)} />
            {t("Publicar artículos en la web", "Publish articles on the website")}
          </label>
        </div>
        <p className={tm.note}>
          {t(
            "Además hace falta «Permitir programar y publicar» y que el canal esté autorizado y conectado.",
            "«Allow scheduling and publishing» must also be on, and the channel allowed and connected.",
          )}
        </p>
      </fieldset>
      <div className={tm.group}>
        <h3>{t("IA de cada agente", "Each agent's AI")}</h3>
        <p className={tm.note}>
          {t(
            "Elige la IA de cada agente en la lista. Los dos precios de cada modelo son en dólares por millón de tokens: lo que el agente lee y lo que escribe. Sin elegir, el agente usa el modelo por defecto. El estado es el de lo último que guardaste: cambia después de guardar.",
            "Pick each agent's AI from the list. Each model's two prices are in dollars per million tokens: what the agent reads and what it writes. If you pick none, the agent uses the default model. The state is that of what you last saved: it changes after you save.",
          )}
        </p>
        <ul className={tm.aiList}>
          {agents.map((a) => (
            <ModelRow
              key={a.key}
              agentKey={a.key}
              name={a.name}
              choice={a.choice}
              view={a.view}
              onChoice={(choice) => set("agentModels", setAgentModel(value.agentModels, a.key, choice))}
              onInvalid={onInvalid}
            />
          ))}
        </ul>
      </div>
      {models.size > 0 && (
        <div className={tm.group}>
          <h3>{t("Precios de los modelos", "Model prices")}</h3>
          <p className={tm.note}>
            {t(
              "Dólares por millón de tokens, como los publica el proveedor. Sin precio el agente no trabaja y su gasto no se puede calcular.",
              "Dollars per million tokens, as the provider publishes them. Without a price the agent does not work and its spend cannot be worked out.",
            )}
          </p>
          <ul className={tm.priceList}>
            {[...models].map(([model, users]) => (
              <PriceRow key={model} id={model} users={users.join(", ")} initial={value.modelPrices[model]} reveal={revealErrors} onPrice={setPrice} onInvalid={onInvalid} />
            ))}
          </ul>
        </div>
      )}
      <PauseBlock
        paused={paused}
        since={server?.pausedAt ? fmtDateTime(server.pausedAt, lang, tz) : ""}
        busy={busy}
        pending={pending}
        failed={failed}
        onPause={() => void run("pause")}
        onResume={() => void run("resume")}
      />
    </section>
  );
}
