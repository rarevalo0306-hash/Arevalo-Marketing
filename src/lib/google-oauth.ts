// "Conectar con Google": inicio de sesión con Google para publicar en el Perfil de Negocio (Maps)
// sin copiar tokens a mano.
import { encryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { bi, type T } from "@/lib/i18n";
import { makeState } from "@/lib/meta-oauth";
import { fetchJson, form } from "@/lib/publishers/http";

export const GOOGLE_COOKIE = "am_google";
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/business.manage";
/** Search Console ("Tus búsquedas en Google"): solo lectura, se pide aparte del Perfil de Negocio. */
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
/** Google Analytics 4 ("Visitas a tu página"): solo lectura, se pide aparte. */
export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
/** YouTube ("Subir videos a tu canal"): permiso para subir videos; se pide aparte, junto con YOUTUBE_READ_SCOPE. */
export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
/** Para leer el nombre del canal al conectar y las vistas de los videos (solo lectura). */
export const YOUTUBE_READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

/** Para qué se pide el permiso de Google: publicar en el Perfil de Negocio, leer Search Console, leer Analytics o subir a YouTube. */
export type GooglePurpose = "profile" | "gsc" | "ga4" | "youtube";

/** Los permisos que necesita cada propósito (YouTube: subir videos y ver el canal). */
export const PURPOSE_SCOPES: Record<GooglePurpose, string[]> = {
  profile: [GOOGLE_SCOPE],
  gsc: [GSC_SCOPE],
  ga4: [GA4_SCOPE],
  youtube: [YOUTUBE_SCOPE, YOUTUBE_READ_SCOPE],
};

export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const baseUrl = () => (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
export const googleRedirectUri = () => `${baseUrl()}/api/google/callback`;

export function googleAuthUrl(businessId: string, purpose: GooglePurpose = "profile"): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    // «openid» (básico, no se puede desmarcar) trae el id_token con la cuenta de Google: ver googleUserFrom.
    scope: ["openid", ...(PURPOSE_SCOPES[purpose] ?? [GOOGLE_SCOPE])].join(" "),
    // offline + consent: Google entrega un refresh token que no vence mientras no se revoque.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    // Search Console y Analytics usan el mismo regreso (/api/google/callback); el propósito va dentro del state firmado.
    // El prefijo «google:» separa este state del de Facebook (misma firma): uno no sirve en el regreso del otro.
    state: makeState(`google:${purpose}:${businessId}`),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

const PURPOSES: GooglePurpose[] = ["profile", "gsc", "ga4", "youtube"];

/** Separa el propósito del negocio en lo que devuelve readState. Sin el prefijo «google:» (por ejemplo, un state de
 *  Facebook) no hay negocio y el regreso lo rechaza. */
export function googleStatePurpose(value: string): { purpose: GooglePurpose; businessId: string } {
  const [prefix, purpose, ...rest] = value.split(":");
  const businessId = rest.join(":");
  if (prefix !== "google" || !PURPOSES.includes(purpose as GooglePurpose) || !businessId) return { purpose: "profile", businessId: "" };
  return { purpose: purpose as GooglePurpose, businessId };
}

/**
 * La cuenta de Google que dio el permiso («sub» del id_token, que llega por pedir «openid»). Sirve para saber qué conexiones
 * comparten el mismo permiso de Google (ver canRevokeAlone). El id_token llega directo de Google por TLS en el cambio del
 * código, así que basta revisar que sea para esta app. Sin id_token (o de otra app): null.
 */
export function googleUserFrom(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const p = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: unknown; aud?: unknown };
    return typeof p.sub === "string" && p.sub && p.aud === process.env.GOOGLE_CLIENT_ID ? p.sub : null;
  } catch {
    return null;
  }
}

/** Cambia el código por un refresh token (para guardar), un access token (para usar ya), los permisos que se dieron y la
 *  cuenta de Google que los dio. */
export async function googleExchange(code: string): Promise<{ refreshToken: string; accessToken: string; scopes: string[] | null; googleUser: string | null }> {
  const t = await fetchJson<{ access_token: string; refresh_token?: string; scope?: string; id_token?: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: form({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!t.refresh_token) throw bi("Google no entregó el permiso permanente. Vuelve a intentarlo.", "Google didn't grant permanent access. Please try again.");
  // Lo que la persona dejó marcado en la pantalla de Google (puede desmarcar casillas). Sin «scope» = todo lo pedido.
  const scopes = typeof t.scope === "string" ? t.scope.split(/\s+/).filter(Boolean) : null;
  return { refreshToken: t.refresh_token, accessToken: t.access_token, scopes, googleUser: googleUserFrom(t.id_token) };
}

/** Los permisos de este propósito que la persona desmarcó (vacío = están todos). Con include_granted_scopes pueden venir
 *  permisos de otros propósitos: no importan. */
export function missingGoogleScopes(purpose: GooglePurpose, granted: string[] | null): string[] {
  return granted ? PURPOSE_SCOPES[purpose].filter((s) => !granted.includes(s)) : [];
}

const SCOPE_NAMES: Record<string, [es: string, en: string]> = {
  [GOOGLE_SCOPE]: ["administrar tu Perfil de Negocio", "manage your Business Profile"],
  [GSC_SCOPE]: ["ver tus datos de Search Console", "view your Search Console data"],
  [GA4_SCOPE]: ["ver tus datos de Google Analytics", "view your Google Analytics data"],
  [YOUTUBE_SCOPE]: ["subir videos a tu canal de YouTube", "upload videos to your YouTube channel"],
  [YOUTUBE_READ_SCOPE]: ["ver tu canal de YouTube (su nombre y las vistas de tus videos)", "view your YouTube channel (its name and your videos' views)"],
};

/** Qué permiso falta, en palabras claras. No se guardó nada: hay que volver a conectar y marcar la casilla. */
export function missingScopesText(missing: string[], t: T): string {
  const es = missing.map((s) => SCOPE_NAMES[s]?.[0] ?? s).join(" ni para ");
  const en = missing.map((s) => SCOPE_NAMES[s]?.[1] ?? s).join(" or to ");
  const two = missing.length > 1;
  return t(
    `No diste el permiso para ${es}, así que no se conectó nada. Vuelve a conectar y, en la pantalla de Google, marca ${two ? "las dos casillas" : "esa casilla"}.`,
    `You didn't grant permission to ${en}, so nothing was connected. Connect again and, on Google's screen, check ${two ? "both boxes" : "that box"}.`,
  );
}

export async function googleAccess(refreshToken: string): Promise<string> {
  const t = await fetchJson<{ access_token: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: form({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  return t.access_token;
}

export type GoogleLocation = { accountId: string; locationId: string; title: string; address: string };

/** Todas las ubicaciones (negocios) que la cuenta de Google administra. */
export async function listLocations(accessToken: string): Promise<GoogleLocation[]> {
  const auth = { headers: { Authorization: `Bearer ${accessToken}` } };
  const accounts = await fetchJson<{ accounts?: { name: string }[] }>(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20",
    auth,
  );
  const out: GoogleLocation[] = [];
  for (const a of accounts.accounts ?? []) {
    const r = await fetchJson<{
      locations?: { name: string; title?: string; storefrontAddress?: { addressLines?: string[]; locality?: string } }[];
    }>(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,storefrontAddress&pageSize=100`,
      auth,
    );
    for (const l of r.locations ?? []) {
      const addr = l.storefrontAddress;
      out.push({
        accountId: a.name.replace(/^accounts\//, ""),
        locationId: l.name.replace(/^locations\//, ""),
        title: l.title ?? l.name,
        address: [addr?.addressLines?.join(", "), addr?.locality].filter(Boolean).join(", "),
      });
    }
  }
  return out;
}

/** Guarda la ubicación elegida y el refresh token (y la cuenta de Google que dio el permiso, si se sabe). Sin copia del
 *  cliente: se renueva con el cliente de la app del servidor (googleClient en publishers/google.ts). */
export async function saveGoogleLocation(businessId: string, refreshToken: string, loc: GoogleLocation, googleUser?: string | null) {
  const secret = encryptJson({ accountId: loc.accountId, locationId: loc.locationId, refreshToken, ...(googleUser ? { googleUser } : {}) });
  await db.connection.upsert({
    where: { businessId_channel: { businessId, channel: "google" } },
    create: { businessId, channel: "google", secret, label: loc.title },
    update: { secret, label: loc.title },
  });
}

// ---------- YouTube ----------

export type YoutubeChannel = { id: string; title: string };

/** El canal de YouTube de la cuenta que dio permiso (null si la cuenta no tiene canal). */
export async function youtubeChannel(accessToken: string): Promise<YoutubeChannel | null> {
  const r = await fetchJson<{ items?: { id: string; snippet?: { title?: string } }[] }>("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const ch = r.items?.[0];
  return ch ? { id: ch.id, title: ch.snippet?.title?.trim() || ch.id } : null;
}

/** Guarda la conexión de YouTube (refresh token, canal y la cuenta de Google, si se sabe). Sin copia del cliente: se renueva
 *  con el cliente de la app del servidor (googleClient en publishers/google.ts). */
export async function saveYoutubeChannel(businessId: string, refreshToken: string, channel: YoutubeChannel, googleUser?: string | null) {
  const secret = encryptJson({ refreshToken, channelId: channel.id, ...(googleUser ? { googleUser } : {}) });
  await db.connection.upsert({
    where: { businessId_channel: { businessId, channel: "youtube" } },
    create: { businessId, channel: "youtube", secret, label: channel.title },
    update: { secret, label: channel.title },
  });
}

/** Revoke at Google rather than merely forgetting our local token. Never include tokens in logs/URLs. */
export async function revokeGoogleToken(token: string): Promise<void> {
  const response = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  if (response.ok) return;
  const error = await response.json().catch(() => null) as { error?: string } | null;
  if (response.status === 400 && error?.error === 'invalid_token') return;
  throw bi('No se pudo revocar el permiso en Google. Intenta de nuevo; no se han borrado los datos.', 'Google access could not be revoked. Retry; the stored data has not been deleted.');
}
