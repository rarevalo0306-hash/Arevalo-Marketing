// «Enlaces dañinos»: lee de la base de datos lo que necesita la página /b/<id>/enlaces y las acciones
// (src/app/actions-toxic.ts). Lo puro (clasificar, ataque, archivo para Google) está en src/lib/toxic-links.ts.
import { db } from "@/lib/db";
import type { UiLang } from "@/lib/i18n";
import { BACKLINKS_LOCKED_KIND, readBacklinksReport } from "@/lib/seo/backlinks";
import { normalizeDomain } from "@/lib/seo/competitors";
import { businessTopicVocab, gbpCategory } from "@/lib/seo/gap";
import { GSC_CHANNEL } from "@/lib/seo/gsc";
import { latestReports } from "@/lib/seo/reports";
import {
  baselineFromBacklinks,
  classifyAll,
  countLevels,
  detectSpike,
  mergeLinkLists,
  readDecision,
  readDisavowRecord,
  readSettings,
  readToxicAudit,
  TOXIC_KIND,
  type Classified,
  type DecisionRecord,
  type DisavowRecord,
  type RiskLevel,
  type Spike,
  type ToxicAudit,
  type ToxicCtx,
} from "@/lib/toxic-links";

/** Filas guardadas de kind "toxic" que se leen (revisiones, decisiones, archivos y ajustes). */
const ROWS_TAKE = 80;

export type ToxicState = {
  business: { id: string; name: string; color: string; website: string };
  ctx: ToxicCtx;
  latestFetch: (ToxicAudit & { id: string }) | null;
  previousFetch: (ToxicAudit & { id: string }) | null;
  latestImport: (ToxicAudit & { id: string }) | null;
  decision: DecisionRecord | null;
  disavows: DisavowRecord[];
  ownSites: string[];
  rows: Classified[];
  counts: Record<RiskLevel, number>;
  spike: Spike;
  /** Sitios que te enlazan (el total de DataForSEO o, si no hay, los de la lista). */
  totalDomains: number;
  /** Sitios nuevos este mes (DataForSEO o por fecha). */
  newThisMonth: number;
  /** La cuenta de DataForSEO no tiene acceso a Backlinks API (marca guardada por la revisión de enlaces). */
  locked: boolean;
  gscConnected: boolean;
};

/** Todo lo de la página, ya clasificado. null si el negocio no existe. */
export async function loadToxicState(businessId: string, now = new Date()): Promise<ToxicState | null> {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, color: true, website: true, seoKeywords: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, study: true, seoLanguage: true },
  });
  if (!b) return null;
  const [rows, backlinks, gbp, locked, gsc] = await Promise.all([
    db.seoReport.findMany({ where: { businessId, kind: TOXIC_KIND }, orderBy: { createdAt: "desc" }, take: ROWS_TAKE }),
    latestReports(businessId, "backlinks"),
    latestReports(businessId, "gbp"),
    db.seoReport.findFirst({ where: { businessId, kind: BACKLINKS_LOCKED_KIND }, select: { id: true } }),
    db.connection.findUnique({ where: { businessId_channel: { businessId, channel: GSC_CHANNEL } }, select: { id: true } }),
  ]);

  const fetches: (ToxicAudit & { id: string })[] = [];
  let latestImport: (ToxicAudit & { id: string }) | null = null;
  let decision: DecisionRecord | null = null;
  let ownSites: string[] | null = null;
  const disavows: DisavowRecord[] = [];
  for (const r of rows) {
    const audit = readToxicAudit(r.data);
    if (audit) {
      const withId = { ...audit, id: r.id, createdAt: audit.createdAt || r.createdAt.toISOString() };
      if (audit.source === "dataforseo") fetches.push(withId);
      else latestImport ??= withId;
      continue;
    }
    const d = readDecision(r.data);
    if (d) {
      decision ??= { ...d, createdAt: d.createdAt || r.createdAt.toISOString() };
      continue;
    }
    const f = readDisavowRecord(r.data);
    if (f) {
      disavows.push({ ...f, createdAt: f.createdAt || r.createdAt.toISOString() });
      continue;
    }
    const s = readSettings(r.data);
    if (s && ownSites === null) ownSites = s.ownSites;
  }

  const ctx: ToxicCtx = {
    site: b.website,
    ownSites: ownSites ?? [],
    name: b.name,
    vocab: businessTopicVocab({ ...b, category: gbp[0] ? gbpCategory(gbp[0].data) : null }),
    language: b.seoLanguage || "es",
  };
  const latestFetch = fetches[0] ?? null;
  const previousFetch = fetches[1] ?? null;
  const merged = mergeLinkLists(latestFetch?.items ?? [], latestImport?.items ?? []);
  const classified = classifyAll(merged.items, ctx, { now, previous: previousFetch ? previousFetch.items.map((i) => i.domain) : null, sources: merged.sources });
  const blReport = backlinks[0] ? readBacklinksReport(backlinks[0].data) : null;
  const spike = detectSpike({ rows: classified, baselineMonthly: baselineFromBacklinks(blReport?.summary), newThisMonth: latestFetch?.newThisMonth ?? null });
  const own = normalizeDomain(b.website);
  return {
    business: { id: b.id, name: b.name, color: b.color, website: b.website },
    ctx,
    latestFetch,
    previousFetch,
    latestImport,
    decision,
    disavows,
    ownSites: ownSites ?? [],
    rows: classified.filter((r) => !own || r.domain !== own),
    counts: countLevels(classified),
    spike,
    totalDomains: Math.max(latestFetch?.total ?? 0, blReport?.summary.referringDomains ?? 0, classified.length),
    newThisMonth: Math.max(latestFetch?.newThisMonth ?? 0, classified.filter((r) => r.isNew).length),
    locked: !!locked && !latestFetch,
    gscConnected: !!gsc,
  };
}

/** Una fila para el navegador (textos en el idioma de la página, sin datos de más). */
export type ToxicRow = {
  domain: string;
  level: RiskLevel;
  points: number;
  reasons: { tone: "bad" | "good" | "info"; text: string }[];
  spamScore: number | null;
  toolScore: number | null;
  rank: number | null;
  backlinks: number | null;
  firstSeen: string | null;
  anchors: string[];
  url: string | null;
  dofollow: boolean | null;
  isNew: boolean;
  safe: boolean;
  fromImport: boolean;
};

export function toRow(r: Classified, lang: UiLang): ToxicRow {
  return {
    domain: r.domain,
    level: r.level,
    points: r.points,
    reasons: r.reasons.map((x) => ({ tone: x.tone, text: lang === "en" ? x.text.en : x.text.es })),
    spamScore: r.spamScore,
    toolScore: r.toolScore,
    rank: r.rank,
    backlinks: r.backlinks,
    firstSeen: r.firstSeen,
    anchors: r.anchors.slice(0, 3),
    url: r.url,
    dofollow: r.dofollow,
    isNew: r.isNew,
    safe: !!r.safe,
    fromImport: r.sources.includes("import"),
  };
}
