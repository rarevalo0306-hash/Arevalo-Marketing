// «Resumen de resultados»: las cuentas puras (sin red ni base de datos) que arma src/lib/results.ts. Se prueban en
// tests/results.test.ts. Todo lo que se devuelve es JSON simple (fechas en ISO) para que los agentes DAILY y OPTIMIZE
// lo puedan guardar o mandar tal cual.
import type { MetricValues } from "@/lib/post-metrics-shape";

const DAY = 86_400_000;

// ---------- Periodos ----------

export const PERIODS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIODS)[number];
export const readPeriod = (v: unknown): PeriodDays => {
  const n = Number(v);
  return (PERIODS as readonly number[]).includes(n) ? (n as PeriodDays) : 30;
};

export type Range = { from: Date; to: Date };

/** El periodo anterior del mismo largo, justo antes de `from`. */
export function previousRange(from: Date, to: Date): Range {
  const len = Math.max(DAY, to.getTime() - from.getTime());
  return { from: new Date(from.getTime() - len), to: new Date(from.getTime()) };
}

/** Los últimos `days` días hasta `now`. */
export function lastDays(days: number, now: Date): Range {
  return { from: new Date(now.getTime() - days * DAY), to: now };
}

// ---------- Una publicación en un canal ----------

export type Format = "photo" | "design" | "carousel" | "story" | "video" | "text";
export const FORMATS: Format[] = ["photo", "design", "carousel", "story", "video", "text"];

/** Qué es: carrusel / historia / video por su tipo; si no, foto, diseño (foto con la marca hecha en la app) o solo texto. */
export function formatOf(kind: string, mediaType: string, isDesign: boolean): Format {
  if (kind === "carousel") return "carousel";
  if (kind === "story") return "story";
  if (kind === "video" || mediaType === "video") return "video";
  if (mediaType === "photo") return isDesign ? "design" : "photo";
  return "text";
}

export type TargetRow = {
  targetId: string;
  postId: string;
  channel: string;
  sentAt: Date;
  url: string;
  text: string;
  thumb: string;
  format: Format;
  campaignId: string | null;
  campaignName: string;
  /** La última lectura buena (null = todavía sin resultados). */
  metric: MetricValues | null;
};

/** Personas alcanzadas: alcance; si la red no lo da, vistas; si no, reproducciones (YouTube). */
export const reachOf = (m: MetricValues) => m.reach || m.impressions || m.videoViews;
/** Interacciones: me gusta + comentarios + compartidos + guardados (los clics van aparte). */
export const interactionsOf = (m: MetricValues) => m.likes + m.comments + m.shares + m.saves;
/** Tasa de interacción (0 a 1): interacciones ÷ personas alcanzadas. null si no hay alcance. */
export function rateOf(m: MetricValues | null): number | null {
  if (!m) return null;
  const r = reachOf(m);
  return r > 0 ? Math.min(1, interactionsOf(m) / r) : null;
}

export type Totals = { reach: number; interactions: number; clicks: number; videoViews: number; measured: number };

export function totals(rows: TargetRow[]): Totals {
  const t: Totals = { reach: 0, interactions: 0, clicks: 0, videoViews: 0, measured: 0 };
  for (const r of rows) {
    if (!r.metric) continue;
    t.measured++;
    t.reach += reachOf(r.metric);
    t.interactions += interactionsOf(r.metric);
    t.clicks += r.metric.clicks;
    t.videoViews += r.metric.videoViews;
  }
  return t;
}

/** Cuántas publicaciones distintas (una publicación en 3 redes cuenta 1). */
export const postCount = (rows: TargetRow[]) => new Set(rows.map((r) => r.postId)).size;

// ---------- Comparar con el periodo anterior ----------

export type Kpi = { now: number | null; prev: number | null; /** cambio en % (null si no se puede comparar) */ change: number | null };

export function kpi(now: number | null, prev: number | null): Kpi {
  const change = now !== null && prev !== null && prev > 0 ? Math.round(((now - prev) / prev) * 100) : null;
  return { now, prev, change };
}

// ---------- Por semana (o por día en 7 días) ----------

/** Un día o una semana de la gráfica. `start` = primer día ("AAAA-MM-DD", en la hora del negocio). */
export type Bucket = { start: string; reach: number; interactions: number; posts: number };

/** "2026-10-06": el día en la zona `tz` (UTC si la zona no existe). */
export function localDate(d: Date, tz: string): string {
  try {
    return d.toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * Reparte las publicaciones por día del calendario del negocio (periodos de hasta 14 días) o por semanas de 7 días
 * contadas hacia atrás desde hoy (la primera puede quedar más corta).
 */
export function buckets(rows: TargetRow[], from: Date, to: Date, tz = "UTC"): { unit: "day" | "week"; items: Bucket[] } {
  const first = localDate(from, tz);
  const last = localDate(to, tz);
  const days: string[] = [];
  for (let d = first; d <= last && days.length < 400; d = addDays(d, 1)) days.push(d);
  const span = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
  const unit = span <= 14 ? "day" : "week";
  // Grupos de días: uno por día, o de 7 en 7 desde el último día hacia atrás.
  const groups: string[][] = [];
  if (unit === "day") days.forEach((d) => groups.push([d]));
  else for (let end = days.length; end > 0; end -= 7) groups.unshift(days.slice(Math.max(0, end - 7), end));
  const index = new Map<string, number>();
  groups.forEach((g, i) => g.forEach((d) => index.set(d, i)));
  const items: Bucket[] = groups.map((g) => ({ start: g[0], reach: 0, interactions: 0, posts: 0 }));
  const seen = items.map(() => new Set<string>());
  for (const r of rows) {
    const i = index.get(localDate(r.sentAt, tz));
    if (i === undefined) continue;
    seen[i].add(r.postId);
    if (r.metric) {
      items[i].reach += reachOf(r.metric);
      items[i].interactions += interactionsOf(r.metric);
    }
  }
  items.forEach((b, i) => (b.posts = seen[i].size));
  return { unit, items };
}

// ---------- Por canal, formato y campaña ----------

export type Group = { key: string; label: string; posts: number; measured: number; reach: number; interactions: number; clicks: number; rate: number | null };

function group(rows: TargetRow[], keyOf: (r: TargetRow) => string, labelOf: (r: TargetRow) => string): Group[] {
  const map = new Map<string, { label: string; rows: TargetRow[] }>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = map.get(k) ?? { label: labelOf(r), rows: [] };
    g.rows.push(r);
    map.set(k, g);
  }
  return [...map.entries()]
    .map(([key, g]) => {
      const t = totals(g.rows);
      return { key, label: g.label, posts: g.rows.length, measured: t.measured, reach: t.reach, interactions: t.interactions, clicks: t.clicks, rate: t.reach > 0 ? t.interactions / t.reach : null };
    })
    .sort((a, b) => b.reach - a.reach || b.posts - a.posts);
}

export const byChannel = (rows: TargetRow[]) => group(rows, (r) => r.channel, (r) => r.channel);
export const byFormat = (rows: TargetRow[]) => group(rows, (r) => r.format, (r) => r.format);
export const byCampaign = (rows: TargetRow[]) =>
  group(
    rows.filter((r) => r.campaignId),
    (r) => r.campaignId!,
    (r) => r.campaignName,
  );

// ---------- Mejores y peores ----------

export type RankedPost = {
  targetId: string;
  postId: string;
  channel: string;
  sentAt: string;
  url: string;
  text: string;
  thumb: string;
  format: Format;
  reach: number;
  interactions: number;
  clicks: number;
  rate: number;
};

/** Alcance mínimo para entrar al ranking (con 3 personas, 1 me gusta sería un 33 %). */
export const MIN_REACH_TO_RANK = 10;

/** Las 5 con mejor tasa de interacción y las 5 con peor (sin repetir; las peores solo si hay más de 5). */
export function rankPosts(rows: TargetRow[], n = 5): { best: RankedPost[]; worst: RankedPost[] } {
  const ranked = rows
    .filter((r) => r.metric && reachOf(r.metric) >= MIN_REACH_TO_RANK)
    .map((r): RankedPost => {
      const m = r.metric!;
      return {
        targetId: r.targetId,
        postId: r.postId,
        channel: r.channel,
        sentAt: r.sentAt.toISOString(),
        url: r.url,
        text: r.text,
        thumb: r.thumb,
        format: r.format,
        reach: reachOf(m),
        interactions: interactionsOf(m),
        clicks: m.clicks,
        rate: rateOf(m) ?? 0,
      };
    })
    .sort((a, b) => b.rate - a.rate || b.reach - a.reach);
  const best = ranked.slice(0, n);
  const rest = ranked.slice(n);
  const worst = rest.slice(-n).reverse();
  return { best, worst };
}

// ---------- Mejor día y hora ----------

/** Publicaciones con resultados que hacen falta para decir el mejor día y hora. */
export const MIN_POSTS_FOR_TIMING = 10;
/** Publicaciones que necesita un día (u hora) para competir. */
export const MIN_PER_SLOT = 2;

export type Slot = { key: number; posts: number; rate: number | null };
export type Timing = { enough: boolean; measured: number; days: Slot[]; hours: Slot[]; bestDay: number | null; bestHour: number | null };

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Día de la semana (0 = domingo) y hora (0-23) en la zona del negocio. */
export function localDayHour(d: Date, tz: string): { day: number; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(d);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    return { day: WEEKDAY[wd] ?? d.getUTCDay(), hour: Number.isFinite(h) ? h % 24 : d.getUTCHours() };
  } catch {
    return { day: d.getUTCDay(), hour: d.getUTCHours() };
  }
}

function best(slots: Slot[]): number | null {
  let top: Slot | null = null;
  for (const s of slots) if (s.posts >= MIN_PER_SLOT && s.rate !== null && (!top || s.rate > (top.rate ?? -1))) top = s;
  return top ? top.key : null;
}

/** Tasa de interacción promedio por día de la semana y por hora. Con menos de 10 publicaciones medidas: enough=false. */
export function timing(rows: TargetRow[], tz: string): Timing {
  const measured = rows.filter((r) => rateOf(r.metric) !== null);
  const dayAcc = Array.from({ length: 7 }, () => ({ n: 0, sum: 0 }));
  const hourAcc = Array.from({ length: 24 }, () => ({ n: 0, sum: 0 }));
  for (const r of measured) {
    const { day, hour } = localDayHour(r.sentAt, tz);
    const rate = rateOf(r.metric)!;
    dayAcc[day].n++;
    dayAcc[day].sum += rate;
    hourAcc[hour].n++;
    hourAcc[hour].sum += rate;
  }
  const toSlots = (acc: { n: number; sum: number }[]): Slot[] => acc.map((a, key) => ({ key, posts: a.n, rate: a.n ? a.sum / a.n : null }));
  const days = toSlots(dayAcc);
  const hours = toSlots(hourAcc);
  const enough = measured.length >= MIN_POSTS_FOR_TIMING;
  return { enough, measured: measured.length, days, hours, bestDay: enough ? best(days) : null, bestHour: enough ? best(hours) : null };
}

// ---------- Anuncios ----------

export type AdLine = { campaignId: string; campaign: string; name: string; goal: string; status: string; spentCents: number; results: number; reach: number; clicks: number; costPerResultCents: number | null };
export type AdsSummary = { count: number; active: number; spentCents: number; results: number; reach: number; clicks: number; costPerResultCents: number | null; items: AdLine[] };

type AdLike = { name: string; goal: string; status: string; startsAt: string; endsAt: string; insights?: { spentCents: number; results: number; reach: number; clicks: number } };

/**
 * Los anuncios que estuvieron vivos en el periodo (empezaron antes de que terminara y terminaron después de que empezó).
 * Lo gastado y los resultados son desde que empezó cada anuncio (Meta los da así). Costo por resultado: sin los de
 * «que te conozcan» (esos se miden por personas, no por resultados).
 */
export function adsSummary(campaigns: { id: string; name: string; items: AdLike[] }[], from: Date, to: Date): AdsSummary {
  const items: AdLine[] = [];
  for (const c of campaigns)
    for (const a of c.items) {
      const s = Date.parse(a.startsAt);
      const e = Date.parse(a.endsAt);
      if (Number.isFinite(s) && s > to.getTime()) continue;
      if (Number.isFinite(e) && e < from.getTime()) continue;
      if (a.status === "error" && !a.insights) continue;
      const i = a.insights ?? { spentCents: 0, results: 0, reach: 0, clicks: 0 };
      items.push({
        campaignId: c.id,
        campaign: c.name,
        name: a.name,
        goal: a.goal,
        status: a.status,
        spentCents: i.spentCents,
        results: i.results,
        reach: i.reach,
        clicks: i.clicks,
        costPerResultCents: a.goal !== "awareness" && i.results > 0 ? Math.round(i.spentCents / i.results) : null,
      });
    }
  const paid = items.filter((x) => x.goal !== "awareness");
  const paidSpent = paid.reduce((s, x) => s + x.spentCents, 0);
  const paidResults = paid.reduce((s, x) => s + x.results, 0);
  return {
    count: items.length,
    active: items.filter((x) => x.status === "active").length,
    spentCents: items.reduce((s, x) => s + x.spentCents, 0),
    results: items.reduce((s, x) => s + x.results, 0),
    reach: items.reduce((s, x) => s + x.reach, 0),
    clicks: items.reduce((s, x) => s + x.clicks, 0),
    costPerResultCents: paidResults > 0 ? Math.round(paidSpent / paidResults) : null,
    items: items.sort((a, b) => b.spentCents - a.spentCents),
  };
}

// ---------- Reseñas ----------

/** Reseñas nuevas en el periodo (por su fecha). Las que no tienen fecha no cuentan. */
export function reviewsBetween(reviews: { timestamp: string; rating: number | null }[], from: Date, to: Date): { count: number; average: number | null } {
  const inside = reviews.filter((r) => {
    const t = Date.parse(r.timestamp);
    return Number.isFinite(t) && t >= from.getTime() && t <= to.getTime();
  });
  const rated = inside.filter((r) => r.rating !== null);
  return { count: inside.length, average: rated.length ? Math.round((rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length) * 10) / 10 : null };
}

// ---------- Posiciones en Google ----------

export type RankSnap = { at: string; avgPosition: number | null; inTop3: number; inTop10: number; rows: { keyword: string; position: number | null }[] };
export type RankMove = { keyword: string; now: number | null; prev: number | null; /** positivo = subió (mejoró) */ moved: number | null };
export type RankMovement = { now: RankSnap; prev: RankSnap | null; moves: RankMove[] };

/**
 * Cómo se movieron las posiciones: la última revisión hasta `to` contra la última hasta `from` (o la más vieja del
 * periodo si no hay una antes). `snaps` del más nuevo al más viejo.
 */
export function rankMovement(snaps: RankSnap[], from: Date, to: Date): RankMovement | null {
  const upTo = snaps.filter((s) => Date.parse(s.at) <= to.getTime());
  const now = upTo[0];
  if (!now) return null;
  const before = upTo.find((s) => Date.parse(s.at) <= from.getTime()) ?? (upTo.length > 1 ? upTo[upTo.length - 1] : null);
  const prev = before && before !== now ? before : null;
  const moves: RankMove[] = now.rows.map((r) => {
    const p = prev?.rows.find((x) => x.keyword.toLowerCase() === r.keyword.toLowerCase());
    const pp = p ? p.position : null;
    const moved = r.position !== null && pp !== null ? pp - r.position : null;
    return { keyword: r.keyword, now: r.position, prev: pp, moved };
  });
  moves.sort((a, b) => Math.abs(b.moved ?? 0) - Math.abs(a.moved ?? 0) || (a.now ?? 999) - (b.now ?? 999));
  return { now, prev, moves };
}
