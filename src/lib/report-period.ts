// Reporte de un periodo (un día o cualquier rango de fechas) de un negocio: lo publicado, las campañas, lo que la IA
// hizo sola, los anuncios pagados, los resultados de las publicaciones, las reseñas, las visitas a la página, los
// cambios en Google, las tareas del plan, las propuestas de la IA, los avisos y los costos.
// Este archivo es PURO (sin base de datos): recibe lo leído (ReportInputs, ver report-period-load.ts) y arma las
// secciones. Cada sección es null cuando no hay nada que mostrar. Lo usan el email diario, la pantalla y el PDF.
import { addDays, daysBetween, daysRange, isDay, localDay, yesterday } from "@/lib/business-tz";
import { readCampaignAds, RESULT_LABEL, type AdEntry, type AdGoal } from "@/lib/ads-shape";
import { readGa4Report } from "@/lib/ga4-shape";
import { rankAlerts, type RankAlert } from "@/lib/seo/alerts";
import { zoneLabel, type Zone } from "@/lib/seo/dataforseo";
import { readGbpReport, readReviewsReport } from "@/lib/seo/gbp";
import { readRankReport, type RankReport } from "@/lib/seo/rank";
import { groupByZone } from "@/lib/seo/zones";

const HOUR_MS = 3600_000;

export type Bi = { es: string; en: string };
export type Tone = "good" | "bad" | "neutral";

// ---------- Periodo ----------

export const RANGE_PRESETS = ["ayer", "7-dias", "este-mes", "mes-pasado", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
/** Lo más largo que se puede pedir (un año y un día). */
export const MAX_RANGE_DAYS = 366;

/**
 * [from, to) en UTC de los días fromDay..toDay (incluidos) en la hora del negocio, y el periodo anterior con el que
 * se compara [prevFrom, prevTo) (la misma cantidad de días justo antes; para «Mes pasado», el mes antes de ese).
 */
export type RangePeriod = {
  preset: RangePreset;
  fromDay: string;
  toDay: string;
  tz: string;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  /** Cuántos días tiene (1 = un solo día). */
  days: number;
};

const monthFirst = (day: string) => `${day.slice(0, 7)}-01`;
const prevMonthFirst = (day: string) => monthFirst(addDays(monthFirst(day), -1));

function makePeriod(preset: RangePreset, fromDay: string, toDay: string, tz: string, prevFromDay?: string, prevToDay?: string): RangePeriod {
  const { from, to } = daysRange(tz, fromDay, toDay);
  const days = daysBetween(fromDay, toDay) + 1;
  const pf = prevFromDay ?? addDays(fromDay, -days);
  const pt = prevToDay ?? addDays(fromDay, -1);
  const prev = daysRange(tz, pf, pt);
  return { preset, fromDay, toDay, tz, from, to, prevFrom: prev.from, prevTo: prev.to, days };
}

/** El periodo de un atajo («Ayer», «Últimos 7 días», «Este mes», «Mes pasado») en la hora del negocio. */
export function presetPeriod(preset: Exclude<RangePreset, "custom">, tz: string, now = new Date()): RangePeriod {
  const today = localDay(now, tz);
  const y = yesterday(tz, now);
  if (preset === "ayer") return makePeriod("ayer", y, y, tz);
  if (preset === "7-dias") return makePeriod("7-dias", addDays(y, -6), y, tz);
  if (preset === "este-mes") {
    // Del día 1 hasta hoy (lo que va del día), comparado con los mismos días del mes anterior.
    const first = monthFirst(today);
    const len = daysBetween(first, today);
    const pf = prevMonthFirst(today);
    const lastPrev = addDays(first, -1);
    const pt = addDays(pf, len) > lastPrev ? lastPrev : addDays(pf, len);
    return makePeriod("este-mes", first, today, tz, pf, pt);
  }
  const from = prevMonthFirst(today);
  const to = addDays(monthFirst(today), -1);
  return makePeriod("mes-pasado", from, to, tz, prevMonthFirst(from), addDays(from, -1));
}

/** El periodo de un día (el del reporte diario). */
export const dayPeriod = (day: string, tz: string): RangePeriod => makePeriod("custom", day, day, tz);

/**
 * Lee el rango de la dirección (?desde=AAAA-MM-DD&hasta=AAAA-MM-DD, o ?p=7-dias). Sin nada: «Ayer».
 * Fechas al revés se dan vuelta; nunca después de hoy; como mucho 366 días. Si coincide con un atajo, lleva su nombre.
 */
export function parseRange(q: { desde?: string | null; hasta?: string | null; p?: string | null }, tz: string, now = new Date()): RangePeriod {
  const today = localDay(now, tz);
  const p = (q.p ?? "") as RangePreset;
  if (p && p !== "custom" && (RANGE_PRESETS as readonly string[]).includes(p) && !q.desde && !q.hasta) return presetPeriod(p, tz, now);
  let a = isDay(q.desde) ? q.desde : null;
  let b = isDay(q.hasta) ? q.hasta : null;
  if (!a && !b) return presetPeriod("ayer", tz, now);
  a = a ?? b!;
  b = b ?? a;
  if (a > b) [a, b] = [b, a];
  if (b > today) b = today;
  if (a > b) a = b;
  if (daysBetween(a, b) + 1 > MAX_RANGE_DAYS) a = addDays(b, -(MAX_RANGE_DAYS - 1));
  for (const pre of ["ayer", "7-dias", "este-mes", "mes-pasado"] as const) {
    const x = presetPeriod(pre, tz, now);
    if (x.fromDay === a && x.toDay === b) return x;
  }
  return makePeriod("custom", a, b, tz);
}

/** "?desde=…&hasta=…" del periodo (para los links). */
export const rangeQuery = (p: Pick<RangePeriod, "fromDay" | "toDay">) => `desde=${p.fromDay}&hasta=${p.toDay}`;

// ---------- Lo que entra ----------

export type RawRow = { data: unknown; createdAt: Date };

/** Lo que se guarda de cada anuncio en el reporte diario, para calcular lo gastado de un día al siguiente. */
export type AdSnap = { id: string; campaignId: string; spentCents: number; impressions: number; reach: number; clicks: number; results: number };
export type AdSnapshot = { at: Date; items: AdSnap[] };

export type InputTarget = {
  id: string;
  postId: string;
  channel: string;
  /** sent | failed | skipped | pending */
  status: string;
  externalUrl: string;
  detail: string;
  /** Cuándo salió (o el último intento, si falló). */
  at: Date;
  title: string;
  campaignId: string | null;
  kind: string;
};

export type InputAction = { id: string; kind: string; actor: string; summary: Bi; costCents: number; createdAt: Date; campaignId: string | null };
export type InputCampaign = { id: string; name: string; status: string; mode: string; startsAt: Date; endsAt: Date | null; ads: unknown };
export type InputMetric = {
  postTargetId: string;
  channel: string;
  fetchedAt: Date;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  videoViews: number;
};
export type InputTask = { title: Bi; area: string; href: string; impact: number; effort: number; doneAt: Date | null };
export type InputProposal = { id: string; kind: string; title: Bi; impact: number; status: string; createdAt: Date };

export type ReportBusiness = { id: string; name: string; color: string; color2: string; color3: string; website: string; logoUrl: string; fontHeading: string; aiText: string };

/** Lo que se lee de la base de datos para armar el reporte (ver report-period-load.ts). */
export type ReportInputs = {
  business: ReportBusiness;
  period: RangePeriod;
  now: Date;
  zones: Zone[];
  /** Canales de las publicaciones que salieron o se intentaron en el periodo. */
  targets: InputTarget[];
  /** Publicaciones enviadas en el periodo anterior (para comparar). */
  prevSent: number;
  /** Publicaciones (canal) enviadas en los últimos 7 días, para mostrar sus resultados en un reporte de 1-2 días. */
  recentTargets: InputTarget[];
  actions: InputAction[];
  prevActions: { auto: number; costCents: number };
  campaigns: InputCampaign[];
  adSnapshots: AdSnapshot[];
  /** El último resultado de cada publicación (PostMetric). */
  metrics: InputMetric[];
  reviews: RawRow | null;
  gbp: RawRow | null;
  ga4: RawRow | null;
  /** Revisiones de posiciones (las del periodo y las de antes), de la más nueva a la más vieja. */
  rank: RawRow[];
  tasksDone: InputTask[];
  /** Las próximas tareas del plan (las más importantes primero). */
  tasksOpen: InputTask[];
  proposals: InputProposal[];
  /** Publicaciones programadas para las 24 horas después del periodo (solo si el periodo terminó hace poco). */
  upcoming: { count: number; next: Date | null } | null;
};

// ---------- Lo que sale ----------

export type PostItem = { postId: string; title: string; channel: string; status: string; url: string; at: string; detail: string };
export type PostsSection = {
  sent: number;
  failed: number;
  skipped: number;
  prevSent: number;
  byChannel: { channel: string; sent: number; failed: number; skipped: number }[];
  /** Las publicaciones (una línea por canal), lo más nuevo primero (máx. 30). */
  items: PostItem[];
};

export type CampaignLine = {
  id: string;
  name: string;
  status: string;
  mode: string;
  /** Publicaciones que salieron de esta campaña en el periodo. */
  published: number;
  /** Publicaciones que la IA preparó (borradores o programadas). */
  prepared: number;
  limits: number;
  /** Cambios de estado (pausa, parada, fin…) con su frase. */
  events: { at: string; kind: string; summary: Bi }[];
};
export type CampaignsSection = { items: CampaignLine[] };

export type AiItem = { at: string; kind: string; summary: Bi; costCents: number; campaign: string | null };
export type AiSection = {
  total: number;
  costCents: number;
  prevTotal: number;
  /** Lo que hizo la IA sola, lo más nuevo primero (máx. 40). */
  items: AiItem[];
  /** Además: lo que el dueño aprobó (para dar contexto). */
  approved: number;
};

export type AdRow = {
  id: string;
  campaign: string;
  name: string;
  status: string;
  goal: AdGoal;
  resultLabel: Bi;
  spentCents: number;
  impressions: number;
  reach: number;
  clicks: number;
  results: number;
  /** true = son los números desde que empezó el anuncio (no hay con qué restar para saber solo los del periodo). */
  cumulative: boolean;
};
export type AdsSection = {
  rows: AdRow[];
  /** Lo gastado en el periodo (solo las filas que no son acumuladas). */
  spentCents: number;
  results: number;
  /** Lo gastado desde el inicio en las filas acumuladas. */
  cumulativeCents: number;
  /** Cuándo se leyeron los números de Meta por última vez. */
  readAt: string | null;
};

export type ResultRow = {
  title: string;
  channel: string;
  url: string;
  at: string;
  impressions: number;
  reach: number;
  interactions: number;
  clicks: number;
  videoViews: number;
  fetchedAt: string;
};
export type ResultsSection = {
  /** Los resultados son de las publicaciones de los últimos 7 días (el periodo es muy corto para verlos). */
  last7: boolean;
  rows: ResultRow[];
  totals: { impressions: number; reach: number; interactions: number; clicks: number; videoViews: number };
};

export type ReviewItem = { name: string; rating: number | null; text: string; at: string; answered: boolean; url: string };
export type ReviewsSection = {
  rating: number | null;
  total: number | null;
  /** null = no se sabe (las reseñas no se revisaron en este periodo). */
  newCount: number | null;
  items: ReviewItem[];
  /** Cuándo se revisaron por última vez. */
  checkedAt: string;
  /** Se revisaron antes de que terminara el periodo: puede haber más nuevas. */
  stale: boolean;
};

export type WebSection = {
  /** Visitas desde Google (gratis) en los días del periodo: null si el reporte de Google Analytics no cubre esos días. */
  organic: number | null;
  prevOrganic: number | null;
  /** Los números de los 28 días del último reporte (otra ventana: se muestran con sus fechas). */
  window: { start: string; end: string; sessions: number; users: number; keyEvents: number; prevSessions: number };
  fetchedAt: string;
};

export type RankZone = { label: string; date: string; prevDate: string | null; avgPosition: number | null; prevAvg: number | null; top10: number; prevTop10: number | null };
export type RankingsSection = { zones: RankZone[]; bad: (RankAlert & { zone: string })[]; good: (RankAlert & { zone: string })[] };

export type TaskItem = { title: Bi; area: string; href: string; at: string | null };
export type TasksSection = { items: TaskItem[] };
export type ProposalsSection = { items: { id: string; kind: string; title: Bi; impact: number; status: string; at: string }[] };

export type AlertItem = { at: string; tone: Tone; text: Bi; href: string };
export type AlertsSection = { items: AlertItem[] };

export type CostsSection = { aiCents: number; adsCents: number; adsCumulative: boolean; prevAiCents: number };
export type NextSection = { tasks: TaskItem[]; upcoming: { count: number; next: string | null } | null };

export type PeriodReport = {
  business: ReportBusiness;
  period: RangePeriod;
  generatedAt: Date;
  posts: PostsSection | null;
  results: ResultsSection | null;
  campaigns: CampaignsSection | null;
  ai: AiSection | null;
  ads: AdsSection | null;
  reviews: ReviewsSection | null;
  web: WebSection | null;
  rankings: RankingsSection | null;
  tasks: TasksSection | null;
  proposals: ProposalsSection | null;
  alerts: AlertsSection | null;
  costs: CostsSection | null;
  next: NextSection | null;
};

const iso = (d: Date) => d.toISOString();
const inRange = (at: Date, from: Date, to: Date) => at.getTime() >= from.getTime() && at.getTime() < to.getTime();

// ---------- Publicaciones ----------

export function postsSection(targets: InputTarget[], prevSent: number): PostsSection | null {
  const done = targets.filter((t) => t.status === "sent" || t.status === "failed" || t.status === "skipped");
  if (!done.length) return null;
  const ch = new Map<string, { channel: string; sent: number; failed: number; skipped: number }>();
  for (const t of done) {
    const c = ch.get(t.channel) ?? { channel: t.channel, sent: 0, failed: 0, skipped: 0 };
    if (t.status === "sent") c.sent += 1;
    else if (t.status === "failed") c.failed += 1;
    else c.skipped += 1;
    ch.set(t.channel, c);
  }
  const order = { failed: 0, sent: 1, skipped: 2 } as Record<string, number>;
  const items = [...done]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || (order[a.status] ?? 3) - (order[b.status] ?? 3))
    .slice(0, 30)
    .map((t) => ({ postId: t.postId, title: t.title, channel: t.channel, status: t.status, url: t.status === "sent" ? t.externalUrl : "", at: iso(t.at), detail: t.status === "sent" ? "" : t.detail.slice(0, 240) }));
  return {
    sent: done.filter((t) => t.status === "sent").length,
    failed: done.filter((t) => t.status === "failed").length,
    skipped: done.filter((t) => t.status === "skipped").length,
    prevSent,
    byChannel: [...ch.values()].sort((a, b) => b.sent - a.sent || a.channel.localeCompare(b.channel)),
    items,
  };
}

// ---------- Campañas ----------

const PREPARED = new Set(["post.draft", "post.scheduled", "video.ready", "video.render"]);
const CAMPAIGN_EVENTS = new Set(["campaign.started", "campaign.paused", "campaign.stopped", "campaign.ended", "campaign.updated", "campaign.resumed"]);

export function campaignsSection(campaigns: InputCampaign[], actions: InputAction[], targets: InputTarget[], period: RangePeriod): CampaignsSection | null {
  const items: CampaignLine[] = [];
  for (const c of campaigns) {
    const acts = actions.filter((a) => a.campaignId === c.id);
    const published = targets.filter((t) => t.campaignId === c.id && t.status === "sent").length;
    const activeInPeriod = c.status === "active" && c.startsAt.getTime() < period.to.getTime() && (!c.endsAt || c.endsAt.getTime() >= period.from.getTime());
    if (!acts.length && !published && !activeInPeriod) continue;
    items.push({
      id: c.id,
      name: c.name,
      status: c.status,
      mode: c.mode,
      published,
      prepared: acts.filter((a) => PREPARED.has(a.kind)).length,
      limits: acts.filter((a) => a.kind === "limit.reached").length,
      events: acts
        .filter((a) => CAMPAIGN_EVENTS.has(a.kind))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 5)
        .map((a) => ({ at: iso(a.createdAt), kind: a.kind, summary: a.summary })),
    });
  }
  if (!items.length) return null;
  const rank = (s: string) => (s === "active" ? 0 : s === "paused" ? 1 : s === "stopped" ? 2 : 3);
  return { items: items.sort((a, b) => rank(a.status) - rank(b.status) || b.published - a.published || a.name.localeCompare(b.name)) };
}

// ---------- Lo que hizo la IA sola ----------

export function aiSection(actions: InputAction[], campaigns: InputCampaign[], prevAuto: number): AiSection | null {
  const auto = actions.filter((a) => a.actor === "auto");
  const approved = actions.filter((a) => a.actor === "approved").length;
  if (!auto.length) return null;
  const names = new Map(campaigns.map((c) => [c.id, c.name]));
  return {
    total: auto.length,
    costCents: auto.reduce((s, a) => s + Math.max(0, a.costCents), 0),
    prevTotal: prevAuto,
    approved,
    items: [...auto]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 40)
      .map((a) => ({ at: iso(a.createdAt), kind: a.kind, summary: a.summary, costCents: a.costCents, campaign: a.campaignId ? (names.get(a.campaignId) ?? null) : null })),
  };
}

// ---------- Anuncios pagados ----------

const ZERO_SNAP = { spentCents: 0, impressions: 0, reach: 0, clicks: 0, results: 0 };
type SnapVals = typeof ZERO_SNAP;

/** La foto de los anuncios más cercana a `at`, tomada entre 3 horas antes y 14 horas después (el cron puede atrasarse). */
export function snapshotNear(snaps: AdSnapshot[], at: Date): AdSnapshot | null {
  let best: AdSnapshot | null = null;
  for (const s of snaps) {
    const d = s.at.getTime() - at.getTime();
    if (d < -3 * HOUR_MS || d > 14 * HOUR_MS) continue;
    if (!best || Math.abs(d) < Math.abs(best.at.getTime() - at.getTime())) best = s;
  }
  return best;
}

const valsOf = (a: AdEntry): SnapVals | null =>
  a.insights ? { spentCents: a.insights.spentCents, impressions: a.insights.impressions, reach: a.insights.reach, clicks: a.insights.clicks, results: a.insights.results } : null;

/** Lo que se guarda de los anuncios en cada reporte diario (los números desde el inicio de cada anuncio). */
export function adSnapshot(campaigns: InputCampaign[]): AdSnap[] {
  const out: AdSnap[] = [];
  for (const c of campaigns)
    for (const a of readCampaignAds(c.ads).items) {
      const v = valsOf(a);
      if (v) out.push({ id: a.id, campaignId: c.id, ...v });
    }
  return out;
}

/**
 * Gasto y resultados de los anuncios en el periodo. Meta solo da los números desde que empezó cada anuncio, así que se
 * resta la foto guardada en el reporte diario del inicio del periodo (o 0 si el anuncio se creó en el periodo).
 * Si no hay foto, la fila queda «acumulada» (desde el inicio) y se dice así.
 */
export function adsSection(campaigns: InputCampaign[], snaps: AdSnapshot[], period: RangePeriod, now: Date): AdsSection | null {
  const startSnap = snapshotNear(snaps, period.from);
  const endSnap = snapshotNear(snaps, period.to);
  const recent = period.to.getTime() > now.getTime() - 26 * HOUR_MS;
  const rows: AdRow[] = [];
  let readAt: string | null = null;
  for (const c of campaigns) {
    for (const a of readCampaignAds(c.ads).items) {
      const cur = valsOf(a);
      if (!cur) continue;
      const created = new Date(a.createdAt);
      if (!Number.isNaN(created.getTime()) && created.getTime() >= period.to.getTime()) continue;
      if (a.insights && (!readAt || a.insights.fetchedAt > readAt)) readAt = a.insights.fetchedAt;
      const endItem = endSnap?.items.find((x) => x.id === a.id);
      const end: SnapVals | null = endItem ?? (recent ? cur : null);
      const createdInPeriod = !Number.isNaN(created.getTime()) && created.getTime() >= period.from.getTime();
      const startItem = startSnap?.items.find((x) => x.id === a.id);
      const start: SnapVals | null = createdInPeriod ? ZERO_SNAP : (startItem ?? (startSnap ? ZERO_SNAP : null));
      const delta = end && start;
      const v: SnapVals = delta
        ? {
            spentCents: Math.max(0, end.spentCents - start.spentCents),
            impressions: Math.max(0, end.impressions - start.impressions),
            reach: Math.max(0, end.reach - start.reach),
            clicks: Math.max(0, end.clicks - start.clicks),
            results: Math.max(0, end.results - start.results),
          }
        : cur;
      // Sin gasto ni resultados en el periodo y ya apagado: no se muestra.
      if (delta && !v.spentCents && !v.results && !v.impressions && a.status !== "active") continue;
      rows.push({ id: a.id, campaign: c.name, name: a.name, status: a.status, goal: a.goal, resultLabel: RESULT_LABEL[a.goal], ...v, cumulative: !delta });
    }
  }
  if (!rows.length) return null;
  rows.sort((x, y) => Number(x.cumulative) - Number(y.cumulative) || y.spentCents - x.spentCents);
  const fresh = rows.filter((r) => !r.cumulative);
  return {
    rows,
    spentCents: fresh.reduce((s, r) => s + r.spentCents, 0),
    results: fresh.reduce((s, r) => s + r.results, 0),
    cumulativeCents: rows.filter((r) => r.cumulative).reduce((s, r) => s + r.spentCents, 0),
    readAt,
  };
}

// ---------- Resultados de las publicaciones ----------

export function resultsSection(targets: InputTarget[], recentTargets: InputTarget[], metrics: InputMetric[], period: RangePeriod): ResultsSection | null {
  if (!metrics.length) return null;
  const last7 = period.days <= 2;
  const pool = (last7 ? recentTargets : targets).filter((t) => t.status === "sent");
  const byTarget = new Map<string, InputMetric>();
  for (const m of metrics) {
    const prev = byTarget.get(m.postTargetId);
    if (!prev || m.fetchedAt.getTime() > prev.fetchedAt.getTime()) byTarget.set(m.postTargetId, m);
  }
  const rows: ResultRow[] = [];
  for (const t of pool) {
    const m = byTarget.get(t.id);
    if (!m) continue;
    rows.push({
      title: t.title,
      channel: t.channel,
      url: t.externalUrl,
      at: iso(t.at),
      impressions: m.impressions,
      reach: m.reach,
      interactions: m.likes + m.comments + m.shares + m.saves,
      clicks: m.clicks,
      videoViews: m.videoViews,
      fetchedAt: iso(m.fetchedAt),
    });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.interactions - a.interactions || b.reach - a.reach);
  const sum = (k: keyof ResultsSection["totals"]) => rows.reduce((s, r) => s + r[k], 0);
  return { last7, rows: rows.slice(0, 15), totals: { impressions: sum("impressions"), reach: sum("reach"), interactions: sum("interactions"), clicks: sum("clicks"), videoViews: sum("videoViews") } };
}

// ---------- Reseñas ----------

export function reviewsSection(reviewsRow: RawRow | null, gbpRow: RawRow | null, period: RangePeriod): ReviewsSection | null {
  const rep = reviewsRow ? readReviewsReport(reviewsRow.data) : null;
  const gbp = gbpRow ? readGbpReport(gbpRow.data) : null;
  if (!rep && !gbp) return null;
  const checked = reviewsRow?.createdAt ?? gbpRow!.createdAt;
  const known = Boolean(rep && reviewsRow && reviewsRow.createdAt.getTime() >= period.from.getTime());
  const fresh = rep && known ? rep.reviews.filter((r) => r.timestamp && inRange(new Date(r.timestamp), period.from, period.to)) : [];
  const newCount = known ? fresh.length : null;
  const rating = rep?.rating ?? gbp?.profile.rating ?? null;
  const total = rep?.total ?? gbp?.profile.reviews ?? null;
  // Un día sin reseñas nuevas no se muestra; un periodo de una semana o más muestra cómo va la calificación.
  if (!newCount && period.days < 7) return null;
  if (!newCount && rating === null) return null;
  return {
    rating,
    total,
    newCount,
    items: fresh
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 10)
      .map((r) => ({ name: r.name, rating: r.rating, text: (r.text || r.originalText).replace(/\s+/g, " ").trim().slice(0, 220), at: r.timestamp, answered: Boolean(r.ownerAnswer || r.postedAt), url: r.url })),
    checkedAt: iso(checked),
    stale: checked.getTime() < period.to.getTime(),
  };
}

// ---------- Visitas a la página (Google Analytics) ----------

export function webSection(ga4Row: RawRow | null, period: RangePeriod): WebSection | null {
  const rep = ga4Row ? readGa4Report(ga4Row.data) : null;
  if (!rep) return null;
  const byDay = new Map(rep.organicTrend.map((d) => [d.date, d.sessions]));
  const sumDays = (a: string, b: string): number | null => {
    let s = 0;
    for (let d = a; d <= b; d = addDays(d, 1)) {
      const v = byDay.get(d);
      if (v === undefined) return null;
      s += v;
    }
    return s;
  };
  const prevFromDay = addDays(period.fromDay, -period.days);
  return {
    organic: sumDays(period.fromDay, period.toDay),
    prevOrganic: sumDays(prevFromDay, addDays(period.fromDay, -1)),
    window: { start: rep.range.start, end: rep.range.end, sessions: rep.totals.sessions, users: rep.totals.users, keyEvents: rep.totals.keyEvents, prevSessions: rep.previous.sessions },
    fetchedAt: rep.fetchedAt || iso(ga4Row!.createdAt),
  };
}

// ---------- Posiciones en Google ----------

export function rankingsSection(rows: RawRow[], zones: Zone[], period: RangePeriod): RankingsSection | null {
  if (!zones.length) return null;
  const reports = rows
    .map((r) => ({ rep: readRankReport(r.data), at: r.createdAt }))
    .filter((x): x is { rep: RankReport; at: Date } => x.rep !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((x) => ({ ...x, locationCode: x.rep.locationCode }));
  const out: RankingsSection = { zones: [], bad: [], good: [] };
  for (const [code, list] of groupByZone(reports, zones)) {
    const cur = list.find((x) => inRange(x.at, period.from, period.to));
    if (!cur || !cur.rep.rows.length) continue;
    const prev = list.find((x) => x.at.getTime() < period.from.getTime()) ?? list.find((x) => x.at.getTime() <= cur.at.getTime() - 12 * HOUR_MS) ?? null;
    const zone = zones.find((z) => z.code === code);
    const label = zoneLabel(zone?.name || cur.rep.location) || "—";
    out.zones.push({
      label,
      date: iso(cur.at),
      prevDate: prev ? iso(prev.at) : null,
      avgPosition: cur.rep.avgPosition,
      prevAvg: prev?.rep.avgPosition ?? null,
      top10: cur.rep.inTop10,
      prevTop10: prev ? prev.rep.inTop10 : null,
    });
    if (prev) {
      const a = rankAlerts(prev.rep, cur.rep);
      out.bad.push(...a.bad.map((x) => ({ ...x, zone: label })));
      out.good.push(...a.good.map((x) => ({ ...x, zone: label })));
    }
  }
  if (!out.zones.length) return null;
  out.bad = out.bad.slice(0, 10);
  out.good = out.good.slice(0, 10);
  return out;
}

// ---------- Avisos ----------

const ALERT_KINDS: Record<string, Tone> = {
  "campaign.paused": "bad",
  "campaign.stopped": "bad",
  "limit.reached": "neutral",
  "post.error": "bad",
  "video.failed": "bad",
  "alert.failed": "bad",
};

export function alertsSection(targets: InputTarget[], actions: InputAction[], campaigns: InputCampaign[], period: RangePeriod, businessId: string): AlertsSection | null {
  const items: AlertItem[] = [];
  const base = `/b/${businessId}`;
  const failed = targets.filter((t) => t.status === "failed");
  if (failed.length) {
    const byChannel = new Map<string, number>();
    for (const t of failed) byChannel.set(t.channel, (byChannel.get(t.channel) ?? 0) + 1);
    for (const [channel, n] of byChannel) {
      const last = failed.find((t) => t.channel === channel)!;
      items.push({
        at: iso(last.at),
        tone: "bad",
        text: {
          es: `${n === 1 ? "1 publicación no salió" : `${n} publicaciones no salieron`} en ${channelLabel(channel, "es")}${last.detail ? `: ${last.detail.slice(0, 160)}` : "."}`,
          en: `${n === 1 ? "1 post didn't go out" : `${n} posts didn't go out`} on ${channelLabel(channel, "en")}${last.detail ? `: ${last.detail.slice(0, 160)}` : "."}`,
        },
        href: `${base}/historial?ver=error`,
      });
    }
  }
  for (const a of actions) {
    const tone = ALERT_KINDS[a.kind];
    if (!tone) continue;
    items.push({ at: iso(a.createdAt), tone, text: a.summary, href: a.campaignId ? `${base}/campanas/${a.campaignId}` : `${base}/campanas` });
  }
  for (const c of campaigns)
    for (const ad of readCampaignAds(c.ads).items)
      for (const e of ad.errors) {
        const at = new Date(e.at);
        if (Number.isNaN(at.getTime()) || !inRange(at, period.from, period.to)) continue;
        items.push({ at: e.at, tone: "bad", text: { es: `Anuncio «${ad.name}»: ${e.es}`, en: `Ad "${ad.name}": ${e.en}` }, href: `${base}/anuncios` });
      }
  if (!items.length) return null;
  const rank = (t: Tone) => (t === "bad" ? 0 : 1);
  return { items: items.sort((a, b) => rank(a.tone) - rank(b.tone) || b.at.localeCompare(a.at)).slice(0, 15) };
}

/** Nombre corto del canal (sin depender de la lista de canales, para que el archivo siga siendo liviano). */
const CHANNEL_NAMES: Record<string, Bi> = {
  facebook: { es: "Facebook", en: "Facebook" },
  instagram: { es: "Instagram", en: "Instagram" },
  tiktok: { es: "TikTok", en: "TikTok" },
  youtube: { es: "YouTube", en: "YouTube" },
  google: { es: "Perfil de Google", en: "Google profile" },
  seo: { es: "tu página web", en: "your website" },
  linkedin: { es: "LinkedIn", en: "LinkedIn" },
  x: { es: "X (Twitter)", en: "X (Twitter)" },
  email: { es: "Email", en: "Email" },
  sms: { es: "Mensajes de texto", en: "Text messages" },
};
export const channelLabel = (id: string, lang: "es" | "en") => CHANNEL_NAMES[id]?.[lang] ?? id;

// ---------- Todo junto ----------

export function buildPeriodReport(inputs: ReportInputs): PeriodReport {
  const { period, now } = inputs;
  const ads = adsSection(inputs.campaigns, inputs.adSnapshots, period, now);
  const aiCents = inputs.actions.reduce((s, a) => s + Math.max(0, a.costCents), 0);
  const adsCents = ads?.spentCents ?? 0;
  const costs: CostsSection | null =
    aiCents || adsCents || ads?.cumulativeCents || inputs.prevActions.costCents
      ? { aiCents, adsCents, adsCumulative: Boolean(ads?.cumulativeCents), prevAiCents: inputs.prevActions.costCents }
      : null;
  const tasksDone = inputs.tasksDone.filter((t) => t.doneAt && inRange(t.doneAt, period.from, period.to));
  const nextTasks = inputs.tasksOpen.slice(0, 3).map((t) => ({ title: t.title, area: t.area, href: t.href, at: null }));
  const upcoming = inputs.upcoming && inputs.upcoming.count ? { count: inputs.upcoming.count, next: inputs.upcoming.next ? iso(inputs.upcoming.next) : null } : null;
  return {
    business: inputs.business,
    period,
    generatedAt: now,
    posts: postsSection(inputs.targets, inputs.prevSent),
    results: resultsSection(inputs.targets, inputs.recentTargets, inputs.metrics, period),
    campaigns: campaignsSection(inputs.campaigns, inputs.actions, inputs.targets, period),
    ai: aiSection(inputs.actions, inputs.campaigns, inputs.prevActions.auto),
    ads,
    reviews: reviewsSection(inputs.reviews, inputs.gbp, period),
    web: webSection(inputs.ga4, period),
    rankings: rankingsSection(inputs.rank, inputs.zones, period),
    tasks: tasksDone.length ? { items: tasksDone.slice(0, 15).map((t) => ({ title: t.title, area: t.area, href: t.href, at: t.doneAt ? iso(t.doneAt) : null })) } : null,
    proposals: inputs.proposals.length
      ? { items: inputs.proposals.slice(0, 10).map((p) => ({ id: p.id, kind: p.kind, title: p.title, impact: p.impact, status: p.status, at: iso(p.createdAt) })) }
      : null,
    alerts: alertsSection(inputs.targets, inputs.actions, inputs.campaigns, period, inputs.business.id),
    costs,
    next: nextTasks.length || upcoming ? { tasks: nextTasks, upcoming } : null,
  };
}

/**
 * ¿Fue un día sin nada? (sin publicaciones, sin nada de la IA, sin gasto en anuncios, sin reseñas nuevas, sin cambios
 * en Google, sin tareas hechas, sin propuestas y sin avisos). Las próximas tareas y las visitas no cuentan.
 */
export function isQuiet(r: PeriodReport): boolean {
  return (
    !r.posts &&
    !r.ai &&
    !(r.ads && (r.ads.spentCents > 0 || r.ads.results > 0)) &&
    !(r.reviews && r.reviews.newCount) &&
    !(r.rankings && (r.rankings.bad.length || r.rankings.good.length)) &&
    !r.tasks &&
    !r.proposals &&
    !r.alerts &&
    !(r.campaigns && r.campaigns.items.some((c) => c.published || c.prepared || c.events.length))
  );
}

/** Los números que se guardan en el registro del reporte diario (para el historial). */
export function reportCounts(r: PeriodReport) {
  return {
    sent: r.posts?.sent ?? 0,
    failed: r.posts?.failed ?? 0,
    ai: r.ai?.total ?? 0,
    aiCents: r.costs?.aiCents ?? 0,
    adsCents: r.ads?.spentCents ?? 0,
    reviews: r.reviews?.newCount ?? 0,
    tasks: r.tasks?.items.length ?? 0,
    proposals: r.proposals?.items.length ?? 0,
    alerts: r.alerts?.items.length ?? 0,
  };
}

/** "8 oct 2026" o "1–7 oct 2026" en el idioma pedido. */
export function periodText(p: RangePeriod, lang: "es" | "en", style: "short" | "long" = "short"): string {
  const loc = lang === "en" ? "en-US" : "es";
  // Mediodía UTC del día: el texto no depende de la zona (el día ya está en la hora del negocio).
  const noon = (d: string) => new Date(`${d}T12:00:00Z`);
  if (p.fromDay === p.toDay) {
    const o: Intl.DateTimeFormatOptions = style === "long" ? { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" } : { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" };
    return new Intl.DateTimeFormat(loc, o).format(noon(p.fromDay));
  }
  const o: Intl.DateTimeFormatOptions = { day: "numeric", month: style === "long" ? "long" : "short", year: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat(loc, o).formatRange(noon(p.fromDay), noon(p.toDay));
}

/** ¿El periodo es justamente ese día? */
export const isSingleDay = (p: RangePeriod) => p.fromDay === p.toDay;

/** Tiempo que cubre un periodo, para el texto de comparación ("el día anterior", "los 7 días anteriores"). */
export function prevText(p: RangePeriod, lang: "es" | "en"): string {
  if (p.preset === "mes-pasado") return lang === "en" ? "the month before" : "el mes anterior";
  if (p.preset === "este-mes") return lang === "en" ? "the same days last month" : "los mismos días del mes pasado";
  if (p.days === 1) return lang === "en" ? "the day before" : "el día anterior";
  return lang === "en" ? `the previous ${p.days} days` : `los ${p.days} días anteriores`;
}

