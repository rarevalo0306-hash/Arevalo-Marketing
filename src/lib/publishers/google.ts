import { fetchJson, form, required } from "./http";
import type { Creds, Publisher } from "./types";

async function accessToken(creds: Creds): Promise<string> {
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

const strip = (id: string, prefix: string) => id.trim().replace(new RegExp(`^${prefix}/`), "");

export const google: Publisher = {
  async publish(input, creds) {
    required(creds, ["accountId", "locationId"]);
    const token = await accessToken(creds);
    const account = strip(creds.accountId, "accounts");
    const location = strip(creds.locationId, "locations");
    const body: Record<string, unknown> = {
      languageCode: "es",
      summary: input.text.slice(0, 1500),
      topicType: "STANDARD",
    };
    if (input.mediaType === "photo" && input.mediaUrl) body.media = [{ mediaFormat: "PHOTO", sourceUrl: input.mediaUrl }];
    const post = await fetchJson<{ searchUrl?: string }>(
      `https://mybusiness.googleapis.com/v4/accounts/${account}/locations/${location}/localPosts`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return { url: post.searchUrl, detail: "Publicado en tu Perfil de Negocio de Google" };
  },
  async test(creds) {
    required(creds, ["accountId", "locationId"]);
    const token = await accessToken(creds);
    const location = strip(creds.locationId, "locations");
    const l = await fetchJson<{ title?: string }>(
      `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${location}?readMask=title`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return `Conectado a "${l.title ?? location}"`;
  },
};
