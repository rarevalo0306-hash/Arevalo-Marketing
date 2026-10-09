import { fetchJson, form, required } from "./http";
import { mediaOf, type Creds, type Publisher } from "./types";

/** Un access token nuevo a partir de las credenciales guardadas de la conexión de Google (refresh token). */
export async function googleAccessToken(creds: Creds): Promise<string> {
  required(creds, ["clientId", "clientSecret", "refreshToken"]);
  const t = await fetchJson<{ access_token: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: form({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  return t.access_token;
}

export const stripGoogleId = (id: string, prefix: string) => id.trim().replace(new RegExp(`^${prefix}/`), "");

export const google: Publisher = {
  async publish(input, creds) {
    required(creds, ["accountId", "locationId"]);
    const token = await googleAccessToken(creds);
    const account = stripGoogleId(creds.accountId, "accounts");
    const location = stripGoogleId(creds.locationId, "locations");
    const body: Record<string, unknown> = {
      languageCode: "es",
      summary: input.text.slice(0, 1500),
      topicType: "STANDARD",
    };
    // Google acepta una sola foto por novedad: la primera (en carruseles e historias también).
    const photo = mediaOf(input).find((m) => m.type === "photo");
    if (photo) body.media = [{ mediaFormat: "PHOTO", sourceUrl: photo.url }];
    const post = await fetchJson<{ searchUrl?: string; name?: string }>(
      `https://mybusiness.googleapis.com/v4/accounts/${account}/locations/${location}/localPosts`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const n = mediaOf(input).filter((m) => m.type === "photo").length;
    return { url: post.searchUrl, ...(post.name ? { id: post.name } : {}), detail: n > 1 ? "Publicado en tu Perfil de Negocio de Google (con la primera foto: Google acepta una por novedad)" : "Publicado en tu Perfil de Negocio de Google" };
  },
  async test(creds) {
    required(creds, ["accountId", "locationId"]);
    const token = await googleAccessToken(creds);
    const location = stripGoogleId(creds.locationId, "locations");
    const l = await fetchJson<{ title?: string }>(
      `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${location}?readMask=title`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return `Conectado a "${l.title ?? location}"`;
  },
};
