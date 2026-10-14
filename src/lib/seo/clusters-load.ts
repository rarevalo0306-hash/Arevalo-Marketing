// «Tus temas»: junta lo que Matya ya sabe del negocio (solo la base de datos) y agrupa las búsquedas por tema con la IA
// de textos (una llamada, sin DataForSEO). Si no hay IA o falla, agrupa por palabras en común. Lo puro está en clusters.ts.
import { z } from "zod";
import { aiEnabled, ask } from "@/lib/ai";
import { db } from "@/lib/db";
import { readAuditReport } from "@/lib/seo/audit";
import { applyAiGroups, buildClusters, type ClusterKeyword, type ClusterSource, type ClustersReport, ignoreStems, mergeKeywords, wordGroups } from "@/lib/seo/clusters";
import { readTrackedKeywords, readZones } from "@/lib/seo/dataforseo";
import { businessTopicVocab, gbpCategory, isRelevantKeyword, readGapReport } from "@/lib/seo/gap";
import { asGscReport } from "@/lib/seo/gsc";
import { readKeywordsReport } from "@/lib/seo/keywords";
import { readOnPageReport } from "@/lib/seo/onpage";
import { loadQuestions, siteTexts } from "@/lib/seo/questions";
import { readRankReport } from "@/lib/seo/rank";
import { latestReports } from "@/lib/seo/reports";
import { MAX_ARTICLES, readArticleReport, stems } from "@/lib/seo/writer";
import { readStudy, topKeywords } from "@/lib/study-shape";

const GroupsSchema = z.object({
  groups: z
    .array(
      z.object({
        nameEs: z.string().describe("Short topic name in Spanish with correct accents (2-5 words), e.g. 'Reparación de techos'"),
        nameEn: z.string().describe("The same topic name in English"),
        main: z.string().describe("The main search of the group, copied exactly from the list (usually the most searched one)"),
        kind: z.enum(["service", "area", "article"]).describe("service = a page that sells one service; area = a page for one city or area; article = a blog article that answers questions"),
        keywords: z.array(z.string()).describe("Searches of this group, copied exactly from the list"),
      }),
    )
    .describe("Between 3 and 15 groups. Every search goes in exactly one group."),
});

/** Todas las búsquedas que conoce la app para este negocio, sin repetir y solo las que tienen que ver con lo que vende. */
export async function loadClusterInput(businessId: string) {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, website: true, aiText: true, aiProfile: true, study: true, seoKeywords: true, seoLocations: true, seoLocationCode: true, seoLocationName: true },
  });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const [kwRows, [gapRow], [gscRow], rankRows, [auditRow], [onpageRow], [gbpRow], articleRows, questions] = await Promise.all([
    latestReports(businessId, "keywords", 5),
    latestReports(businessId, "gap", 1),
    latestReports(businessId, "gsc", 1),
    latestReports(businessId, "rank", Math.max(1, zones.length)),
    latestReports(businessId, "audit", 1),
    latestReports(businessId, "onpage", 1),
    latestReports(businessId, "gbp", 1),
    latestReports(businessId, "article", MAX_ARTICLES),
    loadQuestions(businessId).catch(() => null),
  ]);
  const list: (Partial<ClusterKeyword> & { keyword: string; source: ClusterSource })[] = [];
  for (const k of readTrackedKeywords(b.seoKeywords)) list.push({ keyword: k, source: "tracked" });
  for (const row of kwRows) {
    const r = readKeywordsReport(row.data);
    for (const k of [...(r?.keywords ?? []), ...(r?.ideas ?? [])]) list.push({ keyword: k.keyword, volume: k.volume, difficulty: k.difficulty ?? null, intent: k.intent ?? null, source: "keywords" });
  }
  const gap = gapRow ? readGapReport(gapRow.data) : null;
  for (const r of gap?.rows ?? []) list.push({ keyword: r.keyword, volume: r.volume, difficulty: r.difficulty, intent: r.intent, position: r.yourPosition, source: "gap" });
  const gsc = gscRow ? asGscReport(gscRow.data) : null;
  for (const q of gsc?.queries ?? []) list.push({ keyword: q.key, position: Math.round(q.position), source: "gsc" });
  const ranks = rankRows.map((r) => readRankReport(r.data)).filter((r) => r !== null);
  for (const r of ranks) for (const row of r.rows) if (!row.error) list.push({ keyword: row.keyword, position: row.position, source: "rank" });
  for (const g of questions?.groups ?? []) for (const q of g.questions.slice(0, 3)) if (!q.answered) list.push({ keyword: q.topic || q.question, source: "question" });
  const study = readStudy(b.study);
  for (const k of study ? topKeywords(study, 10) : []) list.push({ keyword: k, source: "study" });

  const vocab = businessTopicVocab({ ...b, category: gbpRow ? gbpCategory(gbpRow.data) : null });
  const keywords = mergeKeywords(list.filter((x) => x.source === "tracked" || isRelevantKeyword(x.keyword, vocab)));
  const places = zones.flatMap((z) => z.name.split(","));
  const audit = auditRow ? readAuditReport(auditRow.data) : null;
  const onpage = onpageRow ? readOnPageReport(onpageRow.data) : null;
  const pages = siteTexts({ audit, onpage, rank: ranks, domain: b.website }).map((p) => ({ url: p.url ?? "", label: p.label, text: p.text })).filter((p) => p.url);
  const articles = articleRows.flatMap((r) => {
    const a = readArticleReport(r.data);
    return a ? [a.draft.title || a.keyword] : [];
  });
  return { business: b, keywords, places, pages, articles };
}

/** Agrupa las búsquedas por tema. Con IA si hay; si no, por palabras. */
export async function runClusters(businessId: string): Promise<ClustersReport | null> {
  const input = await loadClusterInput(businessId);
  if (!input || input.keywords.length < 3) return null;
  const { business: b, keywords, places, pages, articles } = input;
  const ignore = ignoreStems(places, b.name);
  const placeStems = new Set(places.flatMap((p) => stems(p)));
  let groups: Parameters<typeof buildClusters>[0] | null = null;
  let by: ClustersReport["by"] = "words";
  if (aiEnabled()) {
    try {
      const system =
        "You are an SEO strategist for a small local business. Group the given Google searches into topics so that EACH TOPIC BECOMES ONE PAGE of the website " +
        "(one service page, one city/area page, or one blog article). Put searches with the same meaning and the same intent together (synonyms, plurals, Spanish and English versions of the same thing, the same service in the same city). " +
        "Do not mix a service with a different service. Copy every search exactly as written. Use every search once.";
      const user =
        `Business: ${b.name}\nWhat it does: ${(b.aiProfile || "").slice(0, 600)}\nAreas: ${places.join(", ") || "unknown"}\n\nSearches (monthly volume in brackets):\n` +
        keywords.map((k) => `- ${k.keyword}${k.volume != null ? ` [${k.volume}]` : ""}`).join("\n");
      const out = await ask(b.aiText, GroupsSchema, system, user, 8000);
      groups = applyAiGroups(keywords, out.groups, ignore).groups;
      by = "ai";
    } catch (e) {
      console.error("[temas] la IA no pudo agrupar; se agrupa por palabras:", e instanceof Error ? e.message : e);
    }
  }
  if (!groups) groups = wordGroups(keywords, ignore).map((items) => ({ name: { es: items[0].keyword, en: items[0].keyword }, main: items[0].keyword, kind: null, items }));
  return { clusters: buildClusters(groups, { pages, articles, places: placeStems }), total: keywords.length, by, createdAt: new Date().toISOString() };
}
