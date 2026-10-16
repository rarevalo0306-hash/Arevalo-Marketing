// Un resumen corto, en una línea, de cada tipo de reporte de SEO guardado que el digest no desglosa (todo menos rank y gap).
// Puro: cada uno usa el lector tipado que ya existe en src/lib/seo, que no confía en la forma de lo guardado. Si el reporte
// no se puede leer, o no tiene nada que decir, devuelve null y el digest lo salta.
import { readGa4Report } from "@/lib/ga4-shape";
import { readAuditReport } from "@/lib/seo/audit";
import { readClustersReport } from "@/lib/seo/clusters";
import { readCompetitorsReport } from "@/lib/seo/competitors";
import { asGscReport } from "@/lib/seo/gsc";
import { readKeywordsReport, type KwRow } from "@/lib/seo/keywords";
import { readOnPageReport } from "@/lib/seo/onpage";
import type { SeoKind } from "@/lib/seo/reports";
import { oneLine } from "./bounded-context";

/** Longest summary, in characters. */
export const SUMMARY_MAX = 400;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
const text = (v: unknown, max: number) => oneLine(v, max);
/** "a (320), b (200)": a name with its number, when there is one. */
const listOf = (rows: { name: string; n?: number | null }[], total = 3) =>
  rows
    .filter((r) => r.name)
    .slice(0, total)
    .map((r) => (r.n === null || r.n === undefined ? r.name : `${r.name} (${r.n})`))
    .join(", ");
const byDesc = <T,>(rows: T[], key: (r: T) => number | null) =>
  [...rows].sort((a, b) => (key(b) ?? -Infinity) - (key(a) ?? -Infinity));

const kwList = (rows: KwRow[]) =>
  listOf(
    byDesc(rows, (k) => num(k.volume)).map((k) => ({ name: text(k.keyword, 50), n: num(k.volume) })),
  );

const SEVERITY_RANK: Record<string, number> = { error: 3, warning: 2, notice: 1 };

type Summary = (data: unknown) => string | null;

/** The kinds that have a one-line summary. */
export const SUMMARIES: Partial<Record<SeoKind, Summary>> = {
  keywords(data) {
    const r = readKeywordsReport(data);
    if (!r || (!r.keywords.length && !r.ideas.length)) return null;
    return [
      `Keywords measured: ${r.keywords.length}. Most searched a month: ${kwList(r.keywords) || "none"}.`,
      r.ideas.length ? `New ideas: ${kwList(r.ideas)}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  },

  competitors(data) {
    const r = readCompetitorsReport(data);
    if (!r || (!r.competitors.length && !r.gap.length)) return null;
    const rivals = listOf(
      byDesc(r.competitors, (c) => num(c.traffic)).map((c) => ({ name: text(c.domain, 50), n: num(c.traffic) })),
    );
    const wins = byDesc(r.gap, (g) => num(g.volume))
      .slice(0, 3)
      .map((g) => `${text(g.keyword, 50)} (${text(g.bestCompetitor, 40)} #${num(g.competitorPosition) ?? "?"})`)
      .join(", ");
    return [
      rivals ? `Competitors (estimated visits a month): ${rivals}.` : "",
      wins ? `Searches they win and the business does not: ${wins}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  },

  audit(data) {
    const r = readAuditReport(data);
    const score = r ? num(r.score) : null;
    if (!r || score === null) return null;
    const worst = [...r.issues]
      .filter((i) => (num(i.count) ?? 0) > 0)
      .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || (num(b.count) ?? 0) - (num(a.count) ?? 0))
      .slice(0, 4)
      .map((i) => `${text(i.id, 40)} ${text(i.severity, 10)} (${num(i.count)})`)
      .join(", ");
    return `Website audit: score ${score}/100 over ${r.pages.length} pages. ${worst ? `Main problems: ${worst}.` : "No problems found."}`;
  },

  onpage(data) {
    const r = readOnPageReport(data);
    if (!r || !r.pages.length) return null;
    const scored = r.pages.filter((p) => num(p.score) !== null);
    const lowest = [...scored]
      .sort((a, b) => (num(a.score) ?? 0) - (num(b.score) ?? 0))
      .slice(0, 3)
      .map((p) => `${text(p.url, 70)} ${num(p.score)}/100${p.keyword ? ` for "${text(p.keyword, 40)}"` : ""}`)
      .join(", ");
    return `Page review: ${r.pages.length} pages, ${scored.length} scored.${lowest ? ` Lowest: ${lowest}.` : ""}`;
  },

  gsc(data) {
    const r = asGscReport(data);
    // The reader accepts anything with a `totals` key; a real report has its dates.
    if (!r || !r.range.start || !r.range.end) return null;
    const near = r.opportunities
      .slice(0, 3)
      .map((q) => `${text(q.key, 50)} (#${num(q.position)}, ${num(q.impressions)} impressions)`)
      .join(", ");
    return (
      `Search Console ${text(r.range.start, 10)} to ${text(r.range.end, 10)}: ${num(r.totals.clicks)} clicks and ${num(r.totals.impressions)} impressions ` +
      `(before: ${num(r.previous.clicks)} and ${num(r.previous.impressions)}).` +
      (near ? ` Almost on page 1: ${near}.` : "")
    );
  },

  ga4(data) {
    const r = readGa4Report(data);
    if (!r || !r.range.start || !r.range.end) return null;
    const channels = listOf(r.channels.map((c) => ({ name: text(c.key, 30), n: num(c.sessions) })));
    const pages = listOf(r.landingPages.map((p) => ({ name: text(p.key, 60), n: num(p.sessions) })), 2);
    return (
      `Analytics ${text(r.range.start, 10)} to ${text(r.range.end, 10)}: ${num(r.totals.sessions)} sessions (before: ${num(r.previous.sessions)}), ${num(r.totals.keyEvents)} key events.` +
      (channels ? ` Channels: ${channels}.` : "") +
      (pages ? ` Top landing pages: ${pages}.` : "")
    );
  },

  clusters(data) {
    const r = readClustersReport(data);
    if (!r || !r.clusters.length) return null;
    const top = listOf(
      byDesc(r.clusters, (c) => num(c.volume)).map((c) => ({ name: text(c.main, 50), n: num(c.volume) })),
      4,
    );
    return `Topics: ${r.clusters.length} groups of searches. Biggest by monthly searches: ${top}.`;
  },
};

/** The one-line summary of a saved report (at most `SUMMARY_MAX` characters), or null when it cannot be read or says nothing. Never throws. */
export function summarize(kind: SeoKind, data: unknown): string | null {
  try {
    const f = SUMMARIES[kind];
    const s = f ? f(data) : null;
    return s ? oneLine(s, SUMMARY_MAX) || null : null;
  } catch {
    return null;
  }
}
