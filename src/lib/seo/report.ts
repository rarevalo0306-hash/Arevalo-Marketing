// Reporte de SEO y marketing (PDF, como "My Reports" de Semrush): junta lo que YA está guardado del negocio
// (posiciones, mapa de calor, Perfil de Google, IAs, auditoría, revisión de páginas, Search Console, oportunidades,
// artículos y publicaciones) para un periodo y lo compara con el periodo anterior. No llama a DataForSEO:
// lo único que puede costar es el resumen escrito por la IA (opcional).
// Todo lo que arma el reporte es puro (se prueba en tests/seo-report.test.ts); solo loadReportInputs lee la base de datos.
import { aiEnabled, writeReportSummary } from "@/lib/ai";
import { db } from "@/lib/db";
import { intlLocale, translator, type UiLang } from "@/lib/i18n";
import { BUSINESS_TZ, localToUtc } from "@/lib/time";
import { AI_NAMES, alertRecipients, renderEmail, type BuiltEmail, type EmailBlock, type EmailOpts, weeklyMovers, type Mover } from "@/lib/seo/alerts";
import { ISSUE_TEXT, readAuditReport, type Severity } from "@/lib/seo/audit";
import { readTrackedKeywords, readZones, zoneLabel, type Zone } from "@/lib/seo/dataforseo";
import { readGapReport, type GapType } from "@/lib/seo/gap";
import { readGbpReport, readReviewsReport } from "@/lib/seo/gbp";
import { asGscReport } from "@/lib/seo/gsc";
import { readKeywordsReport, reportLookup, type KeywordsReport } from "@/lib/seo/keywords";
import { readMapReport, type MapReport } from "@/lib/seo/maprank";
import { pathOf, readOnPageReport, topIdeas } from "@/lib/seo/onpage";
import { readRankReport, type RankReport } from "@/lib/seo/rank";
import type { SeoKind } from "@/lib/seo/reports";
import { readVisibilityReport, type VisibilityReport } from "@/lib/seo/visibility";
import { readArticleReport } from "@/lib/seo/writer";
import { groupByZone } from "@/lib/seo/zones";

const DAY_MS = 24 * 3600_000;

export type Bi = { es: string; en: string };
export type Tone = "good" | "bad" | "neutral";

// ---------- Periodo (en la hora del negocio) ----------

export const PERIOD_PRESETS = ["este-mes", "mes-pasado", "30-dias"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const asPreset = (v: unknown): PeriodPreset => ((PERIOD_PRESETS as readonly string[]).includes(String(v)) ? (v as PeriodPreset) : "mes-pasado");

/** [from, to) y el periodo anterior con el que se compara [prevFrom, prevTo). */
export type ReportPeriod = { preset: PeriodPreset; from: Date; to: Date; prevFrom: Date; prevTo: Date };

const pad = (n: number) => String(n).padStart(2, "0");

function localParts(date: Date, tz: string): { y: number; m: number; d: number; hour: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hour: Number(p.hour) };
}

/** Las 00:00 del día 1 del mes `m` (1-12, puede pasarse: 0 = diciembre del año anterior) en la hora del negocio, en UTC. */
export function monthStartUtc(y: number, m: number, tz = BUSINESS_TZ): Date {
  const yy = y + Math.floor((m - 1) / 12);
  const mm = ((((m - 1) % 12) + 12) % 12) + 1;
  return localToUtc(`${yy}-${pad(mm)}-01`, 0, "00:00", tz);
}

/** Las 00:00 del día 1 del mes de `now` (hora del negocio), en UTC. */
export function currentMonthStart(now: Date, tz = BUSINESS_TZ): Date {
  const { y, m } = localParts(now, tz);
  return monthStartUtc(y, m, tz);
}

/**
 * Los periodos del reporte:
 * - "este-mes": del día 1 hasta ahora, comparado con los mismos días del mes anterior.
 * - "mes-pasado": el mes anterior completo, comparado con el mes antes de ese.
 * - "30-dias": los últimos 30 días, comparado con los 30 días antes.
 */
export function periodFor(preset: PeriodPreset, now = new Date(), tz = BUSINESS_TZ): ReportPeriod {
  const { y, m } = localParts(now, tz);
  const thisMonth = monthStartUtc(y, m, tz);
  if (preset === "mes-pasado") {
    const from = monthStartUtc(y, m - 1, tz);
    return { preset, from, to: thisMonth, prevFrom: monthStartUtc(y, m - 2, tz), prevTo: from };
  }
  if (preset === "este-mes") {
    const prevFrom = monthStartUtc(y, m - 1, tz);
    const len = now.getTime() - thisMonth.getTime();
    return { preset, from: thisMonth, to: now, prevFrom, prevTo: new Date(Math.min(prevFrom.getTime() + len, thisMonth.getTime())) };
  }
  const from = new Date(now.getTime() - 30 * DAY_MS);
  return { preset, from, to: now, prevFrom: new Date(from.getTime() - 30 * DAY_MS), prevTo: from };
}

/** "septiembre de 2026", "1–6 de octubre de 2026" o "6 sept – 6 oct 2026" (en inglés "September 2026"…). */
export function periodLabel(period: ReportPeriod, lang: UiLang, tz = BUSINESS_TZ): string {
  const loc = intlLocale(lang);
  if (period.preset === "mes-pasado") return new Intl.DateTimeFormat(loc, { timeZone: tz, month: "long", year: "numeric" }).format(period.from);
  const end = new Date(Math.max(period.from.getTime(), period.to.getTime() - 1));
  const opts: Intl.DateTimeFormatOptions =
    period.preset === "este-mes" ? { timeZone: tz, day: "numeric", month: "long", year: "numeric" } : { timeZone: tz, day: "numeric", month: "short", year: "numeric" };
  return new Intl.DateTimeFormat(loc, opts).formatRange(period.from, end);
}

/** "2026-09": el mes donde empieza el periodo (para el nombre del archivo). */
export function periodMonthKey(period: ReportPeriod, tz = BUSINESS_TZ): string {
  const { y, m } = localParts(period.from, tz);
  return `${y}-${pad(m)}`;
}

/** "reporte-seo-arevalo-roofing-2026-09.pdf" (solo letras sin acento, números y guiones). */
export function reportFileName(businessName: string, period: ReportPeriod, lang: UiLang = "es", tz = BUSINESS_TZ): string {
  const slug =
    businessName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/, "") || (lang === "en" ? "business" : "negocio");
  return `${lang === "en" ? "seo-report" : "reporte-seo"}-${slug}-${periodMonthKey(period, tz)}.pdf`;
}

/** ¿Toca el reporte del mes? El día 1 desde las 8:00 (hora del negocio), si el último se mandó antes de este mes. */
export function isMonthlyDue(now: Date, lastSent: Date | null, tz = BUSINESS_TZ): boolean {
  const { d, hour } = localParts(now, tz);
  if (d !== 1 || hour < 8) return false;
  return !lastSent || lastSent.getTime() < currentMonthStart(now, tz).getTime();
}

// ---------- Comparaciones (puras) ----------

export type Delta = { now: number | null; before: number | null; diff: number | null; tone: Tone };

/** Compara dos valores. `lowerIsBetter` para posiciones (bajar de 10 a 6 es bueno). Cambios menores a `epsilon` son neutros. */
export function compare(now: number | null | undefined, before: number | null | undefined, opts: { lowerIsBetter?: boolean; epsilon?: number } = {}): Delta {
  const n = typeof now === "number" && Number.isFinite(now) ? now : null;
  const b = typeof before === "number" && Number.isFinite(before) ? before : null;
  if (n === null || b === null) return { now: n, before: b, diff: null, tone: "neutral" };
  const diff = Math.round((n - b) * 10) / 10;
  const better = opts.lowerIsBetter ? -diff : diff;
  const tone: Tone = Math.abs(diff) < (opts.epsilon ?? 0.05) ? "neutral" : better > 0 ? "good" : "bad";
  return { now: n, before: b, diff, tone };
}

/** Cambio en % (redondeado): 120 vs 100 → 20. null si antes era 0 o no hay. */
export function pctChange(now: number | null | undefined, before: number | null | undefined): number | null {
  if (typeof now !== "number" || typeof before !== "number" || !Number.isFinite(now) || !Number.isFinite(before) || before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

// ---------- Lo que entra (la base de datos) ----------

export type RawRow = { data: unknown; createdAt: Date };

export type ReportBusiness = {
  id: string;
  name: string;
  website: string;
  color: string;
  color2: string;
  color3: string;
  logoUrl: string;
  fontHeading: string;
  aiText: string;
  seoKeywords: unknown;
  seoLocations: unknown;
  seoLocationCode: number | null;
  seoLocationName: string;
};

/** Lo que se lee de la base de datos para armar el reporte. Cada lista va del más nuevo al más viejo. */
export type ReportInputs = {
  business: ReportBusiness;
  rows: Partial<Record<SeoKind, RawRow[]>>;
  /** Publicaciones enviadas (una por canal) desde el inicio del periodo anterior. */
  posts: { channel: string; at: Date }[];
};

export const REPORT_KINDS: SeoKind[] = ["rank", "keywords", "maprank", "gbp", "reviews", "ai", "audit", "onpage", "gsc", "gap", "article"];

/** Cuántos reportes de cada tipo se leen (los más nuevos hasta el final del periodo). */
const TAKE: Partial<Record<SeoKind, number>> = { rank: 300, keywords: 25, maprank: 30, gbp: 3, reviews: 1, ai: 12, audit: 8, onpage: 1, gsc: 1, gap: 1, article: 30 };

/** Lee de la base de datos lo que necesita el reporte. No llama a ninguna API. */
export async function loadReportInputs(businessId: string, period: ReportPeriod): Promise<ReportInputs> {
  const business = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      website: true,
      color: true,
      color2: true,
      color3: true,
      logoUrl: true,
      fontHeading: true,
      aiText: true,
      seoKeywords: true,
      seoLocations: true,
      seoLocationCode: true,
      seoLocationName: true,
    },
  });
  const until = { lte: period.to };
  const lists = await Promise.all(
    REPORT_KINDS.map((kind) =>
      db.seoReport.findMany({
        where: {
          businessId,
          kind,
          createdAt:
            kind === "rank"
              ? { gte: new Date(period.prevFrom.getTime() - 60 * DAY_MS), ...until }
              : kind === "article"
                ? { gte: period.from, ...until }
                : until,
        },
        orderBy: { createdAt: "desc" },
        take: TAKE[kind] ?? 1,
        select: { data: true, createdAt: true },
      }),
    ),
  );
  const rows: ReportInputs["rows"] = {};
  REPORT_KINDS.forEach((k, i) => (rows[k] = lists[i]));

  const targets = await db.postTarget.findMany({
    where: {
      status: "sent",
      post: { businessId, status: { in: ["done", "partial"] } },
      OR: [{ sentAt: { gte: period.prevFrom, lt: period.to } }, { sentAt: null, post: { scheduledAt: { gte: period.prevFrom, lt: period.to } } }],
    },
    select: { channel: true, sentAt: true, post: { select: { scheduledAt: true } } },
    take: 5000,
  });
  return { business, rows, posts: targets.map((x) => ({ channel: x.channel, at: x.sentAt ?? x.post.scheduledAt })) };
}

// ---------- Lo que sale (el reporte) ----------

export type RankZoneSummary = {
  code: number;
  label: string;
  date: string;
  baseDate: string | null;
  /** El último reporte es de antes del periodo (no hubo revisiones en el periodo). */
  stale: boolean;
  keywords: number;
  avgPosition: Delta;
  inTop3: Delta;
  inTop10: Delta;
  visibility: Delta;
};

export type KeywordLine = {
  keyword: string;
  /** Búsquedas al mes (zona principal o la primera que lo tenga). */
  volume: number | null;
  /** Una celda por zona de `rank.zones` (mismo orden). before undefined = no hay con qué comparar. */
  cells: { now: number | null; before: number | null | undefined; error?: boolean; missing?: boolean }[];
};

export type RankSection = {
  zones: RankZoneSummary[];
  climbs: Mover[];
  drops: Mover[];
  keywords: KeywordLine[];
  /** De la zona principal: 1-3, 4-10, 11-20 y fuera de 20. */
  distribution: { top3: number; top10: number; top20: number; out: number };
};

export type MapCell = { rank: number | null; error: boolean };
export type MapsSection = {
  keyword: string;
  date: string;
  inPeriod: boolean;
  size: number;
  spacingKm: number;
  grid: MapCell[][];
  avgRank: number | null;
  top3Share: number;
  found: number;
  points: number;
  prev: { date: string; avgRank: number | null; top3Share: number } | null;
  competitors: { title: string; points: number; avgRank: number }[];
};

export type GbpSection = {
  date: string;
  profileScore: number | null;
  rating: number | null;
  totalReviews: number | null;
  newReviews: number | null;
  prevNewReviews: number | null;
  answeredPct: number | null;
  unanswered: number | null;
  reviewsDate: string | null;
};

export type AiSection = {
  date: string;
  prevDate: string | null;
  stale: boolean;
  score: Delta;
  providers: { id: string; name: string; score: Delta }[];
  questions: number;
};

export type AuditSection = {
  date: string;
  stale: boolean;
  score: Delta;
  pages: number;
  issues: { id: string; severity: Severity; count: number; title: Bi; fix: Bi }[];
};

export type OnPageSection = { date: string; avgScore: number | null; pages: number; ideas: { page: string; text: Bi }[] };

export type GscSection = {
  date: string;
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  prev: { clicks: number; impressions: number; ctr: number; position: number };
  queries: { query: string; clicks: number; impressions: number; position: number }[];
};

export type GapSection = {
  date: string;
  rows: { keyword: string; volume: number | null; difficulty: number | null; type: GapType; yourPosition: number | null; competitor: string; competitorPosition: number | null }[];
};

export type ReportData = {
  business: { id: string; name: string; website: string; color: string; color2: string; color3: string; logoUrl: string; fontHeading: string; aiText: string };
  period: ReportPeriod;
  generatedAt: Date;
  rank: RankSection | null;
  maps: MapsSection | null;
  gbp: GbpSection | null;
  ai: AiSection | null;
  audit: AuditSection | null;
  onpage: OnPageSection | null;
  gsc: GscSection | null;
  gap: GapSection | null;
  articles: { keyword: string; score: number; date: string }[];
  posts: { total: number; prevTotal: number; byChannel: { channel: string; count: number }[] };
};

type Dated<T> = { rep: T; at: Date };

/** Lee una lista de filas con su lector, del más nuevo al más viejo, sin las que no sirven. */
function parsed<T>(rows: RawRow[] | undefined, read: (json: unknown) => T | null): Dated<T>[] {
  return (rows ?? [])
    .map((r) => ({ rep: read(r.data), at: r.createdAt }))
    .filter((x): x is Dated<T> => x.rep !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

const atOrBefore = <T>(list: Dated<T>[], at: Date) => list.find((x) => x.at.getTime() <= at.getTime()) ?? null;

/**
 * Con qué se compara el último reporte: el último de antes de que empiece el periodo (cómo estabas al empezar);
 * si no hay, el más viejo del periodo. Solo reportes al menos 12 horas más viejos que el actual.
 * Si el actual ya es de antes del periodo, no hay cambio que mostrar (null).
 */
function baseFor<T>(list: Dated<T>[], cur: Dated<T>, period: ReportPeriod): Dated<T> | null {
  if (cur.at.getTime() < period.from.getTime()) return null;
  const older = list.filter((x) => x.at.getTime() <= cur.at.getTime() - 12 * 3600_000);
  return older.find((x) => x.at.getTime() <= period.from.getTime()) ?? older[older.length - 1] ?? null;
}

const iso = (d: Date) => d.toISOString();
const inRange = (at: Date, from: Date, to: Date) => at.getTime() >= from.getTime() && at.getTime() < to.getTime();
const MAX_KEYWORDS = 25;

function rankSection(inputs: ReportInputs, period: ReportPeriod): RankSection | null {
  const b = inputs.business;
  const zones: Zone[] = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const reports = parsed(inputs.rows.rank, readRankReport).map((x) => ({ ...x, rep: { ...x.rep, createdAt: iso(x.at) } }));
  const byZone = groupByZone(
    reports.map((x) => ({ ...x, locationCode: x.rep.locationCode })),
    zones,
  );
  const kwByZone = new Map<number, KeywordsReport>();
  for (const [code, list] of groupByZone(
    parsed(inputs.rows.keywords, readKeywordsReport).map((x) => ({ ...x.rep, at: x.at })),
    zones,
  )) {
    const k = list.find((r) => r.at.getTime() <= period.to.getTime());
    if (k) kwByZone.set(code, k);
  }

  const summaries: RankZoneSummary[] = [];
  const pairs: { label: string; cur: RankReport; prev: RankReport | null }[] = [];
  for (const zone of zones) {
    const list = byZone.get(zone.code) ?? [];
    const cur = atOrBefore(list, period.to);
    if (!cur || !cur.rep.rows.length) continue;
    const base = baseFor(list, cur, period);
    const label = zoneLabel(zone.name || cur.rep.location) || "—";
    pairs.push({ label, cur: cur.rep, prev: base?.rep ?? null });
    summaries.push({
      code: zone.code,
      label,
      date: iso(cur.at),
      baseDate: base ? iso(base.at) : null,
      stale: cur.at.getTime() < period.from.getTime(),
      keywords: cur.rep.rows.filter((r) => !r.error).length,
      avgPosition: compare(cur.rep.avgPosition, base?.rep.avgPosition, { lowerIsBetter: true }),
      inTop3: compare(cur.rep.inTop3, base?.rep.inTop3),
      inTop10: compare(cur.rep.inTop10, base?.rep.inTop10),
      visibility: compare(cur.rep.visibility, base?.rep.visibility, { epsilon: 0.5 }),
    });
  }
  if (!summaries.length) return null;

  const { climbs, drops } = weeklyMovers(pairs, 5);

  // Tabla de palabras: las que sigue el negocio (en su orden) y luego las que salen en los reportes.
  const tracked = readTrackedKeywords(b.seoKeywords);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const k of [...tracked, ...pairs.flatMap((p) => p.cur.rows.map((r) => r.keyword))]) {
    const key = k.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    order.push(k.trim());
  }
  const lookups = summaries.map((s) => reportLookup(kwByZone.get(s.code) ?? null));
  const keywords: KeywordLine[] = order
    .map((keyword) => {
      const key = keyword.toLowerCase();
      const cells = pairs.map((p) => {
        const now = p.cur.rows.find((r) => r.keyword.toLowerCase() === key);
        if (!now) return { now: null, before: undefined, missing: true };
        const before = p.prev?.rows.find((r) => r.keyword.toLowerCase() === key && !r.error);
        return { now: now.position, before: before ? before.position : undefined, ...(now.error ? { error: true } : {}) };
      });
      const volume = lookups.map((l) => l.get(key)?.volume ?? null).find((v) => v !== null) ?? null;
      return { keyword, volume, cells };
    })
    .filter((k) => k.cells.some((c) => !c.missing))
    .slice(0, MAX_KEYWORDS);

  const main = pairs[0].cur.rows.filter((r) => !r.error);
  const distribution = {
    top3: main.filter((r) => r.position !== null && r.position <= 3).length,
    top10: main.filter((r) => r.position !== null && r.position > 3 && r.position <= 10).length,
    top20: main.filter((r) => r.position !== null && r.position > 10).length,
    out: main.filter((r) => r.position === null).length,
  };
  return { zones: summaries, climbs, drops, keywords, distribution };
}

/** La cuadrícula del mapa, fila por fila (de norte a sur), con el lugar en cada punto. */
export function mapGrid(rep: Pick<MapReport, "points" | "size">): MapCell[][] {
  const size = Math.max(1, rep.size * rep.size === rep.points.length ? rep.size : Math.ceil(Math.sqrt(rep.points.length)));
  const grid: MapCell[][] = [];
  for (let i = 0; i < rep.points.length; i += size) grid.push(rep.points.slice(i, i + size).map((p) => ({ rank: p.rank, error: Boolean(p.error) })));
  return grid;
}

function mapsSection(inputs: ReportInputs, period: ReportPeriod): MapsSection | null {
  const list = parsed(inputs.rows.maprank, readMapReport).filter((x) => x.at.getTime() <= period.to.getTime());
  const cur = list.find((x) => inRange(x.at, period.from, period.to)) ?? list[0];
  if (!cur) return null;
  const key = cur.rep.keyword.toLowerCase();
  const prev = list.find((x) => x.at.getTime() < cur.at.getTime() && x.rep.keyword.toLowerCase() === key) ?? null;
  const checked = cur.rep.points.filter((p) => !p.error).length;
  return {
    keyword: cur.rep.keyword,
    date: iso(cur.at),
    inPeriod: inRange(cur.at, period.from, period.to),
    size: cur.rep.size,
    spacingKm: cur.rep.spacingKm,
    grid: mapGrid(cur.rep),
    avgRank: cur.rep.avgRank,
    top3Share: cur.rep.top3Share,
    found: cur.rep.found,
    points: checked,
    prev: prev ? { date: iso(prev.at), avgRank: prev.rep.avgRank, top3Share: prev.rep.top3Share } : null,
    competitors: cur.rep.competitors.slice(0, 3).map((c) => ({ title: c.title, points: c.points, avgRank: c.avgRank })),
  };
}

function gbpSection(inputs: ReportInputs, period: ReportPeriod): GbpSection | null {
  const reviews = atOrBefore(parsed(inputs.rows.reviews, readReviewsReport), period.to);
  const profile = atOrBefore(
    parsed(inputs.rows.gbp, (j) => readGbpReport(j, reviews?.rep.stats ?? null)),
    period.to,
  );
  const latest = profile ?? reviews;
  if (!latest) return null;
  const count = (from: Date, to: Date) => (reviews ? reviews.rep.reviews.filter((r) => r.timestamp && inRange(new Date(r.timestamp), from, to)).length : null);
  // Solo se cuentan las reseñas nuevas de un periodo si se trajeron después de que empezó (si no, no se sabe).
  const fetchedAfter = (at: Date) => Boolean(reviews && reviews.at.getTime() >= at.getTime());
  const stats = reviews?.rep.stats;
  return {
    date: iso(latest.at),
    profileScore: profile ? profile.rep.score : null,
    rating: reviews?.rep.rating ?? profile?.rep.profile.rating ?? stats?.average ?? null,
    totalReviews: reviews?.rep.total ?? profile?.rep.profile.reviews ?? null,
    newReviews: fetchedAfter(period.from) ? count(period.from, period.to) : null,
    prevNewReviews: fetchedAfter(new Date(period.prevTo.getTime() - DAY_MS)) ? count(period.prevFrom, period.prevTo) : null,
    answeredPct: stats?.answeredPct ?? null,
    unanswered: stats ? stats.unanswered : null,
    reviewsDate: reviews ? iso(reviews.at) : null,
  };
}

function aiSection(inputs: ReportInputs, period: ReportPeriod): AiSection | null {
  const list = parsed(inputs.rows.ai, readVisibilityReport);
  const cur = atOrBefore(list, period.to);
  if (!cur || (cur.rep.score === null && !Object.keys(cur.rep.byProvider).length)) return null;
  const base = baseFor(list, cur, period);
  const prov = (r: VisibilityReport | undefined, id: string) => r?.byProvider[id as keyof VisibilityReport["byProvider"]]?.score ?? null;
  return {
    date: iso(cur.at),
    prevDate: base ? iso(base.at) : null,
    stale: cur.at.getTime() < period.from.getTime(),
    score: compare(cur.rep.score, base?.rep.score, { epsilon: 0.5 }),
    providers: Object.entries(cur.rep.byProvider)
      .filter(([, s]) => s && s.score !== null)
      .map(([id]) => ({ id, name: AI_NAMES[id] ?? id, score: compare(prov(cur.rep, id), base ? prov(base.rep, id) : null, { epsilon: 0.5 }) })),
    questions: cur.rep.questions.length,
  };
}

function auditSection(inputs: ReportInputs, period: ReportPeriod): AuditSection | null {
  const list = parsed(inputs.rows.audit, readAuditReport);
  const cur = atOrBefore(list, period.to);
  if (!cur) return null;
  const base = baseFor(list, cur, period);
  return {
    date: iso(cur.at),
    stale: cur.at.getTime() < period.from.getTime(),
    score: compare(cur.rep.score, base?.rep.score, { epsilon: 0.5 }),
    pages: cur.rep.pages.length,
    issues: cur.rep.issues.slice(0, 3).map((i) => ({ id: i.id, severity: i.severity, count: i.count, title: { es: ISSUE_TEXT[i.id].es.title, en: ISSUE_TEXT[i.id].en.title }, fix: { es: ISSUE_TEXT[i.id].es.fix, en: ISSUE_TEXT[i.id].en.fix } })),
  };
}

function onpageSection(inputs: ReportInputs, period: ReportPeriod): OnPageSection | null {
  const cur = atOrBefore(parsed(inputs.rows.onpage, readOnPageReport), period.to);
  if (!cur) return null;
  const scored = cur.rep.pages.filter((p) => p.score !== null && !p.error && !p.skipped);
  if (!scored.length) return null;
  return {
    date: iso(cur.at),
    avgScore: Math.round(scored.reduce((s, p) => s + (p.score ?? 0), 0) / scored.length),
    pages: scored.length,
    ideas: topIdeas(scored, 3).map((x) => ({ page: x.title || pathOf(x.url), text: { es: x.idea.es, en: x.idea.en } })),
  };
}

function gscSection(inputs: ReportInputs, period: ReportPeriod): GscSection | null {
  const cur = atOrBefore(parsed(inputs.rows.gsc, asGscReport), period.to);
  if (!cur) return null;
  const g = cur.rep;
  return {
    date: iso(cur.at),
    start: g.range.start,
    end: g.range.end,
    prevStart: g.previousRange.start,
    prevEnd: g.previousRange.end,
    clicks: g.totals.clicks,
    impressions: g.totals.impressions,
    ctr: g.totals.ctr,
    position: g.totals.position,
    prev: { ...g.previous },
    queries: g.queries.slice(0, 5).map((q) => ({ query: q.key, clicks: q.clicks, impressions: q.impressions, position: q.position })),
  };
}

function gapSection(inputs: ReportInputs, period: ReportPeriod): GapSection | null {
  const cur = atOrBefore(parsed(inputs.rows.gap, readGapReport), period.to);
  if (!cur || !cur.rep.rows.length) return null;
  return {
    date: iso(cur.at),
    rows: [...cur.rep.rows]
      .sort((a, b) => b.opportunity - a.opportunity || (b.volume ?? -1) - (a.volume ?? -1))
      .slice(0, 5)
      .map((r) => ({
        keyword: r.keyword,
        volume: r.volume,
        difficulty: r.difficulty,
        type: r.type,
        yourPosition: r.yourPosition,
        competitor: r.competitors[0]?.domain ?? "",
        competitorPosition: r.competitors[0]?.position ?? null,
      })),
  };
}

/** Arma el reporte con lo leído (puro). */
export function buildReport(inputs: ReportInputs, period: ReportPeriod, now = new Date()): ReportData {
  const b = inputs.business;
  const articles = parsed(inputs.rows.article, readArticleReport)
    .filter((x) => inRange(x.at, period.from, period.to))
    .slice(0, 10)
    .map((x) => ({ keyword: x.rep.keyword, score: x.rep.score, date: iso(x.at) }));
  const counts = new Map<string, number>();
  let prevTotal = 0;
  for (const p of inputs.posts) {
    if (inRange(p.at, period.from, period.to)) counts.set(p.channel, (counts.get(p.channel) ?? 0) + 1);
    else if (inRange(p.at, period.prevFrom, period.prevTo)) prevTotal += 1;
  }
  const byChannel = [...counts.entries()].map(([channel, count]) => ({ channel, count })).sort((a, c) => c.count - a.count || a.channel.localeCompare(c.channel));
  return {
    business: { id: b.id, name: b.name, website: b.website, color: b.color, color2: b.color2, color3: b.color3, logoUrl: b.logoUrl, fontHeading: b.fontHeading, aiText: b.aiText },
    period,
    generatedAt: now,
    rank: rankSection(inputs, period),
    maps: mapsSection(inputs, period),
    gbp: gbpSection(inputs, period),
    ai: aiSection(inputs, period),
    audit: auditSection(inputs, period),
    onpage: onpageSection(inputs, period),
    gsc: gscSection(inputs, period),
    gap: gapSection(inputs, period),
    articles,
    posts: { total: byChannel.reduce((s, c) => s + c.count, 0), prevTotal, byChannel },
  };
}

/** Junta los datos del reporte de un negocio (solo lee lo guardado). `load` se cambia en las pruebas. */
export async function gatherReport(
  businessId: string,
  period: ReportPeriod,
  deps: { load?: (id: string, p: ReportPeriod) => Promise<ReportInputs>; now?: Date } = {},
): Promise<ReportData> {
  const inputs = await (deps.load ?? loadReportInputs)(businessId, period);
  return buildReport(inputs, period, deps.now ?? new Date());
}

/** ¿No hay nada que mostrar? (el PDF de una página que dice qué configurar) */
export function isEmptyReport(d: ReportData): boolean {
  return !d.rank && !d.maps && !d.gbp && !d.ai && !d.audit && !d.onpage && !d.gsc && !d.gap && !d.articles.length && !d.posts.total && !d.posts.prevTotal;
}

// ---------- Indicadores (KPIs) ----------

export type KpiId = "avgPosition" | "top10" | "mapTop3" | "rating" | "ai" | "posts";
export type Kpi = { id: KpiId; label: Bi; delta: Delta; format: "pos" | "int" | "pct" | "rating"; note?: Bi };

/** Los indicadores de arriba del reporte (solo los que tienen dato). */
export function reportKpis(d: ReportData): Kpi[] {
  const out: Kpi[] = [];
  const z = d.rank?.zones[0];
  const many = (d.rank?.zones.length ?? 0) > 1;
  if (z) {
    const where = many ? { es: z.label, en: z.label } : undefined;
    out.push({ id: "avgPosition", label: { es: "Posición promedio en Google", en: "Average Google position" }, delta: z.avgPosition, format: "pos", ...(where ? { note: where } : {}) });
    out.push({
      id: "top10",
      label: { es: "Palabras en el top 10", en: "Keywords in the top 10" },
      delta: z.inTop10,
      format: "int",
      note: { es: `de ${z.keywords}${many ? ` · ${z.label}` : ""}`, en: `of ${z.keywords}${many ? ` · ${z.label}` : ""}` },
    });
  }
  if (d.maps)
    out.push({
      id: "mapTop3",
      label: { es: "Google Maps: zona en el top 3", en: "Google Maps: area in the top 3" },
      delta: compare(d.maps.top3Share, d.maps.prev?.top3Share, { epsilon: 0.5 }),
      format: "pct",
      note: { es: `«${d.maps.keyword}»`, en: `"${d.maps.keyword}"` },
    });
  if (d.gbp && d.gbp.rating !== null)
    out.push({
      id: "rating",
      label: { es: "Calificación en Google", en: "Google rating" },
      delta: compare(d.gbp.rating, null),
      format: "rating",
      ...(d.gbp.newReviews !== null
        ? { note: { es: `${d.gbp.newReviews} reseña${d.gbp.newReviews === 1 ? "" : "s"} nueva${d.gbp.newReviews === 1 ? "" : "s"}`, en: `${d.gbp.newReviews} new review${d.gbp.newReviews === 1 ? "" : "s"}` } }
        : d.gbp.totalReviews !== null
          ? { note: { es: `${d.gbp.totalReviews} reseñas`, en: `${d.gbp.totalReviews} reviews` } }
          : {}),
    });
  if (d.ai && d.ai.score.now !== null) out.push({ id: "ai", label: { es: "Visibilidad en las IAs", en: "AI visibility" }, delta: d.ai.score, format: "pct" });
  if (d.posts.total || d.posts.prevTotal)
    out.push({ id: "posts", label: { es: "Publicaciones", en: "Posts published" }, delta: compare(d.posts.total, d.posts.prevTotal, { epsilon: 0.5 }), format: "int" });
  return out;
}

// ---------- Hechos, cambios y resumen ----------

export type Fact = { text: string; tone: Tone; area: string };

const numFmt = (lang: UiLang, digits = 1) => new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: digits });
const quote = (s: string, lang: UiLang) => (lang === "en" ? `"${s}"` : `«${s}»`);
const posText = (p: number | null, t: (es: string, en: string) => string) => (p === null ? t("fuera de los 20 primeros", "outside the top 20") : String(p));

/** Un cambio en palabras: "(antes 10,5; mejoró 2,3)" / "(before 10.5; up 2.3)". */
function changeText(d: Delta, lang: UiLang, opts: { lowerIsBetter?: boolean; unit?: string } = {}): string {
  const t = translator(lang);
  const nf = numFmt(lang);
  if (d.before === null || d.diff === null) return "";
  const u = opts.unit ?? "";
  if (d.tone === "neutral") return t(` (igual que antes: ${nf.format(d.before)}${u})`, ` (same as before: ${nf.format(d.before)}${u})`);
  const amount = nf.format(Math.abs(d.diff));
  return d.tone === "good"
    ? t(` (antes ${nf.format(d.before)}${u}; mejoró ${amount}${u})`, ` (before ${nf.format(d.before)}${u}; improved by ${amount}${u})`)
    : t(` (antes ${nf.format(d.before)}${u}; empeoró ${amount}${u})`, ` (before ${nf.format(d.before)}${u}; worse by ${amount}${u})`);
}

/** Datos cortos del reporte, en frases. Los usa la IA para escribir el resumen (y el resumen sin IA). */
export function summaryFacts(d: ReportData, lang: UiLang, tz = BUSINESS_TZ): Fact[] {
  const t = translator(lang);
  const nf = numFmt(lang);
  const int = numFmt(lang, 0);
  const out: Fact[] = [];
  const day = (s: string) => new Intl.DateTimeFormat(intlLocale(lang), { timeZone: tz, day: "numeric", month: "short" }).format(new Date(s));

  out.push({ area: "period", tone: "neutral", text: t(`Periodo del reporte: ${periodLabel(d.period, lang, tz)}.`, `Report period: ${periodLabel(d.period, lang, tz)}.`) });

  if (d.rank) {
    for (const z of d.rank.zones) {
      const avg = z.avgPosition.now === null ? t("no sale en los 20 primeros con ninguna palabra", "not in the top 20 for any keyword") : nf.format(z.avgPosition.now);
      out.push({
        area: "rank",
        tone: z.avgPosition.tone,
        text: t(
          `Google (${z.label}): posición promedio ${avg}${changeText(z.avgPosition, lang)}; ${z.inTop10.now ?? 0} de ${z.keywords} palabras clave en el top 10${changeText(z.inTop10, lang)}; ${z.inTop3.now ?? 0} en el top 3.`,
          `Google (${z.label}): average position ${avg}${changeText(z.avgPosition, lang)}; ${z.inTop10.now ?? 0} of ${z.keywords} keywords in the top 10${changeText(z.inTop10, lang)}; ${z.inTop3.now ?? 0} in the top 3.`,
        ),
      });
    }
    const where = (m: Mover) => (m.zone ? ` (${m.zone})` : "");
    for (const m of d.rank.climbs.slice(0, 3))
      out.push({ area: "rank", tone: "good", text: t(`Subió ${quote(m.keyword, lang)}${where(m)}: del lugar ${posText(m.from, t)} al ${posText(m.to, t)}.`, `${quote(m.keyword, lang)}${where(m)} climbed from #${posText(m.from, t)} to #${posText(m.to, t)}.`) });
    for (const m of d.rank.drops.slice(0, 3))
      out.push({ area: "rank", tone: "bad", text: t(`Bajó ${quote(m.keyword, lang)}${where(m)}: del lugar ${posText(m.from, t)} al ${posText(m.to, t)}.`, `${quote(m.keyword, lang)}${where(m)} dropped from #${posText(m.from, t)} to #${posText(m.to, t)}.`) });
  }

  if (d.maps) {
    const m = d.maps;
    const ch = compare(m.top3Share, m.prev?.top3Share, { epsilon: 0.5 });
    out.push({
      area: "maps",
      tone: ch.tone,
      text: t(
        `Mapa de calor de Google Maps para ${quote(m.keyword, lang)} (${day(m.date)}): sale en el top 3 en el ${m.top3Share} % de la zona${changeText(ch, lang, { unit: " %" })}; lugar promedio ${m.avgRank === null ? "—" : nf.format(m.avgRank)}.`,
        `Google Maps heatmap for ${quote(m.keyword, lang)} (${day(m.date)}): in the top 3 across ${m.top3Share}% of the area${changeText(ch, lang, { unit: "%" })}; average rank ${m.avgRank === null ? "—" : nf.format(m.avgRank)}.`,
      ),
    });
  }

  if (d.gbp) {
    const g = d.gbp;
    const parts: string[] = [];
    if (g.rating !== null) parts.push(t(`${nf.format(g.rating)} estrellas`, `${nf.format(g.rating)} stars`) + (g.totalReviews !== null ? t(` con ${int.format(g.totalReviews)} reseñas`, ` from ${int.format(g.totalReviews)} reviews`) : ""));
    if (g.newReviews !== null) parts.push(t(`${g.newReviews} ${g.newReviews === 1 ? "reseña nueva" : "reseñas nuevas"} en el periodo`, `${g.newReviews} new ${g.newReviews === 1 ? "review" : "reviews"} in the period`) + (g.prevNewReviews !== null ? t(` (antes ${g.prevNewReviews})`, ` (before ${g.prevNewReviews})`) : ""));
    if (g.answeredPct !== null) parts.push(t(`${g.answeredPct} % contestadas`, `${g.answeredPct}% answered`));
    if (g.unanswered) parts.push(t(`${g.unanswered} sin contestar`, `${g.unanswered} unanswered`));
    if (g.profileScore !== null) parts.push(t(`perfil completo al ${g.profileScore} %`, `profile ${g.profileScore}% complete`));
    if (parts.length)
      out.push({
        area: "gbp",
        tone: g.unanswered ? "bad" : g.newReviews ? "good" : "neutral",
        text: t(`Perfil de Google: ${parts.join("; ")}.`, `Google Business Profile: ${parts.join("; ")}.`),
      });
  }

  if (d.ai && d.ai.score.now !== null) {
    const prov = d.ai.providers.map((p) => `${p.name} ${p.score.now} %${p.score.before !== null && p.score.diff ? t(` (antes ${p.score.before} %)`, ` (before ${p.score.before}%)`) : ""}`).join(", ");
    out.push({
      area: "ai",
      tone: d.ai.score.tone,
      text: t(
        `Las IAs (ChatGPT, Gemini, Claude) mencionan al negocio en el ${d.ai.score.now} % de las respuestas${changeText(d.ai.score, lang, { unit: " %" })}${prov ? `: ${prov}` : ""}.`,
        `AI assistants (ChatGPT, Gemini, Claude) mention the business in ${d.ai.score.now}% of answers${changeText(d.ai.score, lang, { unit: "%" })}${prov ? `: ${prov.replace(/ %/g, "%")}` : ""}.`,
      ),
    });
  }

  if (d.audit) {
    const issues = d.audit.issues.map((i) => i.title[lang]).join("; ");
    out.push({
      area: "audit",
      tone: d.audit.score.tone,
      text: t(
        `Salud del sitio web: ${d.audit.score.now} de 100${changeText(d.audit.score, lang)}${issues ? `. Problemas principales: ${issues}` : ""}.`,
        `Website health: ${d.audit.score.now} out of 100${changeText(d.audit.score, lang)}${issues ? `. Main issues: ${issues}` : ""}.`,
      ),
    });
  }

  if (d.onpage)
    out.push({
      area: "onpage",
      tone: "neutral",
      text: t(
        `Revisión de páginas: puntaje promedio ${d.onpage.avgScore} de 100 en ${d.onpage.pages} páginas${d.onpage.ideas[0] ? `. Idea principal: ${d.onpage.ideas[0].text.es}` : ""}.`,
        `Page review: average score ${d.onpage.avgScore} out of 100 across ${d.onpage.pages} pages${d.onpage.ideas[0] ? `. Top idea: ${d.onpage.ideas[0].text.en}` : ""}.`,
      ),
    });

  if (d.gsc) {
    const g = d.gsc;
    const pc = (now: number, before: number) => {
      const p = pctChange(now, before);
      return p === null ? "" : ` (${p >= 0 ? "+" : ""}${p} %${t(" vs. el periodo anterior", " vs. the previous period")})`;
    };
    out.push({
      area: "gsc",
      tone: compare(g.clicks, g.prev.clicks).tone,
      text: t(
        `Search Console (${g.start} a ${g.end}): ${int.format(g.clicks)} clics${pc(g.clicks, g.prev.clicks)}, ${int.format(g.impressions)} veces en Google${pc(g.impressions, g.prev.impressions)}, CTR ${nf.format(g.ctr * 100)} %, posición promedio ${nf.format(g.position)}.`,
        `Search Console (${g.start} to ${g.end}): ${int.format(g.clicks)} clicks${pc(g.clicks, g.prev.clicks).replace(" %", "%")}, ${int.format(g.impressions)} impressions${pc(g.impressions, g.prev.impressions).replace(" %", "%")}, CTR ${nf.format(g.ctr * 100)}%, average position ${nf.format(g.position)}.`,
      ),
    });
  }

  if (d.gap?.rows.length) {
    const list = d.gap.rows
      .slice(0, 3)
      .map((r) => quote(r.keyword, lang) + (r.volume ? t(` (${int.format(r.volume)} búsquedas al mes)`, ` (${int.format(r.volume)} searches a month)`) : ""))
      .join(", ");
    out.push({ area: "gap", tone: "neutral", text: t(`Oportunidades donde la competencia sale y el negocio no (o sale más abajo): ${list}.`, `Opportunities where competitors rank and the business doesn't (or ranks lower): ${list}.`) });
  }

  if (d.articles.length)
    out.push({
      area: "articles",
      tone: "good",
      text: t(
        `Artículos escritos en el periodo: ${d.articles.length} (${d.articles.slice(0, 3).map((a) => `${quote(a.keyword, lang)}, puntaje ${a.score}`).join("; ")}).`,
        `Articles written in the period: ${d.articles.length} (${d.articles.slice(0, 3).map((a) => `${quote(a.keyword, lang)}, score ${a.score}`).join("; ")}).`,
      ),
    });

  if (d.posts.total || d.posts.prevTotal) {
    const ch = d.posts.byChannel.map((c) => `${channelLabel(c.channel, lang)} ${c.count}`).join(", ");
    out.push({
      area: "posts",
      tone: compare(d.posts.total, d.posts.prevTotal, { epsilon: 0.5 }).tone,
      text: t(
        `Publicaciones en redes y canales: ${d.posts.total} en el periodo (antes ${d.posts.prevTotal})${ch ? `: ${ch}` : ""}.`,
        `Posts published on social and other channels: ${d.posts.total} in the period (before ${d.posts.prevTotal})${ch ? `: ${ch}` : ""}.`,
      ),
    });
  }
  return out;
}

const CHANNEL_NAMES: Record<string, Bi> = {
  facebook: { es: "Facebook", en: "Facebook" },
  instagram: { es: "Instagram", en: "Instagram" },
  tiktok: { es: "TikTok", en: "TikTok" },
  google: { es: "Perfil de Google", en: "Google Profile" },
  seo: { es: "Sitio web", en: "Website" },
  email: { es: "Email", en: "Email" },
  sms: { es: "SMS", en: "SMS" },
};
/** Nombre corto del canal para el reporte. */
export const channelLabel = (id: string, lang: UiLang) => CHANNEL_NAMES[id]?.[lang] ?? id;

/** Lo que cambió en el periodo (bueno y malo), en frases cortas, lo más importante primero. */
export function whatChanged(d: ReportData, lang: UiLang): { tone: Tone; text: string }[] {
  const t = translator(lang);
  const nf = numFmt(lang);
  const out: { tone: Tone; text: string; weight: number }[] = [];
  for (const z of d.rank?.zones ?? []) {
    const where = (d.rank?.zones.length ?? 0) > 1 ? ` (${z.label})` : "";
    const a = z.avgPosition;
    if (a.diff !== null && a.tone !== "neutral" && a.before !== null && a.now !== null)
      out.push({
        tone: a.tone,
        weight: 5,
        text: a.tone === "good"
          ? t(`Tu posición promedio en Google mejoró del ${nf.format(a.before)} al ${nf.format(a.now)}${where}.`, `Your average Google position improved from ${nf.format(a.before)} to ${nf.format(a.now)}${where}.`)
          : t(`Tu posición promedio en Google bajó del ${nf.format(a.before)} al ${nf.format(a.now)}${where}.`, `Your average Google position slipped from ${nf.format(a.before)} to ${nf.format(a.now)}${where}.`),
      });
    const k = z.inTop10;
    if (k.diff && k.before !== null)
      out.push({
        tone: k.tone,
        weight: 4,
        text: t(`Palabras en la primera página de Google: de ${k.before} a ${k.now}${where}.`, `Keywords on Google's first page: from ${k.before} to ${k.now}${where}.`),
      });
  }
  const top = d.rank?.climbs[0];
  if (top) out.push({ tone: "good", weight: 3, text: t(`Lo que más subió: ${quote(top.keyword, lang)}, del ${posText(top.from, t)} al ${posText(top.to, t)}.`, `Biggest climb: ${quote(top.keyword, lang)}, from #${posText(top.from, t)} to #${posText(top.to, t)}.`) });
  const drop = d.rank?.drops[0];
  if (drop) out.push({ tone: "bad", weight: 3, text: t(`Lo que más bajó: ${quote(drop.keyword, lang)}, del ${posText(drop.from, t)} al ${posText(drop.to, t)}.`, `Biggest drop: ${quote(drop.keyword, lang)}, from #${posText(drop.from, t)} to #${posText(drop.to, t)}.`) });
  if (d.maps?.prev) {
    const c = compare(d.maps.top3Share, d.maps.prev.top3Share, { epsilon: 0.5 });
    if (c.tone !== "neutral")
      out.push({ tone: c.tone, weight: 4, text: t(`En Google Maps sales en el top 3 en el ${d.maps.top3Share} % de la zona (antes ${d.maps.prev.top3Share} %).`, `On Google Maps you're in the top 3 across ${d.maps.top3Share}% of the area (before ${d.maps.prev.top3Share}%).`) });
  }
  if (d.gbp?.newReviews)
    out.push({ tone: "good", weight: 3, text: d.gbp.newReviews === 1 ? t("Llegó 1 reseña nueva en Google.", "You got 1 new Google review.") : t(`Llegaron ${d.gbp.newReviews} reseñas nuevas en Google.`, `You got ${d.gbp.newReviews} new Google reviews.`) });
  if (d.gbp?.unanswered)
    out.push({ tone: "bad", weight: 2, text: d.gbp.unanswered === 1 ? t("Tienes 1 reseña sin contestar.", "You have 1 unanswered review.") : t(`Tienes ${d.gbp.unanswered} reseñas sin contestar.`, `You have ${d.gbp.unanswered} unanswered reviews.`) });
  if (d.ai && d.ai.score.tone !== "neutral" && d.ai.score.before !== null)
    out.push({ tone: d.ai.score.tone, weight: 3, text: t(`Las IAs te mencionan en el ${d.ai.score.now} % de las respuestas (antes ${d.ai.score.before} %).`, `AI assistants mention you in ${d.ai.score.now}% of answers (before ${d.ai.score.before}%).`) });
  if (d.audit && d.audit.score.tone !== "neutral" && d.audit.score.before !== null)
    out.push({ tone: d.audit.score.tone, weight: 2, text: t(`La salud de tu sitio pasó de ${d.audit.score.before} a ${d.audit.score.now} de 100.`, `Your website health went from ${d.audit.score.before} to ${d.audit.score.now} out of 100.`) });
  if (d.gsc) {
    const p = pctChange(d.gsc.clicks, d.gsc.prev.clicks);
    if (p !== null && Math.abs(p) >= 5)
      out.push({ tone: p > 0 ? "good" : "bad", weight: 3, text: t(`Clics desde Google: ${p > 0 ? "+" : ""}${p} % (de ${d.gsc.prev.clicks} a ${d.gsc.clicks}).`, `Clicks from Google: ${p > 0 ? "+" : ""}${p}% (from ${d.gsc.prev.clicks} to ${d.gsc.clicks}).`) });
  }
  if (d.posts.total !== d.posts.prevTotal)
    out.push({
      tone: d.posts.total > d.posts.prevTotal ? "good" : "bad",
      weight: 1,
      text: t(`Publicaste ${d.posts.total} veces (antes ${d.posts.prevTotal}).`, `You published ${d.posts.total} times (before ${d.posts.prevTotal}).`),
    });
  if (d.articles.length) out.push({ tone: "good", weight: 1, text: t(`Se escribieron ${d.articles.length} artículos nuevos para tu sitio.`, `${d.articles.length} new articles were written for your website.`) });
  return out.sort((a, b) => b.weight - a.weight).map(({ tone, text }) => ({ tone, text }));
}

/** Qué falta configurar para que el reporte tenga más datos (en el orden en que conviene hacerlo). */
export function setupHints(d: ReportData, lang: UiLang): string[] {
  const t = translator(lang);
  const out: string[] = [];
  if (!d.rank) out.push(t("Elige tus zonas y palabras clave en «Google: zonas y palabras clave» y revisa tus posiciones en Google.", "Pick your areas and keywords in \"Google: areas and keywords\" and check your Google rankings."));
  if (!d.maps) out.push(t("Haz tu primer mapa de calor de Google Maps para ver en qué partes de la zona sales.", "Run your first Google Maps heatmap to see where in your area you show up."));
  if (!d.gbp) out.push(t("Trae tu Perfil de Google y tus reseñas en «Tu perfil de Google».", "Load your Google Business Profile and reviews in \"Your Google Business Profile\"."));
  if (!d.audit) out.push(t("Revisa la salud de tu página web (auditoría del sitio).", "Check your website's health (site audit)."));
  if (!d.ai) out.push(t("Revisa si las IAs (ChatGPT, Gemini, Claude) te recomiendan.", "Check whether AI assistants (ChatGPT, Gemini, Claude) recommend you."));
  if (!d.gsc) out.push(t("Conecta Google Search Console para ver tus clics reales desde Google.", "Connect Google Search Console to see your real clicks from Google."));
  if (!d.posts.total) out.push(t("Programa publicaciones en tus redes desde la app.", "Schedule posts on your social channels from the app."));
  return out;
}

export type ReportSummary = { summary: string; steps: string[]; source: "ai" | "rules" };

/** Resumen sin IA: armado con los cambios y unos próximos pasos según lo que falta o bajó. */
export function ruleSummary(d: ReportData, lang: UiLang, tz = BUSINESS_TZ): ReportSummary {
  const t = translator(lang);
  const int = numFmt(lang, 0);
  const label = periodLabel(d.period, lang, tz);
  const changes = whatChanged(d, lang);
  const good = changes.filter((c) => c.tone === "good").slice(0, 2);
  const bad = changes.filter((c) => c.tone === "bad").slice(0, 2);
  const sentences: string[] = [t(`Este reporte resume cómo le fue a ${d.business.name} en Google, en las IAs y en sus redes en ${label}.`, `This report sums up how ${d.business.name} did on Google, in AI assistants and on social media in ${label}.`)];
  if (isEmptyReport(d)) {
    sentences.push(t("Todavía no hay datos guardados para este periodo, así que no hay cambios que comparar.", "There's no saved data for this period yet, so there are no changes to compare."));
    sentences.push(t("Abajo están los pasos para empezar a medir.", "Below are the steps to start measuring."));
  } else {
    const join = (list: { text: string }[]) => list.map((g, i) => (i ? g.text : lowerFirst(g.text))).join(" ");
    if (good.length) sentences.push(t("Lo bueno: ", "The good news: ") + join(good));
    if (bad.length) sentences.push(t("Para mirar: ", "Worth a look: ") + join(bad));
    if (!good.length && !bad.length) sentences.push(t("No hubo cambios grandes comparado con el periodo anterior.", "There were no big changes compared with the previous period."));
    const z = d.rank?.zones[0];
    if (z && z.inTop10.now !== null) sentences.push(t(`Hoy ${z.inTop10.now} de tus ${z.keywords} palabras clave salen en la primera página de Google.`, `Today ${z.inTop10.now} of your ${z.keywords} keywords show up on Google's first page.`));
    if (d.gbp?.rating !== null && d.gbp?.rating !== undefined)
      sentences.push(t(`Tu calificación en Google es de ${numFmt(lang).format(d.gbp.rating)} estrellas${d.gbp.totalReviews !== null ? ` con ${int.format(d.gbp.totalReviews)} reseñas` : ""}.`, `Your Google rating is ${numFmt(lang).format(d.gbp.rating)} stars${d.gbp.totalReviews !== null ? ` from ${int.format(d.gbp.totalReviews)} reviews` : ""}.`));
  }

  const steps: string[] = [];
  const add = (s: string | null | undefined) => {
    if (s && steps.length < 3 && !steps.includes(s)) steps.push(s);
  };
  // Sin datos: primero lo que hay que configurar.
  if (isEmptyReport(d)) for (const h of setupHints(d, lang)) add(h);
  if (d.gbp?.unanswered) add(
      d.gbp.unanswered === 1
        ? t("Contesta la reseña que está sin respuesta: en la app la IA te la escribe.", "Reply to the unanswered review: in the app the AI writes the reply for you.")
        : t(`Contesta las ${d.gbp.unanswered} reseñas sin respuesta: en la app la IA te escribe cada respuesta.`, `Reply to the ${d.gbp.unanswered} unanswered reviews: in the app the AI writes each reply for you.`),
    );
  if (d.rank?.drops[0]) add(t(`Revisa la página que debería salir con ${quote(d.rank.drops[0].keyword, lang)} y mejórala con «Revisar mis páginas».`, `Review the page that should rank for ${quote(d.rank.drops[0].keyword, lang)} and improve it with "Review my pages".`));
  if (d.gap?.rows[0]) add(t(`Escribe un artículo sobre ${quote(d.gap.rows[0].keyword, lang)} con el Escritor SEO: tu competencia ya sale con esa búsqueda.`, `Write an article about ${quote(d.gap.rows[0].keyword, lang)} with the SEO Writer: your competitors already rank for it.`));
  if (d.audit && (d.audit.score.now ?? 100) < 85 && d.audit.issues[0]) {
    const issue = d.audit.issues[0];
    add(cutWords(`${t("En tu sitio", "On your website")}, ${lowerFirst(issue.title[lang])}: ${issue.fix[lang]}`, 260));
  }
  if (d.onpage?.ideas[0]) add(d.onpage.ideas[0].text[lang]);
  if (d.maps && d.maps.top3Share < 50) add(t("Sube fotos y publica novedades en tu Perfil de Google cada semana para subir en el mapa.", "Upload photos and post updates on your Google Business Profile every week to climb on the map."));
  if (d.ai && (d.ai.score.now ?? 100) < 50) add(t("Pide reseñas y aparece en directorios de tu zona: es lo que leen las IAs antes de recomendar un negocio.", "Ask for reviews and get listed in local directories: that's what AI assistants read before recommending a business."));
  if (d.posts.total < 8) add(t("Publica al menos 2 veces por semana en tus redes y en tu Perfil de Google.", "Post at least twice a week on your social channels and your Google Business Profile."));
  for (const h of setupHints(d, lang)) add(h);
  add(t("Sigue publicando y revisa este reporte el próximo mes para ver el avance.", "Keep posting and check this report next month to see your progress."));
  return { summary: sentences.slice(0, 6).join(" "), steps, source: "rules" };
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
/** Corta un texto largo en la última palabra completa antes de `max`, con "…". */
const cutWords = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, s.lastIndexOf(" ", max - 1)).replace(/[,:;.]$/, "")}…`);

/**
 * ¿Todos los números del texto de la IA están en los datos? Así no se cuela un número inventado.
 * Se comparan solo los dígitos ("8,2" = "8.2", "1.200" = "1,200"); del 0 al 12 siempre se permiten (pasos, meses…).
 */
export function numbersGrounded(text: string, facts: string[]): boolean {
  const nums = (s: string) => (s.match(/\d(?:[\d.,  ]*\d)?/g) ?? []).map((x) => x.replace(/\D/g, "").replace(/^0+(?=\d)/, ""));
  const allowed = new Set(facts.flatMap(nums));
  return nums(text).every((n) => allowed.has(n) || (n.length <= 2 && Number(n) <= 12));
}

/**
 * El resumen del reporte: con IA si se pidió y hay clave (y solo si no inventó números); si no, el resumen sin IA.
 * `write` y `enabled` se cambian en las pruebas.
 */
export async function reportSummary(
  d: ReportData,
  lang: UiLang,
  opts: { ai: boolean; write?: typeof writeReportSummary; enabled?: () => boolean; tz?: string },
): Promise<ReportSummary> {
  const rules = ruleSummary(d, lang, opts.tz);
  if (!opts.ai || isEmptyReport(d) || !(opts.enabled ?? aiEnabled)()) return rules;
  const facts = summaryFacts(d, lang, opts.tz).map((f) => f.text);
  try {
    const r = await (opts.write ?? writeReportSummary)({ business: { name: d.business.name, website: d.business.website, aiText: d.business.aiText }, facts, lang });
    if (!numbersGrounded([r.summary, ...r.steps].join(" "), [...facts, d.business.name])) {
      console.warn("[reporte] la IA usó números que no están en los datos; se usa el resumen sin IA");
      return rules;
    }
    return { summary: r.summary, steps: r.steps.length >= 3 ? r.steps.slice(0, 3) : [...r.steps, ...rules.steps].slice(0, 3), source: "ai" };
  } catch (e) {
    console.warn("[reporte] no se pudo escribir el resumen con IA:", e instanceof Error ? e.message : e);
    return rules;
  }
}

// ---------- Email del reporte (puro) ----------

/** El email que lleva el PDF adjunto: 3-5 indicadores y el resumen corto. */
export function buildReportEmail(d: ReportData, lang: UiLang, summary: ReportSummary | null, opts?: EmailOpts): BuiltEmail {
  const t = translator(lang);
  const label = periodLabel(d.period, lang, opts?.tz);
  const kpis = reportKpis(d).slice(0, 5);
  const blocks: EmailBlock[] = [
    { kind: "p", text: t(`Te adjuntamos el reporte de SEO y marketing de ${d.business.name} de ${label} (PDF).`, `Attached is the SEO and marketing report for ${d.business.name} for ${label} (PDF).`) },
  ];
  if (kpis.length) {
    blocks.push({ kind: "h", text: t("Lo más importante", "The highlights") });
    blocks.push({ kind: "list", items: kpis.map((k) => ({ text: `${k.label[lang]}: ${kpiValue(k, lang)}${kpiChange(k, lang)}`, tone: k.delta.tone })) });
  }
  if (summary?.summary) {
    blocks.push({ kind: "h", text: t("Resumen", "Summary") });
    blocks.push({ kind: "p", text: summary.summary });
  }
  blocks.push({ kind: "p", muted: true, text: t("El reporte completo, con las tablas y el mapa de calor, está en el PDF adjunto.", "The full report, with the tables and the heatmap, is in the attached PDF.") });
  const subject = t(`Reporte de SEO de ${d.business.name} — ${label}`, `SEO report for ${d.business.name} — ${label}`);
  const title = t(`Reporte de SEO y marketing — ${label}`, `SEO and marketing report — ${label}`);
  return {
    subject,
    ...renderEmail({ id: d.business.id, name: d.business.name, color: d.business.color }, lang, title, blocks, {
      ...opts,
      anchor: "#reporte",
      offText: t(
        "Para dejar de recibir el reporte de cada mes: entra a SEO en la app, busca «Reporte en PDF» y quita la marca de «Mandarme el reporte cada mes».",
        "To stop the monthly report: open SEO in the app, find \"PDF report\" and uncheck \"Send me the report every month\".",
      ),
    }),
  };
}

/** El valor de un indicador como texto ("8,2", "44 %", "4,8 ★"). */
export function kpiValue(k: Kpi, lang: UiLang): string {
  const v = k.delta.now;
  if (v === null) return "—";
  const nf = numFmt(lang);
  if (k.format === "pct") return lang === "en" ? `${Math.round(v)}%` : `${Math.round(v)} %`;
  if (k.format === "rating") return `${nf.format(v)} ★`;
  if (k.format === "int") return numFmt(lang, 0).format(v);
  return nf.format(v);
}

/** " (+3 vs. antes)" o "". Para posiciones, positivo = subió (mejor). */
export function kpiChange(k: Kpi, lang: UiLang): string {
  const d = k.delta;
  if (d.diff === null || d.before === null) return "";
  if (d.diff === 0) return lang === "en" ? " (no change)" : " (sin cambio)";
  const shown = k.format === "pos" ? -d.diff : d.diff;
  const nf = numFmt(lang);
  const unit = k.format === "pct" ? (lang === "en" ? " pts" : " pts") : "";
  return lang === "en" ? ` (${shown > 0 ? "+" : ""}${nf.format(shown)}${unit} vs. before)` : ` (${shown > 0 ? "+" : ""}${nf.format(shown)}${unit} vs. antes)`;
}

/** Destinatarios del reporte (los mismos de los avisos). */
export const reportRecipients = (raw: string) => alertRecipients(raw);
