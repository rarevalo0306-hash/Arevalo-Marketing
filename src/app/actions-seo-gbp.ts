"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { aiEnabled, draftReviewReplies, draftReviewReply } from "@/lib/ai";
import { db } from "@/lib/db";
import { errorText, intlLocale, type UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import {
  carryDrafts,
  competitorTargets,
  DRAFT_BATCH,
  fetchCompetitorProfiles,
  fetchProfile,
  fetchReviews,
  GBP_KEEP,
  googleReplyCreds,
  type GbpReport,
  type GbpReview,
  MAX_REPLY,
  postGoogleReply,
  profileChecklist,
  readPendingTask,
  readReviewsReport,
  ReviewsPendingError,
  type ReviewsReport,
  reviewStats,
} from "@/lib/seo/gbp";
import { readMapPlace, readMapReport } from "@/lib/seo/maprank";
import { latestReports, saveReport, type SeoKind } from "@/lib/seo/reports";

export type GbpResult = { ok: boolean; message: string } | null;
export type ReplyResult = { ok: boolean; message: string; text?: string };

const BUSINESS_FIELDS = {
  name: true,
  website: true,
  phone: true,
  aiProfile: true,
  aiText: true,
  brandVoice: true,
  brandIdentity: true,
  seoLanguage: true,
  seoMapPlace: true,
  seoLocations: true,
  seoLocationCode: true,
  seoLocationName: true,
} as const;

type T = (es: string, en: string) => string;
const notConnected = (t: T) =>
  t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).");
const noPlace = (t: T) =>
  t("Primero busca y elige tu negocio en Google Maps (en «Mapa de calor en Google Maps»).", "First find and pick your business on Google Maps (in “Google Maps heatmap”).");
const noAi = (t: T) =>
  t("Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en Vercel.", "The AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is missing in Vercel.");
const noReviews = (t: T) => t("Primero trae tus reseñas con «Actualizar reseñas».", "First bring in your reviews with “Update reviews”.");
const notFoundReview = (t: T) => t("No encontramos esa reseña. Actualiza tus reseñas y vuelve a intentar.", "We couldn't find that review. Update your reviews and try again.");

const money = (lang: UiLang, n: number) => new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(n);
const json = (v: unknown) => v as Prisma.InputJsonValue;
const refresh = (businessId: string) => revalidatePath(`/b/${businessId}/seo`);

/** Deja solo los últimos `keep` reportes de ese tipo. */
async function prune(businessId: string, kind: SeoKind, keep = GBP_KEEP) {
  const old = await db.seoReport.findMany({ where: { businessId, kind }, orderBy: { createdAt: "desc" }, skip: keep, select: { id: true } });
  if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

/** El último reporte de reseñas (la fila y lo leído). */
async function latestReviews(businessId: string): Promise<{ id: string; report: ReviewsReport } | null> {
  const [row] = await latestReports(businessId, "reviews", 1);
  const report = row ? readReviewsReport(row.data) : null;
  return row && report ? { id: row.id, report } : null;
}

/** Guarda cambios en las reseñas del último reporte (borradores, respuestas publicadas). */
async function saveReviews(rowId: string, report: ReviewsReport, reviews: GbpReview[]) {
  const at = Date.parse(report.createdAt) > 0 ? new Date(report.createdAt) : new Date();
  const next: ReviewsReport = { ...report, reviews, stats: reviewStats(reviews, at) };
  await db.seoReport.update({ where: { id: rowId }, data: { data: json(next) } });
}

const searchLang = (v: string) => (v === "en" ? "en" : "es");

/** "Actualizar perfil": tu perfil de Google Maps y el de hasta 3 competidores del mapa de calor (~US$0.0054 cada uno). */
export async function refreshProfile(businessId: string, _prev: GbpResult, _f: FormData): Promise<GbpResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!dataForSeoEnabled()) return { ok: false, message: notConnected(t) };
  const b = await db.business.findUnique({ where: { id: businessId }, select: BUSINESS_FIELDS });
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  const place = readMapPlace(b.seoMapPlace);
  if (!place) return { ok: false, message: noPlace(t) };
  const zone = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName)[0] ?? null;
  const language = searchLang(b.seoLanguage);
  try {
    const [mapRow] = await latestReports(businessId, "maprank", 1);
    const targets = competitorTargets(mapRow ? readMapReport(mapRow.data) : null, place.cid);
    const [own, comps, reviews] = await Promise.all([
      fetchProfile(place, language, zone),
      fetchCompetitorProfiles(targets, language, zone, place),
      latestReviews(businessId),
    ]);
    const { checklist, score } = profileChecklist(own.profile, comps.competitors, reviews?.report.stats ?? null);
    const cost = Math.round((own.cost + comps.cost) * 10000) / 10000;
    const report: GbpReport = { version: 1, profile: own.profile, competitors: comps.competitors, checklist, score, cost, createdAt: new Date().toISOString() };
    await saveReport(businessId, "gbp", json(report));
    await prune(businessId, "gbp");
    refresh(businessId);
    const okComps = comps.competitors.filter((c) => !c.error).length;
    return {
      ok: true,
      message:
        t(`Listo: tu perfil sacó ${score}/100.`, `Done: your profile scored ${score}/100.`) +
        (okComps ? t(` Lo comparamos con ${okComps} ${okComps === 1 ? "competidor" : "competidores"} de tu mapa de calor.`, ` We compared it with ${okComps} ${okComps === 1 ? "competitor" : "competitors"} from your heatmap.`) : "") +
        t(` Costó ${money(lang, cost)}.`, ` It cost ${money(lang, cost)}.`),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** "Actualizar reseñas": las 50 más nuevas (cola prioritaria de DataForSEO, ~US$0.0075, 10-60 s). */
export async function refreshReviews(businessId: string, _prev: GbpResult, _f: FormData): Promise<GbpResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!dataForSeoEnabled()) return { ok: false, message: notConnected(t) };
  const b = await db.business.findUnique({ where: { id: businessId }, select: BUSINESS_FIELDS });
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  const place = readMapPlace(b.seoMapPlace);
  if (!place) return { ok: false, message: noPlace(t) };
  const zone = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName)[0] ?? null;

  // Si la vez anterior Google tardó, se sigue esperando esa misma tarea (ya pagada).
  const [taskRow] = await latestReports(businessId, "reviews-task", 1);
  const pending = taskRow ? readPendingTask(taskRow.data) : null;
  const clearPending = () => db.seoReport.deleteMany({ where: { businessId, kind: "reviews-task" } });
  try {
    const r = await fetchReviews(place, searchLang(b.seoLanguage), zone, { resumeTaskId: pending?.taskId });
    await clearPending();
    const cost = r.cost || pending?.cost || 0;
    const prev = await latestReviews(businessId);
    const reviews = carryDrafts(r.reviews, prev?.report.reviews ?? []);
    const createdAt = new Date().toISOString();
    const report: ReviewsReport = { version: 1, total: r.total, rating: r.rating, reviews, stats: reviewStats(reviews, new Date(createdAt)), cost, createdAt };
    await saveReport(businessId, "reviews", json(report));
    await prune(businessId, "reviews");
    refresh(businessId);
    const s = report.stats;
    return {
      ok: true,
      message: reviews.length
        ? t(
            `Listo: trajimos tus ${reviews.length} reseñas más nuevas. ${s.unanswered ? `Te faltan contestar ${s.unanswered}.` : "Todas están contestadas."} Costó ${money(lang, cost)}.`,
            `Done: we brought in your ${reviews.length} newest reviews. ${s.unanswered ? `${s.unanswered} still need a reply.` : "All of them are answered."} It cost ${money(lang, cost)}.`,
          )
        : t(`Google no mostró reseñas para tu negocio. Costó ${money(lang, cost)}.`, `Google showed no reviews for your business. It cost ${money(lang, cost)}.`),
    };
  } catch (e) {
    if (e instanceof ReviewsPendingError) {
      // Se guarda la tarea para la próxima vez (la primera vez que quedó esperando, no se cambia la fecha).
      if (!pending) await saveReport(businessId, "reviews-task", json({ taskId: e.taskId, cost: e.cost, createdAt: new Date().toISOString() }));
    } else if (pending) {
      await clearPending();
    }
    return { ok: false, message: errorText(e, lang) };
  }
}

const replyBusiness = (b: { name: string; website: string; phone: string; aiProfile: string; aiText: string; brandVoice: string; brandIdentity: unknown }) => ({
  name: b.name,
  website: b.website,
  phone: b.phone,
  aiProfile: b.aiProfile,
  aiText: b.aiText,
  brandVoice: b.brandVoice,
  brandIdentity: b.brandIdentity,
});

/** La IA escribe la respuesta a una reseña y queda guardada como borrador (el dueño la puede cambiar). */
export async function draftReply(businessId: string, reviewId: string): Promise<ReplyResult> {
  const { lang, t } = await getT();
  if (!aiEnabled()) return { ok: false, message: noAi(t) };
  const [b, latest] = await Promise.all([db.business.findUnique({ where: { id: businessId }, select: BUSINESS_FIELDS }), latestReviews(businessId)]);
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  if (!latest) return { ok: false, message: noReviews(t) };
  const review = latest.report.reviews.find((r) => r.id === reviewId);
  if (!review) return { ok: false, message: notFoundReview(t) };
  try {
    const text = await draftReviewReply({ business: replyBusiness(b), review, lang: searchLang(b.seoLanguage) });
    const at = new Date().toISOString();
    await saveReviews(latest.id, latest.report, latest.report.reviews.map((r) => (r.id === reviewId ? { ...r, draft: text, draftAt: at } : r)));
    return { ok: true, message: t("Listo. Revísala y cámbiala si quieres antes de publicarla.", "Done. Check it and change it if you want before posting it."), text };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** La IA escribe las respuestas de hasta 10 reseñas sin contestar ni borrador (primero las de 3 estrellas o menos). */
export async function draftAllReplies(businessId: string): Promise<{ ok: boolean; message: string; drafts: Record<string, string> }> {
  const { lang, t } = await getT();
  if (!aiEnabled()) return { ok: false, message: noAi(t), drafts: {} };
  const [b, latest] = await Promise.all([db.business.findUnique({ where: { id: businessId }, select: BUSINESS_FIELDS }), latestReviews(businessId)]);
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found."), drafts: {} };
  if (!latest) return { ok: false, message: noReviews(t), drafts: {} };
  const todo = latest.report.reviews
    .filter((r) => !r.ownerAnswer.trim() && !r.draft?.trim())
    .map((r, i) => ({ r, i }))
    .sort((a, c) => Number((c.r.rating ?? 5) <= 3) - Number((a.r.rating ?? 5) <= 3) || a.i - c.i)
    .map((x) => x.r)
    .slice(0, DRAFT_BATCH);
  if (!todo.length) return { ok: true, message: t("No hay reseñas sin contestar que necesiten respuesta nueva.", "There are no unanswered reviews that need a new reply."), drafts: {} };
  try {
    const results = await draftReviewReplies({ business: replyBusiness(b), reviews: todo, lang: searchLang(b.seoLanguage), limit: DRAFT_BATCH });
    const drafts: Record<string, string> = {};
    for (const r of results) if (r.text) drafts[r.id] = r.text;
    const done = Object.keys(drafts).length;
    // Se vuelve a leer por si el dueño guardó algo mientras tanto.
    const fresh = (await latestReviews(businessId)) ?? latest;
    const at = new Date().toISOString();
    if (done) await saveReviews(fresh.id, fresh.report, fresh.report.reviews.map((r) => (drafts[r.id] && !r.draft?.trim() ? { ...r, draft: drafts[r.id], draftAt: at } : r)));
    const failed = results.filter((r) => r.error);
    if (!done) return { ok: false, message: failed[0]?.error ? (lang === "en" ? failed[0].error.en : failed[0].error.es) : t("La IA no pudo escribir las respuestas.", "The AI couldn't write the replies."), drafts };
    const left = latest.report.reviews.filter((r) => !r.ownerAnswer.trim() && !r.draft?.trim()).length - done;
    return {
      ok: true,
      drafts,
      message:
        t(`Listo: la IA escribió ${done} ${done === 1 ? "respuesta" : "respuestas"}. Revísalas antes de publicarlas.`, `Done: the AI wrote ${done} ${done === 1 ? "reply" : "replies"}. Check them before posting.`) +
        (failed.length ? t(` ${failed.length} no se pudieron escribir; inténtalo de nuevo.`, ` ${failed.length} couldn't be written; try again.`) : "") +
        (left > 0 ? t(` Quedan ${left}: presiona otra vez para seguir.`, ` ${left} left: press again to continue.`) : ""),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang), drafts: {} };
  }
}

/** Guarda la respuesta como la dejó el dueño. */
export async function saveReplyDraft(businessId: string, reviewId: string, text: string): Promise<ReplyResult> {
  const { t } = await getT();
  const latest = await latestReviews(businessId);
  if (!latest) return { ok: false, message: noReviews(t) };
  if (!latest.report.reviews.some((r) => r.id === reviewId)) return { ok: false, message: notFoundReview(t) };
  const clean = String(text ?? "").replace(/\r/g, "").trim().slice(0, MAX_REPLY + 500);
  const at = new Date().toISOString();
  await saveReviews(
    latest.id,
    latest.report,
    latest.report.reviews.map((r) => {
      if (r.id !== reviewId) return r;
      const rest = { ...r };
      delete rest.draft;
      delete rest.draftAt;
      return clean ? { ...rest, draft: clean, draftAt: at } : rest;
    }),
  );
  return { ok: true, message: t("Guardada.", "Saved."), text: clean };
}

/**
 * Publica la respuesta directo en Google. Solo funciona con la conexión "google" (cuenta y ubicación) y cuando Google
 * aprobó el acceso de la app a la API del Perfil de Negocio; si no, el dueño copia la respuesta y la pega en Google.
 */
export async function postReply(businessId: string, reviewId: string, text?: string): Promise<ReplyResult> {
  const { lang, t } = await getT();
  const creds = await googleReplyCreds(businessId);
  if (!creds)
    return {
      ok: false,
      message: t(
        "Para responder desde aquí conecta tu Perfil de Negocio en Conexiones. Mientras tanto, copia la respuesta y pégala en Google.",
        "To reply from here, connect your Business Profile in Connections. Meanwhile, copy the reply and paste it on Google.",
      ),
    };
  const latest = await latestReviews(businessId);
  if (!latest) return { ok: false, message: noReviews(t) };
  const review = latest.report.reviews.find((r) => r.id === reviewId);
  if (!review) return { ok: false, message: notFoundReview(t) };
  const comment = String(text ?? review.draft ?? "").replace(/\r/g, "").trim().slice(0, 4000);
  if (comment.length < 2) return { ok: false, message: t("Escribe la respuesta primero.", "Write the reply first.") };
  try {
    await postGoogleReply(creds, review, comment);
    const at = new Date().toISOString();
    await saveReviews(
      latest.id,
      latest.report,
      latest.report.reviews.map((r) => {
        if (r.id !== reviewId) return r;
        const rest = { ...r };
        delete rest.draft;
        delete rest.draftAt;
        return { ...rest, ownerAnswer: comment, ownerTimestamp: at, postedAt: at };
      }),
    );
    refresh(businessId);
    return { ok: true, message: t("Listo: tu respuesta ya está en Google.", "Done: your reply is now on Google."), text: comment };
  } catch (e) {
    // Si falló, se guarda lo que escribió para no perderlo.
    if (comment !== review.draft) await saveReviews(latest.id, latest.report, latest.report.reviews.map((r) => (r.id === reviewId ? { ...r, draft: comment, draftAt: new Date().toISOString() } : r)));
    return { ok: false, message: errorText(e, lang) };
  }
}
