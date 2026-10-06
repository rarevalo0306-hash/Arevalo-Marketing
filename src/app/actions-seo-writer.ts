"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { aiEnabled, improveSeoArticle, pickText, writeSeoArticle } from "@/lib/ai";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import { cleanKeyword, costText } from "@/lib/seo/keywords";
import {
  type ArticleReport,
  briefFor,
  cleanDraft,
  contentTargets,
  failingForAi,
  MAX_ARTICLES,
  readArticleReport,
  researchKeyword,
  scoreDraft,
  type WriterLang,
} from "@/lib/seo/writer";

export type WriterResult = { ok: boolean; message: string; id?: string } | null;

/** Tipo de reporte en la tabla SeoReport para los artículos. */
const KIND = "article";

const BUSINESS_FIELDS = {
  name: true,
  website: true,
  phone: true,
  aiProfile: true,
  aiText: true,
  brandVoice: true,
  study: true,
  seoLocations: true,
  seoLocationCode: true,
  seoLocationName: true,
} as const;

const paths = (businessId: string) => {
  revalidatePath(`/b/${businessId}/seo/escribir`);
  revalidatePath(`/b/${businessId}/seo`);
};

/** Deja solo los últimos MAX_ARTICLES artículos del negocio. */
async function prune(businessId: string) {
  const old = await db.seoReport.findMany({
    where: { businessId, kind: KIND },
    orderBy: { createdAt: "desc" },
    skip: MAX_ARTICLES,
    select: { id: true },
  });
  if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

/**
 * Escribe un artículo para Google: mira los 10 primeros (DataForSEO), lee las páginas que ganan,
 * arma las metas, la IA escribe y se revisa con un puntaje. Se guarda como reporte "article".
 */
export async function writeArticle(businessId: string, _prev: WriterResult, f: FormData): Promise<WriterResult> {
  void _prev;
  const { lang, t } = await getT();
  const keyword = cleanKeyword(String(f.get("keyword") ?? ""));
  const language: WriterLang = f.get("language") === "en" ? "en" : "es";
  if (keyword.length < 2) return { ok: false, message: t("Escribe la búsqueda para la que quieres salir en Google.", "Enter the search you want to show up for on Google.") };
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  if (!aiEnabled())
    return { ok: false, message: t("Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en Vercel.", "The AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is missing in Vercel.") };
  const b = await db.business.findUnique({ where: { id: businessId }, select: BUSINESS_FIELDS });
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  const zone = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName)[0];
  if (!zone)
    return {
      ok: false,
      message: t("Primero elige tu zona de Google en SEO y visibilidad (Datos reales de Google) y guarda.", "First pick your Google area in SEO and visibility (Real Google data) and save."),
    };

  try {
    const research = await researchKeyword(keyword, zone, language);
    if (!research.organic.length)
      return { ok: false, message: t("Google no devolvió resultados para esa búsqueda en tu zona. Prueba con otras palabras.", "Google returned no results for that search in your area. Try other words.") };
    const targets = contentTargets(research);
    const brief = briefFor(research, targets, zone.name);
    const draft = cleanDraft(await writeSeoArticle({ business: b, keyword, language, brief }));
    const { score, checklist } = scoreDraft(draft, keyword, targets, { phone: b.phone, website: b.website });
    const report: ArticleReport = {
      version: 1,
      keyword,
      language,
      zone: { code: zone.code, name: zone.name },
      research,
      targets,
      draft,
      score,
      checklist,
      cost: research.cost,
      provider: pickText(b.aiText) ?? "",
      createdAt: new Date().toISOString(),
    };
    const saved = await db.seoReport.create({ data: { businessId, kind: KIND, data: report as unknown as Prisma.InputJsonValue } });
    await prune(businessId);
    paths(businessId);
    const read = research.pages.filter((p) => !p.error).length;
    return {
      ok: true,
      id: saved.id,
      message: t(
        `Listo: tu artículo sacó ${score}/100. Leímos ${read} ${read === 1 ? "página" : "páginas"} de los que ganan. Costo de DataForSEO: ${costText(research.cost)}.`,
        `Done: your article scored ${score}/100. We read ${read} winning ${read === 1 ? "page" : "pages"}. DataForSEO cost: ${costText(research.cost)}.`,
      ),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** La IA reescribe el artículo para arreglar lo que falta en la revisión. No vuelve a consultar Google (gratis en DataForSEO). */
export async function improveArticle(businessId: string, reportId: string, _prev: WriterResult, _f: FormData): Promise<WriterResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!aiEnabled())
    return { ok: false, message: t("Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en Vercel.", "The AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is missing in Vercel.") };
  const [b, row] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: BUSINESS_FIELDS }),
    db.seoReport.findFirst({ where: { id: reportId, businessId, kind: KIND } }),
  ]);
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  const report = row ? readArticleReport(row.data) : null;
  if (!row || !report) return { ok: false, message: t("No encontramos ese artículo.", "We couldn't find that article.") };
  try {
    const brief = briefFor(report.research, report.targets, report.zone.name);
    const draft = cleanDraft(
      await improveSeoArticle({ business: b, keyword: report.keyword, language: report.language, brief, draft: report.draft, failing: failingForAi(report.checklist) }),
    );
    const { score, checklist } = scoreDraft(draft, report.keyword, report.targets, { phone: b.phone, website: b.website });
    const next: ArticleReport = { ...report, draft, score, checklist, previousScore: report.score, improvedAt: new Date().toISOString(), provider: pickText(b.aiText) ?? report.provider };
    await db.seoReport.update({ where: { id: row.id }, data: { data: next as unknown as Prisma.InputJsonValue } });
    paths(businessId);
    return {
      ok: true,
      id: row.id,
      message:
        score >= report.score
          ? t(`Listo: el puntaje pasó de ${report.score} a ${score}.`, `Done: the score went from ${report.score} to ${score}.`)
          : t(
              `Listo, pero el puntaje bajó de ${report.score} a ${score}. Revisa la lista o vuelve a intentarlo.`,
              `Done, but the score went down from ${report.score} to ${score}. Check the list or try again.`,
            ),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Borra un artículo guardado. */
export async function deleteArticle(businessId: string, reportId: string): Promise<{ ok: boolean }> {
  const r = await db.seoReport.deleteMany({ where: { id: reportId, businessId, kind: KIND } });
  paths(businessId);
  return { ok: r.count > 0 };
}
