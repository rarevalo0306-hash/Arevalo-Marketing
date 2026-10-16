// Resumen puro de los reportes de SEO que ya están guardados: lo que el agente SEO le muestra a la IA como datos.
// No mide nada, no toca la base de datos y no lanza error por un reporte dañado (se ignora).
import { rankAlerts } from "@/lib/seo/alerts";
import { readGapReport } from "@/lib/seo/gap";
import { rankQuestions } from "@/lib/seo/questions";
import { readRankReport, type RankReport } from "@/lib/seo/rank";
import type { SeoKind } from "@/lib/seo/reports";
import { oneLine as clean } from "./bounded-context";
import { SUMMARIES, SUMMARY_MAX, summarize } from "./seo-summaries";

/**
 * One fact taken from a saved report.
 * - `kind`: `drop` (fell in Google), `rank` (searches where the business is outside the top 3), `question` (people also
 *   ask), `gap` (search a competitor wins and the business does not), or the kind of any other saved report that has a
 *   summary (`keywords`, `competitors`, `audit`, `onpage`, `gsc`, `ga4`, `clusters`): one item per report.
 * - `source`: `"<report kind>@<reportAt>"`, the only ids the research step accepts as evidence.
 * - `stale`: the report is older than its cycle (`staleDays`); a kind without a cycle is never stale.
 */
export type SeoDigestItem = {
  kind: string;
  detail: string;
  source: string;
  reportAt: string;
  stale: boolean;
};

/**
 * How many items each part may add, so the whole digest stays small enough to send to the model: at most
 * 6 + 6 + 8 + 8 from rank and gap, and `perKind` reports of each of the other kinds (7 kinds, so 14 more).
 */
export const DIGEST_LIMITS = { drops: 6, rank: 6, questions: 8, gap: 8, perKind: 2 } as const;
/** The most items `seoDigest` can return. */
export const DIGEST_TOTAL =
  DIGEST_LIMITS.drops + DIGEST_LIMITS.rank + DIGEST_LIMITS.questions + DIGEST_LIMITS.gap +
  Object.keys(SUMMARIES).length * DIGEST_LIMITS.perKind;

const DAY_MS = 86_400_000;
const DETAIL_MAX = 300;

type Saved = { kind: SeoKind; createdAt: Date; data: unknown };
type Stamp = { source: string; reportAt: string; stale: boolean };

const place = (p: number | null): string => (p === null ? "outside the top 20" : `#${p}`);

const validDate = (d: unknown): d is Date => d instanceof Date && Number.isFinite(d.getTime());

/** Stamps every item of one report. Null when the report has no usable date. */
function stampOf(
  r: Saved,
  now: Date,
  staleDays: Partial<Record<SeoKind, number>>,
): Stamp | null {
  if (!validDate(r.createdAt)) return null;
  const reportAt = r.createdAt.toISOString();
  const days = staleDays[r.kind];
  const stale =
    typeof days === "number" && Number.isFinite(days) && days >= 0
      ? now.getTime() - r.createdAt.getTime() > days * DAY_MS
      : false;
  return { source: `${r.kind}@${reportAt}`, reportAt, stale };
}

const byNewest = (a: { at: number }, b: { at: number }) => b.at - a.at;

type RankRead = { report: RankReport; at: number; stamp: Stamp };

/**
 * What the saved SEO reports say, as short facts the model can cite.
 * - `rank`: the newest valid check of each zone gives the searches where the business is outside the top 3 (nearest
 *   first), the questions Google shows (`question`) and, against the check before it, the searches that fell
 *   (`drop`, from `rankAlerts`). Items of a `drop` cite the newer check.
 * - `gap`: the newest valid report gives the best opportunities first.
 * - `keywords`, `competitors`, `audit`, `onpage`, `gsc`, `ga4`, `clusters`: the newest `perKind` reports of each give one
 *   item each (a one-line summary from `seoSummaries`), newest first.
 * - Any other kind, an unreadable report, one with nothing to say or one without a valid date is skipped; this never throws.
 * Order: drops, rank, questions, gap, then the other kinds in the order of `SUMMARIES`.
 */
export function seoDigest(
  reports: Saved[],
  now: Date,
  staleDays: Partial<Record<SeoKind, number>>,
): SeoDigestItem[] {
  const out = { drop: [], rank: [], question: [], gap: [], other: [] } as Record<
    "drop" | "rank" | "question" | "gap" | "other",
    SeoDigestItem[]
  >;
  const item = (kind: string, detail: string, s: Stamp, max = DETAIL_MAX): SeoDigestItem => ({
    kind,
    detail: clean(detail, max),
    source: s.source,
    reportAt: s.reportAt,
    stale: s.stale,
  });

  // Rank checks, grouped by zone (and device): the newest is the current one, the next one is what to compare with.
  const zones = new Map<string, RankRead[]>();
  const gaps: { at: number; stamp: Stamp; data: unknown }[] = [];
  const others = new Map<string, { at: number; stamp: Stamp; data: unknown }[]>();
  for (const r of Array.isArray(reports) ? reports : []) {
    try {
      if (!r || !(r.kind === "rank" || r.kind === "gap" || Object.hasOwn(SUMMARIES, r.kind))) continue;
      const stamp = stampOf(r, now, staleDays);
      if (!stamp) continue;
      const at = r.createdAt.getTime();
      if (r.kind === "gap") {
        gaps.push({ at, stamp, data: r.data });
        continue;
      }
      if (r.kind !== "rank") {
        others.set(r.kind, [...(others.get(r.kind) ?? []), { at, stamp, data: r.data }]);
        continue;
      }
      const report = readRankReport(r.data);
      if (!report) continue;
      const key = `${report.location}|${report.locationCode}|${report.device}`;
      zones.set(key, [...(zones.get(key) ?? []), { report, at, stamp }]);
    } catch {
      // A damaged report is skipped.
    }
  }

  const questions = new Set<string>();
  const groups = [...zones.values()]
    .map((list) => list.sort(byNewest))
    .sort((a, b) => byNewest(a[0], b[0]));
  for (const [cur, prev] of groups) {
    const where = cur.report.location ? ` (${clean(cur.report.location, 60)})` : "";
    try {
      if (prev && out.drop.length < DIGEST_LIMITS.drops)
        for (const a of rankAlerts(prev.report, cur.report).bad) {
          if (out.drop.length >= DIGEST_LIMITS.drops) break;
          if ((a.kind !== "drop" && a.kind !== "page1-exit") || a.from === null) continue;
          out.drop.push(
            item("drop", `"${clean(a.keyword, 80)}" fell from #${a.from} to ${place(a.to)} on Google${where}.`, cur.stamp),
          );
        }
      // Nearest to the top first; the ones that do not show up at all after.
      const below = cur.report.rows
        .filter((r) => !r.error && (r.position === null || r.position > 3))
        .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
      for (const r of below) {
        if (out.rank.length >= DIGEST_LIMITS.rank) break;
        out.rank.push(
          item(
            "rank",
            r.position === null
              ? `"${clean(r.keyword, 80)}": the business does not show up in the top 20 on Google${where}.`
              : `"${clean(r.keyword, 80)}": the business is at #${r.position} on Google, outside the top 3${where}.`,
            cur.stamp,
          ),
        );
      }
      for (const q of rankQuestions([cur.report])) {
        const text = clean(q.question, 150);
        const id = text.toLowerCase();
        if (!text || questions.has(id) || out.question.length >= DIGEST_LIMITS.questions) continue;
        questions.add(id);
        out.question.push(
          item("question", `People also ask: "${text}" (when searching "${clean(q.keyword, 80)}").`, cur.stamp),
        );
      }
    } catch {
      // A report that cannot be summarised is skipped.
    }
  }

  // The newest gap report that can be read.
  for (const g of gaps.sort(byNewest)) {
    try {
      const report = readGapReport(g.data);
      if (!report) continue;
      const rows = [...report.rows].sort(
        (a, b) => b.opportunity - a.opportunity || (b.volume ?? -1) - (a.volume ?? -1) || a.keyword.localeCompare(b.keyword),
      );
      for (const r of rows.slice(0, DIGEST_LIMITS.gap)) {
        const best = [...r.competitors].sort((a, b) => a.position - b.position)[0];
        out.gap.push(
          item(
            "gap",
            `"${clean(r.keyword, 80)}": ${r.volume === null ? "unknown volume" : `${r.volume} searches a month`}` +
              `${r.difficulty === null ? "" : `, difficulty ${r.difficulty}/100`}; ` +
              `${best ? `${clean(best.domain, 60)} is at #${best.position}` : "competitors rank"}, ` +
              `${r.yourPosition === null ? "the business does not rank" : `the business is at #${r.yourPosition}`}.`,
            g.stamp,
          ),
        );
      }
      break;
    } catch {
      // Try the next one.
    }
  }

  // The other kinds: one summary per report, the newest reports of each kind (a report with nothing to say does not count).
  for (const kind of Object.keys(SUMMARIES) as SeoKind[]) {
    let kept = 0;
    for (const o of (others.get(kind) ?? []).sort(byNewest)) {
      if (kept >= DIGEST_LIMITS.perKind) break;
      const detail = summarize(kind, o.data);
      if (!detail) continue;
      kept += 1;
      out.other.push(item(kind, detail, o.stamp, SUMMARY_MAX));
    }
  }

  return [...out.drop, ...out.rank, ...out.question, ...out.gap, ...out.other];
}
