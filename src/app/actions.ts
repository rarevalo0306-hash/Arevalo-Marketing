"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { aiEnabled, designTemplates, planWeek, readBrandBook, stormPlan, suggestBrandKit, type BrandKitSuggestion, TEXT_PROVIDERS, toPostFields, writePost, type AiPost, type AiPostOut, type Lang } from "@/lib/ai";
import { recentOpenings } from "@/lib/content-ideas";
import { brevoDomains, brevoEnvKey } from "@/lib/brevo";
import { CHANNEL_IDS, channelDef, type ChannelId } from "@/lib/channels";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { normalizePhone, parseContactsCsv } from "@/lib/contacts";
import { db } from "@/lib/db";
import { startVideo, videoEnabled, videoResult, type Shape, type VideoJob } from "@/lib/fal";
import { DESIGN_SHAPES, type Brand, type DesignShape } from "@/lib/design";
import { BUILTIN_TEMPLATES, FONTS, hexOr, pickTemplate, StoredTemplate } from "@/lib/design-shapes";
import { photoContextFor, photoMetaFor, storeDesign } from "@/lib/media-formats";
import { createImage, IMAGE_PROVIDERS, imagesEnabled } from "@/lib/imagegen";
import { createSignedUpload, isOwnFile, saveUpload, storeRemote } from "@/lib/media";
import { GOOGLE_COOKIE, saveGoogleLocation, type GoogleLocation } from "@/lib/google-oauth";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { listPages, META_COOKIE, saveMetaPage } from "@/lib/meta-oauth";
import { publishPost, retryPost } from "@/lib/publish";
import { PUBLISHERS } from "@/lib/publishers";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/lib/session";
import { stormEvent, stormSchedule } from "@/lib/storm";
import { businessDay, localToUtc } from "@/lib/time";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const HEX = /^#[0-9a-fA-F]{6}$/;

async function business(id: string) {
  const b = await db.business.findUnique({ where: { id } });
  if (!b) {
    const { t } = await getT();
    throw new Error(t("Negocio no encontrado", "Business not found"));
  }
  return b;
}

// ---------- Sesión ----------

export async function login(_: string | null, f: FormData): Promise<string | null> {
  const { t } = await getT();
  const expected = process.env.APP_PASSWORD;
  if (!expected) return t("Falta APP_PASSWORD en el archivo .env del servidor.", "APP_PASSWORD is missing from the server's .env file.");
  if (!safeEqual(str(f, "password"), expected)) return t("Contraseña incorrecta.", "Wrong password.");
  (await cookies()).set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- Negocios ----------

export async function createBusiness(f: FormData) {
  const { t } = await getT();
  const name = str(f, "name");
  if (!name) throw new Error(t("Escribe el nombre del negocio", "Enter the business name"));
  const color = HEX.test(str(f, "color")) ? str(f, "color") : "#126BBC";
  const b = await db.business.create({ data: { name, color, website: str(f, "website") } });
  redirect(`/b/${b.id}/conexiones`);
}

export async function updateBusiness(id: string, f: FormData) {
  await business(id);
  const { t } = await getT();
  const name = str(f, "name");
  if (!name) throw new Error(t("Escribe el nombre del negocio", "Enter the business name"));
  const color = HEX.test(str(f, "color")) ? str(f, "color") : undefined;
  await db.business.update({ where: { id }, data: { name, website: str(f, "website"), ...(color && { color }) } });
  revalidatePath(`/b/${id}`, "layout");
}

export async function deleteBusiness(id: string, f: FormData) {
  const b = await business(id);
  const { t } = await getT();
  if (str(f, "confirm") !== b.name) throw new Error(t("Escribe el nombre exacto para confirmar", "Type the exact name to confirm"));
  await db.business.delete({ where: { id } });
  redirect("/");
}

// ---------- Conexiones ----------

export async function saveConnection(businessId: string, channel: ChannelId, f: FormData) {
  await business(businessId);
  const def = channelDef(channel);
  if (!def) {
    const { t } = await getT();
    throw new Error(t("Canal desconocido", "Unknown channel"));
  }
  const existing = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel } } });
  const previous = existing ? decryptJson(existing.secret) : {};
  const values: Record<string, string> = {};
  for (const field of def.fields) {
    const v = str(f, field.key);
    // Un campo secreto vacío conserva el valor guardado.
    values[field.key] = v || (field.secret ? previous[field.key] ?? "" : "");
  }
  const secret = encryptJson(values);
  // El nombre visible nunca es un dato secreto (va sin cifrar).
  const labelField = def.fields.find((x) => !x.secret);
  const label = labelField ? values[labelField.key] ?? "" : "";
  await db.connection.upsert({
    where: { businessId_channel: { businessId, channel } },
    create: { businessId, channel, secret, label },
    update: { secret, label },
  });
  revalidatePath(`/b/${businessId}/conexiones`);
}

/** Email con la clave de Brevo de la app: el negocio solo pone el nombre y el email que envía. */
export async function connectBrevo(businessId: string, f: FormData): Promise<TestResult> {
  const b = await business(businessId);
  const { t } = await getT();
  if (!brevoEnvKey()) return { ok: false, message: t("Falta BREVO_API_KEY en la configuración del servidor.", "BREVO_API_KEY is missing from the server settings.") };
  const name = (str(f, "name") || b.name).replace(/[<>"]/g, "").slice(0, 80);
  const address = str(f, "email").toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/.test(address)) return { ok: false, message: t("Escribe un email válido, por ejemplo info@tunegocio.com", "Enter a valid email, for example info@yourbusiness.com") };
  const domains = await brevoDomains();
  const domain = address.split("@")[1];
  if (!domains.includes(domain))
    return {
      ok: false,
      message: t(
        `El dominio ${domain} no está autenticado en Brevo.${domains.length ? ` Dominios listos: ${domains.join(", ")}.` : ""} Autentícalo en Brevo → Remitentes y dominios.`,
        `The domain ${domain} isn't authenticated in Brevo.${domains.length ? ` Ready domains: ${domains.join(", ")}.` : ""} Authenticate it in Brevo → Senders & Domains.`,
      ),
    };
  const from = `${name} <${address}>`;
  await db.connection.upsert({
    where: { businessId_channel: { businessId, channel: "email" } },
    create: { businessId, channel: "email", secret: encryptJson({ apiKey: "", from }), label: from },
    update: { secret: encryptJson({ apiKey: "", from }), label: from },
  });
  revalidatePath(`/b/${businessId}/conexiones`);
  return { ok: true, message: t(`Listo: los emails de ${b.name} saldrán desde ${from}.`, `Done: emails from ${b.name} will be sent from ${from}.`) };
}

/** Después de "Conectar con Facebook", cuando la cuenta administra varias páginas. */
export async function chooseMetaPage(businessId: string, pageId: string) {
  await business(businessId);
  const { t } = await getT();
  const jar = await cookies();
  const raw = jar.get(META_COOKIE)?.value;
  const saved = raw ? decryptJson<{ userToken: string; businessId: string }>(raw) : null;
  if (!saved || saved.businessId !== businessId) redirect(`/b/${businessId}/conexiones?meta=error&msg=${encodeURIComponent(t("La conexión venció. Vuelve a intentarlo.", "The connection expired. Please try again."))}`);
  const page = (await listPages(saved.userToken)).find((p) => p.id === pageId);
  if (!page) throw new Error(t("Esa página ya no está disponible", "That Page is no longer available"));
  const { instagram } = await saveMetaPage(businessId, page);
  jar.delete(META_COOKIE);
  revalidatePath(`/b/${businessId}/conexiones`);
  redirect(`/b/${businessId}/conexiones?${new URLSearchParams({ meta: "ok", page: page.name, ig: instagram ?? "" })}`);
}

/** Después de "Conectar con Google", cuando la cuenta administra varios perfiles. */
export async function chooseGoogleLocation(businessId: string, locationId: string) {
  await business(businessId);
  const { t } = await getT();
  const jar = await cookies();
  const raw = jar.get(GOOGLE_COOKIE)?.value;
  const saved = raw ? decryptJson<{ refreshToken: string; businessId: string; locations: GoogleLocation[] }>(raw) : null;
  if (!saved || saved.businessId !== businessId) redirect(`/b/${businessId}/conexiones?google=error&msg=${encodeURIComponent(t("La conexión venció. Vuelve a intentarlo.", "The connection expired. Please try again."))}`);
  const loc = saved.locations.find((l) => l.locationId === locationId);
  if (!loc) throw new Error(t("Ese perfil ya no está disponible", "That profile is no longer available"));
  await saveGoogleLocation(businessId, saved.refreshToken, loc);
  jar.delete(GOOGLE_COOKIE);
  revalidatePath(`/b/${businessId}/conexiones`);
  redirect(`/b/${businessId}/conexiones?${new URLSearchParams({ google: "ok", place: loc.title })}`);
}

export async function deleteConnection(businessId: string, channel: ChannelId) {
  await db.connection.deleteMany({ where: { businessId, channel } });
  revalidatePath(`/b/${businessId}/conexiones`);
}

export type TestResult = { ok: boolean; message: string } | null;

export async function testConnection(businessId: string, channel: ChannelId): Promise<TestResult> {
  const { lang, t } = await getT();
  const conn = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel } } });
  if (!conn) return { ok: false, message: t("Primero guarda los datos de la conexión.", "Save the connection details first.") };
  try {
    return { ok: true, message: await PUBLISHERS[channel].test(decryptJson(conn.secret)) };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

// ---------- Contactos ----------

export async function addContact(businessId: string, f: FormData) {
  await business(businessId);
  const email = str(f, "email");
  const phone = normalizePhone(str(f, "phone"));
  if (!email && !phone) {
    const { t } = await getT();
    throw new Error(t("Escribe un email o un teléfono", "Enter an email or a phone number"));
  }
  await db.contact.create({
    data: {
      businessId,
      name: str(f, "name"),
      email,
      phone,
      emailOptIn: f.get("emailOptIn") === "on",
      smsOptIn: f.get("smsOptIn") === "on",
    },
  });
  revalidatePath(`/b/${businessId}/contactos`);
}

export async function importContacts(businessId: string, f: FormData) {
  await business(businessId);
  const rows = parseContactsCsv(str(f, "csv"), {
    emailOptIn: f.get("emailOptIn") === "on",
    smsOptIn: f.get("smsOptIn") === "on",
  });
  if (rows.length) await db.contact.createMany({ data: rows.map((r) => ({ ...r, businessId })) });
  revalidatePath(`/b/${businessId}/contactos`);
}

export async function updateContactConsent(businessId: string, contactId: string, field: "emailOptIn" | "smsOptIn", value: boolean) {
  await db.contact.updateMany({ where: { id: contactId, businessId }, data: { [field]: value } });
  revalidatePath(`/b/${businessId}/contactos`);
}

export async function deleteContact(businessId: string, contactId: string) {
  await db.contact.deleteMany({ where: { id: contactId, businessId } });
  revalidatePath(`/b/${businessId}/contactos`);
}

// ---------- Publicaciones ----------

/** Dirección para que el navegador suba la foto o el video directo a Supabase Storage. */
export async function getUploadUrl(businessId: string, contentType: string) {
  await business(businessId);
  return createSignedUpload(contentType, businessId);
}

export async function createPost(businessId: string, f: FormData) {
  await business(businessId);
  const { t } = await getT();
  const text = String(f.get("text") ?? "").trim();
  if (!text) throw new Error(t("Escribe tu mensaje", "Write your message"));
  const channels = f.getAll("channels").map(String).filter((c): c is ChannelId => CHANNEL_IDS.includes(c as ChannelId));
  if (!channels.length) throw new Error(t("Elige al menos un canal", "Choose at least one channel"));

  let mediaUrl = "";
  let mediaType = str(f, "mediaType");
  const file = f.get("file");
  if (file instanceof File && file.size > 0) {
    const saved = await saveUpload(file);
    mediaUrl = saved.path;
    mediaType = saved.type;
  } else if (mediaType !== "none" && /^https?:\/\//i.test(str(f, "mediaLink"))) {
    mediaUrl = str(f, "mediaLink");
  } else {
    mediaType = "none";
  }

  const later = str(f, "when") === "later";
  let scheduledAt = new Date();
  if (later) {
    scheduledAt = new Date(str(f, "scheduledAt"));
    if (isNaN(scheduledAt.getTime())) throw new Error(t("Elige la fecha y hora para programar", "Choose the date and time to schedule"));
  }

  let variants: Partial<Record<ChannelId, string>> | undefined;
  try {
    const raw = JSON.parse(str(f, "variants") || "{}") as Record<string, unknown>;
    const clean = Object.fromEntries(
      Object.entries(raw).filter(([k, v]) => CHANNEL_IDS.includes(k as ChannelId) && typeof v === "string" && v.trim()),
    ) as Partial<Record<ChannelId, string>>;
    if (Object.keys(clean).length) variants = clean;
  } catch {
    variants = undefined;
  }

  const post = await db.post.create({
    data: {
      businessId,
      text,
      variants,
      source: str(f, "source") === "ai" ? "ai" : "manual",
      subject: str(f, "subject"),
      seoTitle: str(f, "seoTitle"),
      mediaUrl,
      mediaType: mediaType === "photo" || mediaType === "video" ? mediaType : "none",
      scheduledAt,
      targets: { create: channels.map((channel) => ({ channel })) },
    },
  });
  if (!later || scheduledAt <= new Date()) await publishPost(post.id);
  revalidatePath(`/b/${businessId}/historial`);
  redirect(`/b/${businessId}/historial?nuevo=${post.id}`);
}

export async function retry(businessId: string, postId: string) {
  const post = await db.post.findFirst({ where: { id: postId, businessId } });
  if (!post) return;
  await retryPost(postId);
  revalidatePath(`/b/${businessId}/historial`);
}

export async function publishNow(businessId: string, postId: string) {
  const res = await db.post.updateMany({
    where: { id: postId, businessId, status: "scheduled" },
    data: { scheduledAt: new Date() },
  });
  if (res.count) await publishPost(postId);
  revalidatePath(`/b/${businessId}/historial`);
}

export async function deletePost(businessId: string, postId: string) {
  await db.post.deleteMany({ where: { id: postId, businessId, status: { not: "publishing" } } });
  revalidatePath(`/b/${businessId}/historial`);
  revalidatePath(`/b/${businessId}/plan`);
}

// ---------- Agente de IA ----------

const LANGS: Lang[] = ["es", "en", "both"];
const postLang = (v: string): Lang => (LANGS.includes(v as Lang) ? (v as Lang) : "es");

export type AiWriteResult = { ok: true; post: AiPostOut } | { ok: false; error: string };

/**
 * El compositor pide un texto a la IA a partir de una idea. La IA ve el comienzo de las últimas publicaciones para
 * no repetirse; con `bilingual`, también escribe Facebook e Instagram en el otro idioma.
 */
export async function aiWrite(businessId: string, idea: string, language: string, opts?: { bilingual?: boolean }): Promise<AiWriteResult> {
  const b = await business(businessId);
  const { lang, t } = await getT();
  if (!idea.trim()) return { ok: false, error: t("Escribe una idea o tema.", "Write an idea or topic.") };
  try {
    const avoid = await recentOpenings(businessId);
    return { ok: true, post: await writePost(b, idea.slice(0, 2000), postLang(language), { avoid, bilingual: opts?.bilingual === true }) };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

export async function updateAiSettings(businessId: string, f: FormData) {
  await business(businessId);
  await db.business.update({
    where: { id: businessId },
    data: {
      aiProfile: str(f, "aiProfile").slice(0, 4000),
      aiAutopublish: f.get("aiAutopublish") === "on",
      aiText: TEXT_PROVIDERS.some((p) => p.id === str(f, "aiText")) ? str(f, "aiText") : "",
      aiImage: IMAGE_PROVIDERS.some((p) => p.id === str(f, "aiImage")) ? str(f, "aiImage") : "",
    },
  });
  revalidatePath(`/b/${businessId}`, "layout");
}

export type PlanResult = { ok: boolean; message: string } | null;

/** Genera las publicaciones de una semana: borradores para aprobar, o programadas si el negocio tiene publicación automática. */
export async function generatePlan(businessId: string, _prev: PlanResult, f: FormData): Promise<PlanResult> {
  const b = await business(businessId);
  const { lang, t } = await getT();
  if (!aiEnabled()) return { ok: false, message: t("Falta la clave de la IA (GEMINI_API_KEY) en la configuración del servidor.", "The AI key (GEMINI_API_KEY) is missing from the server settings.") };
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(str(f, "startDate")) ? str(f, "startDate") : businessDay(new Date());
  const count = Math.min(14, Math.max(1, Number(str(f, "count")) || 7));
  const channels = f.getAll("channels").map(String).filter((c): c is ChannelId => CHANNEL_IDS.includes(c as ChannelId));
  if (!channels.length) return { ok: false, message: t("Elige al menos un canal.", "Choose at least one channel.") };
  try {
    const plan = await planWeek(b, { startDate, count, themes: str(f, "themes").slice(0, 1000), lang: postLang(str(f, "lang")), avoid: await recentOpenings(businessId) });
    const now = new Date();
    await savePlanPosts(b, businessId, channels, plan.posts.map((item) => {
      const at = localToUtc(startDate, item.day, item.time);
      return { post: item.post, scheduledAt: at < now ? new Date(now.getTime() + 60 * 60 * 1000) : at };
    }));
    revalidatePath(`/b/${businessId}/plan`);
    const n = plan.posts.length;
    return {
      ok: true,
      message: b.aiAutopublish
        ? t(`Listo: ${n} publicaciones programadas. Saldrán solas a su hora.`, `Done: ${n} posts scheduled. They'll go out on their own at the set time.`)
        : t(`Listo: ${n} borradores. Revísalos abajo y aprueba los que te gusten.`, `Done: ${n} drafts. Review them below and approve the ones you like.`),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Guarda las publicaciones de un plan: una foto con la marca para cada una y su hora. */
async function savePlanPosts(
  b: Awaited<ReturnType<typeof business>>,
  businessId: string,
  channels: ChannelId[],
  items: { post: AiPost; scheduledAt: Date }[],
) {
  // Una foto para cada publicación (si hay clave de imágenes). Si una falla, esa publicación queda sin foto.
  const images = imagesEnabled()
    ? await Promise.all(
        items.map(async ({ post }, i) => {
          try {
            const photo = await createImage(b.aiImage, post.imageIdea, "square", businessId, photoContextFor(b, { title: post.imageHeadline }));
            // Con la marca activada, la foto sale con logo, titular y teléfono; si el diseño falla, queda la foto sola.
            return b.brandImages && post.imageHeadline.trim()
              ? await brandPhoto(b, { photoUrl: photo, headline: post.imageHeadline, steps: post.imageSteps, seed: i }).catch(() => photo)
              : photo;
          } catch {
            return null;
          }
        }),
      )
    : items.map(() => null);
  for (const [i, { post, scheduledAt }] of items.entries()) {
    const image = images[i];
    await db.post.create({
      data: {
        businessId,
        ...toPostFields(post),
        ...(image ? { mediaUrl: image, mediaType: "photo" } : {}),
        source: "ai",
        status: b.aiAutopublish ? "scheduled" : "draft",
        scheduledAt,
        targets: { create: channels.map((channel) => ({ channel })) },
      },
    });
  }
}

/** Campaña de tormenta: 6 publicaciones listas, las de ofrecer servicios después de 48 horas. */
export async function stormCampaign(businessId: string, _prev: PlanResult, f: FormData): Promise<PlanResult> {
  const b = await business(businessId);
  const { lang, t } = await getT();
  if (!aiEnabled()) return { ok: false, message: t("Falta la clave de la IA (GEMINI_API_KEY) en la configuración del servidor.", "The AI key (GEMINI_API_KEY) is missing from the server settings.") };
  const event = stormEvent(str(f, "event"));
  if (!event) return { ok: false, message: t("Elige qué tipo de tormenta fue.", "Choose what kind of storm it was.") };
  const channels = f.getAll("channels").map(String).filter((c): c is ChannelId => CHANNEL_IDS.includes(c as ChannelId));
  if (!channels.length) return { ok: false, message: t("Elige al menos un canal.", "Choose at least one channel.") };
  const [date, time] = str(f, "eventAt").split("T");
  const eventAt = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? localToUtc(date, 0, time ?? "") : new Date();
  if (Date.now() - eventAt.getTime() > 10 * 24 * 3600000) return { ok: false, message: t("La tormenta fue hace más de 10 días. Usa el plan de la semana normal.", "The storm was more than 10 days ago. Use the regular weekly plan.") };
  try {
    const plan = await stormPlan(b, { event: event.en, zone: str(f, "zone").slice(0, 300), lang: postLang(str(f, "lang")) });
    const now = new Date();
    const sinceEvent = Math.max(0, (now.getTime() - eventAt.getTime()) / 3600000);
    await savePlanPosts(b, businessId, channels, plan.posts.map((item, i) => {
      // Si la hora que pidió la IA ya pasó, sale en las próximas horas permitidas, una cada 3 horas.
      const hours = Math.max(item.hoursAfter, sinceEvent + 1 + i * 3);
      return { post: item.post, scheduledAt: stormSchedule(eventAt, hours, item.phase) };
    }));
    revalidatePath(`/b/${businessId}/plan`);
    const n = plan.posts.length;
    return {
      ok: true,
      message: b.aiAutopublish
        ? t(
            `Listo: campaña de ${n} publicaciones programada. Las que ofrecen tus servicios salen después de 48 horas.`,
            `Done: a ${n}-post campaign is scheduled. The ones that offer your services go out after 48 hours.`,
          )
        : t(
            `Listo: campaña de ${n} borradores abajo. Las que ofrecen tus servicios están programadas después de 48 horas.`,
            `Done: a ${n}-draft campaign is below. The ones that offer your services are scheduled after 48 hours.`,
          ),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Guarda los cambios del borrador y lo programa. */
export async function approveDraft(businessId: string, postId: string, f: FormData) {
  const post = await db.post.findFirst({ where: { id: postId, businessId, status: "draft" }, include: { targets: true } });
  if (!post) return;
  const variants = { ...((post.variants ?? {}) as Record<string, string>) };
  for (const t of post.targets) {
    const v = f.get(`v_${t.channel}`);
    if (typeof v === "string") variants[t.channel] = v.trim();
  }
  const subject = f.get("subject");
  await db.post.update({
    where: { id: postId },
    data: {
      variants,
      text: variants.facebook || post.text,
      subject: typeof subject === "string" ? subject.trim() : post.subject,
      status: "scheduled",
    },
  });
  revalidatePath(`/b/${businessId}/plan`);
  revalidatePath(`/b/${businessId}/historial`);
}

// ---------- Imágenes y videos con IA ----------

const SHAPES: Shape[] = ["square", "vertical", "horizontal"];


export type MediaResult = { ok: true; url: string } | { ok: false; error: string };

/** Crea una foto con IA y la guarda en tu almacenamiento. */
export async function aiImage(businessId: string, description: string, shape: string): Promise<MediaResult> {
  const b = await business(businessId);
  const { lang, t } = await getT();
  if (!imagesEnabled()) return { ok: false, error: t("Falta una clave para crear imágenes en la configuración del servidor.", "An image key is missing from the server settings.") };
  if (!description.trim()) return { ok: false, error: t("Describe la imagen que quieres.", "Describe the image you want.") };
  try {
    return { ok: true, url: await createImage(b.aiImage, description, SHAPES.includes(shape as Shape) ? (shape as Shape) : "square", businessId, photoContextFor(b, { title: description })) };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

export type VideoStart = { ok: true; job: VideoJob } | { ok: false; error: string };

/** Empieza a convertir una foto en video (5 segundos). */
export async function aiVideoStart(businessId: string, imageUrl: string, motion: string): Promise<VideoStart> {
  await business(businessId);
  const { lang, t } = await getT();
  if (!videoEnabled()) return { ok: false, error: t("Falta la clave para videos (FAL_KEY o GEMINI_API_KEY) en la configuración del servidor.", "The video key (FAL_KEY or GEMINI_API_KEY) is missing from the server settings.") };
  if (!/^https:\/\//.test(imageUrl)) return { ok: false, error: t("Primero crea o sube una foto para el video.", "First create or upload a photo for the video.") };
  try {
    return { ok: true, job: await startVideo(imageUrl, motion.slice(0, 500)) };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

export type VideoCheck = { ok: true; done: false } | { ok: true; done: true; url: string } | { ok: false; error: string };

/** Pregunta si el video ya está listo; si lo está, lo guarda en tu almacenamiento. */
export async function aiVideoCheck(businessId: string, job: VideoJob): Promise<VideoCheck> {
  await business(businessId);
  const { lang } = await getT();
  try {
    const r = await videoResult(job);
    if (!r.done) return { ok: true, done: false };
    return { ok: true, done: true, url: (await storeRemote(r.url, businessId, r.headers)).url };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

// ---------- Diseño con la marca ----------

type BrandRow = Awaited<ReturnType<typeof business>>;
const brandOf = (b: BrandRow): Brand => ({ name: b.name, color: b.color, color2: b.color2, color3: b.color3, logoUrl: b.logoUrl, logoLightUrl: b.logoLightUrl, phone: b.phone, website: b.website, fontHeading: b.fontHeading, fontBody: b.fontBody });

/** Plantillas del negocio (las que creó la IA o subió el dueño), o las de fábrica si todavía no tiene. */
async function templatesOf(businessId: string): Promise<StoredTemplate[]> {
  const rows = await db.template.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } });
  const list = rows.map((r) => StoredTemplate.safeParse(r.spec)).filter((r) => r.success).map((r) => r.data!);
  return list.length ? list : BUILTIN_TEMPLATES;
}

/** Diseña un post con la marca del negocio y una plantilla, y guarda el resultado. */
async function brandPhoto(
  b: BrandRow,
  opts: { photoUrl?: string; headline: string; steps?: string[]; template?: number; shape?: DesignShape; seed?: number },
): Promise<string> {
  const list = await templatesOf(b.id);
  const template = pickTemplate(list, opts.template ?? -1, { headline: opts.headline, steps: opts.steps, hasPhoto: !!opts.photoUrl, seed: opts.seed });
  // Se guarda con los datos del negocio (autor, lugar, palabras clave) y con la receta para rehacerlo en el tamaño de cada red.
  return storeDesign({ brand: brandOf(b), template, headline: opts.headline, photoUrl: opts.photoUrl, steps: opts.steps, shape: opts.shape }, b.id, photoMetaFor(b, { title: opts.headline }));
}

export async function aiDesign(businessId: string, photoUrl: string, headline: string, shape: string, template = -1, steps: string[] = []): Promise<MediaResult> {
  const b = await business(businessId);
  const { lang, t } = await getT();
  if (photoUrl && !/^https:\/\//.test(photoUrl)) return { ok: false, error: t("La foto necesita una dirección pública.", "The photo needs a public web address.") };
  if (!headline.trim()) return { ok: false, error: t("Escribe el titular que va en la foto.", "Write the headline that goes on the photo.") };
  try {
    const url = await brandPhoto(b, { photoUrl: photoUrl || undefined, headline, steps: steps.slice(0, 3), template, shape: shape in DESIGN_SHAPES ? (shape as DesignShape) : "square" });
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: t(`No se pudo diseñar la imagen: ${errorText(e, lang)}`, `Couldn't design the image: ${errorText(e, lang)}`) };
  }
}

const safeUrl = (v: string) => (/^https:\/\//.test(v) || v === "" ? v : undefined);

/** Kit de marca: logos, colores, letras, tono de voz, hashtags, teléfono y diseño automático. */
export async function updateBrandKit(businessId: string, f: FormData) {
  const b = await business(businessId);
  const font = str(f, "fontHeading");
  await db.business.update({
    where: { id: businessId },
    data: {
      logoUrl: safeUrl(str(f, "logoUrl")),
      logoLightUrl: safeUrl(str(f, "logoLightUrl")),
      color: hexOr(str(f, "color"), b.color),
      color2: str(f, "color2") === "" ? "" : hexOr(str(f, "color2"), b.color2),
      color3: str(f, "color3") === "" ? "" : hexOr(str(f, "color3"), b.color3),
      fontHeading: font in FONTS ? font : b.fontHeading,
      fontBody: str(f, "fontBody").slice(0, 60),
      brandVoice: str(f, "brandVoice").slice(0, 2000),
      hashtags: str(f, "hashtags").slice(0, 300),
      phone: str(f, "phone").slice(0, 40),
      brandImages: f.get("brandImages") === "on",
    },
  });
  revalidatePath(`/b/${businessId}`, "layout");
}

export type BrandKitResult = { ok: true; kit: BrandKitSuggestion } | { ok: false; message: string };

export async function getBrandBookUploadUrl(businessId: string, contentType: string) {
  await business(businessId);
  return createSignedUpload(contentType, businessId, "document");
}

/** Guarda el manual de marca subido y la IA lo lee para llenar la identidad (el dueño revisa y guarda). */
export async function brandFromBook(businessId: string, url: string): Promise<BrandKitResult> {
  const b = await business(businessId);
  const { lang, t } = await getT();
  if (!isOwnFile(url, businessId)) return { ok: false, message: t("El archivo no es de este negocio.", "That file doesn't belong to this business.") };
  await db.business.update({ where: { id: businessId }, data: { brandBookUrl: url } });
  revalidatePath(`/b/${businessId}/marca`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(t(`No se pudo leer el archivo (${res.status}).`, `Couldn't read the file (${res.status}).`));
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > 18 * 1024 * 1024) return { ok: false, message: t("Se guardó el manual, pero es muy grande para que la IA lo lea (máximo 18 MB).", "The guide was saved, but it's too large for the AI to read (18 MB max).") };
    const mimeType = (res.headers.get("content-type") || "").split(";")[0].trim() || (url.endsWith(".pdf") ? "application/pdf" : "image/png");
    return { ok: true, kit: await readBrandBook(b, { mimeType, data }) };
  } catch (e) {
    return { ok: false, message: t(`Se guardó el manual, pero la IA no pudo leerlo: ${errorText(e, lang)}`, `The guide was saved, but the AI couldn't read it: ${errorText(e, lang)}`) };
  }
}

/** La IA propone una identidad de marca completa (el dueño revisa y guarda). */
export async function brandFromAi(businessId: string): Promise<BrandKitResult> {
  const b = await business(businessId);
  const { lang, t } = await getT();
  if (!aiEnabled()) return { ok: false, message: t("Falta la clave de la IA en la configuración del servidor.", "The AI key is missing from the server settings.") };
  try {
    return { ok: true, kit: await suggestBrandKit(b) };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

export type TemplatesResult = { ok: boolean; message: string } | null;

/** La IA diseña plantillas nuevas con la marca del negocio y las guarda. */
export async function generateTemplates(businessId: string): Promise<TemplatesResult> {
  const b = await business(businessId);
  const { lang, t } = await getT();
  if (!aiEnabled()) return { ok: false, message: t("Falta la clave de la IA en la configuración del servidor.", "The AI key is missing from the server settings.") };
  try {
    const specs = await designTemplates(b);
    await db.template.createMany({ data: specs.map((spec) => ({ businessId, name: spec.name.slice(0, 40), spec })) });
    revalidatePath(`/b/${businessId}/marca`);
    return { ok: true, message: t(`Listo: la IA creó ${specs.length} plantillas con tu marca.`, `Done: the AI created ${specs.length} templates with your brand.`) };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/**
 * La IA propone plantillas nuevas con la marca guardada (se llama sola al guardar cambios de colores, letras o logo).
 * Reemplaza las que diseñó la IA antes; las que subió el dueño (plantillas propias) se quedan.
 */
export async function proposeTemplates(businessId: string): Promise<TemplatesResult> {
  const b = await business(businessId);
  const { lang, t } = await getT();
  if (!aiEnabled()) return { ok: false, message: t("Falta la clave de la IA en la configuración del servidor.", "The AI key is missing from the server settings.") };
  try {
    const specs = await designTemplates(b);
    const old = await db.template.findMany({ where: { businessId }, select: { id: true, spec: true } });
    const aiMade = old.filter((x) => !(x.spec as { custom?: unknown } | null)?.custom).map((x) => x.id);
    await db.$transaction([
      db.template.deleteMany({ where: { businessId, id: { in: aiMade } } }),
      db.template.createMany({ data: specs.map((spec) => ({ businessId, name: spec.name.slice(0, 40), spec })) }),
    ]);
    revalidatePath(`/b/${businessId}/marca`);
    revalidatePath(`/b/${businessId}/publicar`);
    return { ok: true, message: t(`Listo: la IA te propone ${specs.length} plantillas con tu marca.`, `Done: the AI suggests ${specs.length} templates with your brand.`) };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

export async function deleteTemplate(businessId: string, templateId: string) {
  await db.template.deleteMany({ where: { id: templateId, businessId } });
  revalidatePath(`/b/${businessId}/marca`);
}

// El estudio del negocio (leer la web, entrevista, generar, borrar y recuperar) está en actions-study.ts.
