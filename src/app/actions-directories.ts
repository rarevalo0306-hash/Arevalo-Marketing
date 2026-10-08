"use server";

// «Directorios y reseñas»: marcar en qué directorios ya está el negocio, que la IA escriba las descripciones, y pedir
// reseñas por email o SMS a contactos con permiso (con límite por día y sin ofrecer nada a cambio). Todo queda anotado
// con logAiAction. No gasta en servicios pagados: solo usa la IA de textos y el email/SMS ya conectados.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { refreshActionPlan } from "@/lib/action-plan";
import { askGemini } from "@/lib/ai";
import { logAiAction, recentAiActions } from "@/lib/ai-actions";
import { brandSlogan, identityPrompt } from "@/lib/brand-identity";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ALL_DIRECTORY_IDS, directoryName, isListingStatus, readDescriptions, type NapDescriptions } from "@/lib/directories";
import { loadDirectoryBasics } from "@/lib/directories-data";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { PUBLISHERS } from "@/lib/publishers";
import {
  defaultTemplate,
  fillTemplate,
  hasLink,
  incentiveIssues,
  NAP_DESCRIPTION_KIND,
  pickRecipients,
  readRequestLog,
  REVIEW_COOLDOWN_DAYS,
  REVIEW_DAILY_MAX,
  REVIEW_LINK_KIND,
  REVIEW_REQUEST_KIND,
  sentInLogs,
  type ReqChannel,
  type ReqTemplate,
} from "@/lib/reviews-request";
import { readTrackedKeywords } from "@/lib/seo/dataforseo";
import { readStudy, topKeywords } from "@/lib/study-shape";

export type DirResult = { ok: boolean; message: string } | null;
export type DescResult = { ok: boolean; message: string; descriptions?: NapDescriptions } | null;

const DAY_MS = 86_400_000;
const str = (f: FormData, k: string, max = 2000) => String(f.get(k) ?? "").trim().slice(0, max);
const page = (id: string) => `/b/${id}/directorios`;

async function afterChange(businessId: string) {
  // El plan de acción tiene tareas de esta pantalla: se vuelve a armar (barato, solo lee la base de datos).
  await refreshActionPlan(businessId).catch((e) => console.error("[directorios] plan", e));
  revalidatePath(page(businessId));
}

// ---------- Directorios ----------

/** Guarda el estado de un directorio: dónde está la ficha, notas y si los datos coinciden. */
export async function saveListing(businessId: string, _prev: DirResult, f: FormData): Promise<DirResult> {
  void _prev;
  const { t } = await getT();
  const directory = str(f, "directory", 60);
  if (!ALL_DIRECTORY_IDS.includes(directory)) return { ok: false, message: t("Ese directorio no existe.", "That directory doesn't exist.") };
  const status = str(f, "status", 20);
  if (!isListingStatus(status)) return { ok: false, message: t("Elige un estado.", "Pick a status.") };
  const url = str(f, "url", 500);
  if (url && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(url))
    return { ok: false, message: t("El enlace debe empezar con https:// (cópialo de la barra del navegador).", "The link must start with https:// (copy it from the browser's address bar).") };
  const notes = str(f, "notes", 1000);
  const nap = str(f, "napOk", 5);
  const napOk = nap === "yes" ? true : nap === "no" ? false : null;
  const exists = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!exists) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  // Si pega el enlace de su ficha sin marcar el estado, ya está en ese directorio.
  const data = { status: status === "todo" && url ? "listed" : status, url, notes, napOk, checkedAt: new Date() };
  await db.directoryListing.upsert({ where: { businessId_directory: { businessId, directory } }, create: { businessId, directory, ...data }, update: data });
  await afterChange(businessId);
  return { ok: true, message: t(`Guardado: ${directoryName(directory)}.`, `Saved: ${directoryName(directory)}.`) };
}

/** Cambia solo el estado (los botones rápidos de cada tarjeta). */
export async function setListingStatus(businessId: string, directory: string, status: string): Promise<DirResult> {
  const { t } = await getT();
  if (!ALL_DIRECTORY_IDS.includes(directory) || !isListingStatus(status)) return { ok: false, message: t("No se pudo guardar.", "Couldn't save.") };
  const exists = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!exists) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  await db.directoryListing.upsert({
    where: { businessId_directory: { businessId, directory } },
    create: { businessId, directory, status, checkedAt: new Date() },
    update: { status, checkedAt: new Date() },
  });
  await afterChange(businessId);
  return { ok: true, message: t("Guardado.", "Saved.") };
}

// ---------- Descripciones con IA ----------

const DescSchema = z.object({
  shortEs: z.string().describe("Spanish with correct accents, max 150 characters: what the business does and where. No phone, no URL, no emojis"),
  shortEn: z.string().describe("The same short description in natural English, max 150 characters"),
  longEs: z
    .string()
    .describe("Spanish with correct accents, 450-700 characters: services, area served, what makes it different, a soft call to action. Include 2-3 of the given keywords naturally. No phone, no URL, no prices, no emojis"),
  longEn: z.string().describe("The same long description in natural English, 450-700 characters"),
});

const clip = (s: string, max: number) => s.replace(/\s+/g, " ").replace(/https?:\/\/\S+/g, "").trim().slice(0, max);

/** La IA escribe las descripciones corta y larga (es/en) con las palabras clave y la voz de la marca. */
export async function writeDescriptions(businessId: string, _prev: DescResult, f: FormData): Promise<DescResult> {
  void _prev;
  void f;
  const { lang, t } = await getT();
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, aiProfile: true, brandVoice: true, brandIdentity: true, study: true, seoKeywords: true },
  });
  const basics = await loadDirectoryBasics(businessId);
  if (!b || !basics) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  if (!process.env.GEMINI_API_KEY)
    return { ok: false, message: t("La IA no está configurada (falta GEMINI_API_KEY). Puedes usar las descripciones de ejemplo de abajo.", "AI isn't set up (GEMINI_API_KEY is missing). You can use the sample descriptions below.") };
  const study = readStudy(b.study);
  const keywords = [...new Set([...readTrackedKeywords(b.seoKeywords), ...(study ? topKeywords(study, 8) : [])])].slice(0, 10);
  const system = [
    `You write business directory descriptions (Google Business Profile, Bing, Apple, Yelp, Facebook) for ONE local business: ${b.name}.`,
    "Use ONLY the facts given about this business. Never invent years, prices, licenses, awards, guarantees or results.",
    "Google forbids links, phone numbers and promotional ALL CAPS in the profile description: never include them.",
    "Mention the city or area served. Use the keywords naturally (never a list of keywords). Friendly, clear, plain words.",
    b.brandVoice.trim() ? `Brand voice (follow it):\n<brand_voice>\n${b.brandVoice.trim().slice(0, 1500)}\n</brand_voice>` : "",
    identityPrompt(b),
  ]
    .filter(Boolean)
    .join("\n");
  const user = [
    `Business: ${b.name}`,
    `Area: ${[basics.place.city, basics.place.country].filter(Boolean).join(", ") || "(unknown)"}`,
    `Business profile (facts):\n${b.aiProfile.slice(0, 2500) || "(none)"}`,
    study ? `Study summary: ${study.summary.slice(0, 1200)}` : "",
    study?.services.length ? `Services: ${study.services.map((s) => s.name).join("; ")}` : "",
    study?.differentiators.length ? `Differentiators: ${study.differentiators.join("; ")}` : "",
    `Keywords (use 2-3): ${keywords.join(", ") || "(none)"}`,
    basics.profile?.category ? `Google category: ${basics.profile.category}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const r = await askGemini(DescSchema, system, user, 2500);
    const d: NapDescriptions = { shortEs: clip(r.shortEs, 200), shortEn: clip(r.shortEn, 200), longEs: clip(r.longEs, 750), longEn: clip(r.longEn, 750) };
    const ok = readDescriptions(d);
    if (!ok) return { ok: false, message: t("La IA no devolvió descripciones. Intenta otra vez.", "The AI didn't return descriptions. Try again.") };
    await logAiAction({
      businessId,
      kind: NAP_DESCRIPTION_KIND,
      summary: { es: "La IA escribió las descripciones del negocio para los directorios (corta y larga, español e inglés).", en: "The AI wrote the business descriptions for directories (short and long, Spanish and English)." },
      detail: ok,
      actor: "owner",
    });
    revalidatePath(page(businessId));
    return { ok: true, message: t("Listo: la IA escribió tus descripciones.", "Done: the AI wrote your descriptions."), descriptions: ok };
  } catch (e) {
    return { ok: false, message: t(`No se pudo usar la IA: ${errorText(e, lang).slice(0, 200)}`, `Couldn't use the AI: ${errorText(e, lang).slice(0, 200)}`) };
  }
}

// ---------- Link de reseñas ----------

/** Anota que el dueño copió o descargó su link de reseñas (para el recordatorio de 30 días). Como mucho una vez cada 12 horas. */
export async function markReviewShared(businessId: string, how: "copy" | "qr" | "card"): Promise<void> {
  const exists = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!exists) return;
  const recent = await recentAiActions(businessId, { since: new Date(Date.now() - DAY_MS / 2), limit: 100 });
  if (recent.some((r) => r.kind === REVIEW_LINK_KIND)) return;
  const what = { copy: { es: "copió", en: "copied" }, qr: { es: "descargó el código QR de", en: "downloaded the QR code for" }, card: { es: "descargó la tarjeta de", en: "downloaded the card for" } }[how];
  await logAiAction({
    businessId,
    kind: REVIEW_LINK_KIND,
    summary: { es: `El dueño ${what.es} su link de reseñas de Google.`, en: `The owner ${what.en} their Google review link.` },
    detail: { how },
    actor: "owner",
  });
  await afterChange(businessId);
}

// ---------- Pedir reseñas ----------

const TemplateSchema = z.object({
  subject: z.string().describe("Email subject, max 70 characters"),
  email: z.string().describe("Email body, 50-110 words, plain text with line breaks. Must contain the literal placeholder {link} once and greet with the placeholder {name}"),
  sms: z.string().describe("SMS, max 200 characters. Must contain {name} and {link}"),
});

/** La IA escribe el pedido de reseña con la voz de la marca (sin ofrecer nada a cambio). Si falla, la plantilla. */
export async function writeReviewTemplate(businessId: string, reqLang: "es" | "en"): Promise<{ ok: boolean; message: string; template: ReqTemplate }> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { name: true, aiProfile: true, brandVoice: true, brandIdentity: true, ownerName: true } });
  const base = defaultTemplate(reqLang, { name: b?.name ?? "", slogan: b ? brandSlogan(b, reqLang) : "", signer: b?.ownerName });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found"), template: base };
  if (!process.env.GEMINI_API_KEY) return { ok: false, message: t("La IA no está configurada; dejamos la plantilla.", "AI isn't set up; we kept the template."), template: base };
  const nameKey = reqLang === "es" ? "{nombre}" : "{name}";
  const system = [
    `You write a short, warm message asking a past customer of ${b.name} to leave a Google review. Language: ${reqLang === "en" ? "English" : "Spanish with correct accents"}.`,
    "Google's rules: NEVER offer anything in return (discounts, gifts, raffles, money), never ask for 5 stars or only for positive reviews, never pressure. Ask for an honest review of their experience.",
    "Use the placeholders exactly: {name} for the customer's first name and {link} for the review link. Do not write any URL.",
    b.brandVoice.trim() ? `Brand voice (follow it):\n<brand_voice>\n${b.brandVoice.trim().slice(0, 1500)}\n</brand_voice>` : "",
    identityPrompt(b),
  ]
    .filter(Boolean)
    .join("\n");
  const user = `Business: ${b.name}\nSigned by: ${[b.ownerName, b.name].filter(Boolean).join(" · ")}\nBusiness profile (facts):\n${b.aiProfile.slice(0, 1500) || "(none)"}`;
  try {
    const r = await askGemini(TemplateSchema, system, user, 1200);
    const fix = (s: string) => s.replace(/\{name\}/gi, nameKey).replace(/\{nombre\}/gi, nameKey).trim();
    const tpl: ReqTemplate = { subject: fix(r.subject).slice(0, 120), email: fix(r.email).slice(0, 2000), sms: fix(r.sms).slice(0, 320) };
    if (!hasLink(tpl.email, "") || !hasLink(tpl.sms, "") || incentiveIssues(`${tpl.subject} ${tpl.email} ${tpl.sms}`).length)
      return { ok: false, message: t("La IA escribió algo que no cumple las reglas; dejamos la plantilla.", "The AI wrote something that breaks the rules; we kept the template."), template: base };
    await logAiAction({
      businessId,
      kind: "review.template",
      summary: { es: "La IA escribió el mensaje para pedir reseñas con la voz de la marca.", en: "The AI wrote the review-request message in the brand voice." },
      detail: { lang: reqLang },
      actor: "owner",
    });
    return { ok: true, message: t("Listo: revisa el mensaje y cámbialo si quieres.", "Done: check the message and edit it if you like."), template: tpl };
  } catch (e) {
    return { ok: false, message: t(`No se pudo usar la IA (${errorText(e, lang).slice(0, 160)}); dejamos la plantilla.`, `Couldn't use the AI (${errorText(e, lang).slice(0, 160)}); we kept the template.`), template: base };
  }
}

/** Manda el pedido de reseña a los contactos elegidos (solo con permiso), con límite por día. Queda anotado. */
export async function sendReviewRequests(businessId: string, _prev: DirResult, f: FormData): Promise<DirResult> {
  void _prev;
  const { lang, t } = await getT();
  const channel: ReqChannel = str(f, "channel", 10) === "sms" ? "sms" : "email";
  const reqLang = str(f, "lang", 5) === "en" ? "en" : "es";
  const subject = str(f, "subject", 120);
  const body = str(f, "body", channel === "sms" ? 320 : 2000);
  const ids = f.getAll("contact").map(String).slice(0, 500);
  if (f.get("confirm") !== "on") return { ok: false, message: t("Marca la casilla para confirmar el envío.", "Tick the box to confirm sending.") };
  const basics = await loadDirectoryBasics(businessId);
  if (!basics) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const link = basics.reviewLink;
  if (!link)
    return {
      ok: false,
      message: t(
        "Todavía no tenemos tu link de reseñas: elige tu negocio en Google Maps (SEO → Google Maps) o actualiza tu Perfil de Google.",
        "We don't have your review link yet: pick your business on Google Maps (SEO → Google Maps) or refresh your Google profile.",
      ),
    };
  if (!body) return { ok: false, message: t("Escribe el mensaje.", "Write the message.") };
  if (channel === "email" && !subject) return { ok: false, message: t("Escribe el asunto del correo.", "Write the email subject.") };
  if (!hasLink(body, link)) return { ok: false, message: t("El mensaje debe llevar {link} (ahí va tu link de reseñas).", "The message must include {link} (that's where your review link goes).") };
  const bad = incentiveIssues(`${subject} ${body}`);
  if (bad.length)
    return {
      ok: false,
      message: t(
        `Quita esto del mensaje: ${bad.join(", ")}. Google no permite ofrecer nada a cambio de reseñas ni pedir solo reseñas buenas, y puede borrarlas.`,
        `Remove this from the message: ${bad.join(", ")}. Google doesn't allow offering anything for reviews or asking only for good ones, and may remove them.`,
      ),
    };
  if (!ids.length) return { ok: false, message: t("Elige al menos un contacto.", "Pick at least one contact.") };

  const now = Date.now();
  const [contacts, logs, conn] = await Promise.all([
    db.contact.findMany({ where: { businessId, id: { in: ids } }, select: { id: true, name: true, email: true, phone: true, emailOptIn: true, smsOptIn: true } }),
    recentAiActions(businessId, { since: new Date(now - REVIEW_COOLDOWN_DAYS * DAY_MS), limit: 500 }),
    db.connection.findUnique({ where: { businessId_channel: { businessId, channel } } }),
  ]);
  const reqLogs = logs.filter((l) => l.kind === REVIEW_REQUEST_KIND);
  const asked = new Set(reqLogs.flatMap((l) => readRequestLog(l.detail)?.contactIds ?? []));
  const remaining = REVIEW_DAILY_MAX - sentInLogs(reqLogs.filter((l) => l.createdAt.getTime() >= now - DAY_MS));
  if (remaining <= 0)
    return { ok: false, message: t(`Ya pediste ${REVIEW_DAILY_MAX} reseñas hoy. Sigue mañana: pocas a la vez se ve natural.`, `You already asked ${REVIEW_DAILY_MAX} people today. Continue tomorrow: a few at a time looks natural.`) };
  const pick = pickRecipients(contacts, ids, channel, asked, remaining);
  if (!pick.send.length)
    return {
      ok: false,
      message: t(
        "Ninguno de los elegidos se puede contactar ahora: necesitan permiso para este canal y no haberles pedido en los últimos 90 días.",
        "None of the chosen contacts can be reached now: they need permission for this channel and not to have been asked in the last 90 days.",
      ),
    };
  if (!conn)
    return {
      ok: false,
      message:
        channel === "email"
          ? t("Primero conecta tu email en «Conexiones» (Brevo o Resend).", "First connect your email in “Connections” (Brevo or Resend).")
          : t("Primero conecta los mensajes de texto en «Conexiones» (Twilio).", "First connect text messages in “Connections” (Twilio)."),
    };
  let creds: Record<string, string>;
  try {
    creds = decryptJson(conn.secret);
  } catch {
    return { ok: false, message: t("No pudimos leer la conexión. Vuelve a conectarla en «Conexiones».", "We couldn't read the connection. Reconnect it in “Connections”.") };
  }

  const b = basics.business;
  const sentIds: string[] = [];
  let failed = 0;
  let firstError = "";
  for (const c of pick.send) {
    const text = fillTemplate(body, { name: c.name, link });
    try {
      await PUBLISHERS[channel].publish(
        { text, subject: fillTemplate(subject, { name: c.name, link }), seoTitle: "", mediaType: "none", mediaUrl: "", businessName: b.name, contacts: [{ ...c }] },
        creds,
      );
      sentIds.push(c.id);
    } catch (e) {
      failed++;
      if (!firstError) firstError = errorText(e, lang).slice(0, 200);
    }
  }
  const how = channel === "email" ? { es: "email", en: "email" } : { es: "SMS", en: "SMS" };
  await logAiAction({
    businessId,
    kind: REVIEW_REQUEST_KIND,
    summary: {
      es: `Se pidió una reseña de Google a ${sentIds.length} ${sentIds.length === 1 ? "cliente" : "clientes"} por ${how.es}${failed ? ` (${failed} no se pudieron enviar)` : ""}.`,
      en: `Asked ${sentIds.length} ${sentIds.length === 1 ? "customer" : "customers"} for a Google review by ${how.en}${failed ? ` (${failed} couldn't be sent)` : ""}.`,
    },
    detail: { channel, sent: sentIds.length, failed, contactIds: sentIds, lang: reqLang },
    actor: "owner",
  });
  await afterChange(businessId);
  const skipped = pick.noConsent + pick.recent + pick.overLimit;
  const extra = [
    pick.noConsent ? t(`${pick.noConsent} sin permiso`, `${pick.noConsent} without permission`) : "",
    pick.recent ? t(`${pick.recent} ya se les pidió hace poco`, `${pick.recent} were asked recently`) : "",
    pick.overLimit ? t(`${pick.overLimit} quedan para mañana (límite diario)`, `${pick.overLimit} left for tomorrow (daily limit)`) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (!sentIds.length) return { ok: false, message: t(`No se pudo enviar: ${firstError}`, `Couldn't send: ${firstError}`) };
  return {
    ok: true,
    message:
      t(`Listo: se pidió reseña a ${sentIds.length} ${sentIds.length === 1 ? "persona" : "personas"}.`, `Done: asked ${sentIds.length} ${sentIds.length === 1 ? "person" : "people"} for a review.`) +
      (failed ? t(` ${failed} fallaron (${firstError}).`, ` ${failed} failed (${firstError}).`) : "") +
      (skipped ? ` ${t("No se envió a:", "Not sent to:")} ${extra}.` : ""),
  };
}
