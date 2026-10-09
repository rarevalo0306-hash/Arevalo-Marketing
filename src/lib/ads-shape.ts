// Anuncios pagados de una campaña (Campaign.ads, JSON) y los límites de dinero. Sin servidor ni base de datos:
// lo usan el motor (src/lib/ads.ts), la pantalla /b/<id>/anuncios y las pruebas.
//
// Límites que NUNCA se pasan (todo en centavos de dólar):
// 1. Total de la campaña (Campaign.budgetCents): lo máximo que pueden gastar TODOS sus anuncios juntos. Cada anuncio
//    se crea en Meta con un presupuesto total (lifetime_budget) y fecha de fin, así Meta no puede gastar más que eso.
//    La suma de lo que cada anuncio PUEDE gastar (no solo lo gastado) nunca pasa del total de la campaña.
// 2. Por día: cada anuncio tiene un gasto por día; si un día gasta eso (o la campaña llega a su tope diario), se pausa
//    hasta el día siguiente.
// 3. Por mes y negocio (AdsSettings.monthlyCapCents, en la fila Connection "ads_settings"): sin ese tope no se puede
//    crear ni encender ningún anuncio.
// 4. Parada de emergencia: si la campaña está pausada, parada, terminada (o en borrador), se pausan todos sus anuncios.

export type BiText = { es: string; en: string };

export const AD_GOALS = ["awareness", "traffic", "engagement", "messages", "calls"] as const;
export type AdGoal = (typeof AD_GOALS)[number];

/**
 * Categorías especiales de Meta. Los anuncios de seguros, préstamos, tarjetas, inversiones (y en general productos y
 * servicios financieros) DEBEN usar FINANCIAL_PRODUCTS_SERVICES (antes CREDIT, desde el 14 de enero de 2025): sin
 * edad ni género, radio mínimo de ~25 km (15 millas en EE. UU. y Canadá), sin códigos postales y sin intereses de
 * comportamiento. Vivienda (HOUSING) y empleo (EMPLOYMENT) tienen las mismas reglas.
 */
export const SPECIAL_CATEGORIES = ["NONE", "FINANCIAL_PRODUCTS_SERVICES", "HOUSING", "EMPLOYMENT"] as const;
export type SpecialCategory = (typeof SPECIAL_CATEGORIES)[number];

/** Radio en km: Meta acepta de 1 a 80. Con categoría especial, mínimo 25 km (15 millas). */
export const RADIUS_MIN_KM = 1;
export const RADIUS_MAX_KM = 80;
export const SPECIAL_RADIUS_MIN_KM = 25;
/** Mínimo por día que acepta Meta para anuncios que se cobran por vistas (aprox. US$1; se pide al menos eso). */
export const MIN_DAILY_CENTS = 100;
/** Duración de un anuncio: de 1 a 90 días. */
export const MAX_DAYS = 90;

/** Estados de un anuncio en esta app. */
export type AdStatus =
  /** Creado en Meta pero apagado: no gasta nada. */
  | "paused"
  /** Encendido: puede gastar (siempre dentro de sus límites). */
  | "active"
  /** Llegó a su gasto del día: pausado hasta mañana (el motor lo vuelve a encender si todo sigue en orden). */
  | "capped_today"
  /** Terminó (fecha de fin o se gastó todo). */
  | "ended"
  /** No se pudo crear completo en Meta. */
  | "error";

export type PauseReason = "owner" | "budget" | "daily" | "monthly" | "campaign" | "ended" | "error";

/** De dónde sale el anuncio: una publicación que ya existe (promocionarla) o un anuncio nuevo con foto y texto. */
export type AdSource =
  | { kind: "fb_post"; postId: string; text: string; image: string; permalink: string }
  | { kind: "ig_post"; mediaId: string; text: string; image: string; permalink: string }
  | { kind: "new"; text: string; headline: string; image: string; link: string };

export type AdTargeting = {
  lat: number;
  lng: number;
  radiusKm: number;
  /** null = sin límite (18+). Con categoría especial siempre null. */
  ageMin: number | null;
  ageMax: number | null;
  /** Intereses de Meta (id y nombre) — solo sin categoría especial. */
  interests: { id: string; name: string }[];
  /** Texto para el dueño: "25 km alrededor de Managua". */
  place: string;
  /** Ciudad de Meta (cuando no hay punto en el mapa): se usa en vez de lat/lng. */
  cityKey: string;
};

export type AdInsights = {
  /** Gastado desde el inicio, centavos. */
  spentCents: number;
  /** Gastado hoy (día de la cuenta de anuncios). */
  todayCents: number;
  /** Gastado este mes. */
  monthCents: number;
  impressions: number;
  reach: number;
  clicks: number;
  /** Llamadas, mensajes, clics… según el objetivo. */
  results: number;
  fetchedAt: string;
};

export type AdError = { at: string; es: string; en: string };

export type AdEntry = {
  /** Id local (para la pantalla y las acciones). */
  id: string;
  platform: "meta";
  name: string;
  goal: AdGoal;
  source: AdSource;
  /** Ids en Meta, se llenan paso a paso al crear. */
  ext: { campaignId?: string; adSetId?: string; creativeId?: string; adId?: string };
  status: AdStatus;
  pausedReason?: PauseReason;
  /** Día (AAAA-MM-DD, hora del negocio) en que se pausó por llegar al gasto del día. */
  cappedDay?: string;
  /** Gasto por día pensado (también el tope diario del anuncio). */
  dailyCents: number;
  /** Lo máximo que puede gastar (lifetime_budget en Meta). */
  totalCents: number;
  startsAt: string;
  endsAt: string;
  targeting: AdTargeting;
  specialCategory: SpecialCategory;
  insights?: AdInsights;
  createdAt: string;
  createdBy: "owner" | "auto";
  activatedAt?: string;
  /** Últimos errores (máx. 5). */
  errors: AdError[];
};

/** Una propuesta de la IA (todavía no existe en Meta). */
export type AdProposal = {
  id: string;
  title: string;
  why: string;
  goal: AdGoal;
  /** Publicación que conviene promocionar (id de Facebook "pagina_post" o de Instagram), o "" para un anuncio nuevo. */
  postRef: string;
  postKind: "fb_post" | "ig_post" | "new";
  text: string;
  headline: string;
  radiusKm: number;
  ageMin: number | null;
  ageMax: number | null;
  interests: string[];
  dailyCents: number;
  days: number;
  reachLow: number;
  reachHigh: number;
  keywords: string[];
};

export type CampaignAds = {
  /** «La IA puede crear anuncios» (solo campañas en modo automático). Apagado por defecto. */
  aiCanCreate: boolean;
  /** Tope de gasto por día de toda la campaña (0 = solo el de cada anuncio). */
  dailyCapCents: number;
  items: AdEntry[];
  proposals: AdProposal[];
  proposalsAt?: string;
  /** Última vez que la IA intentó crear un anuncio sola (para no intentarlo en cada vuelta). */
  autoTriedAt?: string;
};

/** Ajustes de anuncios del negocio (fila Connection "ads_settings", cifrada). */
export type AdsSettings = {
  /** Lo máximo que el negocio gasta en anuncios en un mes (todas las campañas). 0 = no puesto: no se crean anuncios. */
  monthlyCapCents: number;
  specialCategory: SpecialCategory;
  /** País de la cuenta (ISO-2) para la categoría especial. */
  country: string;
  /** Plan de Google Ads mejorado por la IA (si se pidió). */
  googlePlan?: unknown;
};

// ---------- Leer y limpiar ----------

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, min = 0, max = 1e12) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min;
};
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const STATUSES: readonly AdStatus[] = ["paused", "active", "capped_today", "ended", "error"];
const REASONS: readonly PauseReason[] = ["owner", "budget", "daily", "monthly", "campaign", "ended", "error"];

function readSource(v: unknown): AdSource {
  const o = obj(v);
  if (o.kind === "fb_post") return { kind: "fb_post", postId: str(o.postId, 80), text: str(o.text, 2000), image: str(o.image, 1000), permalink: str(o.permalink, 500) };
  if (o.kind === "ig_post") return { kind: "ig_post", mediaId: str(o.mediaId, 80), text: str(o.text, 2000), image: str(o.image, 1000), permalink: str(o.permalink, 500) };
  return { kind: "new", text: str(o.text, 2000), headline: str(o.headline, 100), image: str(o.image, 1000), link: str(o.link, 500) };
}

function readTargeting(v: unknown): AdTargeting {
  const o = obj(v);
  const age = (x: unknown) => (typeof x === "number" && x >= 13 && x <= 65 ? Math.round(x) : null);
  return {
    lat: typeof o.lat === "number" ? o.lat : 0,
    lng: typeof o.lng === "number" ? o.lng : 0,
    radiusKm: int(o.radiusKm, RADIUS_MIN_KM, RADIUS_MAX_KM),
    ageMin: age(o.ageMin),
    ageMax: age(o.ageMax),
    interests: Array.isArray(o.interests)
      ? o.interests.map(obj).filter((i) => str(i.id)).map((i) => ({ id: str(i.id, 40), name: str(i.name, 100) })).slice(0, 10)
      : [],
    place: str(o.place, 200),
    cityKey: str(o.cityKey, 40),
  };
}

function readInsights(v: unknown): AdInsights | undefined {
  const o = obj(v);
  if (!str(o.fetchedAt)) return undefined;
  return {
    spentCents: int(o.spentCents),
    todayCents: int(o.todayCents),
    monthCents: int(o.monthCents),
    impressions: int(o.impressions),
    reach: int(o.reach),
    clicks: int(o.clicks),
    results: int(o.results),
    fetchedAt: str(o.fetchedAt, 40),
  };
}

export function readAdEntry(v: unknown): AdEntry | null {
  const o = obj(v);
  const id = str(o.id, 40);
  if (!id) return null;
  const ext = obj(o.ext);
  return {
    id,
    platform: "meta",
    name: str(o.name, 200),
    goal: oneOf(o.goal, AD_GOALS, "awareness"),
    source: readSource(o.source),
    ext: {
      ...(str(ext.campaignId) ? { campaignId: str(ext.campaignId, 40) } : {}),
      ...(str(ext.adSetId) ? { adSetId: str(ext.adSetId, 40) } : {}),
      ...(str(ext.creativeId) ? { creativeId: str(ext.creativeId, 40) } : {}),
      ...(str(ext.adId) ? { adId: str(ext.adId, 40) } : {}),
    },
    status: oneOf(o.status, STATUSES, "paused"),
    ...(REASONS.includes(o.pausedReason as PauseReason) ? { pausedReason: o.pausedReason as PauseReason } : {}),
    ...(str(o.cappedDay) ? { cappedDay: str(o.cappedDay, 10) } : {}),
    dailyCents: int(o.dailyCents),
    totalCents: int(o.totalCents),
    startsAt: str(o.startsAt, 40),
    endsAt: str(o.endsAt, 40),
    targeting: readTargeting(o.targeting),
    specialCategory: oneOf(o.specialCategory, SPECIAL_CATEGORIES, "NONE"),
    ...(readInsights(o.insights) ? { insights: readInsights(o.insights) } : {}),
    createdAt: str(o.createdAt, 40),
    createdBy: o.createdBy === "auto" ? "auto" : "owner",
    ...(str(o.activatedAt) ? { activatedAt: str(o.activatedAt, 40) } : {}),
    errors: Array.isArray(o.errors) ? o.errors.map(obj).map((e) => ({ at: str(e.at, 40), es: str(e.es), en: str(e.en) })).slice(-5) : [],
  };
}

function readProposal(v: unknown): AdProposal | null {
  const o = obj(v);
  const id = str(o.id, 40);
  if (!id) return null;
  return {
    id,
    title: str(o.title, 120),
    why: str(o.why, 600),
    goal: oneOf(o.goal, AD_GOALS, "awareness"),
    postRef: str(o.postRef, 80),
    postKind: oneOf(o.postKind, ["fb_post", "ig_post", "new"] as const, "new"),
    text: str(o.text, 1500),
    headline: str(o.headline, 80),
    radiusKm: int(o.radiusKm, RADIUS_MIN_KM, RADIUS_MAX_KM),
    ageMin: numOrNull(o.ageMin),
    ageMax: numOrNull(o.ageMax),
    interests: Array.isArray(o.interests) ? o.interests.map((x) => str(x, 60)).filter(Boolean).slice(0, 6) : [],
    dailyCents: int(o.dailyCents),
    days: int(o.days, 1, MAX_DAYS),
    reachLow: int(o.reachLow),
    reachHigh: int(o.reachHigh),
    keywords: Array.isArray(o.keywords) ? o.keywords.map((x) => str(x, 80)).filter(Boolean).slice(0, 8) : [],
  };
}

/** Lee Campaign.ads (lo que sea que haya guardado) con valores seguros: la IA no crea anuncios si no se encendió. */
export function readCampaignAds(json: unknown): CampaignAds {
  const o = obj(json);
  return {
    aiCanCreate: o.aiCanCreate === true,
    dailyCapCents: int(o.dailyCapCents),
    items: Array.isArray(o.items) ? o.items.map(readAdEntry).filter((x): x is AdEntry => x !== null) : [],
    proposals: Array.isArray(o.proposals) ? o.proposals.map(readProposal).filter((x): x is AdProposal => x !== null).slice(0, 3) : [],
    ...(str(o.proposalsAt) ? { proposalsAt: str(o.proposalsAt, 40) } : {}),
    ...(str(o.autoTriedAt) ? { autoTriedAt: str(o.autoTriedAt, 40) } : {}),
  };
}

export function readAdsSettings(json: unknown): AdsSettings {
  const o = obj(json);
  const country = str(o.country, 2).toUpperCase();
  return {
    monthlyCapCents: int(o.monthlyCapCents),
    specialCategory: oneOf(o.specialCategory, SPECIAL_CATEGORIES, "NONE"),
    country: /^[A-Z]{2}$/.test(country) ? country : "",
    ...(o.googlePlan ? { googlePlan: o.googlePlan } : {}),
  };
}

// ---------- Dinero ----------

/** ¿Este anuncio todavía puede gastar? (encendido o pausado por el día). */
export const isLive = (a: AdEntry) => a.status === "active" || a.status === "capped_today";
const spent = (a: AdEntry) => a.insights?.spentCents ?? 0;

/**
 * Lo que un anuncio "ocupa" del presupuesto: si ya terminó o falló, lo que gastó; si no, lo máximo que podría
 * gastar (su total), porque aunque esté pausado se puede volver a encender.
 */
export function committedCents(a: AdEntry): number {
  if (a.status === "ended" || a.status === "error") return spent(a);
  return Math.max(a.totalCents, spent(a));
}

/** Lo gastado por todos los anuncios de una campaña (para Campaign.spentCents). */
export const adsSpentCents = (items: AdEntry[]) => items.reduce((s, a) => s + spent(a), 0);

const monthOf = (iso: string) => iso.slice(0, 7);

/** Lo gastado este mes (AAAA-MM) según los últimos resultados guardados. */
export function monthSpentCents(items: AdEntry[], month: string): number {
  return items.reduce((s, a) => s + (a.insights && monthOf(a.insights.fetchedAt) === month ? a.insights.monthCents : 0), 0);
}

/**
 * Lo que ocupa este mes: lo ya gastado este mes + lo que los anuncios vivos o pausados todavía PUEDEN gastar.
 * (Si un anuncio cruza de mes, se cuenta completo en este mes: mejor de más que de menos.)
 */
export function monthCommittedCents(items: AdEntry[], month: string): number {
  return items.reduce((s, a) => {
    const thisMonth = a.insights && monthOf(a.insights.fetchedAt) === month ? a.insights.monthCents : 0;
    if (a.status === "ended" || a.status === "error") return s + thisMonth;
    const before = Math.max(0, spent(a) - thisMonth);
    return s + Math.max(thisMonth, a.totalCents - before);
  }, 0);
}

/** Lo que queda del presupuesto de la campaña para anuncios nuevos. */
export function campaignRoomCents(budgetCents: number, items: AdEntry[], exceptId?: string): number {
  const used = items.filter((a) => a.id !== exceptId).reduce((s, a) => s + committedCents(a), 0);
  return Math.max(0, budgetCents - used);
}

/** Días completos entre dos fechas (mínimo 1). */
export function daysBetween(start: Date, end: Date): number {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}

/** Lo máximo que puede gastar un anuncio: su gasto por día × días, que es el total que se le pone en Meta. */
export const maxSpendCents = (dailyCents: number, days: number) => Math.max(0, Math.round(dailyCents)) * Math.max(1, Math.round(days));

export type NewAdCheck = {
  dailyCents: number;
  days: number;
  startsAt: Date;
  campaign: { status: string; budgetCents: number; endsAt: Date | null };
  items: AdEntry[];
  /** Lo que ya ocupa el negocio este mes en anuncios de TODAS las campañas (committed, incluye esta). */
  monthCommittedCents: number;
  monthlyCapCents: number;
  dailyCapCents: number;
  radiusKm: number;
  specialCategory: SpecialCategory;
  ageMin: number | null;
  ageMax: number | null;
};

/** Revisa un anuncio nuevo contra TODOS los límites. Devuelve los problemas (vacío = se puede crear). */
export function checkNewAd(c: NewAdCheck): BiText[] {
  const out: BiText[] = [];
  const total = maxSpendCents(c.dailyCents, c.days);
  if (["stopped", "ended"].includes(c.campaign.status))
    out.push({ es: "La campaña está parada o terminó: no se pueden crear anuncios.", en: "The campaign is stopped or ended: ads can't be created." });
  if (c.monthlyCapCents <= 0)
    out.push({ es: "Primero pon el máximo que el negocio puede gastar en anuncios por mes.", en: "First set the most the business can spend on ads per month." });
  if (c.campaign.budgetCents <= 0)
    out.push({ es: "La campaña no tiene presupuesto para anuncios (es solo gratis). Ponle un presupuesto en Campañas.", en: "The campaign has no ad budget (free only). Give it a budget in Campaigns." });
  if (c.dailyCents < MIN_DAILY_CENTS)
    out.push({ es: `El gasto por día debe ser de al menos ${money(MIN_DAILY_CENTS)}.`, en: `The daily spend must be at least ${money(MIN_DAILY_CENTS)}.` });
  if (c.days < 1 || c.days > MAX_DAYS) out.push({ es: `Elige de 1 a ${MAX_DAYS} días.`, en: `Pick 1 to ${MAX_DAYS} days.` });
  const room = campaignRoomCents(c.campaign.budgetCents, c.items);
  if (c.campaign.budgetCents > 0 && total > room)
    out.push({
      es: `Este anuncio podría gastar ${money(total)} y a la campaña solo le quedan ${money(room)}.`,
      en: `This ad could spend ${money(total)} and the campaign only has ${money(room)} left.`,
    });
  if (c.monthlyCapCents > 0 && c.monthCommittedCents + total > c.monthlyCapCents)
    out.push({
      es: `Pasaría el máximo del mes (${money(c.monthlyCapCents)}): ya hay ${money(c.monthCommittedCents)} comprometidos.`,
      en: `It would go over the monthly maximum (${money(c.monthlyCapCents)}): ${money(c.monthCommittedCents)} is already committed.`,
    });
  if (c.dailyCapCents > 0) {
    const dailyLive = c.items.filter((a) => a.status !== "ended" && a.status !== "error").reduce((s, a) => s + a.dailyCents, 0);
    if (dailyLive + c.dailyCents > c.dailyCapCents)
      out.push({
        es: `Con este anuncio la campaña gastaría hasta ${money(dailyLive + c.dailyCents)} por día y su tope diario es ${money(c.dailyCapCents)}.`,
        en: `With this ad the campaign would spend up to ${money(dailyLive + c.dailyCents)} a day and its daily cap is ${money(c.dailyCapCents)}.`,
      });
  }
  const end = new Date(c.startsAt.getTime() + c.days * 86_400_000);
  if (c.campaign.endsAt && end.getTime() > c.campaign.endsAt.getTime() + 60_000)
    out.push({ es: "El anuncio terminaría después que la campaña. Usa menos días.", en: "The ad would end after the campaign. Use fewer days." });
  const minRadius = c.specialCategory === "NONE" ? RADIUS_MIN_KM : SPECIAL_RADIUS_MIN_KM;
  if (c.radiusKm < minRadius || c.radiusKm > RADIUS_MAX_KM)
    out.push({ es: `El radio debe ser de ${minRadius} a ${RADIUS_MAX_KM} km.`, en: `The radius must be ${minRadius} to ${RADIUS_MAX_KM} km.` });
  if (c.specialCategory !== "NONE" && (c.ageMin !== null || c.ageMax !== null))
    out.push({ es: "En esta categoría Meta no permite elegir edades.", en: "In this category Meta doesn't allow choosing ages." });
  if (c.ageMin !== null && c.ageMax !== null && c.ageMin > c.ageMax)
    out.push({ es: "La edad mínima es mayor que la máxima.", en: "The minimum age is higher than the maximum." });
  return out;
}

/** Revisión antes de ENCENDER (o volver a encender) un anuncio que ya existe. */
export function checkActivate(a: AdEntry, ctx: { campaignStatus: string; campaignBudgetCents: number; campaignSpentCents: number; campaignEndsAt: Date | null; monthlyCapCents: number; monthSpentCents: number; now: Date }): BiText[] {
  const out: BiText[] = [];
  if (ctx.campaignStatus !== "active")
    out.push({ es: "La campaña no está activa. Actívala primero en Campañas.", en: "The campaign isn't active. Turn it on first in Campaigns." });
  if (!a.ext.adId) out.push({ es: "Este anuncio no se terminó de crear en Meta.", en: "This ad wasn't fully created on Meta." });
  if (a.status === "ended" || a.status === "error") out.push({ es: "Este anuncio ya terminó.", en: "This ad has already ended." });
  if (ctx.monthlyCapCents <= 0) out.push({ es: "Falta el máximo por mes del negocio.", en: "The business monthly maximum is missing." });
  else if (ctx.monthSpentCents >= ctx.monthlyCapCents) out.push({ es: "Ya se gastó el máximo de este mes.", en: "This month's maximum is already spent." });
  if (ctx.campaignBudgetCents <= 0 || ctx.campaignSpentCents >= ctx.campaignBudgetCents)
    out.push({ es: "La campaña ya gastó su presupuesto.", en: "The campaign has already spent its budget." });
  if (spent(a) >= a.totalCents) out.push({ es: "Este anuncio ya gastó su total.", en: "This ad has already spent its total." });
  const end = new Date(a.endsAt);
  if (!Number.isNaN(end.getTime()) && end <= ctx.now) out.push({ es: "La fecha de fin ya pasó.", en: "The end date has passed." });
  if (ctx.campaignEndsAt && ctx.campaignEndsAt <= ctx.now) out.push({ es: "La campaña ya terminó.", en: "The campaign has ended." });
  return out;
}

// ---------- Decisiones del motor (pausar / volver a encender) ----------

export type AdDecision = { adId: string; action: "pause" | "resume" | "end"; reason: PauseReason };

export type DecideInput = {
  campaign: { status: string; budgetCents: number; spentCents: number; endsAt: Date | null; dailyCapCents: number };
  items: AdEntry[];
  monthlyCapCents: number;
  /** Lo gastado este mes por el negocio en anuncios (todas las campañas). */
  monthSpentCents: number;
  now: Date;
  /** Día de hoy (AAAA-MM-DD, hora del negocio). */
  today: string;
};

/**
 * Qué hacer con cada anuncio en esta vuelta. Nunca enciende algo que el dueño o un límite pausó, salvo el tope del
 * día cuando ya es otro día y todo lo demás sigue en orden.
 */
export function decideAds(x: DecideInput): AdDecision[] {
  const out: AdDecision[] = [];
  const c = x.campaign;
  const stopCampaign = ["stopped", "paused", "ended", "draft"].includes(c.status);
  const campaignOver = c.endsAt !== null && c.endsAt <= x.now;
  const budgetGone = c.budgetCents <= 0 || c.spentCents >= c.budgetCents;
  const monthGone = x.monthlyCapCents <= 0 || x.monthSpentCents >= x.monthlyCapCents;
  const campaignToday = x.items.reduce((s, a) => s + (a.insights?.todayCents ?? 0), 0);
  const campaignDayCapped = c.dailyCapCents > 0 && campaignToday >= c.dailyCapCents;

  for (const a of x.items) {
    if (a.status === "ended" || a.status === "error") continue;
    const adEnd = new Date(a.endsAt);
    const adOver = !Number.isNaN(adEnd.getTime()) && adEnd <= x.now;
    const adBudgetGone = a.totalCents > 0 && spent(a) >= a.totalCents;
    if (adOver || adBudgetGone) {
      out.push({ adId: a.id, action: "end", reason: adOver ? "ended" : "budget" });
      continue;
    }
    if (a.status === "paused") continue;
    // De aquí en adelante: encendido o pausado por el día.
    const hard: PauseReason | null = stopCampaign ? "campaign" : campaignOver ? "ended" : budgetGone ? "budget" : monthGone ? "monthly" : null;
    if (hard) {
      out.push({ adId: a.id, action: "pause", reason: hard });
      continue;
    }
    const adToday = a.insights?.todayCents ?? 0;
    const dayCapped = (a.dailyCents > 0 && adToday >= a.dailyCents) || campaignDayCapped;
    if (a.status === "active" && dayCapped) out.push({ adId: a.id, action: "pause", reason: "daily" });
    else if (a.status === "capped_today" && a.cappedDay && a.cappedDay < x.today) out.push({ adId: a.id, action: "resume", reason: "daily" });
  }
  return out;
}

/** Aplica una decisión al anuncio guardado (después de que Meta respondió bien). */
export function applyDecision(a: AdEntry, d: AdDecision, today: string): AdEntry {
  if (d.action === "end") return { ...a, status: "ended", pausedReason: d.reason };
  if (d.action === "resume") {
    const { cappedDay: _c, pausedReason: _p, ...rest } = a;
    void _c;
    void _p;
    return { ...rest, status: "active" };
  }
  if (d.reason === "daily") return { ...a, status: "capped_today", pausedReason: "daily", cappedDay: today };
  return { ...a, status: "paused", pausedReason: d.reason };
}

/** Agrega un error al anuncio (guarda los últimos 5). */
export function withError(a: AdEntry, e: BiText, at: Date): AdEntry {
  return { ...a, errors: [...a.errors, { at: at.toISOString(), es: e.es.slice(0, 500), en: e.en.slice(0, 500) }].slice(-5) };
}

// ---------- Textos ----------

/** "$12.50" (centavos de dólar → texto). */
export function money(cents: number): string {
  const v = Math.max(0, Math.round(cents)) / 100;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** "12.5" o "$12.50" → centavos (null si no es un número válido). */
export function parseMoney(v: unknown): number | null {
  const s = String(v ?? "").replace(/[$\s,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** Palabras que hacen pensar que el negocio vende productos financieros (seguros, préstamos…). */
const FINANCIAL_WORDS = /\b(seguros?|aseguradora|insurance|insurer|public adjuster|ajustador(es)? p[uú]blicos?|reclamos? de seguro|claims? adjust|pr[eé]stamos?|loans?|cr[eé]dito|credit cards?|tarjetas? de cr[eé]dito|hipotecas?|mortgages?|inversi[oó]n(es)?|investments?|financiamiento|financing)\b/i;

/** Sugerencia de categoría especial a partir del perfil del negocio (el dueño decide). */
export function guessSpecialCategory(text: string): SpecialCategory {
  return FINANCIAL_WORDS.test(text) ? "FINANCIAL_PRODUCTS_SERVICES" : "NONE";
}

export const GOAL_LABEL: Record<AdGoal, BiText> = {
  awareness: { es: "Que más gente te conozca", en: "Get more people to know you" },
  traffic: { es: "Visitas a tu página web", en: "Visits to your website" },
  engagement: { es: "Más reacciones y comentarios", en: "More reactions and comments" },
  messages: { es: "Mensajes por Messenger", en: "Messenger messages" },
  calls: { es: "Llamadas", en: "Phone calls" },
};

export const RESULT_LABEL: Record<AdGoal, BiText> = {
  awareness: { es: "personas alcanzadas", en: "people reached" },
  traffic: { es: "clics a tu página", en: "clicks to your site" },
  engagement: { es: "reacciones y comentarios", en: "reactions and comments" },
  messages: { es: "conversaciones", en: "conversations" },
  calls: { es: "llamadas", en: "calls" },
};

/**
 * Lo que vale cada resultado (centavos) o null si todavía no hay resultados. Para «que te conozcan» es el costo por
 * cada 1.000 personas alcanzadas (por persona serían fracciones de centavo).
 */
export function costPerResultCents(a: AdEntry): number | null {
  const i = a.insights;
  if (!i) return null;
  if (a.goal === "awareness") return i.reach > 0 ? Math.round((i.spentCents * 1000) / i.reach) : null;
  return i.results > 0 ? Math.round(i.spentCents / i.results) : null;
}

/** Nuevo id local corto. */
export const newAdId = (now = Date.now()) => `ad_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
