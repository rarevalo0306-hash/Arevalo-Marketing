// Carga lo que Matya ya sabe del negocio para «Que la IA elija el tema» (solo la base de datos: no gasta nada).
import { db } from "@/lib/db";
import { readAuditReport } from "@/lib/seo/audit";
import { readTrackedKeywords } from "@/lib/seo/dataforseo";
import { businessTopicVocab, gbpCategory, readGapReport } from "@/lib/seo/gap";
import { readKeywordsReport } from "@/lib/seo/keywords";
import { readOnPageReport } from "@/lib/seo/onpage";
import { loadQuestions, siteTexts } from "@/lib/seo/questions";
import { latestReports } from "@/lib/seo/reports";
import { pickTopic, planKeyword, type TopicCandidate, type TopicPick } from "@/lib/seo/topic-pick";
import { MAX_ARTICLES, readArticleReport } from "@/lib/seo/writer";
import { readStudy, topKeywords } from "@/lib/study-shape";

/** El mejor tema para el próximo artículo, o null si no hay datos suficientes. `skip`: temas que el dueño ya vio. */
export async function suggestArticleTopic(businessId: string, skip: string[] = []): Promise<{ pick: TopicPick; others: TopicPick[] } | null> {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, website: true, study: true, seoKeywords: true, seoLocations: true, seoLocationCode: true, seoLocationName: true },
  });
  if (!b) return null;
  const [kwRows, [gapRow], articleRows, [auditRow], [onpageRow], [gbpRow], tasks, questions] = await Promise.all([
    latestReports(businessId, "keywords", 3),
    latestReports(businessId, "gap", 1),
    latestReports(businessId, "article", MAX_ARTICLES),
    latestReports(businessId, "audit", 1),
    latestReports(businessId, "onpage", 1),
    latestReports(businessId, "gbp", 1),
    db.actionTask.findMany({ where: { businessId, status: "todo", href: { contains: "/seo/escribir?kw=" } }, select: { title: true, impact: true, href: true } }),
    loadQuestions(businessId).catch(() => null),
  ]);

  const out: TopicCandidate[] = [];
  // Plan de acción: las tareas que abren el escritor.
  for (const t of tasks) {
    const keyword = planKeyword(t.href);
    const title = (t.title as { es?: string } | null)?.es ?? "";
    if (keyword) out.push({ keyword, source: "plan", volume: null, boost: Math.max(0, t.impact - 1), note: title.slice(0, 90) });
  }
  // Lo que la competencia tiene y tú no.
  const gap = gapRow ? readGapReport(gapRow.data) : null;
  for (const r of gap?.rows ?? []) {
    if (r.type !== "missing" && !(r.type === "weak" && (r.yourPosition ?? 0) > 10)) continue;
    out.push({ keyword: r.keyword, source: "gap", volume: r.volume, boost: Math.min(2, r.opportunity / 50) });
  }
  // Preguntas que nadie responde todavía.
  for (const g of questions?.groups ?? []) for (const q of g.questions) if (!q.answered) out.push({ keyword: q.topic || q.question, source: "question", volume: null });
  // Palabras clave medidas e ideas (con búsquedas al mes).
  const vol = new Map<string, number>();
  for (const row of kwRows) {
    const r = readKeywordsReport(row.data);
    for (const k of [...(r?.keywords ?? []), ...(r?.ideas ?? [])]) {
      if (!k.volume) continue;
      vol.set(k.keyword, Math.max(vol.get(k.keyword) ?? 0, k.volume));
    }
  }
  for (const [keyword, volume] of vol) out.push({ keyword, source: "keywords", volume });
  // Lo que vende el negocio (estudio y palabras que sigue).
  const study = readStudy(b.study);
  for (const keyword of [...(study ? topKeywords(study, 8) : []), ...readTrackedKeywords(b.seoKeywords)]) out.push({ keyword, source: "study", volume: vol.get(keyword) ?? null });
  // Si ya se sabe el volumen de un tema de otra fuente, se usa.
  for (const c of out) if (c.volume === null && vol.has(c.keyword)) c.volume = vol.get(c.keyword) ?? null;

  // Lo que ya está escrito (artículos, publicados o no) y lo que ya está en la web.
  const written = articleRows.flatMap((r) => {
    const a = readArticleReport(r.data);
    return a ? [a.keyword, a.draft.title, a.draft.h1].filter(Boolean) : [];
  });
  const site = siteTexts({ audit: auditRow ? readAuditReport(auditRow.data) : null, onpage: onpageRow ? readOnPageReport(onpageRow.data) : null, domain: b.website }).map((x) => x.text);
  const vocab = businessTopicVocab({ ...b, category: gbpRow ? gbpCategory(gbpRow.data) : null });
  return pickTopic(out, { written, site, vocab, brand: b.name, skip });
}
