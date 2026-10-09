// "Conectar con Google": inicio de sesión con Google para publicar en el Perfil de Negocio (Maps)
// sin copiar tokens a mano.
import { encryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { bi } from "@/lib/i18n";
import { makeState } from "@/lib/meta-oauth";
import { fetchJson, form } from "@/lib/publishers/http";

export const GOOGLE_COOKIE = "am_google";
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/business.manage";
/** Search Console ("Tus búsquedas en Google"): solo lectura, se pide aparte del Perfil de Negocio. */
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
/** Google Analytics 4 ("Visitas a tu página"): solo lectura, se pide aparte. */
export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
/** YouTube ("Subir videos a tu canal"): solo permiso para subir videos, se pide aparte. */
export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
/** Para leer el nombre del canal al conectar (solo lectura). */
export const YOUTUBE_READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

/** Para qué se pide el permiso de Google: publicar en el Perfil de Negocio, leer Search Console, leer Analytics o subir a YouTube. */
export type GooglePurpose = "profile" | "gsc" | "ga4" | "youtube";

const PURPOSE_SCOPE: Record<GooglePurpose, string> = { profile: GOOGLE_SCOPE, gsc: GSC_SCOPE, ga4: GA4_SCOPE, youtube: `${YOUTUBE_SCOPE} ${YOUTUBE_READ_SCOPE}` };

export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const baseUrl = () => (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
export const googleRedirectUri = () => `${baseUrl()}/api/google/callback`;

export function googleAuthUrl(businessId: string, purpose: GooglePurpose = "profile"): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: PURPOSE_SCOPE[purpose] ?? GOOGLE_SCOPE,
    // offline + consent: Google entrega un refresh token que no vence mientras no se revoque.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    // Search Console y Analytics usan el mismo regreso (/api/google/callback); el propósito va dentro del state firmado.
    state: makeState(purpose === "profile" ? businessId : `${purpose}:${businessId}`),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Separa el propósito del negocio en lo que devuelve readState (sin prefijo = Perfil de Negocio). */
export function googleStatePurpose(value: string): { purpose: GooglePurpose; businessId: string } {
  if (value.startsWith("gsc:")) return { purpose: "gsc", businessId: value.slice(4) };
  if (value.startsWith("ga4:")) return { purpose: "ga4", businessId: value.slice(4) };
  if (value.startsWith("youtube:")) return { purpose: "youtube", businessId: value.slice(8) };
  return { purpose: "profile", businessId: value };
}

/** Cambia el código por un refresh token (para guardar) y un access token (para usar ya). */
export async function googleExchange(code: string): Promise<{ refreshToken: string; accessToken: string }> {
  const t = await fetchJson<{ access_token: string; refresh_token?: string }>("https://oauth2.googleapis.com/token", {
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
  return { refreshToken: t.refresh_token, accessToken: t.access_token };
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

/** Guarda la ubicación elegida con las mismas credenciales que usa el publicador de Google. */
export async function saveGoogleLocation(businessId: string, refreshToken: string, loc: GoogleLocation) {
  const secret = encryptJson({
    accountId: loc.accountId,
    locationId: loc.locationId,
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken,
  });
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

/** Guarda la conexión de YouTube con las mismas credenciales que usa el publicador de YouTube. */
export async function saveYoutubeChannel(businessId: string, refreshToken: string, channel: YoutubeChannel) {
  const secret = encryptJson({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken,
    channelId: channel.id,
  });
  await db.connection.upsert({
    where: { businessId_channel: { businessId, channel: "youtube" } },
    create: { businessId, channel: "youtube", secret, label: channel.title },
    update: { secret, label: channel.title },
  });
}
