// "Conectar con Facebook": inicio de sesión con Meta para guardar la página de Facebook
// y la cuenta de Instagram vinculada sin copiar tokens a mano.
import { createHmac, randomBytes } from "crypto";
import { encryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { fetchJson, PublishError } from "@/lib/publishers/http";
import { safeEqual } from "@/lib/session";

const GRAPH = "https://graph.facebook.com/v21.0";
export const META_COOKIE = "am_meta";
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
];

export const metaEnabled = () => Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);

function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}
export const redirectUri = () => `${baseUrl()}/api/meta/callback`;

function sign(data: string): string {
  return createHmac("sha256", process.env.APP_SECRET ?? "").update(data).digest("base64url");
}

/** El "state" lleva el negocio y una firma, para que nadie pueda inventar una respuesta de Facebook. */
export function makeState(businessId: string): string {
  const payload = `${businessId}.${randomBytes(8).toString("hex")}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export function readState(state: string): string | null {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const payload = parts.slice(0, 3).join(".");
  if (!safeEqual(parts[3], sign(payload))) return null;
  if (Date.now() - Number(parts[2]) > 15 * 60 * 1000) return null;
  return parts[0];
}

export function authUrl(businessId: string): string {
  const q = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: redirectUri(),
    state: makeState(businessId),
    response_type: "code",
  });
  // Apps con "Facebook Login for Business" pueden usar una configuración (config_id) en vez de la lista de permisos.
  if (process.env.META_CONFIG_ID) q.set("config_id", process.env.META_CONFIG_ID);
  else q.set("scope", META_SCOPES.join(","));
  return `https://www.facebook.com/v21.0/dialog/oauth?${q}`;
}

/** Cambia el código por un token de usuario de larga duración (unos 60 días). */
export async function exchangeCode(code: string): Promise<string> {
  const app = { client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET! };
  const short = await fetchJson<{ access_token: string }>(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({ ...app, redirect_uri: redirectUri(), code })}`,
  );
  const long = await fetchJson<{ access_token: string }>(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({ ...app, grant_type: "fb_exchange_token", fb_exchange_token: short.access_token })}`,
  );
  return long.access_token;
}

export type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
};

/** Páginas que administra la persona. Con un token de usuario de larga duración, los tokens de página no vencen. */
export async function listPages(userToken: string): Promise<MetaPage[]> {
  const r = await fetchJson<{ data: MetaPage[] }>(
    `${GRAPH}/me/accounts?${new URLSearchParams({
      fields: "id,name,access_token,instagram_business_account{id,username}",
      limit: "100",
      access_token: userToken,
    })}`,
  );
  return r.data ?? [];
}

/** Guarda Facebook (y la cuenta de Instagram vinculada, si hay) para el negocio. */
export async function saveMetaPage(businessId: string, page: MetaPage): Promise<{ instagram: string | null }> {
  if (!page.access_token) throw new PublishError("Facebook no entregó el permiso para publicar en esa página.");
  const upsert = (channel: string, values: Record<string, string>, label: string) =>
    db.connection.upsert({
      where: { businessId_channel: { businessId, channel } },
      create: { businessId, channel, secret: encryptJson(values), label },
      update: { secret: encryptJson(values), label },
    });
  await upsert("facebook", { pageId: page.id, accessToken: page.access_token }, page.name);
  const ig = page.instagram_business_account;
  if (ig?.id) {
    await upsert("instagram", { igUserId: ig.id, accessToken: page.access_token }, ig.username ? `@${ig.username}` : ig.id);
    return { instagram: ig.username ?? ig.id };
  }
  return { instagram: null };
}
