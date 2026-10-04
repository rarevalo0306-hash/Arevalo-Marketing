import { fetchJson, form, PublishError, required } from "./http";
import type { Creds, Publisher } from "./types";

const API = "https://open.tiktokapis.com/v2";

async function accessToken(creds: Creds): Promise<string> {
  required(creds, ["clientKey", "clientSecret", "refreshToken"]);
  const t = await fetchJson<{ access_token: string }>(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({
      client_key: creds.clientKey,
      client_secret: creds.clientSecret,
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
    }),
  });
  return t.access_token;
}

type CreatorInfo = { data: { creator_username: string; privacy_level_options: string[] } };

async function creatorInfo(token: string): Promise<CreatorInfo["data"]> {
  const r = await fetchJson<CreatorInfo>(`${API}/post/publish/creator_info/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
  });
  return r.data;
}

export const tiktok: Publisher = {
  async publish(input, creds) {
    if (input.mediaType !== "video" || !input.mediaUrl) throw new PublishError("TikTok necesita un video.");
    const token = await accessToken(creds);
    const info = await creatorInfo(token);
    const options = info.privacy_level_options ?? [];
    // Apps sin auditar de TikTok solo pueden publicar en privado (SELF_ONLY).
    const privacy = options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : options[0] ?? "SELF_ONLY";
    const r = await fetchJson<{ data: { publish_id: string } }>(`${API}/post/publish/video/init/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        post_info: { title: input.text.slice(0, 2200), privacy_level: privacy },
        source_info: { source: "PULL_FROM_URL", video_url: input.mediaUrl },
      }),
    });
    const note = privacy === "PUBLIC_TO_EVERYONE" ? "" : " (en privado: tu app de TikTok aún no está auditada)";
    return {
      url: info.creator_username ? `https://www.tiktok.com/@${info.creator_username}` : undefined,
      detail: `Enviado a TikTok, se procesa en unos minutos${note}. Id ${r.data.publish_id}`,
    };
  },
  async test(creds) {
    const info = await creatorInfo(await accessToken(creds));
    return `Conectado como @${info.creator_username}`;
  },
};
