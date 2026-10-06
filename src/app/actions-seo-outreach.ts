"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db";
import { errorText, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { BACKLINKS_KIND, readBacklinksReport, type BacklinksReport } from "@/lib/seo/backlinks";
import { normalizeDomain } from "@/lib/seo/competitors";
import {
  buildOutreach,
  mergeOutreach,
  needsEmail,
  OUTREACH_KIND,
  outreachBusiness,
  type OutreachDraft,
  type OutreachStore,
  pickTopGap,
  readOutreachStore,
} from "@/lib/seo/outreach";

export type OutreachResult = { ok: boolean; message: string; draft?: OutreachDraft };
export type OutreachTopResult = { ok: boolean; message: string; drafts?: Record<string, OutreachDraft> };

const BUSINESS_FIELDS = {
  name: true,
  website: true,
  phone: true,
  aiProfile: true,
  aiText: true,
  brandVoice: true,
  seoLanguage: true,
  seoLocations: true,
  seoLocationCode: true,
  seoLocationName: true,
  seoMapPlace: true,
  study: true,
} as const;

const noAi = (t: T) =>
  t(
    "Para escribir el correo falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en Vercel. Los pasos para directorios y redes sí funcionan sin ella.",
    "To write the email, the AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is missing in Vercel. The steps for directories and social networks work without it.",
  );
const noReport = (t: T) =>
  t(
    "Primero revisa tus enlaces con «Revisar mis enlaces» (en Enlaces hacia tu página) para saber dónde pedirlos.",
    "First check your links with “Check my links” (in Links to your site) to know where to ask for them.",
  );

/** El último reporte de enlaces. */
async function latestBacklinks(businessId: string): Promise<BacklinksReport | null> {
  const [row] = await db.seoReport.findMany({ where: { businessId, kind: BACKLINKS_KIND }, orderBy: { createdAt: "desc" }, take: 1 });
  return row ? readBacklinksReport(row.data) : null;
}

/** La fila de borradores del negocio (una sola por negocio). */
async function latestStore(businessId: string): Promise<{ id: string | null; store: OutreachStore }> {
  const [row] = await db.seoReport.findMany({ where: { businessId, kind: OUTREACH_KIND }, orderBy: { createdAt: "desc" }, take: 1 });
  return { id: row?.id ?? null, store: readOutreachStore(row?.data) };
}

/** Guarda los borradores en la misma fila (se vuelve a leer justo antes para no pisar otros cambios) y borra las demás. */
async function saveDrafts(businessId: string, add: OutreachDraft[]) {
  const { id, store } = await latestStore(businessId);
  const data = mergeOutreach(store, add) as unknown as Prisma.InputJsonValue;
  const keepId = id ? (await db.seoReport.update({ where: { id }, data: { data } })).id : (await db.seoReport.create({ data: { businessId, kind: OUTREACH_KIND, data } })).id;
  await db.seoReport.deleteMany({ where: { businessId, kind: OUTREACH_KIND, id: { not: keepId } } });
}

/** "Pedir enlace" de un sitio de "Dónde conseguir enlaces": correo (con IA) o pasos, y su contacto si aparece en su página. */
export async function draftOutreach(businessId: string, domain: string): Promise<OutreachResult> {
  const { lang, t } = await getT();
  const site = normalizeDomain(domain);
  if (!site) return { ok: false, message: t("Ese sitio no es válido.", "That site isn't valid.") };
  const [b, report] = await Promise.all([db.business.findUnique({ where: { id: businessId }, select: BUSINESS_FIELDS }), latestBacklinks(businessId)]);
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  if (!report) return { ok: false, message: noReport(t) };
  const gap = report.gap.find((g) => g.domain === site);
  if (!gap) return { ok: false, message: t("Ese sitio ya no está en la lista. Actualiza tus enlaces y vuelve a intentar.", "That site is no longer on the list. Update your links and try again.") };
  if (needsEmail(gap.hint) && !aiEnabled()) return { ok: false, message: noAi(t) };
  try {
    const draft = await buildOutreach(outreachBusiness(b), gap);
    await saveDrafts(businessId, [draft]);
    revalidatePath(`/b/${businessId}/seo`);
    return {
      ok: true,
      message:
        draft.type === "email"
          ? draft.contactEmail
            ? t(`Listo. Encontramos su correo (${draft.contactEmail}). Revisa el mensaje antes de mandarlo.`, `Done. We found their email (${draft.contactEmail}). Check the message before sending it.`)
            : t("Listo. No encontramos un correo en su página: usa su formulario de contacto o sus redes.", "Done. We didn't find an email on their site: use their contact form or social media.")
          : t("Listo. Sigue los pasos.", "Done. Follow the steps."),
      draft,
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** "Preparar los 5 primeros": los 5 primeros sitios de la lista que todavía no tienen nada preparado (de a 3 a la vez). */
export async function draftTopOutreach(businessId: string): Promise<OutreachTopResult> {
  const { lang, t } = await getT();
  const [b, report, { store }] = await Promise.all([db.business.findUnique({ where: { id: businessId }, select: BUSINESS_FIELDS }), latestBacklinks(businessId), latestStore(businessId)]);
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  if (!report) return { ok: false, message: noReport(t) };
  if (!report.gap.length) return { ok: false, message: t("No hay sitios en «Dónde conseguir enlaces» todavía.", "There are no sites in “Where to get links” yet.") };
  const ai = aiEnabled();
  const picked = pickTopGap(report.gap.filter((g) => ai || !needsEmail(g.hint)), store);
  if (!picked.length)
    return {
      ok: true,
      message: ai
        ? t("Ya preparaste todos los sitios de la lista. Ábrelos con «Pedir enlace».", "You already prepared every site on the list. Open them with “Ask for a link”.")
        : noAi(t),
    };
  const business = outreachBusiness(b);
  const done: OutreachDraft[] = [];
  const failed: string[] = [];
  let lastError: unknown = null;
  for (let i = 0; i < picked.length; i += 3) {
    const chunk = await Promise.all(
      picked.slice(i, i + 3).map(async (g) => {
        try {
          return await buildOutreach(business, g);
        } catch (e) {
          failed.push(g.domain);
          lastError = e;
          return null;
        }
      }),
    );
    done.push(...chunk.filter((d): d is OutreachDraft => d !== null));
  }
  if (!done.length) return { ok: false, message: errorText(lastError, lang) };
  await saveDrafts(businessId, done);
  revalidatePath(`/b/${businessId}/seo`);
  const emails = done.filter((d) => d.type === "email").length;
  return {
    ok: true,
    message:
      t(
        `Listo: preparamos ${done.length} ${done.length === 1 ? "sitio" : "sitios"}${emails ? ` (${emails} con correo escrito)` : ""}. Ábrelos con «Pedir enlace».`,
        `Done: we prepared ${done.length} ${done.length === 1 ? "site" : "sites"}${emails ? ` (${emails} with a written email)` : ""}. Open them with “Ask for a link”.`,
      ) +
      (failed.length
        ? t(` No se pudo con ${failed.join(", ")}: ${errorText(lastError, "es")}`, ` Couldn't do ${failed.join(", ")}: ${errorText(lastError, "en")}`)
        : "") +
      (!ai ? t(" Los de noticias y blogs necesitan la IA (falta su clave en Vercel).", " News and blog sites need the AI (its key is missing in Vercel).") : ""),
    drafts: Object.fromEntries(done.map((d) => [d.domain, d])),
  };
}

/** Guarda los cambios que el dueño le hizo al correo. */
export async function saveOutreachEdit(businessId: string, domain: string, subject: string, body: string): Promise<{ ok: boolean; message: string }> {
  const { t } = await getT();
  const site = normalizeDomain(domain);
  const { store } = await latestStore(businessId);
  const prev = site ? store.drafts[site] : undefined;
  if (!prev) return { ok: false, message: t("No encontramos ese borrador. Vuelve a presionar «Pedir enlace».", "We couldn't find that draft. Press “Ask for a link” again.") };
  await saveDrafts(businessId, [{ ...prev, subject: subject.slice(0, 200), body: body.slice(0, 5000) }]);
  return { ok: true, message: t("Guardado.", "Saved.") };
}
