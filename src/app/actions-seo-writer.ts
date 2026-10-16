"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { aiEnabled, improveSeoArticle, pickText } from "@/lib/ai";
import { deniedText, hasBusiness } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { costText } from "@/lib/seo/keywords";
import {
  type ArticleReport,
  briefFor,
  cleanDraft,
  failingForAi,
  readArticleReport,
  scoreDraft,
  type WriterLang,
} from "@/lib/seo/writer";
import { ARTICLE_KIND as KIND, BUSINESS_FIELDS, createArticleReport } from "@/lib/seo/writer-run";

export type WriterResult = { ok: boolean; message: string; id?: string } | null;

const paths = (businessId: string) => {
  revalidatePath(`/b/${businessId}/seo/escribir`);
  revalidatePath(`/b/${businessId}/seo`);
};

/**
 * Escribe un artículo para Google: mira los 10 primeros (DataForSEO), lee las páginas que ganan,
 * arma las metas, la IA escribe y se revisa con un puntaje. Se guarda como reporte "article".
 * El trabajo está en `createArticleReport` (lo usa también el equipo de agentes); aquí van el permiso y los mensajes.
 */
export async function writeArticle(businessId: string, _prev: WriterResult, f: FormData): Promise<WriterResult> {
  ensure.text(businessId);
  void _prev;
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  const language: WriterLang = f.get("language") === "en" ? "en" : "es";
  try {
    const made = await createArticleReport(businessId, String(f.get("keyword") ?? ""), language);
    paths(businessId);
    return {
      ok: true,
      id: made.id,
      message: t(
        `Listo: tu artículo sacó ${made.score}/100. Leímos ${made.pagesRead} ${made.pagesRead === 1 ? "página" : "páginas"} de los que ganan. Costo de DataForSEO: ${costText(made.cost)}.`,
        `Done: your article scored ${made.score}/100. We read ${made.pagesRead} winning ${made.pagesRead === 1 ? "page" : "pages"}. DataForSEO cost: ${costText(made.cost)}.`,
      ),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** La IA reescribe el artículo para arreglar lo que falta en la revisión. No vuelve a consultar Google (gratis en DataForSEO). */
export async function improveArticle(businessId: string, reportId: string, _prev: WriterResult, _f: FormData): Promise<WriterResult> {
  ensure.text(businessId, reportId);
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
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
  ensure.text(businessId, reportId);
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false };
  const r = await db.seoReport.deleteMany({ where: { id: reportId, businessId, kind: KIND } });
  paths(businessId);
  return { ok: r.count > 0 };
}
