// Forma de Campaign.rules (límites y reglas de una campaña) y las reglas puras que la IA nunca puede saltarse.
// Sin base de datos: lo usan el servidor (motor de campañas), las pantallas y las pruebas.
//
// Toda acción automática de una campaña (crear un borrador, programar una publicación) pasa por checkPost().
// Si checkPost dice que no, la IA no lo hace y queda anotado (limit.reached) en el registro de la campaña.

import type { UiLang } from "@/lib/i18n";
import { BUSINESS_TZ, localToUtc } from "@/lib/time";

// ---------- Modos, estados y tipos ----------

export const CAMPAIGN_MODES = ["manual", "approval", "auto"] as const;
export type CampaignMode = (typeof CAMPAIGN_MODES)[number];
export const asMode = (v: unknown): CampaignMode => (CAMPAIGN_MODES.includes(v as CampaignMode) ? (v as CampaignMode) : "approval");

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "stopped", "ended"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const asStatus = (v: unknown): CampaignStatus => (CAMPAIGN_STATUSES.includes(v as CampaignStatus) ? (v as CampaignStatus) : "draft");

export const POST_KINDS = ["post", "carousel", "story", "video"] as const;
export type PostKind = (typeof POST_KINDS)[number];

/** Nombre del modo para el dueño. */
export function modeLabel(mode: string, lang: UiLang = "es"): string {
  const m: Record<CampaignMode, [string, string]> = {
    manual: ["Manual", "Manual"],
    approval: ["Con tu aprobación", "With your approval"],
    auto: ["100% IA", "100% AI"],
  };
  const [es, en] = m[asMode(mode)];
  return lang === "en" ? en : es;
}

export function statusLabel(status: string, lang: UiLang = "es"): string {
  const m: Record<CampaignStatus, [string, string]> = {
    draft: ["Sin empezar", "Not started"],
    active: ["Activa", "Active"],
    paused: ["En pausa", "Paused"],
    stopped: ["Parada", "Stopped"],
    ended: ["Terminada", "Finished"],
  };
  const [es, en] = m[asStatus(status)];
  return lang === "en" ? en : es;
}

export function kindLabel(kind: string, lang: UiLang = "es"): string {
  const m: Record<PostKind, [string, string]> = {
    post: ["Post", "Post"],
    carousel: ["Carrusel", "Carousel"],
    story: ["Historia", "Story"],
    video: ["Video", "Video"],
  };
  const [es, en] = m[(POST_KINDS as readonly string[]).includes(kind) ? (kind as PostKind) : "post"];
  return lang === "en" ? en : es;
}

// ---------- Temas que la IA nunca toca (lista fija de seguridad) ----------

export const SAFETY_IDS = ["politics", "religion", "competitors", "prices", "promises", "insurance"] as const;
export type SafetyId = (typeof SAFETY_IDS)[number];

type SafetyTopic = { id: SafetyId; es: string; en: string; hintEs: string; hintEn: string; words: string[]; patterns?: RegExp[] };

/** Palabras sin acentos y en minúsculas (se comparan contra el texto normalizado igual). */
export const SAFETY_TOPICS: SafetyTopic[] = [
  {
    id: "politics",
    es: "Política",
    en: "Politics",
    hintEs: "Partidos, elecciones, gobierno, políticos.",
    hintEn: "Parties, elections, government, politicians.",
    words: [
      "politica", "politicas", "politico", "politicos", "elecciones", "eleccion", "votar", "votacion", "partido politico", "campana electoral",
      "candidato", "candidata", "diputado", "senador", "asamblea nacional", "sandinista", "trump", "biden", "ortega", "murillo",
      "politics", "political", "election", "elections", "vote for", "ballot", "senator", "congressman", "republican", "democrat",
    ],
  },
  {
    id: "religion",
    es: "Religión",
    en: "Religion",
    hintEs: "Dios, iglesia, oraciones, creencias.",
    hintEn: "God, church, prayers, beliefs.",
    words: [
      "religion", "religiosa", "religioso", "iglesia", "dios", "jesus", "cristo", "biblia", "oracion", "rezar", "virgen", "bendiciones",
      "religious", "church", "god", "christ", "bible", "prayer", "pray",
    ],
  },
  {
    id: "competitors",
    es: "Nombrar a la competencia",
    en: "Naming competitors",
    hintEs: "Nunca menciona a otros negocios por su nombre.",
    hintEn: "Never mentions other businesses by name.",
    words: [],
  },
  {
    id: "prices",
    es: "Precios y descuentos",
    en: "Prices and discounts",
    hintEs: "Montos, descuentos, ofertas, «gratis». Quítalo solo si quieres que hable de precios.",
    hintEn: "Amounts, discounts, deals, “free”. Uncheck it only if you want it to talk about prices.",
    words: [
      "precio", "precios", "descuento", "descuentos", "rebaja", "rebajas", "cupon", "barato", "baratos", "gratis", "gratuito", "gratuita",
      "price", "prices", "pricing", "discount", "discounts", "coupon", "cheap", "cheapest", "free estimate", "free quote", "free inspection", "for free",
    ],
    patterns: [/(?:us|c)?\$\s?\d/, /\d+(?:[.,]\d+)?\s?%/, /\d+\s?(?:dolares|cordobas|usd)\b/, /\b\d+\s?% off\b/],
  },
  {
    id: "promises",
    es: "Promesas médicas o legales",
    en: "Medical or legal promises",
    hintEs: "Curas, diagnósticos, consejos legales, «garantizado».",
    hintEn: "Cures, diagnoses, legal advice, “guaranteed”.",
    words: [
      "cura", "curar", "diagnostico", "garantizado", "garantizada", "garantizamos", "sin riesgo", "100% seguro", "asesoria legal", "consejo legal",
      "ganaras el caso", "cure", "cures", "diagnosis", "guaranteed", "we guarantee", "risk-free", "risk free", "legal advice", "win your case",
    ],
  },
  {
    id: "insurance",
    es: "Prometer resultados del seguro",
    en: "Promising insurance results",
    hintEs: "Nunca promete pagos, «más dinero» ni reclamos aprobados.",
    hintEn: "Never promises payouts, “more money” or approved claims.",
    words: [
      "te pagaran", "te pagara", "mas dinero", "reclamo garantizado", "pago garantizado", "aprobacion garantizada", "obtendras mas", "recuperaras",
      "guaranteed payout", "guaranteed claim", "more money", "guaranteed settlement", "you will get paid", "get you paid",
    ],
  },
];

export const safetyTopic = (id: string) => SAFETY_TOPICS.find((s) => s.id === id);

// ---------- Forma de las reglas ----------

/** Cuándo una campaña 100% IA igual pide tu aprobación. */
export const APPROVAL_NEEDS = ["prices", "newChannel", "aiImage"] as const;
export type ApprovalNeed = (typeof APPROVAL_NEEDS)[number];

export type QuietHours = { from: string; to: string };
export type ContentMix = Record<PostKind, number>;
export type CampaignAlerts = { email: string; onEveryPost: boolean; onLimit: boolean; onError: boolean; onStop: boolean };

export type CampaignRules = {
  version: 1;
  /** Palabras o temas que el dueño prohibió. */
  bannedTopics: string[];
  /** Lista fija de seguridad: true = prohibido. */
  safety: Record<SafetyId, boolean>;
  /** Nombres de la competencia (para no nombrarlos nunca). */
  competitors: string[];
  /** Servicios o temas en los que se enfoca la campaña. */
  allowedTopics: string[];
  maxPerDay: number;
  /** Horas sin publicar, en la hora del negocio. null = sin horas de silencio. */
  quietHours: QuietHours | null;
  /** Días permitidos: 0 = domingo … 6 = sábado. */
  weekdays: number[];
  /** Horas preferidas para publicar (hora del negocio). */
  postTimes: string[];
  timezone: string;
  needsApprovalFor: ApprovalNeed[];
  /** Tope de gasto en fotos y videos con IA para toda la campaña, en centavos de dólar. */
  maxAiCostCents: number;
  alerts: CampaignAlerts;
  /** Cuántos errores seguidos pausan la campaña. */
  stopOnErrors: number;
  /** Porcentaje de cada tipo de publicación. */
  contentMix: ContentMix;
  languages: ("es" | "en")[];
  /** «La IA puede aplicar sola las propuestas de bajo riesgo (horarios, formatos)». Solo cuenta en campañas 100% IA. */
  autoApplyProposals?: boolean;
};

export const LIMITS = {
  maxPerDay: [1, 5],
  perWeek: [1, 21],
  maxAiCostCents: [0, 5000],
  stopOnErrors: [1, 10],
  bannedTopics: 40,
  competitors: 20,
  allowedTopics: 20,
  /** Duración máxima de una campaña en días. */
  maxDays: 366,
} as const;

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

export function defaultRules(opts: { email?: string; lang?: string; competitors?: string[] } = {}): CampaignRules {
  return {
    version: 1,
    bannedTopics: [],
    safety: { politics: true, religion: true, competitors: true, prices: true, promises: true, insurance: true },
    competitors: (opts.competitors ?? []).map((c) => c.trim()).filter(Boolean).slice(0, LIMITS.competitors),
    allowedTopics: [],
    maxPerDay: 1,
    quietHours: { from: "21:00", to: "08:00" },
    weekdays: [1, 2, 3, 4, 5, 6],
    postTimes: ["10:00", "13:00", "18:00"],
    timezone: BUSINESS_TZ,
    needsApprovalFor: ["prices", "newChannel"],
    maxAiCostCents: 0,
    alerts: { email: (opts.email ?? "").trim(), onEveryPost: false, onLimit: true, onError: true, onStop: true },
    stopOnErrors: 3,
    contentMix: { post: 100, carousel: 0, story: 0, video: 0 },
    languages: [opts.lang === "en" ? "en" : "es"],
  };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const int = (v: unknown, [lo, hi]: readonly [number, number], dflt: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};
const bool = (v: unknown, dflt: boolean) => (typeof v === "boolean" ? v : dflt);
const words = (v: unknown, max: number) =>
  [...new Set((Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/) : []).filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 80)).filter(Boolean))].slice(0, max);
const time = (v: unknown, dflt: string) => {
  const m = typeof v === "string" ? TIME_RE.exec(v.trim()) : null;
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : dflt;
};

function validTz(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return BUSINESS_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return BUSINESS_TZ;
  }
}

/** Lee las reglas guardadas (o lo que venga) sin fallar nunca: lo que falta o está mal toma el valor por defecto. */
export function readRules(json: unknown, defaults: { email?: string; lang?: string } = {}): CampaignRules {
  const d = defaultRules(defaults);
  const r = obj(json);
  const safetyIn = obj(r.safety);
  const safety = Object.fromEntries(SAFETY_IDS.map((id) => [id, bool(safetyIn[id], d.safety[id])])) as Record<SafetyId, boolean>;
  const q = r.quietHours === null ? null : obj(r.quietHours);
  const quietHours = q === null ? null : { from: time(q.from, d.quietHours!.from), to: time(q.to, d.quietHours!.to) };
  const weekdays = Array.isArray(r.weekdays)
    ? [...new Set(r.weekdays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
    : d.weekdays;
  const times = Array.isArray(r.postTimes) ? [...new Set(r.postTimes.map((x) => time(x, "")).filter(Boolean))].sort() : d.postTimes;
  const a = obj(r.alerts);
  const mixIn = obj(r.contentMix);
  const contentMix = Object.fromEntries(POST_KINDS.map((k) => [k, int(mixIn[k], [0, 100], Object.keys(mixIn).length ? 0 : d.contentMix[k])])) as ContentMix;
  if (!POST_KINDS.some((k) => contentMix[k] > 0)) contentMix.post = 100;
  const langs = Array.isArray(r.languages) ? [...new Set(r.languages.filter((l): l is "es" | "en" => l === "es" || l === "en"))] : d.languages;
  return {
    version: 1,
    bannedTopics: words(r.bannedTopics, LIMITS.bannedTopics),
    safety,
    competitors: words(r.competitors ?? d.competitors, LIMITS.competitors),
    allowedTopics: words(r.allowedTopics, LIMITS.allowedTopics),
    maxPerDay: int(r.maxPerDay, LIMITS.maxPerDay, d.maxPerDay),
    quietHours: quietHours && quietHours.from !== quietHours.to ? quietHours : null,
    weekdays: weekdays.length ? weekdays : d.weekdays,
    postTimes: times.length ? times.slice(0, 6) : d.postTimes,
    timezone: validTz(r.timezone),
    needsApprovalFor: Array.isArray(r.needsApprovalFor) ? APPROVAL_NEEDS.filter((n) => (r.needsApprovalFor as unknown[]).includes(n)) : d.needsApprovalFor,
    maxAiCostCents: int(r.maxAiCostCents, LIMITS.maxAiCostCents, d.maxAiCostCents),
    alerts: {
      email: typeof a.email === "string" && a.email.trim() ? a.email.trim().slice(0, 200) : d.alerts.email,
      onEveryPost: bool(a.onEveryPost, d.alerts.onEveryPost),
      onLimit: bool(a.onLimit, d.alerts.onLimit),
      onError: bool(a.onError, d.alerts.onError),
      onStop: bool(a.onStop, d.alerts.onStop),
    },
    stopOnErrors: int(r.stopOnErrors, LIMITS.stopOnErrors, d.stopOnErrors),
    contentMix,
    languages: langs.length ? langs : d.languages,
    ...(r.autoApplyProposals === true ? { autoApplyProposals: true } : {}),
  };
}

export type RuleProblem = { field: string; es: string; en: string };

/** Revisa unas reglas (ya leídas) y devuelve lo que hay que corregir antes de guardar. */
export function validateRules(r: CampaignRules): RuleProblem[] {
  const out: RuleProblem[] = [];
  if (!r.weekdays.length) out.push({ field: "weekdays", es: "Elige al menos un día para publicar.", en: "Choose at least one day to post." });
  if (r.quietHours && r.postTimes.every((t) => inQuietHours(toMinutes(t), r.quietHours)))
    out.push({ field: "quietHours", es: "Todas tus horas de publicar caen en las horas sin publicar.", en: "All your posting times fall inside the no-posting hours." });
  if (quietLength(r.quietHours) > 20 * 60)
    out.push({ field: "quietHours", es: "Las horas sin publicar dejan menos de 4 horas al día para publicar.", en: "The no-posting hours leave less than 4 hours a day to post." });
  const anyAlert = r.alerts.onEveryPost || r.alerts.onLimit || r.alerts.onError || r.alerts.onStop;
  if (anyAlert && !EMAIL_RE.test(r.alerts.email))
    out.push({ field: "alerts.email", es: "Escribe un email válido para los avisos (o apaga los avisos).", en: "Enter a valid email for the alerts (or turn the alerts off)." });
  if (!r.languages.length) out.push({ field: "languages", es: "Elige al menos un idioma.", en: "Choose at least one language." });
  return out;
}

/** Lo que se le dice a la campaña en la pantalla: el nombre de la campaña, fechas, canales… */
export type CampaignBasics = {
  name: string;
  mode: CampaignMode;
  startsAt: Date;
  endsAt: Date | null;
  channels: string[];
  perWeek: number;
};

/** Revisa los datos de la campaña (además de las reglas). `autoAccepted`: marcó «Entiendo que la IA publicará sola». */
export function validateCampaign(c: CampaignBasics, r: CampaignRules, opts: { autoAccepted?: boolean; now?: Date } = {}): RuleProblem[] {
  const out: RuleProblem[] = [];
  const now = opts.now ?? new Date();
  if (!c.name.trim()) out.push({ field: "name", es: "Ponle un nombre a la campaña.", en: "Give the campaign a name." });
  if (c.mode !== "manual" && !c.channels.length) out.push({ field: "channels", es: "Elige al menos un canal conectado.", en: "Choose at least one connected channel." });
  if (!c.endsAt) out.push({ field: "endsAt", es: "Elige cuándo termina la campaña.", en: "Choose when the campaign ends." });
  else if (c.endsAt.getTime() <= c.startsAt.getTime()) out.push({ field: "endsAt", es: "La campaña debe terminar después de empezar.", en: "The campaign must end after it starts." });
  else if (c.endsAt.getTime() - c.startsAt.getTime() > LIMITS.maxDays * 86400000)
    out.push({ field: "endsAt", es: "Una campaña dura como mucho un año.", en: "A campaign can last one year at most." });
  else if (c.endsAt.getTime() <= now.getTime()) out.push({ field: "endsAt", es: "La fecha de fin ya pasó.", en: "The end date has already passed." });
  if (c.perWeek < LIMITS.perWeek[0] || c.perWeek > LIMITS.perWeek[1]) out.push({ field: "perWeek", es: "Entre 1 y 21 publicaciones por semana.", en: "Between 1 and 21 posts per week." });
  else if (c.perWeek > r.weekdays.length * r.maxPerDay)
    out.push({
      field: "perWeek",
      es: `Con ${r.weekdays.length} días y ${r.maxPerDay} por día caben ${r.weekdays.length * r.maxPerDay} publicaciones a la semana como mucho.`,
      en: `With ${r.weekdays.length} days and ${r.maxPerDay} a day, at most ${r.weekdays.length * r.maxPerDay} posts fit in a week.`,
    });
  if (c.mode === "auto" && !opts.autoAccepted)
    out.push({ field: "autoAccepted", es: "Para «100% IA» marca «Entiendo que la IA publicará sola dentro de estos límites».", en: "For “100% AI”, check “I understand the AI will post on its own within these limits”." });
  return [...out, ...validateRules(r)];
}

// ---------- Estado del motor (dentro de rules.engine) ----------

/** Lo que el motor recuerda de cada campaña. Vive en rules.engine (el dueño nunca lo edita). */
export type EngineState = {
  /** Mientras una corrida del cron trabaja en la campaña, nadie más la toma. */
  lockedUntil: string | null;
  /** Horarios (ISO) ya atendidos: con publicación creada o saltados por un límite. Nunca se repiten. */
  handled: string[];
  /** Errores seguidos al crear publicaciones (se reinicia al salir bien). */
  errorsInRow: number;
  /** Publicaciones que estaban programadas al pausar: se vuelven a programar al reanudar. */
  held: string[];
  lastRunAt: string | null;
  /** Desde cuándo se cuentan los errores de publicación (al reanudar se empieza de cero). */
  resetAt: string | null;
  /** Videos que se están creando para publicaciones de la campaña: al estar listos, la publicación toma el video. */
  videos: PendingVideo[];
};

/** `want`: cómo debe quedar la publicación cuando el video esté listo (borrador o programada). */
export type PendingVideo = { postId: string; projectId: string; want: "draft" | "scheduled"; since: string };

export function readEngine(rulesJson: unknown): EngineState {
  const e = obj(obj(rulesJson).engine);
  const iso = (v: unknown) => (typeof v === "string" && !isNaN(Date.parse(v)) ? v : null);
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-max) : []);
  return {
    lockedUntil: iso(e.lockedUntil),
    handled: list(e.handled, 400),
    errorsInRow: int(e.errorsInRow, [0, 1000], 0),
    held: list(e.held, 200),
    lastRunAt: iso(e.lastRunAt),
    resetAt: iso(e.resetAt),
    videos: (Array.isArray(e.videos) ? e.videos : [])
      .map((v) => obj(v))
      .filter((v) => typeof v.postId === "string" && typeof v.projectId === "string")
      .map((v) => ({ postId: v.postId as string, projectId: v.projectId as string, want: v.want === "scheduled" ? ("scheduled" as const) : ("draft" as const), since: iso(v.since) ?? new Date(0).toISOString() }))
      .slice(-30),
  };
}

/** Reglas + estado del motor, listo para guardar en Campaign.rules. */
export function rulesJson(rules: CampaignRules, engine: EngineState): Record<string, unknown> {
  return { ...rules, engine: { ...engine, handled: engine.handled.slice(-400), held: engine.held.slice(-200) } };
}

/** ¿Se puede tomar la campaña ahora? (nadie la está trabajando, o el candado venció). */
export function canClaim(engine: EngineState, now: Date): boolean {
  return !engine.lockedUntil || Date.parse(engine.lockedUntil) <= now.getTime();
}

// ---------- Horas y días en la zona del negocio ----------

export function toMinutes(t: string): number {
  const m = TIME_RE.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function quietLength(q: QuietHours | null): number {
  if (!q) return 0;
  const a = toMinutes(q.from);
  const b = toMinutes(q.to);
  return b > a ? b - a : 24 * 60 - a + b;
}

/** ¿Este minuto del día (0-1439) cae en las horas sin publicar? La ventana puede cruzar la medianoche (21:00 → 08:00). */
export function inQuietHours(minutes: number, q: QuietHours | null): boolean {
  if (!q) return false;
  const a = toMinutes(q.from);
  const b = toMinutes(q.to);
  if (a === b) return false;
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

/** Día, día de la semana (0 = domingo) y minuto del día de una fecha en la zona del negocio. */
export function localParts(d: Date, tz: string = BUSINESS_TZ): { day: string; weekday: number; minutes: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { day: `${p.year}-${p.month}-${p.day}`, weekday, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** "2026-10-08" + n días. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** Semana de la campaña (0, 1, 2…) de un día: bloques de 7 días desde que empieza. */
export function campaignWeek(startDay: string, day: string): number {
  return Math.floor(daysBetween(startDay, day) / 7);
}

/** Las horas para publicar que no caen en las horas sin publicar (si todas caen, la hora en que termina el silencio). */
export function usableTimes(r: Pick<CampaignRules, "postTimes" | "quietHours">): string[] {
  const ok = r.postTimes.filter((t) => !inQuietHours(toMinutes(t), r.quietHours));
  if (ok.length) return ok;
  return [r.quietHours ? r.quietHours.to : "10:00"];
}

/**
 * Todos los horarios de la campaña: `perWeek` publicaciones por semana repartidas entre los días permitidos
 * (como mucho `maxPerDay` el mismo día), a horas que nunca caen en las horas sin publicar. La última semana,
 * si es más corta, lleva menos publicaciones. Sin fecha de fin se planean 4 semanas.
 */
export function campaignSlots(
  c: { startsAt: Date; endsAt: Date | null; perWeek: number },
  r: Pick<CampaignRules, "weekdays" | "maxPerDay" | "postTimes" | "quietHours" | "timezone">,
): Date[] {
  const tz = r.timezone || BUSINESS_TZ;
  const start = localParts(c.startsAt, tz);
  const endDate = c.endsAt ?? new Date(c.startsAt.getTime() + 28 * 86400000);
  const end = localParts(endDate, tz);
  const totalDays = Math.min(LIMITS.maxDays, daysBetween(start.day, end.day) + 1);
  const times = usableTimes(r);
  const perDay = Math.max(1, Math.min(r.maxPerDay, times.length));
  const out: Date[] = [];
  for (let w = 0; w * 7 < totalDays; w++) {
    const covered = Math.min(7, totalDays - w * 7);
    const days = Array.from({ length: covered }, (_, i) => addDays(start.day, w * 7 + i)).filter((d) => r.weekdays.includes(weekdayOf(d)));
    if (!days.length) continue;
    const want = covered === 7 ? c.perWeek : Math.round((c.perWeek * covered) / 7);
    const n = Math.min(want, days.length * perDay);
    // Cada día lleva `base`; los que sobran van a días repartidos parejo (un día sí y otro no).
    const base = Math.floor(n / days.length);
    const extra = n % days.length;
    const plus = new Set(Array.from({ length: extra }, (_, j) => Math.floor(((j + 0.5) * days.length) / extra)));
    days.forEach((day, i) => {
      const k = base + (plus.has(i) ? 1 : 0);
      // Horas repartidas en el día: con 3 horas y 1 publicación, la del medio; con 2, la primera y la última.
      const picks = k === 1 ? [times[Math.floor((times.length - 1) / 2)]] : Array.from({ length: k }, (_, j) => times[Math.round((j * (times.length - 1)) / Math.max(1, k - 1))]);
      for (const t of new Set(picks)) out.push(localToUtc(day, 0, t, tz));
    });
  }
  const first = c.startsAt.getTime();
  const last = endDate.getTime();
  return out.filter((d) => d.getTime() >= first && d.getTime() <= last).sort((a, b) => a.getTime() - b.getTime());
}

/** Clave de un horario (se guarda en engine.handled). */
export const slotKey = (d: Date) => d.toISOString();

/** Horarios que toca preparar ahora: los de los próximos `leadDays` días que aún no se atendieron (nunca en el pasado). */
export function dueSlots(slots: Date[], handled: string[], now: Date, leadDays = 3): Date[] {
  const done = new Set(handled);
  const from = now.getTime() + 10 * 60000;
  const to = now.getTime() + leadDays * 86400000;
  return slots.filter((s) => s.getTime() >= from && s.getTime() <= to && !done.has(slotKey(s)));
}

/** El tipo de publicación del horario número `index`, según el reparto (siempre igual para el mismo número). */
export function pickKind(mix: ContentMix, index: number): PostKind {
  const total = POST_KINDS.reduce((s, k) => s + Math.max(0, mix[k]), 0);
  if (total <= 0) return "post";
  // Reparto parejo: en cada vuelta de 20 se toma el tipo que más se queda atrás de su parte.
  const cycle = 20;
  const pos = ((index % cycle) + cycle) % cycle;
  const given: Record<PostKind, number> = { post: 0, carousel: 0, story: 0, video: 0 };
  let pick: PostKind = "post";
  for (let i = 0; i <= pos; i++) {
    let best: PostKind = "post";
    let gap = -Infinity;
    for (const k of POST_KINDS) {
      const share = Math.max(0, mix[k]) / total;
      if (share <= 0) continue;
      const g = share * (i + 1) - given[k];
      if (g > gap + 1e-9) {
        gap = g;
        best = k;
      }
    }
    given[best]++;
    pick = best;
  }
  return pick;
}

/** Cuántas de las últimas publicaciones (la más nueva primero) fallaron seguidas. */
export function failuresInRow(statuses: string[]): number {
  let n = 0;
  for (const s of statuses) {
    if (s === "failed") n++;
    else if (s === "done" || s === "partial") break;
  }
  return n;
}

// ---------- Temas prohibidos ----------

export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ¿Aparece esta palabra o frase (completa) en el texto ya normalizado? */
export function hasPhrase(normText: string, phrase: string): boolean {
  const p = normalize(phrase).trim().replace(/\s+/g, " ");
  if (!p) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "u").test(normText);
}

export type TopicHit = { topic: SafetyId | "owner"; word: string };

/** La primera palabra de un tema que aparece en el texto (o null). */
export function topicHit(text: string, topic: SafetyId, competitors: string[] = []): TopicHit | null {
  const norm = normalize(text);
  const def = safetyTopic(topic);
  if (!def) return null;
  const list = topic === "competitors" ? competitors : def.words;
  for (const w of list) if (hasPhrase(norm, w)) return { topic, word: w };
  for (const re of def.patterns ?? []) {
    const m = re.exec(norm);
    if (m) return { topic, word: m[0].trim() };
  }
  return null;
}

/** Todos los temas prohibidos que aparecen en el texto: los del dueño y los de la lista de seguridad que estén marcados. */
export function bannedHits(rules: Pick<CampaignRules, "bannedTopics" | "safety" | "competitors">, text: string): TopicHit[] {
  const norm = normalize(text);
  const hits: TopicHit[] = [];
  for (const w of rules.bannedTopics) if (hasPhrase(norm, w)) hits.push({ topic: "owner", word: w });
  for (const id of SAFETY_IDS) {
    if (!rules.safety[id]) continue;
    const h = topicHit(text, id, rules.competitors);
    if (h) hits.push(h);
  }
  return hits;
}

// ---------- La revisión de cada publicación automática ----------

export type ReasonCode =
  | "status"
  | "manual"
  | "beforeStart"
  | "afterEnd"
  | "past"
  | "noChannels"
  | "channel"
  | "maxPerDay"
  | "perWeek"
  | "quietHours"
  | "weekday"
  | "budget"
  | "banned"
  | "empty"
  | "prices"
  | "newChannel"
  | "aiImage";

export type Reason = { code: ReasonCode; word?: string; channel?: string; topic?: string; detail?: string };

export type CheckCampaign = { status: string; mode: string; startsAt: Date; endsAt: Date | null; channels: string[]; perWeek: number };
export type CheckDraft = {
  /** Todos los textos de la publicación (cada canal, asunto, titular de la foto…). Vacío = revisar solo horario y límites. */
  texts: string[];
  channels: string[];
  scheduledAt: Date;
  /** Lo que cuesta esta publicación en fotos/videos con IA (centavos). */
  aiCostCents: number;
  /** La foto la hizo la IA (no es una foto real del negocio). */
  aiImage?: boolean;
};
export type CheckCounts = {
  /** Publicaciones de la campaña ya puestas ese mismo día (sin contar esta). */
  day: number;
  /** …y en esa misma semana de la campaña. */
  week: number;
  /** Lo ya gastado en IA (fotos/videos) en esta campaña, en centavos. */
  aiSpentCents: number;
  /** Canales conectados del negocio. */
  connected: string[];
  /** Canales donde el negocio ya publicó algo antes (para «canal nuevo»). */
  usedChannels: string[];
};
export type CheckResult = { ok: boolean; reasons: Reason[]; needsApproval: Reason[] };

/**
 * La revisión que TODA acción automática debe pasar. `ok: false` = la IA no lo hace (y se anota por qué).
 * `needsApproval` = puede hacerse, pero en 100% IA queda como borrador para que el dueño lo apruebe.
 */
export function checkPost(rules: CampaignRules, campaign: CheckCampaign, draft: CheckDraft, counts: CheckCounts, now: Date = new Date()): CheckResult {
  const reasons: Reason[] = [];
  const needsApproval: Reason[] = [];
  const tz = rules.timezone || BUSINESS_TZ;
  if (campaign.mode === "manual") reasons.push({ code: "manual" });
  if (campaign.status !== "active") reasons.push({ code: "status", detail: campaign.status });
  const at = draft.scheduledAt.getTime();
  if (at < campaign.startsAt.getTime()) reasons.push({ code: "beforeStart" });
  if (campaign.endsAt && at > campaign.endsAt.getTime()) reasons.push({ code: "afterEnd" });
  if (at < now.getTime() - 60000) reasons.push({ code: "past" });

  if (!draft.channels.length) reasons.push({ code: "noChannels" });
  for (const ch of draft.channels) {
    if (!campaign.channels.includes(ch)) reasons.push({ code: "channel", channel: ch, detail: "notInCampaign" });
    else if (!counts.connected.includes(ch)) reasons.push({ code: "channel", channel: ch, detail: "notConnected" });
  }

  const local = localParts(draft.scheduledAt, tz);
  if (!rules.weekdays.includes(local.weekday)) reasons.push({ code: "weekday" });
  if (inQuietHours(local.minutes, rules.quietHours)) reasons.push({ code: "quietHours" });
  if (counts.day >= rules.maxPerDay) reasons.push({ code: "maxPerDay" });
  if (counts.week >= campaign.perWeek) reasons.push({ code: "perWeek" });
  if (draft.aiCostCents > 0 && counts.aiSpentCents + draft.aiCostCents > rules.maxAiCostCents) reasons.push({ code: "budget" });

  const texts = draft.texts.filter((t) => t.trim());
  if (draft.texts.length && !texts.length) reasons.push({ code: "empty" });
  const all = texts.join("\n");
  if (all) {
    for (const h of bannedHits(rules, all)) reasons.push({ code: "banned", word: h.word, topic: h.topic });
    if (!rules.safety.prices && rules.needsApprovalFor.includes("prices")) {
      const p = topicHit(all, "prices");
      if (p) needsApproval.push({ code: "prices", word: p.word });
    }
  }
  if (rules.needsApprovalFor.includes("newChannel"))
    for (const ch of draft.channels) if (!counts.usedChannels.includes(ch)) needsApproval.push({ code: "newChannel", channel: ch });
  if (draft.aiImage && rules.needsApprovalFor.includes("aiImage")) needsApproval.push({ code: "aiImage" });

  return { ok: reasons.length === 0, reasons, needsApproval };
}

/** Qué hace el motor con una publicación lista según el modo: borrador, programada o nada. */
export function decideStatus(mode: string, check: CheckResult): "draft" | "scheduled" | null {
  if (mode === "manual" || !check.ok) return null;
  if (mode === "approval") return "draft";
  return check.needsApproval.length ? "draft" : "scheduled";
}

/** Una razón en palabras para el dueño. `channelName` traduce el id del canal. */
export function reasonText(r: Reason, lang: UiLang = "es", channelName: (id: string) => string = (id) => id): string {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const ch = r.channel ? channelName(r.channel) : "";
  const topic = r.topic && r.topic !== "owner" ? safetyTopic(r.topic) : null;
  switch (r.code) {
    case "manual":
      return t("La campaña es manual: la IA no publica nada sola.", "The campaign is manual: the AI doesn't post anything on its own.");
    case "status":
      return t("La campaña no está activa.", "The campaign isn't active.");
    case "beforeStart":
      return t("Sería antes de que empiece la campaña.", "It would be before the campaign starts.");
    case "afterEnd":
      return t("Sería después de que termine la campaña.", "It would be after the campaign ends.");
    case "past":
      return t("La hora ya pasó.", "That time has already passed.");
    case "noChannels":
      return t("No hay ningún canal conectado de la campaña donde publicar.", "None of the campaign's channels is connected.");
    case "channel":
      return r.detail === "notConnected" ? t(`${ch} no está conectado.`, `${ch} isn't connected.`) : t(`${ch} no es un canal de esta campaña.`, `${ch} isn't one of this campaign's channels.`);
    case "maxPerDay":
      return t("Ese día ya llegó al máximo de publicaciones.", "That day already reached the maximum number of posts.");
    case "perWeek":
      return t("Esa semana ya llegó al número de publicaciones de la campaña.", "That week already reached the campaign's number of posts.");
    case "quietHours":
      return t("Cae en las horas sin publicar.", "It falls in the no-posting hours.");
    case "weekday":
      return t("Ese día de la semana no está permitido.", "That day of the week isn't allowed.");
    case "budget":
      return t("Se pasaría del tope de gasto en IA de la campaña.", "It would go over the campaign's AI spending cap.");
    case "banned":
      return topic
        ? t(`Toca un tema prohibido (${topic.es}): «${r.word}».`, `It touches a banned topic (${topic.en}): “${r.word}”.`)
        : t(`Usa una palabra prohibida: «${r.word}».`, `It uses a banned word: “${r.word}”.`);
    case "empty":
      return t("El texto quedó vacío.", "The text came out empty.");
    case "prices":
      return t(`Habla de precios («${r.word}»): necesita tu aprobación.`, `It mentions prices (“${r.word}”): it needs your approval.`);
    case "newChannel":
      return t(`Es la primera vez que se publica en ${ch}: necesita tu aprobación.`, `It's the first post on ${ch}: it needs your approval.`);
    case "aiImage":
      return t("La foto la hizo la IA: necesita tu aprobación.", "The photo was made by the AI: it needs your approval.");
  }
}

/** Idioma de los textos para la IA según los idiomas de la campaña. */
export function writeLang(r: Pick<CampaignRules, "languages">): "es" | "en" | "both" {
  if (r.languages.includes("es") && r.languages.includes("en")) return "both";
  return r.languages[0] === "en" ? "en" : "es";
}

/** Costo aproximado (centavos, redondeado hacia arriba) de una foto con IA según el servicio. */
export const AI_IMAGE_CENTS: Record<string, number> = { flux: 4, openai: 7, gemini: 4 };
export const aiImageCents = (provider: string | null | undefined) => (provider ? (AI_IMAGE_CENTS[provider] ?? 7) : 0);

/** "US$1.25" */
export const centsText = (cents: number) => `US$${(Math.max(0, cents) / 100).toFixed(2)}`;

/** Cuántas publicaciones de la campaña ya hay el mismo día y en la misma semana de la campaña que `slot`. */
export function slotCounts(existing: { scheduledAt: Date }[], slot: Date, startsAt: Date, tz: string = BUSINESS_TZ): { day: number; week: number } {
  const startDay = localParts(startsAt, tz).day;
  const day = localParts(slot, tz).day;
  const week = campaignWeek(startDay, day);
  let d = 0;
  let w = 0;
  for (const p of existing) {
    const pd = localParts(p.scheduledAt, tz).day;
    if (pd === day) d++;
    if (campaignWeek(startDay, pd) === week) w++;
  }
  return { day: d, week: w };
}

/** Qué publicaciones se cancelan al PARAR: las que todavía no salieron (programadas o borradores). */
export const STOPPABLE_STATUSES = ["scheduled", "draft"] as const;
export const isStoppable = (status: string) => (STOPPABLE_STATUSES as readonly string[]).includes(status);

// ---------- Formulario (asistente y «Editar límites») ----------

/** Lee los límites y reglas del formulario. Lo que no viene en el formulario se queda como estaba en `base`. */
export function rulesFromForm(f: FormData, base: CampaignRules): CampaignRules {
  const has = (k: string) => f.has(k);
  const str = (k: string) => String(f.get(k) ?? "").trim();
  const on = (k: string) => f.get(k) === "on" || f.get(k) === "1" || f.get(k) === "true";
  const raw: Record<string, unknown> = { ...base, safety: { ...base.safety }, alerts: { ...base.alerts } };
  if (has("bannedTopics")) raw.bannedTopics = str("bannedTopics");
  if (has("competitors")) raw.competitors = str("competitors");
  if (has("allowedTopics")) raw.allowedTopics = str("allowedTopics");
  if (has("safety_present")) raw.safety = Object.fromEntries(SAFETY_IDS.map((id) => [id, on(`safety_${id}`)]));
  if (has("maxPerDay")) raw.maxPerDay = str("maxPerDay");
  if (has("quiet_present")) raw.quietHours = on("quietOn") ? { from: str("quietFrom"), to: str("quietTo") } : null;
  if (has("weekdays_present")) raw.weekdays = f.getAll("weekdays").map(Number);
  if (has("approval_present")) raw.needsApprovalFor = f.getAll("needsApprovalFor").map(String);
  if (has("maxAiCost")) {
    const dollars = Number(str("maxAiCost").replace(",", "."));
    raw.maxAiCostCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : base.maxAiCostCents;
  }
  if (has("alerts_present"))
    raw.alerts = { email: str("alertEmail"), onEveryPost: on("alertPost"), onLimit: on("alertLimit"), onError: on("alertError"), onStop: on("alertStop") };
  if (has("stopOnErrors")) raw.stopOnErrors = str("stopOnErrors");
  if (has("mix_present")) raw.contentMix = Object.fromEntries(POST_KINDS.map((k) => [k, Number(str(`mix_${k}`)) || 0]));
  if (has("languages_present")) raw.languages = f.getAll("languages").map(String);
  const out = readRules(raw, { email: base.alerts.email });
  // Un formulario sin días o sin idiomas no se rellena solo con los de antes: se avisa.
  if (has("weekdays_present") && !f.getAll("weekdays").length) out.weekdays = [];
  if (has("languages_present") && !f.getAll("languages").length) out.languages = [];
  if (has("alerts_present")) out.alerts.email = str("alertEmail").slice(0, 200);
  return out;
}
