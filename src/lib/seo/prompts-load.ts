// El "Prompt general para la IA" del Resumen de SEO: junta lo más importante de todos los reportes guardados (sin
// llamar a ninguna API ni a la IA) y lo arma con generalPrompt (prompts.ts).
import { db } from "@/lib/db";
import { readAuditReport } from "@/lib/seo/audit";
import { buildCannibal, loadCannibalInput } from "@/lib/seo/cannibal";
import { readZones } from "@/lib/seo/dataforseo";
import { latestDecayReports, readDecayReport } from "@/lib/seo/decay";
import { businessTopicVocab, gbpCategory, readGapReport, relevantGapRows } from "@/lib/seo/gap";
import { readOnPageReport } from "@/lib/seo/onpage";
import { loadPromptContext } from "@/lib/seo/prompt-context";
import { generalPrompt, type GeneralInput, pagesByKeyword, type PromptLang } from "@/lib/seo/prompts";
import { loadQuestions } from "@/lib/seo/questions";
import { readRankReport, type RankReport } from "@/lib/seo/rank";
import { latestReports } from "@/lib/seo/reports";
import { schemaStatus } from "@/lib/seo/schema";
import { latestByZone } from "@/lib/seo/zones";

/** Todo lo que hay que arreglar en la página, para pegar en el chat de la IA que la maneja. "" si no hay nada. */
export async function loadGeneralPrompt(businessId: string, lang: PromptLang, status: string[] = []): Promise<string> {
  const [ctx, b] = await Promise.all([
    loadPromptContext(businessId),
    db.business.findUnique({ where: { id: businessId }, select: { seoKeywords: true, study: true, seoLocations: true, seoLocationCode: true, seoLocationName: true } }),
  ]);
  if (!ctx || !b) return "";
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const [[auditRow], [onpageRow], [decayRow], [gapRow], [gbpRow], rankRows, cannibalInput, questions] = await Promise.all([
    latestReports(businessId, "audit", 1),
    latestReports(businessId, "onpage", 1),
    latestDecayReports(businessId, 1),
    latestReports(businessId, "gap", 1),
    latestReports(businessId, "gbp", 1),
    zones.length ? latestReports(businessId, "rank", 3 * zones.length) : Promise.resolve([]),
    loadCannibalInput(businessId),
    loadQuestions(businessId),
  ]);
  const audit = auditRow ? readAuditReport(auditRow.data) : null;
  const onpage = onpageRow ? readOnPageReport(onpageRow.data) : null;
  const gap = gapRow ? readGapReport(gapRow.data) : null;
  const vocab = businessTopicVocab({ ...b, category: gbpRow ? gbpCategory(gbpRow.data) : null });
  const byZone = latestByZone(
    rankRows.map((r) => readRankReport(r.data)),
    zones,
  );
  const rank: RankReport | null = zones[0] ? (byZone.get(zones[0].code) ?? null) : null;
  const ranks = [...byZone.values()];
  const schema = schemaStatus(audit);

  const input: GeneralInput = {
    audit,
    onpage,
    decay: decayRow ? readDecayReport(decayRow.data) : null,
    cannibal: cannibalInput ? buildCannibal(cannibalInput) : null,
    // La auditoría ya lo cuenta como problema ("Google no sabe que eres un negocio local"): no se repite.
    schemaMissing: (schema.status === "missing" || schema.status === "incomplete") && !audit?.issues.some((i) => i.id === "no-structured-data"),
    questions: questions?.unanswered ? { groups: questions.groups, pageFor: pagesByKeyword(ranks, onpage?.pages.map((p) => ({ keyword: p.keyword, url: p.url })) ?? []) } : null,
    gap: gap ? relevantGapRows(gap.rows, vocab) : null,
    rank,
    status,
  };
  return generalPrompt(ctx, input, lang);
}
