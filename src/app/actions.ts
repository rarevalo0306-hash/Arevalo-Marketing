"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CHANNEL_IDS, channelDef, type ChannelId } from "@/lib/channels";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { normalizePhone, parseContactsCsv } from "@/lib/contacts";
import { db } from "@/lib/db";
import { createSignedUpload, saveUpload } from "@/lib/media";
import { listPages, META_COOKIE, saveMetaPage } from "@/lib/meta-oauth";
import { publishPost, retryPost } from "@/lib/publish";
import { PUBLISHERS } from "@/lib/publishers";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/lib/session";

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
  const label = values[def.fields[0].key] ?? "";
  await db.connection.upsert({
    where: { businessId_channel: { businessId, channel } },
    create: { businessId, channel, secret, label },
    update: { secret, label },
  });
  revalidatePath(`/b/${businessId}/conexiones`);
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

  const post = await db.post.create({
    data: {
      businessId,
      text,
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
}
