"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { aiEnabled, draftReviewReplies } from "@/lib/ai";
import { deniedText, hasBusiness } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import { reviewStats } from "@/lib/seo/gbp";
import { costText } from "@/lib/seo/keywords";
import { readMapPlace } from "@/lib/seo/maprank";
import { latestReports, saveReport } from "@/lib/seo/reports";
import {
  carryWebDrafts,
  fetchWebReviews,
  readWebReviewsReport,
  readWebTasks,
  tripadvisorPath,
  WEB_REVIEWS_KIND,
  WEB_REVIEWS_TASK_KIND,
  type WebReview,
  WebReviewsPendingError,
  type WebReviewsReport,
  webSources,
} from "@/lib/seo/web-reviews";

export type WebReviewsResult = { ok: boolean; message: string } | null;
export type WebReplyResult = { ok: boolean; message: string; drafts?: Record<string, string> };

const searchLang = (v: string) => (v === "en" ? "en" : "es");
const page = (id: string) => `/b/${id}/seo`;

async function latestWeb(businessId: string): Promise<{ id: string; report: WebReviewsReport } | null> {
  const [row] = await latestReports(businessId, WEB_REVIEWS_KIND, 1);
  const report = row ? readWebReviewsReport(row.data) : null;
  return row && report ? { id: row.id, report } : null;
}

async function saveWeb(rowId: string, report: WebReviewsReport, reviews: WebReview[]) {
  const next: WebReviewsReport = { ...report, reviews, stats: reviewStats(reviews) };
  await db.seoReport.update({ where: { id: rowId }, data: { data: next as unknown as Prisma.InputJsonValue } });
}

/** «Traer reseñas»: las de Yelp, Facebook, Trustpilot, Tripadvisor y otros sitios (DataForSEO, unos centavos). */
export async function refreshWebReviews(businessId: string, _prev: WebReviewsResult, f: FormData): Promise<WebReviewsResult> {
  ensure.text(businessId);
  void _prev;
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true, seoMapPlace: true, seoLanguage: true, seoLocations: true, seoLocationCode: true, seoLocationName: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const typed = String(f.get("tripadvisor") ?? "").trim().slice(0, 500);
  const typedPath = typed ? tripadvisorPath(typed) : "";
  if (typed && !typedPath)
    return { ok: false, message: t("Ese enlace no parece una ficha de Tripadvisor. Copia la dirección de tu página en Tripadvisor (termina en .html).", "That link doesn't look like a Tripadvisor listing. Copy your Tripadvisor page address (it ends in .html).") };
  const [prev, [taskRow]] = await Promise.all([latestWeb(businessId), latestReports(businessId, WEB_REVIEWS_TASK_KIND, 1)]);
  const pending = taskRow ? readWebTasks(taskRow.data) : null;
  const tripPath = typedPath || prev?.report.tripadvisorPath || "";
  const clearPending = () => db.seoReport.deleteMany({ where: { businessId, kind: WEB_REVIEWS_TASK_KIND } });
  try {
    const r = await fetchWebReviews({
      place: readMapPlace(b.seoMapPlace),
      zone: readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName)[0] ?? null,
      lang: searchLang(b.seoLanguage),
      website: b.website,
      tripadvisorPath: tripPath,
      // Si cambió la ficha de Tripadvisor, se vuelve a pedir todo.
      resume: pending && !typedPath ? pending.tasks : undefined,
    });
    const reviews = carryWebDrafts(r.reviews, prev?.report.reviews ?? []);
    const cost = Math.round((r.cost + (pending && !typedPath ? pending.cost : 0)) * 10000) / 10000;
    const report: WebReviewsReport = {
      version: 1,
      sources: webSources(reviews, r.direct),
      reviews,
      stats: reviewStats(reviews),
      tripadvisorPath: tripPath,
      trustpilotDomain: r.trustpilotDomain,
      notes: r.notes,
      cost,
      createdAt: new Date().toISOString(),
    };
    await saveReport(businessId, WEB_REVIEWS_KIND, report as unknown as Prisma.InputJsonValue);
    await clearPending();
    revalidatePath(page(businessId));
    const unanswered = reviews.filter((x) => !x.ownerAnswer).length;
    return {
      ok: true,
      message: reviews.length
        ? t(
            `Listo: ${reviews.length} reseñas de ${report.sources.length} ${report.sources.length === 1 ? "sitio" : "sitios"}; ${unanswered} sin contestar. Costó ${costText(cost)}.`,
            `Done: ${reviews.length} reviews from ${report.sources.length} ${report.sources.length === 1 ? "site" : "sites"}; ${unanswered} unanswered. It cost ${costText(cost)}.`,
          )
        : t(`No encontramos reseñas en otros sitios todavía. Costó ${costText(cost)}.`, `We didn't find reviews on other sites yet. It cost ${costText(cost)}.`),
    };
  } catch (e) {
    if (e instanceof WebReviewsPendingError) {
      if (!pending) await saveReport(businessId, WEB_REVIEWS_TASK_KIND, { tasks: e.tasks, cost: e.cost, createdAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue);
    } else if (pending) await clearPending();
    return { ok: false, message: errorText(e, lang) };
  }
}

const BUSINESS_FIELDS = { name: true, website: true, phone: true, aiProfile: true, aiText: true, brandVoice: true, brandIdentity: true, seoLanguage: true } as const;

/** La IA escribe las respuestas de hasta 10 reseñas sin contestar (primero las de 3 estrellas o menos), para copiar y pegar. */
export async function draftWebReplies(businessId: string, reviewId: string): Promise<WebReplyResult> {
  ensure.text(businessId, reviewId);
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  if (!aiEnabled()) return { ok: false, message: t("Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en Vercel.", "The AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is missing in Vercel.") };
  const [b, latest] = await Promise.all([db.business.findUnique({ where: { id: businessId }, select: BUSINESS_FIELDS }), latestWeb(businessId)]);
  if (!b || !latest) return { ok: false, message: t("Primero trae tus reseñas.", "First get your reviews.") };
  // reviewId vacío = todas las que faltan (hasta 10); si no, solo esa.
  const todo = latest.report.reviews
    .filter((r) => (reviewId ? r.id === reviewId : !r.ownerAnswer && !r.draft))
    .sort((a, c) => Number((c.rating ?? 5) <= 3) - Number((a.rating ?? 5) <= 3))
    .slice(0, 10);
  if (!todo.length) return { ok: true, message: t("No hay reseñas sin contestar que necesiten respuesta.", "There are no unanswered reviews that need a reply.") };
  try {
    const results = await draftReviewReplies({
      business: { name: b.name, website: b.website, phone: b.phone, aiProfile: b.aiProfile, aiText: b.aiText, brandVoice: b.brandVoice, brandIdentity: b.brandIdentity },
      reviews: todo.map((r) => ({ ...r, platform: r.sourceName })),
      lang: searchLang(b.seoLanguage),
      limit: 10,
    });
    const drafts: Record<string, string> = {};
    for (const r of results) if (r.text) drafts[r.id] = r.text;
    const fresh = (await latestWeb(businessId)) ?? latest;
    const at = new Date().toISOString();
    await saveWeb(fresh.id, fresh.report, fresh.report.reviews.map((r) => (drafts[r.id] ? { ...r, draft: drafts[r.id], draftAt: at } : r)));
    revalidatePath(page(businessId));
    const done = Object.keys(drafts).length;
    if (!done) return { ok: false, message: t("La IA no pudo escribir las respuestas. Intenta de nuevo.", "The AI couldn't write the replies. Try again.") };
    return { ok: true, drafts, message: t(`Listo: ${done} ${done === 1 ? "respuesta" : "respuestas"}. Revísalas, cópialas y pégalas en cada sitio.`, `Done: ${done} ${done === 1 ? "reply" : "replies"}. Check them, copy them and paste them on each site.`) };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Guarda la respuesta como la dejó el dueño y, si la copió, cuándo (para saber cuáles ya pegó). */
export async function saveWebReply(businessId: string, reviewId: string, text: string, copied: boolean): Promise<WebReplyResult> {
  ensure.text(businessId, reviewId, text);
  ensure.flag(copied);
  const { t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  const latest = await latestWeb(businessId);
  if (!latest || !latest.report.reviews.some((r) => r.id === reviewId)) return { ok: false, message: t("Esa reseña ya no está. Vuelve a traer tus reseñas.", "That review is gone. Get your reviews again.") };
  const at = new Date().toISOString();
  await saveWeb(
    latest.id,
    latest.report,
    latest.report.reviews.map((r) => (r.id === reviewId ? { ...r, draft: text.slice(0, 2000), draftAt: r.draftAt || at, ...(copied ? { copiedAt: at } : {}) } : r)),
  );
  return { ok: true, message: t("Guardado.", "Saved.") };
}
