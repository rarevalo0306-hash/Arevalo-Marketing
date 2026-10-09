"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { CampaignFormResult } from "@/app/actions-campaign";
import { useT } from "@/components/I18n";
import {
  APPROVAL_NEEDS,
  centsText,
  POST_KINDS,
  SAFETY_TOPICS,
  type ApprovalNeed,
  type CampaignMode,
  type CampaignRules,
  type PostKind,
  type SafetyId,
} from "@/lib/campaign-shape";
import s from "./Campaign.module.css";

export type WizardInitial = {
  name: string;
  goal: string;
  mode: CampaignMode;
  channels: string[];
  startDate: string;
  endDate: string;
  perWeek: number;
  keywords: string;
  rules: CampaignRules;
};

type Props = {
  action: (prev: CampaignFormResult, f: FormData) => Promise<CampaignFormResult>;
  /** Editar una campaña que ya existe: sin el paso 1 y con «Guardar cambios». */
  editing?: boolean;
  /** Al editar: la campaña ya era 100% IA (no se vuelve a pedir la casilla). */
  wasAuto?: boolean;
  channels: { id: string; name: string; connected: boolean }[];
  connectHref: string;
  suggestions: string[];
  services: string[];
  businessKeywords: string[];
  initial: WizardInitial;
  today: string;
  tzLabel: string;
  /** Costo aproximado de una foto con IA (centavos); 0 = no hay servicio de fotos con IA. */
  imageCents: number;
};

const WEEKDAYS: [number, string, string][] = [
  [1, "Lun", "Mon"],
  [2, "Mar", "Tue"],
  [3, "Mié", "Wed"],
  [4, "Jue", "Thu"],
  [5, "Vie", "Fri"],
  [6, "Sáb", "Sat"],
  [0, "Dom", "Sun"],
];
const KIND_NAMES: Record<PostKind, [string, string]> = {
  post: ["Posts (foto o diseño)", "Posts (photo or design)"],
  carousel: ["Carruseles", "Carousels"],
  story: ["Historias", "Stories"],
  video: ["Videos (con tus fotos)", "Videos (from your photos)"],
};
const NEED_NAMES: Record<ApprovalNeed, [string, string]> = {
  prices: ["Si habla de precios o descuentos", "If it mentions prices or discounts"],
  newChannel: ["La primera vez en un canal", "The first time on a channel"],
  aiImage: ["Si la foto la hizo la IA", "If the photo was made by the AI"],
};
const COST_STEPS = [0, 0.5, 1, 3, 5, 10, 20];

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function CampaignWizard(p: Props) {
  const { t, lang } = useT();
  const fmtDay = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`)) : d);
  const first = p.editing ? 2 : 1;
  const [step, setStep] = useState(first);
  const [result, run, isPending] = useActionState(p.action, null);
  const [localError, setLocalError] = useState("");

  const r0 = p.initial.rules;
  const [name, setName] = useState(p.initial.name);
  const [goal, setGoal] = useState(p.initial.goal);
  const [mode, setMode] = useState<CampaignMode>(p.initial.mode);
  const [channels, setChannels] = useState<string[]>(p.initial.channels);
  const [startDate, setStartDate] = useState(p.initial.startDate);
  const [endDate, setEndDate] = useState(p.initial.endDate);
  const [perWeek, setPerWeek] = useState(p.initial.perWeek);
  const [weekdays, setWeekdays] = useState<number[]>(r0.weekdays);
  const [mix, setMix] = useState<Record<PostKind, number>>(r0.contentMix);
  const [languages, setLanguages] = useState<string[]>(r0.languages);
  const [keywords, setKeywords] = useState(p.initial.keywords);
  const [safety, setSafety] = useState<Record<SafetyId, boolean>>(r0.safety);
  const [banned, setBanned] = useState<string[]>(r0.bannedTopics);
  const [newWord, setNewWord] = useState("");
  const [competitors, setCompetitors] = useState(r0.competitors.join(", "));
  const [focus, setFocus] = useState(r0.allowedTopics.join(", "));
  const [quietOn, setQuietOn] = useState(r0.quietHours !== null);
  const [quietFrom, setQuietFrom] = useState(r0.quietHours?.from ?? "21:00");
  const [quietTo, setQuietTo] = useState(r0.quietHours?.to ?? "08:00");
  const [maxPerDay, setMaxPerDay] = useState(r0.maxPerDay);
  const [needs, setNeeds] = useState<ApprovalNeed[]>(r0.needsApprovalFor);
  const [maxCost, setMaxCost] = useState(r0.maxAiCostCents / 100);
  const [alerts, setAlerts] = useState(r0.alerts);
  const [stopOnErrors, setStopOnErrors] = useState(r0.stopOnErrors);
  const [accepted, setAccepted] = useState(false);

  const chanName = (id: string) => p.channels.find((c) => c.id === id)?.name ?? id;
  const dayNames = WEEKDAYS.filter(([d]) => weekdays.includes(d)).map(([, es, en]) => t(es, en));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const costOptions = useMemo(() => [...new Set([...COST_STEPS, maxCost])].sort((a, b) => a - b), [maxCost]);
  const photos = p.imageCents ? Math.floor((maxCost * 100) / p.imageCents) : 0;

  /** Revisión rápida del paso antes de seguir (el servidor revisa todo otra vez al guardar). */
  function stepProblem(n: number): string {
    if (n === 1 && !name.trim()) return t("Ponle un nombre a la campaña.", "Give the campaign a name.");
    if (n === 3 && mode !== "manual" && !channels.length) return t("Elige al menos un canal conectado.", "Choose at least one connected channel.");
    if (n === 4) {
      if (!endDate || endDate <= startDate) return t("La fecha de fin debe ser después del inicio.", "The end date must be after the start.");
      if (!weekdays.length) return t("Elige al menos un día para publicar.", "Choose at least one day to post.");
      if (!languages.length) return t("Elige al menos un idioma.", "Choose at least one language.");
    }
    if (n === 5) {
      if (perWeek > weekdays.length * maxPerDay)
        return t(
          `Con ${weekdays.length} días y ${maxPerDay} por día caben ${weekdays.length * maxPerDay} publicaciones a la semana. Sube el máximo por día o baja la frecuencia.`,
          `With ${weekdays.length} days and ${maxPerDay} a day, ${weekdays.length * maxPerDay} posts fit in a week. Raise the daily maximum or lower the frequency.`,
        );
      const anyAlert = alerts.onEveryPost || alerts.onLimit || alerts.onError || alerts.onStop;
      if (anyAlert && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(alerts.email.trim())) return t("Escribe un email válido para los avisos (o apaga los avisos).", "Enter a valid email for the alerts (or turn the alerts off).");
    }
    return "";
  }
  const go = (n: number) => {
    if (n > step) {
      const problem = stepProblem(step);
      if (problem) return setLocalError(problem);
    }
    setLocalError("");
    setStep(n);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const addWord = () => {
    const w = newWord.trim().slice(0, 80);
    if (w && !banned.some((b) => b.toLowerCase() === w.toLowerCase())) setBanned([...banned, w].slice(0, 40));
    setNewWord("");
  };

  const shown = (n: number) => (step === n ? undefined : { display: "none" as const });
  const total = 6;
  const titles: Record<number, string> = {
    1: t("Objetivo y nombre", "Goal and name"),
    2: t("¿Cómo trabajas con la IA?", "How do you work with the AI?"),
    3: t("Canales", "Channels"),
    4: t("Fechas y frecuencia", "Dates and frequency"),
    5: t("Límites y reglas", "Limits and rules"),
    6: t("Resumen", "Summary"),
  };
  const safetyOn = SAFETY_TOPICS.filter((x) => safety[x.id]);
  const chosen = channels.map(chanName).join(", ") || "—";
  const needsText = needs.map((n) => t(...NEED_NAMES[n]).toLowerCase());

  return (
    <form
      action={run}
      className={`card ${s.wizard}`}
      onKeyDown={(e) => {
        // Enter en un campo no manda el formulario antes del resumen.
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && step < total) e.preventDefault();
      }}
    >
      <div className="stack" style={{ gap: 6 }}>
        <span className={s.stepLabel}>
          {t(`Paso ${step} de ${total}`, `Step ${step} of ${total}`)}
          {p.editing ? ` · ${t("Editar límites", "Edit limits")}` : ""}
        </span>
        <div className={s.steps} aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <i key={i} className={i < step ? s.done : ""} />
          ))}
        </div>
        <h2 className={s.stepTitle}>{titles[step]}</h2>
      </div>

      {/* ---------- 1. Objetivo y nombre ---------- */}
      {!p.editing && (
        <div className="stack" style={{ gap: 14, ...shown(1) }}>
          <div className={s.field}>
            <label htmlFor="cw-goal">{t("¿Qué quieres lograr?", "What do you want to achieve?")}</label>
            <textarea
              id="cw-goal"
              name="goal"
              className="field"
              style={{ minHeight: 90 }}
              value={goal}
              maxLength={1000}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={t("Ej.: más llamadas para reparación de portones en Managua este mes", "E.g.: more calls for gate repairs in Managua this month")}
            />
          </div>
          {p.suggestions.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className={s.help}>{t("Ideas de tu estudio y tu plan (toca una para usarla):", "Ideas from your study and plan (tap one to use it):")}</span>
              <div className={s.suggest}>
                {p.suggestions.map((x) => (
                  <button
                    key={x}
                    type="button"
                    onClick={() => {
                      setGoal(x);
                      if (!name.trim()) setName(x.slice(0, 80));
                    }}
                  >
                    {x}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className={s.field}>
            <label htmlFor="cw-name">{t("Nombre de la campaña", "Campaign name")}</label>
            <input id="cw-name" name="name" className="field" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t("Ej.: Portones octubre", "E.g.: Gates October")} />
            <p className={s.help}>{t("Solo para que tú la reconozcas.", "Just so you recognize it.")}</p>
          </div>
        </div>
      )}

      {/* ---------- 2. Modo ---------- */}
      <div className="stack" style={{ gap: 10, ...shown(2) }}>
        <div className={s.options} role="radiogroup" aria-label={t("Modo", "Mode")}>
          {(
            [
              ["manual", t("Manual", "Manual"), t("Tú creas y publicas todo. La campaña solo junta tus publicaciones, fechas y resultados. La IA no hace nada sola.", "You create and post everything. The campaign just groups your posts, dates and results. The AI does nothing on its own.")],
              ["approval", t("Con tu aprobación", "With your approval"), t("La IA prepara cada publicación (texto y foto) unos días antes. Nada sale hasta que tú la apruebas.", "The AI prepares each post (text and photo) a few days ahead. Nothing goes out until you approve it.")],
              ["auto", t("100% IA", "100% AI"), t("La IA prepara y publica sola, siempre dentro de los límites que pongas. Te avisa por email y puedes pararla con un botón.", "The AI prepares and posts on its own, always within the limits you set. It emails you and you can stop it with one button.")],
            ] as const
          ).map(([id, title, text]) => (
            <label key={id} className={`${s.option} ${mode === id ? s.on : ""}`}>
              <input type="radio" name="mode" value={id} checked={mode === id} onChange={() => setMode(id)} />
              <div>
                <b>{title}</b>
                <span>{text}</span>
              </div>
            </label>
          ))}
        </div>
        {mode === "auto" && <p className="note">{t("En el paso 5 eliges qué nunca puede hacer y cuándo igual te pide permiso.", "In step 5 you choose what it can never do and when it still asks you first.")}</p>}
      </div>

      {/* ---------- 3. Canales ---------- */}
      <div className="stack" style={{ gap: 10, ...shown(3) }}>
        <input type="hidden" name="channels_present" value="1" />
        <p className={s.help}>{t("Solo puedes elegir canales conectados.", "You can only choose connected channels.")}</p>
        <div className={s.chans}>
          {p.channels.map((c) => {
            const on = channels.includes(c.id);
            return c.connected ? (
              <div key={c.id} className={`${s.chan} ${on ? s.on : ""}`}>
                <label>
                  <input type="checkbox" name="channels" value={c.id} checked={on} onChange={() => setChannels(toggle(channels, c.id))} />
                  {c.name}
                </label>
              </div>
            ) : (
              <div key={c.id} className={`${s.chan} ${s.off}`}>
                <span>{c.name}</span>
                <Link href={p.connectHref} className="small">
                  {t("Conectar", "Connect")}
                </Link>
              </div>
            );
          })}
        </div>
        {!p.channels.some((c) => c.connected) && (
          <p className="note">{t("Todavía no tienes canales conectados. Conecta al menos uno para que la IA pueda publicar.", "You don't have any connected channels yet. Connect at least one so the AI can post.")}</p>
        )}
      </div>

      {/* ---------- 4. Fechas y frecuencia ---------- */}
      <div className="stack" style={{ gap: 14, ...shown(4) }}>
        <div className={s.twoCol}>
          <div className={s.field}>
            <label htmlFor="cw-start">{t("Empieza", "Starts")}</label>
            <input
              id="cw-start"
              name="startDate"
              type="date"
              className="field"
              value={startDate}
              min={p.editing ? undefined : p.today}
              disabled={p.editing}
              onChange={(e) => {
                const v = e.target.value;
                setStartDate(v);
                if (endDate <= v) setEndDate(addDays(v, 28));
              }}
            />
          </div>
          <div className={s.field}>
            <label htmlFor="cw-end">{t("Termina", "Ends")}</label>
            <input id="cw-end" name="endDate" type="date" className="field" value={endDate} min={addDays(startDate, 1)} max={addDays(startDate, 366)} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className={s.field}>
            <label htmlFor="cw-week">{t("Publicaciones por semana", "Posts per week")}</label>
            <select id="cw-week" name="perWeek" className="field" value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))}>
              {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className={s.help}>{t(`Por defecto: 4 semanas, 3 por semana. Horas en ${p.tzLabel}.`, `Default: 4 weeks, 3 a week. Times in ${p.tzLabel}.`)}</p>
        <fieldset className={s.fieldset}>
          <input type="hidden" name="weekdays_present" value="1" />
          <legend className={s.legend}>{t("Días en que puede publicar", "Days it may post")}</legend>
          <div className={s.days}>
            {WEEKDAYS.map(([d, es, en]) => (
              <label key={d} className={weekdays.includes(d) ? s.on : ""}>
                <input type="checkbox" name="weekdays" value={d} checked={weekdays.includes(d)} onChange={() => setWeekdays(toggle(weekdays, d))} />
                {t(es, en)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className={s.fieldset}>
          <input type="hidden" name="mix_present" value="1" />
          <legend className={s.legend}>{t("Tipo de publicaciones (%)", "Kind of posts (%)")}</legend>
          <div className={s.mix}>
            {POST_KINDS.map((k) => (
              <label key={k}>
                {t(...KIND_NAMES[k])}
                <input
                  type="number"
                  className="field"
                  name={`mix_${k}`}
                  min={0}
                  max={100}
                  step={10}
                  value={mix[k]}
                  onChange={(e) => setMix({ ...mix, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                />
              </label>
            ))}
          </div>
          <p className={s.help}>
            {t(
              "Los carruseles usan varias fotos reales de tu negocio. Los videos se arman con tus fotos reales y cuestan unos US$0.01–0.03 cada uno (sale del tope de gasto del paso 5). Si no se puede, sale un post normal.",
              "Carousels use several real photos of your business. Videos are made from your real photos and cost about US$0.01–0.03 each (it comes out of the spending cap in step 5). If it can't be done, a regular post goes out.",
            )}
          </p>
        </fieldset>
        <fieldset className={s.fieldset}>
          <input type="hidden" name="languages_present" value="1" />
          <legend className={s.legend}>{t("Idioma de los textos", "Language of the texts")}</legend>
          <div className="row">
            {(["es", "en"] as const).map((l) => (
              <label key={l} className={s.line}>
                <input type="checkbox" name="languages" value={l} checked={languages.includes(l)} onChange={() => setLanguages(toggle(languages, l))} />
                {l === "es" ? t("Español", "Spanish") : t("Inglés", "English")}
              </label>
            ))}
          </div>
        </fieldset>
        {!p.editing && (
          <div className={s.field}>
            <label htmlFor="cw-kw">{t("Palabras clave extra para esta campaña (opcional)", "Extra keywords for this campaign (optional)")}</label>
            <input id="cw-kw" name="keywords" className="field" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={t("Separadas por comas", "Separated by commas")} />
            {p.businessKeywords.length > 0 && (
              <p className={s.help}>
                {t("La IA ya usa las de tu negocio:", "The AI already uses your business's keywords:")} {p.businessKeywords.slice(0, 8).join(", ")}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ---------- 5. Límites y reglas ---------- */}
      <div className="stack" style={{ gap: 18, ...shown(5) }}>
        <fieldset className={s.fieldset}>
          <input type="hidden" name="safety_present" value="1" />
          <legend className={s.legend}>{t("Temas que la IA nunca toca", "Topics the AI never touches")}</legend>
          <div className={s.safety}>
            {SAFETY_TOPICS.map((x) => (
              <label key={x.id} className="check">
                <input type="checkbox" name={`safety_${x.id}`} checked={safety[x.id]} onChange={() => setSafety({ ...safety, [x.id]: !safety[x.id] })} />
                <span className="stack" style={{ gap: 2 }}>
                  <strong>{t(x.es, x.en)}</strong>
                  <span className="small muted">{t(x.hintEs, x.hintEn)}</span>
                </span>
              </label>
            ))}
          </div>
          {safety.competitors && (
            <div className={s.field}>
              <label htmlFor="cw-comp">{t("Nombres de tu competencia (nunca los nombra)", "Your competitors' names (it never names them)")}</label>
              <input id="cw-comp" name="competitors" className="field" value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder={t("Separados por comas", "Separated by commas")} />
            </div>
          )}
          {!safety.competitors && <input type="hidden" name="competitors" value={competitors} />}
          <span className={s.legend} style={{ marginTop: 6 }}>{t("Tus palabras prohibidas", "Your banned words")}</span>
          <input type="hidden" name="bannedTopics" value={banned.join("\n")} />
          {banned.length > 0 && (
            <div className={s.tags}>
              {banned.map((w) => (
                <span key={w} className={s.tag}>
                  {w}
                  <button type="button" aria-label={t(`Quitar ${w}`, `Remove ${w}`)} onClick={() => setBanned(banned.filter((x) => x !== w))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className={s.addRow}>
            <input
              className="field"
              value={newWord}
              aria-label={t("Palabra o tema prohibido", "Banned word or topic")}
              placeholder={t("Ej.: barato, lluvia ácida…", "E.g.: cheap, acid rain…")}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addWord();
                }
              }}
            />
            <button type="button" className="btn" onClick={addWord}>
              {t("Agregar", "Add")}
            </button>
          </div>
        </fieldset>

        <div className={s.field}>
          <label htmlFor="cw-focus">{t("Enfocarse en (servicios o temas)", "Focus on (services or topics)")}</label>
          <input id="cw-focus" name="allowedTopics" className="field" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder={t("Vacío = todos tus servicios", "Empty = all your services")} />
          {p.services.length > 0 && (
            <div className={s.suggest}>
              {p.services.map((x) => (
                <button key={x} type="button" onClick={() => setFocus(focus.trim() ? (focus.includes(x) ? focus : `${focus}, ${x}`) : x)}>
                  + {x}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={s.twoCol}>
          <fieldset className={s.fieldset}>
            <input type="hidden" name="quiet_present" value="1" />
            <legend className={s.legend}>{t("Horas sin publicar", "No-posting hours")}</legend>
            <label className={s.line}>
              <input type="checkbox" name="quietOn" checked={quietOn} onChange={() => setQuietOn(!quietOn)} />
              {t("Nunca publicar de", "Never post from")}
            </label>
            <div className="row">
              <input type="time" name="quietFrom" className="field" style={{ flex: "1 1 130px", minWidth: 130, maxWidth: 170 }} value={quietFrom} disabled={!quietOn} onChange={(e) => setQuietFrom(e.target.value)} aria-label={t("Desde", "From")} />
              <span>{t("a", "to")}</span>
              <input type="time" name="quietTo" className="field" style={{ flex: "1 1 130px", minWidth: 130, maxWidth: 170 }} value={quietTo} disabled={!quietOn} onChange={(e) => setQuietTo(e.target.value)} aria-label={t("Hasta", "To")} />
            </div>
            {/* Los campos desactivados no se envían: se mandan aparte. */}
            {!quietOn && (
              <>
                <input type="hidden" name="quietFrom" value={quietFrom} />
                <input type="hidden" name="quietTo" value={quietTo} />
              </>
            )}
          </fieldset>
          <div className={s.field}>
            <label htmlFor="cw-max">{t("Máximo por día", "Maximum per day")}</label>
            <select id="cw-max" name="maxPerDay" className="field" value={maxPerDay} onChange={(e) => setMaxPerDay(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className={s.fieldset}>
          <input type="hidden" name="approval_present" value="1" />
          <legend className={s.legend}>{t("Aunque sea 100% IA, pedirme permiso…", "Even in 100% AI, ask me first…")}</legend>
          {mode !== "auto" && <p className={s.help}>{t("En este modo todo espera tu aprobación de todas formas.", "In this mode everything waits for your approval anyway.")}</p>}
          {APPROVAL_NEEDS.map((n) => (
            <label key={n} className={s.line}>
              <input type="checkbox" name="needsApprovalFor" value={n} checked={needs.includes(n)} onChange={() => setNeeds(toggle(needs, n))} />
              {t(...NEED_NAMES[n])}
            </label>
          ))}
        </fieldset>

        <div className={s.field}>
          <label htmlFor="cw-cost">{t("Tope de gasto en fotos y videos con IA (toda la campaña)", "AI photo and video spending cap (whole campaign)")}</label>
          <select id="cw-cost" name="maxAiCost" className="field" style={{ maxWidth: 260 }} value={maxCost} onChange={(e) => setMaxCost(Number(e.target.value))}>
            {costOptions.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? t("US$0 — no gastar nada", "US$0 — spend nothing") : `US$${d.toFixed(2)}`}
              </option>
            ))}
          </select>
          <p className={s.help}>
            {p.imageCents
              ? maxCost > 0
                ? t(
                    `Cada foto con IA cuesta unos ${centsText(p.imageCents)}: alcanza para unas ${photos}. Primero siempre usa tus fotos reales. Al llegar al tope, no gasta más.`,
                    `Each AI photo costs about ${centsText(p.imageCents)}: enough for about ${photos}. It always uses your real photos first. At the cap, it stops spending.`,
                  )
                : t("Solo usará tus fotos reales y diseños con tu marca (gratis).", "It will only use your real photos and designs with your brand (free).")
              : t("No hay un servicio de fotos con IA configurado: solo usará tus fotos reales y diseños.", "No AI photo service is set up: it will only use your real photos and designs.")}{" "}
            {t("Escribir los textos con IA cuesta menos de un centavo cada uno.", "Writing the texts with AI costs less than a cent each.")}
          </p>
        </div>

        <fieldset className={s.fieldset}>
          <input type="hidden" name="alerts_present" value="1" />
          <legend className={s.legend}>{t("Avisos por email", "Email alerts")}</legend>
          <input
            name="alertEmail"
            type="email"
            className="field"
            value={alerts.email}
            onChange={(e) => setAlerts({ ...alerts, email: e.target.value })}
            placeholder="tu@correo.com"
            aria-label={t("Email para los avisos", "Email for the alerts")}
          />
          {(
            [
              ["onEveryPost", "alertPost", t("Cada vez que prepare o programe una publicación", "Every time it prepares or schedules a post")],
              ["onLimit", "alertLimit", t("Cuando llegue a un límite", "When it hits a limit")],
              ["onError", "alertError", t("Cuando haya errores (y se pause)", "When there are errors (and it pauses)")],
              ["onStop", "alertStop", t("Cuando se pare la campaña", "When the campaign is stopped")],
            ] as const
          ).map(([k, field, label]) => (
            <label key={k} className={s.line}>
              <input type="checkbox" name={field} checked={alerts[k]} onChange={() => setAlerts({ ...alerts, [k]: !alerts[k] })} />
              {label}
            </label>
          ))}
        </fieldset>

        <div className={s.field}>
          <label htmlFor="cw-err">{t("Pausar sola después de estos errores seguidos", "Pause on its own after this many errors in a row")}</label>
          <select id="cw-err" name="stopOnErrors" className="field" style={{ maxWidth: 160 }} value={stopOnErrors} onChange={(e) => setStopOnErrors(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ---------- 6. Resumen ---------- */}
      <div className="stack" style={{ gap: 14, ...shown(6) }}>
        {!p.editing && (
          <p style={{ margin: 0 }}>
            <strong>{name || t("(sin nombre)", "(no name)")}</strong>
            {goal && goal.trim() !== name.trim() ? ` — ${goal}` : ""}
          </p>
        )}
        <div className={s.summary}>
          <div className={`${s.box} ${s.may}`}>
            <h3>{t("Lo que la IA puede hacer", "What the AI may do")}</h3>
            <ul>
              {mode === "manual" && <li>{t("Nada sola: tú creas y publicas. La campaña junta tus publicaciones y su registro.", "Nothing on its own: you create and post. The campaign groups your posts and their log.")}</li>}
              {mode === "approval" && (
                <li>
                  {t(
                    `Preparar ${perWeek} publicaciones por semana para ${chosen} y dejarlas como borrador para que tú las apruebes.`,
                    `Prepare ${perWeek} posts a week for ${chosen} and leave them as drafts for you to approve.`,
                  )}
                </li>
              )}
              {mode === "auto" && (
                <li>
                  {t(
                    `Publicar sola hasta ${perWeek} por semana (máximo ${maxPerDay} por día) en ${chosen}.`,
                    `Post on its own up to ${perWeek} a week (at most ${maxPerDay} a day) on ${chosen}.`,
                  )}
                </li>
              )}
              {mode !== "manual" && (
                <>
                  <li>{t(`Solo del ${fmtDay(startDate)} al ${fmtDay(endDate)}, los días ${dayNames.join(", ")}.`, `Only from ${fmtDay(startDate)} to ${fmtDay(endDate)}, on ${dayNames.join(", ")}.`)}</li>
                  <li>{t("Usar tus fotos reales primero y diseñarlas con tu marca.", "Use your real photos first and design them with your brand.")}</li>
                  <li>
                    {maxCost > 0 && p.imageCents
                      ? t(`Crear fotos con IA solo si no hay una real que vaya, gastando como mucho US$${maxCost.toFixed(2)} en toda la campaña.`, `Create AI photos only when no real one fits, spending at most US$${maxCost.toFixed(2)} for the whole campaign.`)
                      : t("No gastar nada en fotos ni videos con IA.", "Spend nothing on AI photos or videos.")}
                  </li>
                  <li>{t("Usar las palabras clave de tu negocio en textos, hashtags y descripciones de fotos.", "Use your business's keywords in texts, hashtags and photo descriptions.")}</li>
                  {focus.trim() && <li>{t(`Enfocarse en: ${focus}.`, `Focus on: ${focus}.`)}</li>}
                </>
              )}
              {alerts.email && (alerts.onEveryPost || alerts.onLimit || alerts.onError || alerts.onStop) && (
                <li>{t(`Avisarte a ${alerts.email}.`, `Alert you at ${alerts.email}.`)}</li>
              )}
            </ul>
          </div>
          <div className={`${s.box} ${s.never}`}>
            <h3>{t("Lo que nunca hará", "What it will never do")}</h3>
            <ul>
              {safetyOn.length > 0 && <li>{t(`Hablar de: ${safetyOn.map((x) => x.es.toLowerCase()).join(", ")}.`, `Talk about: ${safetyOn.map((x) => x.en.toLowerCase()).join(", ")}.`)}</li>}
              {banned.length > 0 && <li>{t(`Usar: ${banned.join(", ")}.`, `Use: ${banned.join(", ")}.`)}</li>}
              <li>{t("Publicar fuera de las fechas o en canales que no elegiste.", "Post outside the dates or on channels you didn't choose.")}</li>
              <li>{t(`Publicar más de ${maxPerDay} al día o más de ${perWeek} a la semana.`, `Post more than ${maxPerDay} a day or more than ${perWeek} a week.`)}</li>
              {quietOn && <li>{t(`Publicar de ${quietFrom} a ${quietTo}.`, `Post from ${quietFrom} to ${quietTo}.`)}</li>}
              <li>{t(`Gastar más de US$${maxCost.toFixed(2)} en fotos y videos con IA.`, `Spend more than US$${maxCost.toFixed(2)} on AI photos and videos.`)}</li>
              <li>{t(`Seguir después de ${stopOnErrors} errores seguidos: se pausa y te avisa.`, `Keep going after ${stopOnErrors} errors in a row: it pauses and tells you.`)}</li>
              {mode === "auto" && needs.length > 0 && <li>{t(`Publicar sin tu permiso: ${needsText.join("; ")}.`, `Post without your OK: ${needsText.join("; ")}.`)}</li>}
            </ul>
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {t("Puedes pausar o PARAR la campaña en cualquier momento con el botón rojo.", "You can pause or STOP the campaign at any time with the red button.")}
        </p>
        {mode === "auto" && !(p.editing && p.wasAuto) && (
          <label className={`check ${s.accept}`}>
            <input type="checkbox" name="autoAccepted" checked={accepted} onChange={() => setAccepted(!accepted)} />
            <strong>{t("Entiendo que la IA publicará sola dentro de estos límites", "I understand the AI will post on its own within these limits")}</strong>
          </label>
        )}
      </div>

      {(localError || (result && !result.ok) || (result?.ok && result.message)) && (
        <div className={localError || !result?.ok ? "note error" : "note ok"} role="status">
          {localError || result?.message}
          {!localError && result?.problems && result.problems.length > 0 && (
            <ul className={s.problems}>
              {result.problems.map((x, i) => (
                <li key={i}>{x.text}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={s.nav}>
        <div>
          {step > first && (
            <button type="button" className="btn" onClick={() => go(step - 1)} disabled={isPending}>
              ← {t("Atrás", "Back")}
            </button>
          )}
        </div>
        <div>
          {step < total && (
            <button type="button" className="btn on" onClick={() => go(step + 1)}>
              {t("Siguiente", "Next")} →
            </button>
          )}
          {step === total && !p.editing && (
            <>
              <button type="submit" name="intent" value="save" className="btn" disabled={isPending}>
                {t("Guardar sin empezar", "Save without starting")}
              </button>
              <button type="submit" name="intent" value="start" className="btn on" disabled={isPending || (mode === "auto" && !accepted)}>
                {isPending ? t("Guardando…", "Saving…") : t("Empezar", "Start")}
              </button>
            </>
          )}
          {step === total && p.editing && (
            <button type="submit" className="btn on" disabled={isPending || (mode === "auto" && !p.wasAuto && !accepted)}>
              {isPending ? t("Guardando…", "Saving…") : t("Guardar cambios", "Save changes")}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
