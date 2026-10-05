"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { aiEnabled, planWeek, TEXT_PROVIDERS, toPostFields, writePost, type AiPost, type Lang } from "@/lib/ai";
import { brevoDomains, brevoEnvKey } from "@/lib/brevo";
import { CHANNEL_IDS, channelDef, type ChannelId } from "@/lib/channels";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { normalizePhone, parseContactsCsv } from "@/lib/contacts";
import { db } from "@/lib/db";
import { falEnabled, startVideo, videoResult, type Shape, type VideoJob } from "@/lib/fal";
import { createImage, IMAGE_PROVIDERS, imagesEnabled } from "@/lib/imagegen";
import { createSignedUpload, saveUpload, storeRemote } from "@/lib/media";
import { GOOGLE_COOKIE, saveGoogleLocation, type GoogleLocation } from "@/lib/google-oauth";
import { listPages, META_COOKIE, saveMetaPage } from "@/lib/meta-oauth";
import { publishPost, retryPost } from "@/lib/publish";
import { PUBLISHERS } from "@/lib/publishers";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/lib/session";
import { localToUtc } from "@/lib/time";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const HEX = /^#[0-9a-fA-F]{6}$/;

async function business(id: string) {
  const b = await db.business.findUnique({ where: { id } });
  if (!b) throw new Error("Negocio no encontrado");
  return b;
}

// ---------- Sesión ----------

export async function login(_: string | null, f: FormData): Promise<string | null> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return "Falta APP_PASSWORD en el archivo .env del servidor.";
  if (!safeEqual(str(f, "password"), expected)) return "Contraseña incorrecta.";
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
  const name = str(f, "name");
  if (!name) throw new Error("Escribe el nombre del negocio");
  const color = HEX.test(str(f, "color")) ? str(f, "color") : "#126BBC";
  const b = await db.business.create({ data: { name, color, website: str(f, "website") } });
  redirect(`/b/${b.id}/conexiones`);
}

export async function updateBusiness(id: string, f: FormData) {
  await business(id);
  const name = str(f, "name");
  if (!name) throw new Error("Escribe el nombre del negocio");
  const color = HEX.test(str(f, "color")) ? str(f, "color") : undefined;
  await db.business.update({ where: { id }, data: { name, website: str(f, "website"), ...(color && { color }) } });
  revalidatePath(`/b/${id}`, "layout");
}

export async function deleteBusiness(id: string, f: FormData) {
  const b = await business(id);
  if (str(f, "confirm") !== b.name) throw new Error("Escribe el nombre exacto para confirmar");
  await db.business.delete({ where: { id } });
  redirect("/");
}

// ---------- Conexiones ----------

export async function saveConnection(businessId: string, channel: ChannelId, f: FormData) {
  await business(businessId);
  const def = channelDef(channel);
  if (!def) throw new Error("Canal desconocido");
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
  if (!brevoEnvKey()) return { ok: false, message: "Falta BREVO_API_KEY en la configuración del servidor." };
  const name = (str(f, "name") || b.name).replace(/[<>"]/g, "").slice(0, 80);
  const address = str(f, "email").toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/.test(address)) return { ok: false, message: "Escribe un email válido, por ejemplo info@tunegocio.com" };
  const domains = await brevoDomains();
  const domain = address.split("@")[1];
  if (!domains.includes(domain))
    return {
      ok: false,
      message: `El dominio ${domain} no está autenticado en Brevo.${domains.length ? ` Dominios listos: ${domains.join(", ")}.` : ""} Autentícalo en Brevo → Remitentes y dominios.`,
    };
  const from = `${name} <${address}>`;
  await db.connection.upsert({
    where: { businessId_channel: { businessId, channel: "email" } },
    create: { businessId, channel: "email", secret: encryptJson({ apiKey: "", from }), label: from },
    update: { secret: encryptJson({ apiKey: "", from }), label: from },
  });
  revalidatePath(`/b/${businessId}/conexiones`);
  return { ok: true, message: `Listo: los emails de ${b.name} saldrán desde ${from}.` };
}

/** Después de "Conectar con Facebook", cuando la cuenta administra varias páginas. */
export async function chooseMetaPage(businessId: string, pageId: string) {
  await business(businessId);
  const jar = await cookies();
  const raw = jar.get(META_COOKIE)?.value;
  const saved = raw ? decryptJson<{ userToken: string; businessId: string }>(raw) : null;
  if (!saved || saved.businessId !== businessId) redirect(`/b/${businessId}/conexiones?meta=error&msg=${encodeURIComponent("La conexión venció. Vuelve a intentarlo.")}`);
  const page = (await listPages(saved.userToken)).find((p) => p.id === pageId);
  if (!page) throw new Error("Esa página ya no está disponible");
  const { instagram } = await saveMetaPage(businessId, page);
  jar.delete(META_COOKIE);
  revalidatePath(`/b/${businessId}/conexiones`);
  redirect(`/b/${businessId}/conexiones?${new URLSearchParams({ meta: "ok", page: page.name, ig: instagram ?? "" })}`);
}

/** Después de "Conectar con Google", cuando la cuenta administra varios perfiles. */
export async function chooseGoogleLocation(businessId: string, locationId: string) {
  await business(businessId);
  const jar = await cookies();
  const raw = jar.get(GOOGLE_COOKIE)?.value;
  const saved = raw ? decryptJson<{ refreshToken: string; businessId: string; locations: GoogleLocation[] }>(raw) : null;
  if (!saved || saved.businessId !== businessId) redirect(`/b/${businessId}/conexiones?google=error&msg=${encodeURIComponent("La conexión venció. Vuelve a intentarlo.")}`);
  const loc = saved.locations.find((l) => l.locationId === locationId);
  if (!loc) throw new Error("Ese perfil ya no está disponible");
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
  const conn = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel } } });
  if (!conn) return { ok: false, message: "Primero guarda los datos de la conexión." };
  try {
    return { ok: true, message: await PUBLISHERS[channel].test(decryptJson(conn.secret)) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ---------- Contactos ----------

export async function addContact(businessId: string, f: FormData) {
  await business(businessId);
  const email = str(f, "email");
  const phone = normalizePhone(str(f, "phone"));
  if (!email && !phone) throw new Error("Escribe un email o un teléfono");
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
  const text = String(f.get("text") ?? "").trim();
  if (!text) throw new Error("Escribe tu mensaje");
  const channels = f.getAll("channels").map(String).filter((c): c is ChannelId => CHANNEL_IDS.includes(c as ChannelId));
  if (!channels.length) throw new Error("Elige al menos un canal");

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
    if (isNaN(scheduledAt.getTime())) throw new Error("Elige la fecha y hora para programar");
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
const lang = (v: string): Lang => (LANGS.includes(v as Lang) ? (v as Lang) : "es");

export type AiWriteResult = { ok: true; post: AiPost } | { ok: false; error: string };

/** El compositor pide un texto a la IA a partir de una idea. */
export async function aiWrite(businessId: string, idea: string, language: string): Promise<AiWriteResult> {
  const b = await business(businessId);
  if (!idea.trim()) return { ok: false, error: "Escribe una idea o tema." };
  try {
    return { ok: true, post: await writePost(b, idea.slice(0, 2000), lang(language)) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
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
  if (!aiEnabled()) return { ok: false, message: "Falta la clave de la IA (GEMINI_API_KEY) en la configuración del servidor." };
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(str(f, "startDate")) ? str(f, "startDate") : new Date().toISOString().slice(0, 10);
  const count = Math.min(14, Math.max(1, Number(str(f, "count")) || 5));
  const channels = f.getAll("channels").map(String).filter((c): c is ChannelId => CHANNEL_IDS.includes(c as ChannelId));
  if (!channels.length) return { ok: false, message: "Elige al menos un canal." };
  try {
    const plan = await planWeek(b, { startDate, count, themes: str(f, "themes").slice(0, 1000), lang: lang(str(f, "lang")) });
    // Una foto para cada publicación (si fal.ai está configurado). Si una falla, esa publicación queda sin foto.
    const images = imagesEnabled()
      ? await Promise.all(plan.posts.map((p) => createImage(b.aiImage, p.post.imageIdea, "square", businessId).catch(() => null)))
      : plan.posts.map(() => null);
    const now = new Date();
    for (const [i, item] of plan.posts.entries()) {
      const fields = toPostFields(item.post);
      const image = images[i];
      let scheduledAt = localToUtc(startDate, item.day, item.time);
      if (scheduledAt < now) scheduledAt = new Date(now.getTime() + 60 * 60 * 1000);
      await db.post.create({
        data: {
          businessId,
          ...fields,
          ...(image ? { mediaUrl: image, mediaType: "photo" } : {}),
          source: "ai",
          status: b.aiAutopublish ? "scheduled" : "draft",
          scheduledAt,
          targets: { create: channels.map((channel) => ({ channel })) },
        },
      });
    }
    revalidatePath(`/b/${businessId}/plan`);
    const n = plan.posts.length;
    return {
      ok: true,
      message: b.aiAutopublish
        ? `Listo: ${n} publicaciones programadas. Saldrán solas a su hora.`
        : `Listo: ${n} borradores. Revísalos abajo y aprueba los que te gusten.`,
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
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
  if (!imagesEnabled()) return { ok: false, error: "Falta una clave para crear imágenes en la configuración del servidor." };
  if (!description.trim()) return { ok: false, error: "Describe la imagen que quieres." };
  try {
    return { ok: true, url: await createImage(b.aiImage, description, SHAPES.includes(shape as Shape) ? (shape as Shape) : "square", businessId) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type VideoStart = { ok: true; job: VideoJob } | { ok: false; error: string };

/** Empieza a convertir una foto en video (5 segundos). */
export async function aiVideoStart(businessId: string, imageUrl: string, motion: string): Promise<VideoStart> {
  await business(businessId);
  if (!falEnabled()) return { ok: false, error: "Falta la clave de fal.ai (FAL_KEY) en la configuración del servidor." };
  if (!/^https:\/\//.test(imageUrl)) return { ok: false, error: "Primero crea o sube una foto para el video." };
  try {
    return { ok: true, job: await startVideo(imageUrl, motion.slice(0, 500)) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type VideoCheck = { ok: true; done: false } | { ok: true; done: true; url: string } | { ok: false; error: string };

/** Pregunta si el video ya está listo; si lo está, lo guarda en tu almacenamiento. */
export async function aiVideoCheck(businessId: string, job: VideoJob): Promise<VideoCheck> {
  await business(businessId);
  try {
    const r = await videoResult(job);
    if (!r.done) return { ok: true, done: false };
    return { ok: true, done: true, url: (await storeRemote(r.url, businessId)).url };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
