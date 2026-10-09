// Propuestas de la IA para mejorar (tabla AiProposal): forma de `action`, `evidence` y `detail`, los lectores
// tolerantes y las reglas de seguridad que se revisan al crear, al aplicar y al deshacer. Sin base de datos:
// lo usan el motor (src/lib/proposals.ts), las pantallas /b/<id>/propuestas y las pruebas.
//
// Reglas que nunca se saltan:
// - Nunca se toca una campaña parada o terminada.
// - Nunca se sube el gasto por encima de lo que la campaña tiene (Campaign.budgetCents), del tope por día de la
//   campaña ni del máximo del mes del negocio. Encender un anuncio sigue siendo SOLO del dueño (con su confirmación
//   en Anuncios): la IA solo lo sugiere como consejo, sin aplicarlo.
// - Una propuesta sin decidir vence a los 14 días. «Deshacer» se puede durante 24 horas (si el cambio se puede revertir).
// - Solo lo de bajo riesgo (horarios y formatos) se puede aplicar solo, en campañas 100% IA donde el dueño lo permitió.

import { isLive, MIN_DAILY_CENTS, money, type AdEntry, type CampaignAds } from "@/lib/ads-shape";
import {
  bannedHits,
  inQuietHours,
  kindLabel,
  LIMITS,
  POST_KINDS,
  toMinutes,
  type CampaignRules,
  type ContentMix,
  type PostKind,
} from "@/lib/campaign-shape";
import { CHANNEL_IDS, channelName } from "@/lib/channels";
import type { UiLang } from "@/lib/i18n";
import { BUSINESS_TZ } from "@/lib/time";

export type Bi = { es: string; en: string };

// ---------- Tipos, estados y tiempos ----------

export const PROPOSAL_KINDS = ["timing", "format", "topic", "channel", "ads-budget", "ads-pause", "keyword", "content", "other"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const asKind = (v: unknown): ProposalKind => (PROPOSAL_KINDS.includes(v as ProposalKind) ? (v as ProposalKind) : "other");

export const PROPOSAL_STATUSES = ["proposed", "accepted", "rejected", "applied", "expired"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const asStatus = (v: unknown): ProposalStatus => (PROPOSAL_STATUSES.includes(v as ProposalStatus) ? (v as ProposalStatus) : "proposed");

/** Una propuesta sin decidir vence a los 14 días. */
export const EXPIRE_DAYS = 14;
/** «Deshacer» se puede durante 24 horas. */
export const UNDO_HOURS = 24;
/** Lo rechazado no se vuelve a proponer en 30 días; lo aplicado, en 14. */
export const REJECT_COOLDOWN_DAYS = 30;
export const APPLIED_COOLDOWN_DAYS = 14;
/** Lo que se puede aplicar solo (con permiso del dueño, en campañas 100% IA). */
export const LOW_RISK_KINDS: readonly ProposalKind[] = ["timing", "format"];
/** Palabras clave que sigue un negocio como mucho (igual que en Ajustes de SEO). */
export const MAX_TRACKED_KEYWORDS = 25;
export const MAX_CAMPAIGN_KEYWORDS = 20;
/** Lo que cuesta pedirle a la IA que redacte las propuestas (una llamada corta de texto), en centavos. */
export const PROPOSALS_AI_CENTS = 1;

const DAY_MS = 86_400_000;

/** La zona horaria del negocio ("" = la de la app). */
export const tzOf = (b: { timezone?: string | null }) => (b.timezone && b.timezone.trim()) || BUSINESS_TZ;

// ---------- Cambios que se pueden aplicar ----------

/** Cambios en una campaña: horarios, días, reparto de formatos, publicaciones por semana, canales, palabras, temas. */
export type CampaignPatch = {
  postTimes?: string[];
  weekdays?: number[];
  contentMix?: ContentMix;
  perWeek?: number;
  addChannels?: string[];
  removeChannels?: string[];
  addKeywords?: string[];
  addBannedTopics?: string[];
};

/** Lo que un cambio toca de una campaña (antes y después; con esto se deshace). */
export type CampaignFields = {
  postTimes?: string[];
  weekdays?: number[];
  contentMix?: ContentMix;
  perWeek?: number;
  channels?: string[];
  keywords?: string[];
  bannedTopics?: string[];
};

export type ProposalAction =
  | { type: "campaign.update"; campaignId: string; patch: CampaignPatch }
  /** Pausar un anuncio (bajar el gasto siempre es seguro). Volver a encenderlo es solo del dueño. */
  | { type: "ad.pause"; campaignId: string; adId: string }
  /** Nuevo gasto por día de un anuncio (subir solo dentro de los topes). */
  | { type: "ad.daily"; campaignId: string; adId: string; dailyCents: number }
  /** Seguir palabras clave en Google (Ajustes de SEO). */
  | { type: "keyword.track"; keywords: string[] }
  /** Una idea de publicación: queda como BORRADOR en la campaña para que el dueño la apruebe. */
  | { type: "post.draft"; campaignId: string; text: string; postKind: PostKind };

export type ActionType = ProposalAction["type"];

/** Lo que pasó al aplicar (se guarda dentro de action para mostrar «antes → después» y para «Deshacer»). */
export type AppliedRecord = {
  at: string;
  actor: "approved" | "auto";
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reversible: boolean;
  postId?: string;
  undoneAt?: string;
};

export type StoredAction = ProposalAction & { applied?: AppliedRecord };

export type Fact = { label: Bi; value: string };
export type ChangeLine = { label: Bi; before: string; after: string };

/** Datos en que se basa una propuesta (se muestran como «Por qué»). */
export type Evidence = {
  /** Clave para no repetir la misma propuesta (tipo + a qué + qué). */
  key: string;
  /** Qué regla la encontró (o "ai" para las ideas de la IA). */
  rule: string;
  /** Período de los datos (días AAAA-MM-DD). */
  period: { from: string; to: string };
  facts: Fact[];
  source: Bi;
  /** Qué cambia (antes → después), en palabras. */
  change: ChangeLine[];
};

/** detail: por qué y qué cambia, en palabras; y por qué la rechazó el dueño (si dijo). */
export type ProposalDetail = Bi & { rejectReason?: string };

// ---------- Lectores tolerantes ----------

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");
const strList = (v: unknown, max: number, len = 80) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, len)).filter(Boolean))].slice(0, max) : [];
const int = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
};
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const time = (v: unknown) => {
  const m = typeof v === "string" ? TIME_RE.exec(v.trim()) : null;
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
};
const readBi = (v: unknown, max = 600): Bi => {
  const o = obj(v);
  const es = str(o.es, max);
  const en = str(o.en, max);
  return { es: es || en, en: en || es };
};

function readMix(v: unknown): ContentMix | undefined {
  const o = obj(v);
  if (!Object.keys(o).length) return undefined;
  const mix = Object.fromEntries(POST_KINDS.map((k) => [k, int(o[k], 0, 100) ?? 0])) as ContentMix;
  return POST_KINDS.some((k) => mix[k] > 0) ? mix : undefined;
}

export function readPatch(v: unknown): CampaignPatch {
  const o = obj(v);
  const out: CampaignPatch = {};
  if (Array.isArray(o.postTimes)) out.postTimes = [...new Set(o.postTimes.map(time).filter(Boolean))].sort().slice(0, 6);
  if (Array.isArray(o.weekdays)) out.weekdays = [...new Set(o.weekdays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  const mix = readMix(o.contentMix);
  if (mix) out.contentMix = mix;
  const pw = int(o.perWeek, LIMITS.perWeek[0], LIMITS.perWeek[1]);
  if (pw !== null) out.perWeek = pw;
  if (Array.isArray(o.addChannels)) out.addChannels = strList(o.addChannels, 10, 20).filter((c) => (CHANNEL_IDS as string[]).includes(c));
  if (Array.isArray(o.removeChannels)) out.removeChannels = strList(o.removeChannels, 10, 20).filter((c) => (CHANNEL_IDS as string[]).includes(c));
  if (Array.isArray(o.addKeywords)) out.addKeywords = strList(o.addKeywords, 10);
  if (Array.isArray(o.addBannedTopics)) out.addBannedTopics = strList(o.addBannedTopics, 10);
  return out;
}

function readApplied(v: unknown): AppliedRecord | undefined {
  const o = obj(v);
  if (!str(o.at)) return undefined;
  return {
    at: str(o.at, 40),
    actor: o.actor === "auto" ? "auto" : "approved",
    before: obj(o.before),
    after: obj(o.after),
    reversible: o.reversible === true,
    ...(str(o.postId) ? { postId: str(o.postId, 40) } : {}),
    ...(str(o.undoneAt) ? { undoneAt: str(o.undoneAt, 40) } : {}),
  };
}

/** Lee AiProposal.action sin confiar en su forma. null = solo un consejo (o algo que no se entiende: nunca se aplica). */
export function readAction(json: unknown): StoredAction | null {
  const o = obj(json);
  const applied = readApplied(o.applied);
  const extra = applied ? { applied } : {};
  const campaignId = str(o.campaignId, 40);
  switch (o.type) {
    case "campaign.update": {
      if (!campaignId) return null;
      const patch = readPatch(o.patch);
      return Object.keys(patch).length ? { type: "campaign.update", campaignId, patch, ...extra } : null;
    }
    case "ad.pause": {
      const adId = str(o.adId, 40);
      return campaignId && adId ? { type: "ad.pause", campaignId, adId, ...extra } : null;
    }
    case "ad.daily": {
      const adId = str(o.adId, 40);
      const dailyCents = int(o.dailyCents, 0, 10_000_000);
      return campaignId && adId && dailyCents !== null ? { type: "ad.daily", campaignId, adId, dailyCents, ...extra } : null;
    }
    case "keyword.track": {
      const keywords = strList(o.keywords, 5);
      return keywords.length ? { type: "keyword.track", keywords, ...extra } : null;
    }
    case "post.draft": {
      const text = str(o.text, 2200).trim();
      const postKind = (POST_KINDS as readonly string[]).includes(o.postKind as string) ? (o.postKind as PostKind) : "post";
      return campaignId && text ? { type: "post.draft", campaignId, text, postKind, ...extra } : null;
    }
    default:
      return null;
  }
}

/** La acción sin lo que pasó al aplicarla (lo que se guarda al crear la propuesta). */
export function bareAction(a: StoredAction): ProposalAction {
  const { applied: _a, ...rest } = a;
  void _a;
  return rest as ProposalAction;
}

export function readEvidence(json: unknown): Evidence {
  const o = obj(json);
  const p = obj(o.period);
  const facts = (Array.isArray(o.facts) ? o.facts : []).map(obj).map((f) => ({ label: readBi(f.label, 200), value: str(f.value, 120) })).filter((f) => f.label.es && f.value).slice(0, 8);
  const change = (Array.isArray(o.change) ? o.change : [])
    .map(obj)
    .map((c) => ({ label: readBi(c.label, 200), before: str(c.before, 300), after: str(c.after, 300) }))
    .filter((c) => c.label.es)
    .slice(0, 8);
  return {
    key: str(o.key, 300),
    rule: str(o.rule, 40),
    period: { from: str(p.from, 10), to: str(p.to, 10) },
    facts,
    source: readBi(o.source, 200),
    change,
  };
}

export function readDetail(json: unknown): ProposalDetail {
  const o = obj(json);
  const b = readBi(o, 1200);
  const reason = str(o.rejectReason, 300).trim();
  return { ...b, ...(reason ? { rejectReason: reason } : {}) };
}

export const readTitle = (json: unknown): Bi => readBi(json, 200);
export const impactOf = (v: unknown): 1 | 2 | 3 => (v === 3 ? 3 : v === 1 ? 1 : 2);

// ---------- Estado de una campaña y contexto para revisar ----------

export type CampaignState = {
  id: string;
  name: string;
  status: string;
  mode: string;
  channels: string[];
  perWeek: number;
  keywords: string[];
  rules: CampaignRules;
  budgetCents: number;
  spentCents: number;
  ads: CampaignAds;
};

export type ApplyContext = {
  /** La campaña a la que apunta la acción (leída de nuevo, con la fila bloqueada, al aplicar). */
  campaign: CampaignState | null;
  /** Canales conectados del negocio. */
  connected: string[];
  /** Palabras clave que el negocio sigue hoy. */
  tracked: string[];
  monthlyCapCents: number;
  /** Lo gastado este mes en anuncios por TODAS las campañas del negocio. */
  monthSpentCents: number;
  now: Date;
};

const CLOSED = ["stopped", "ended"];
export const isClosed = (status: string) => CLOSED.includes(status);

const sameKey = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const uniq = (list: string[]) => {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = sameKey(x);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** Todo lo que un cambio puede tocar de una campaña, como está ahora. */
export function campaignFields(c: CampaignState): Required<CampaignFields> {
  return {
    postTimes: [...c.rules.postTimes],
    weekdays: [...c.rules.weekdays],
    contentMix: { ...c.rules.contentMix },
    perWeek: c.perWeek,
    channels: [...c.channels],
    keywords: [...c.keywords],
    bannedTopics: [...c.rules.bannedTopics],
  };
}

/** Antes y después de aplicar un cambio (solo lo que el cambio toca). */
export function patchFields(c: CampaignState, patch: CampaignPatch): { before: CampaignFields; after: CampaignFields } {
  const cur = campaignFields(c);
  const before: CampaignFields = {};
  const after: CampaignFields = {};
  if (patch.postTimes) {
    before.postTimes = cur.postTimes;
    after.postTimes = [...new Set(patch.postTimes)].sort();
  }
  if (patch.weekdays) {
    before.weekdays = cur.weekdays;
    after.weekdays = [...new Set(patch.weekdays)].sort((a, b) => a - b);
  }
  if (patch.contentMix) {
    before.contentMix = cur.contentMix;
    after.contentMix = { ...patch.contentMix };
  }
  if (patch.perWeek !== undefined) {
    before.perWeek = cur.perWeek;
    after.perWeek = patch.perWeek;
  }
  if (patch.addChannels?.length || patch.removeChannels?.length) {
    before.channels = cur.channels;
    const remove = new Set(patch.removeChannels ?? []);
    after.channels = [...new Set([...cur.channels, ...(patch.addChannels ?? [])])].filter((ch) => !remove.has(ch));
  }
  if (patch.addKeywords?.length) {
    before.keywords = cur.keywords;
    after.keywords = uniq([...cur.keywords, ...patch.addKeywords]);
  }
  if (patch.addBannedTopics?.length) {
    before.bannedTopics = cur.bannedTopics;
    after.bannedTopics = uniq([...cur.bannedTopics, ...patch.addBannedTopics]);
  }
  return { before, after };
}

/** La campaña con esos campos puestos (reglas y columnas), sin guardar nada. */
export function withFields(c: CampaignState, f: CampaignFields): CampaignState {
  return {
    ...c,
    perWeek: f.perWeek ?? c.perWeek,
    channels: f.channels ?? c.channels,
    keywords: f.keywords ?? c.keywords,
    rules: {
      ...c.rules,
      ...(f.postTimes ? { postTimes: f.postTimes } : {}),
      ...(f.weekdays ? { weekdays: f.weekdays } : {}),
      ...(f.contentMix ? { contentMix: f.contentMix } : {}),
      ...(f.bannedTopics ? { bannedTopics: f.bannedTopics } : {}),
    },
  };
}

/** Lee los campos guardados en applied.before / applied.after. */
export function readFields(v: unknown): CampaignFields {
  const p = readPatch(v);
  const o = obj(v);
  const out: CampaignFields = {};
  if (p.postTimes) out.postTimes = p.postTimes;
  if (p.weekdays) out.weekdays = p.weekdays;
  if (p.contentMix) out.contentMix = p.contentMix;
  if (p.perWeek !== undefined) out.perWeek = p.perWeek;
  if (Array.isArray(o.channels)) out.channels = strList(o.channels, 10, 20);
  if (Array.isArray(o.keywords)) out.keywords = strList(o.keywords, 40);
  if (Array.isArray(o.bannedTopics)) out.bannedTopics = strList(o.bannedTopics, LIMITS.bannedTopics);
  return out;
}

const P = (es: string, en: string): Bi => ({ es, en });

/** Revisa cómo quedaría la campaña. Vacío = se puede. */
export function campaignProblems(c: CampaignState, f: CampaignFields, connected: string[], before?: CampaignFields): Bi[] {
  const out: Bi[] = [];
  if (isClosed(c.status)) out.push(P("La campaña está parada o terminó: la IA no la toca.", "The campaign is stopped or finished: the AI doesn't touch it."));
  const next = withFields(c, f);
  if (f.postTimes) {
    if (!f.postTimes.length || f.postTimes.length > 6 || f.postTimes.some((t) => !TIME_RE.test(t)))
      out.push(P("Las horas para publicar no son válidas.", "The posting times aren't valid."));
    else if (f.postTimes.every((t) => inQuietHours(toMinutes(t), next.rules.quietHours)))
      out.push(P("Todas las horas caerían en las horas sin publicar.", "All the times would fall in the no-posting hours."));
  }
  if (f.weekdays && !f.weekdays.length) out.push(P("Tiene que quedar al menos un día para publicar.", "At least one posting day has to remain."));
  if (f.contentMix && !POST_KINDS.some((k) => (f.contentMix?.[k] ?? 0) > 0)) out.push(P("El reparto de formatos quedaría vacío.", "The format mix would be empty."));
  if (f.perWeek !== undefined || f.weekdays) {
    const cap = next.rules.weekdays.length * next.rules.maxPerDay;
    if (next.perWeek < LIMITS.perWeek[0] || next.perWeek > LIMITS.perWeek[1]) out.push(P("Entre 1 y 21 publicaciones por semana.", "Between 1 and 21 posts per week."));
    else if (next.perWeek > cap) out.push(P(`Con esos días caben como mucho ${cap} publicaciones por semana.`, `With those days, at most ${cap} posts fit in a week.`));
  }
  if (f.channels) {
    const added = f.channels.filter((ch) => !(before?.channels ?? c.channels).includes(ch));
    for (const ch of added)
      if (!(CHANNEL_IDS as string[]).includes(ch) || !connected.includes(ch))
        out.push(P(`${channelName(ch, "es")} no está conectado.`, `${channelName(ch, "en")} isn't connected.`));
    if (!f.channels.length && c.mode !== "manual") out.push(P("La campaña se quedaría sin canales.", "The campaign would be left without channels."));
  }
  if (f.keywords && f.keywords.length > MAX_CAMPAIGN_KEYWORDS) out.push(P(`Una campaña usa como mucho ${MAX_CAMPAIGN_KEYWORDS} palabras clave.`, `A campaign uses at most ${MAX_CAMPAIGN_KEYWORDS} keywords.`));
  if (f.bannedTopics && f.bannedTopics.length > LIMITS.bannedTopics) out.push(P("Hay demasiados temas prohibidos.", "There are too many banned topics."));
  return out;
}

/** Lo máximo que se puede poner por día a un anuncio sin pasar ningún tope (null = no se puede subir). */
export function maxDailyCents(ad: AdEntry, c: CampaignState, ctx: Pick<ApplyContext, "monthlyCapCents" | "monthSpentCents">): number | null {
  if (c.status !== "active" || c.budgetCents <= 0 || ctx.monthlyCapCents <= 0) return null;
  const limits = [ad.totalCents, ad.dailyCents * 2, c.budgetCents - c.spentCents, ctx.monthlyCapCents - ctx.monthSpentCents];
  if (c.ads.dailyCapCents > 0) {
    const others = c.ads.items.filter((a) => a.id !== ad.id && a.status !== "ended" && a.status !== "error").reduce((s, a) => s + a.dailyCents, 0);
    limits.push(c.ads.dailyCapCents - others);
  }
  const max = Math.min(...limits);
  return max >= MIN_DAILY_CENTS ? max : null;
}

/** Problemas al cambiar el gasto por día de un anuncio. Bajar casi siempre se puede; subir, solo dentro de los topes. */
export function adDailyProblems(ad: AdEntry | undefined, dailyCents: number, c: CampaignState, ctx: Pick<ApplyContext, "monthlyCapCents" | "monthSpentCents">): Bi[] {
  const out: Bi[] = [];
  if (isClosed(c.status)) out.push(P("La campaña está parada o terminó: la IA no la toca.", "The campaign is stopped or finished: the AI doesn't touch it."));
  if (!ad) return [...out, P("El anuncio ya no existe.", "The ad no longer exists.")];
  if (ad.status === "ended" || ad.status === "error") out.push(P("Ese anuncio ya terminó.", "That ad has already ended."));
  if (dailyCents < MIN_DAILY_CENTS) out.push(P(`El gasto por día debe ser de al menos ${money(MIN_DAILY_CENTS)}.`, `The daily spend must be at least ${money(MIN_DAILY_CENTS)}.`));
  if (dailyCents > ad.totalCents) out.push(P(`Sería más que el total del anuncio (${money(ad.totalCents)}).`, `It would be more than the ad's total (${money(ad.totalCents)}).`));
  if (dailyCents > ad.dailyCents) {
    const max = maxDailyCents(ad, c, ctx);
    if (max === null || dailyCents > max)
      out.push(
        max === null
          ? P("No se puede subir: la campaña no está activa, no tiene presupuesto o falta el máximo del mes.", "It can't go up: the campaign isn't active, has no budget, or the monthly maximum is missing.")
          : P(`Subirlo a ${money(dailyCents)} pasaría un tope: lo máximo posible hoy es ${money(max)} por día.`, `Raising it to ${money(dailyCents)} would pass a cap: the most possible today is ${money(max)} a day.`),
      );
  }
  return out;
}

/** Revisa una acción contra el estado de AHORA (al crear, al aplicar y al aplicar sola). Vacío = se puede aplicar. */
export function validateAction(a: ProposalAction, ctx: ApplyContext): Bi[] {
  if (a.type === "keyword.track") {
    const have = new Set(ctx.tracked.map(sameKey));
    const fresh = uniq(a.keywords).filter((k) => !have.has(sameKey(k)));
    if (!fresh.length) return [P("Esa palabra clave ya se está siguiendo.", "That keyword is already being tracked.")];
    if (ctx.tracked.length + fresh.length > MAX_TRACKED_KEYWORDS)
      return [P(`Ya sigues ${ctx.tracked.length} palabras clave (máximo ${MAX_TRACKED_KEYWORDS}). Quita alguna en Ajustes de SEO.`, `You already track ${ctx.tracked.length} keywords (max ${MAX_TRACKED_KEYWORDS}). Remove one in SEO settings.`)];
    return [];
  }
  const c = ctx.campaign;
  if (!c || c.id !== a.campaignId) return [P("La campaña ya no existe.", "The campaign no longer exists.")];
  switch (a.type) {
    case "campaign.update": {
      const { before, after } = patchFields(c, a.patch);
      if (!Object.keys(after).length) return [P("No hay nada que cambiar.", "There's nothing to change.")];
      const same = JSON.stringify(before) === JSON.stringify(after);
      return [...campaignProblems(c, after, ctx.connected, before), ...(same ? [P("La campaña ya está así.", "The campaign is already like that.")] : [])];
    }
    case "ad.pause": {
      const ad = c.ads.items.find((x) => x.id === a.adId);
      if (isClosed(c.status)) return [P("La campaña está parada o terminó: la IA no la toca.", "The campaign is stopped or finished: the AI doesn't touch it.")];
      if (!ad) return [P("El anuncio ya no existe.", "The ad no longer exists.")];
      if (!isLive(ad)) return [P("Ese anuncio ya está apagado.", "That ad is already off.")];
      return [];
    }
    case "ad.daily": {
      const ad = c.ads.items.find((x) => x.id === a.adId);
      if (ad && ad.dailyCents === a.dailyCents) return [P("El anuncio ya tiene ese gasto por día.", "The ad already has that daily spend.")];
      return adDailyProblems(ad, a.dailyCents, c, ctx);
    }
    case "post.draft": {
      const out: Bi[] = [];
      if (isClosed(c.status)) out.push(P("La campaña está parada o terminó: la IA no la toca.", "The campaign is stopped or finished: the AI doesn't touch it."));
      if (!a.text.trim()) out.push(P("La idea no tiene texto.", "The idea has no text."));
      if (!c.channels.some((ch) => ctx.connected.includes(ch))) out.push(P("La campaña no tiene canales conectados.", "The campaign has no connected channels."));
      const hits = bannedHits(c.rules, a.text);
      if (hits.length) out.push(P(`Toca un tema prohibido: «${hits[0].word}».`, `It touches a banned topic: “${hits[0].word}”.`));
      return out;
    }
  }
}

/** ¿Se puede deshacer este cambio? (pausar un anuncio no: encenderlo es solo del dueño, en Anuncios). */
export const isReversible = (a: ProposalAction) => a.type !== "ad.pause";

/** ¿Esta propuesta se puede aplicar sola? Solo horarios/formatos, en campañas 100% IA con el permiso encendido. */
export function canAutoApply(kind: ProposalKind, a: ProposalAction | null, c: Pick<CampaignState, "mode" | "status" | "rules"> | null): boolean {
  if (!a || !c || a.type !== "campaign.update") return false;
  if (!LOW_RISK_KINDS.includes(kind)) return false;
  if (c.mode !== "auto" || c.rules.autoApplyProposals !== true || isClosed(c.status)) return false;
  const keys = Object.keys(a.patch);
  return keys.length > 0 && keys.every((k) => k === "postTimes" || k === "contentMix" || k === "weekdays");
}

export function isExpired(p: { status: string; createdAt: Date }, now: Date): boolean {
  return p.status === "proposed" && now.getTime() - p.createdAt.getTime() > EXPIRE_DAYS * DAY_MS;
}

/** Días que le quedan a una propuesta nueva antes de vencer. */
export const daysLeft = (createdAt: Date, now: Date) => Math.max(0, Math.ceil((createdAt.getTime() + EXPIRE_DAYS * DAY_MS - now.getTime()) / DAY_MS));

export function canUndo(p: { status: string; action: StoredAction | null }, now: Date): boolean {
  const ap = p.action?.applied;
  if (p.status !== "applied" || !p.action || !ap || !ap.reversible || ap.undoneAt) return false;
  return now.getTime() - Date.parse(ap.at) <= UNDO_HOURS * 3_600_000;
}

/** Lo que ya existe para no repetir: abiertas, rechazadas hace poco (30 días) o aplicadas hace poco (14 días). */
export type ExistingProposal = { key: string; status: string; createdAt: Date; decidedAt: Date | null };

export function isDuplicate(key: string, existing: ExistingProposal[], now: Date): boolean {
  if (!key) return false;
  return existing.some((p) => {
    if (p.key !== key) return false;
    if (p.status === "proposed") return true;
    const when = (p.decidedAt ?? p.createdAt).getTime();
    if (p.status === "rejected") return now.getTime() - when < REJECT_COOLDOWN_DAYS * DAY_MS;
    if (p.status === "applied" || p.status === "accepted") return now.getTime() - when < APPLIED_COOLDOWN_DAYS * DAY_MS;
    return false;
  });
}

// ---------- Textos ----------

/** "19:00" → "7:00 p. m." / "7:00 PM". */
export function timeLabel(t: string, lang: UiLang = "es"): string {
  const m = TIME_RE.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return lang === "en" ? `${h12}:${m[2]} ${h < 12 ? "AM" : "PM"}` : `${h12}:${m[2]} ${h < 12 ? "a. m." : "p. m."}`;
}

const DAYS: Record<UiLang, string[]> = { es: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"], en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };

export function mixLabel(mix: ContentMix, lang: UiLang = "es"): string {
  const total = POST_KINDS.reduce((s, k) => s + Math.max(0, mix[k]), 0) || 1;
  return POST_KINDS.filter((k) => mix[k] > 0)
    .map((k) => `${kindLabel(k, lang)} ${Math.round((mix[k] * 100) / total)}%`)
    .join(" · ");
}

const list = (xs: string[], none: string) => (xs.length ? xs.join(", ") : none);

/** Antes → después de unos campos de campaña, en palabras. */
export function fieldsChange(before: CampaignFields, after: CampaignFields): ChangeLine[] {
  const out: ChangeLine[] = [];
  const bi = (fn: (lang: UiLang) => string) => ({ es: fn("es"), en: fn("en") });
  if (after.postTimes) {
    const b = bi((l) => (before.postTimes ?? []).map((t) => timeLabel(t, l)).join(", "));
    const a = bi((l) => after.postTimes!.map((t) => timeLabel(t, l)).join(", "));
    out.push({ label: P("Horas para publicar", "Posting times"), before: `${b.es}|${b.en}`, after: `${a.es}|${a.en}` });
  }
  if (after.weekdays) {
    const fmt = (d: number[] | undefined, l: UiLang) => (d ?? []).map((n) => DAYS[l][n]).join(", ");
    out.push({ label: P("Días", "Days"), before: `${fmt(before.weekdays, "es")}|${fmt(before.weekdays, "en")}`, after: `${fmt(after.weekdays, "es")}|${fmt(after.weekdays, "en")}` });
  }
  if (after.contentMix && before.contentMix)
    out.push({ label: P("Formatos", "Formats"), before: `${mixLabel(before.contentMix, "es")}|${mixLabel(before.contentMix, "en")}`, after: `${mixLabel(after.contentMix, "es")}|${mixLabel(after.contentMix, "en")}` });
  if (after.perWeek !== undefined) out.push({ label: P("Publicaciones por semana", "Posts per week"), before: String(before.perWeek ?? ""), after: String(after.perWeek) });
  if (after.channels) {
    const fmt = (c: string[] | undefined, l: UiLang) => list((c ?? []).map((x) => channelName(x, l)), l === "es" ? "ninguno" : "none");
    out.push({ label: P("Canales", "Channels"), before: `${fmt(before.channels, "es")}|${fmt(before.channels, "en")}`, after: `${fmt(after.channels, "es")}|${fmt(after.channels, "en")}` });
  }
  if (after.keywords) out.push({ label: P("Palabras clave de la campaña", "Campaign keywords"), before: `${list(before.keywords ?? [], "ninguna")}|${list(before.keywords ?? [], "none")}`, after: list(after.keywords, "—") });
  if (after.bannedTopics)
    out.push({ label: P("Temas prohibidos", "Banned topics"), before: `${list(before.bannedTopics ?? [], "ninguno")}|${list(before.bannedTopics ?? [], "none")}`, after: list(after.bannedTopics, "—") });
  return out;
}

/** Un lado de «antes → después» en el idioma pedido (los textos con dos idiomas se guardan como "es|en"). */
export function sideText(v: string, lang: UiLang): string {
  const i = v.indexOf("|");
  if (i < 0) return v;
  return lang === "en" ? v.slice(i + 1) : v.slice(0, i);
}

/** Antes → después de cualquier acción, con el estado de ahora (para crear la propuesta). */
export function describeChange(a: ProposalAction, ctx: ApplyContext): ChangeLine[] {
  if (a.type === "keyword.track")
    return [{ label: P("Palabras clave que se siguen en Google", "Keywords tracked on Google"), before: `${ctx.tracked.length}`, after: `${ctx.tracked.length + a.keywords.length} (+ ${a.keywords.join(", ")})` }];
  const c = ctx.campaign;
  if (!c) return [];
  if (a.type === "campaign.update") {
    const { before, after } = patchFields(c, a.patch);
    return fieldsChange(before, after);
  }
  const ad = a.type === "post.draft" ? undefined : c.ads.items.find((x) => x.id === a.adId);
  if (a.type === "ad.pause") return [{ label: P(`Anuncio «${ad?.name ?? ""}»`, `Ad “${ad?.name ?? ""}”`), before: "Encendido|On", after: "Pausado|Paused" }];
  if (a.type === "ad.daily")
    return [{ label: P(`Gasto por día de «${ad?.name ?? ""}»`, `Daily spend of “${ad?.name ?? ""}”`), before: money(ad?.dailyCents ?? 0), after: money(a.dailyCents) }];
  return [{ label: P("Borrador nuevo en la campaña", "New draft in the campaign"), before: "—", after: `${a.text.slice(0, 120)}${a.text.length > 120 ? "…" : ""}` }];
}

/** Frase para el registro al aplicar (o deshacer). */
export function appliedSummary(title: Bi, actor: "approved" | "auto" | "owner", undone = false): Bi {
  if (undone) return { es: `Deshiciste una propuesta: ${title.es}.`, en: `You undid a proposal: ${title.en}.` };
  return actor === "auto"
    ? { es: `La IA aplicó sola (bajo riesgo): ${title.es}.`, en: `The AI applied on its own (low risk): ${title.en}.` }
    : { es: `Aplicado con tu aprobación: ${title.es}.`, en: `Applied with your approval: ${title.en}.` };
}

export const KIND_LABEL: Record<ProposalKind, Bi> = {
  timing: { es: "Horarios", en: "Timing" },
  format: { es: "Formatos", en: "Formats" },
  topic: { es: "Temas", en: "Topics" },
  channel: { es: "Canales", en: "Channels" },
  "ads-budget": { es: "Gasto en anuncios", en: "Ad spend" },
  "ads-pause": { es: "Pausar anuncio", en: "Pause ad" },
  keyword: { es: "Palabras clave", en: "Keywords" },
  content: { es: "Idea de publicación", en: "Post idea" },
  other: { es: "Consejo", en: "Tip" },
};

export const IMPACT_LABEL: Record<1 | 2 | 3, Bi> = {
  3: { es: "Impacto alto", en: "High impact" },
  2: { es: "Impacto medio", en: "Medium impact" },
  1: { es: "Impacto bajo", en: "Low impact" },
};

/** Texto de los problemas para el dueño. */
export const problemsText = (ps: Bi[], lang: UiLang) => ps.map((p) => (lang === "en" ? p.en : p.es)).join(" ");
