import { fetchJson, form, PublishError, required, sleep } from "./http";
import type { Publisher } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0";

export const facebook: Publisher = {
  async publish(input, creds) {
    required(creds, ["pageId", "accessToken"]);
    const { pageId, accessToken } = creds;
    let res: { id?: string; post_id?: string };
    if (input.mediaType === "photo" && input.mediaUrl) {
      res = await fetchJson(`${GRAPH}/${pageId}/photos`, {
        method: "POST",
        body: form({ url: input.mediaUrl, caption: input.text, access_token: accessToken }),
      });
    } else if (input.mediaType === "video" && input.mediaUrl) {
      res = await fetchJson(`${GRAPH}/${pageId}/videos`, {
        method: "POST",
        body: form({ file_url: input.mediaUrl, description: input.text, access_token: accessToken }),
      });
    } else {
      res = await fetchJson(`${GRAPH}/${pageId}/feed`, {
        method: "POST",
        body: form({ message: input.text, access_token: accessToken }),
      });
    }
    const id = res.post_id ?? res.id;
    return { url: id ? `https://www.facebook.com/${id}` : undefined, detail: "Publicado en Facebook" };
  },
  async test(creds) {
    required(creds, ["pageId", "accessToken"]);
    const page = await fetchJson<{ name: string }>(
      `${GRAPH}/${creds.pageId}?fields=name&access_token=${encodeURIComponent(creds.accessToken)}`,
    );
    return `Conectado a la página "${page.name}"`;
  },
};

export const instagram: Publisher = {
  async publish(input, creds) {
    required(creds, ["igUserId", "accessToken"]);
    const { igUserId, accessToken } = creds;
    if (!input.mediaUrl || input.mediaType === "none") throw new PublishError("Instagram necesita una foto o un video.");

    const params: Record<string, string> = { caption: input.text, access_token: accessToken };
    if (input.mediaType === "video") {
      params.media_type = "REELS";
      params.video_url = input.mediaUrl;
    } else {
      params.image_url = input.mediaUrl;
    }
    const container = await fetchJson<{ id: string }>(`${GRAPH}/${igUserId}/media`, { method: "POST", body: form(params) });

    // Instagram procesa el archivo antes de poder publicarlo (los videos tardan más).
    for (let i = 0; i < 30; i++) {
      const s = await fetchJson<{ status_code?: string }>(
        `${GRAPH}/${container.id}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
      );
      if (s.status_code === "FINISHED" || !s.status_code) break;
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED")
        throw new PublishError(`Instagram no pudo procesar el archivo (${s.status_code}).`);
      await sleep(4000);
    }

    const media = await fetchJson<{ id: string }>(`${GRAPH}/${igUserId}/media_publish`, {
      method: "POST",
      body: form({ creation_id: container.id, access_token: accessToken }),
    });
    let url: string | undefined;
    try {
      const p = await fetchJson<{ permalink?: string }>(
        `${GRAPH}/${media.id}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`,
      );
      url = p.permalink;
    } catch {
      // el enlace es opcional
    }
    return { url, detail: "Publicado en Instagram" };
  },
  async test(creds) {
    required(creds, ["igUserId", "accessToken"]);
    const u = await fetchJson<{ username: string }>(
      `${GRAPH}/${creds.igUserId}?fields=username&access_token=${encodeURIComponent(creds.accessToken)}`,
    );
    return `Conectado como @${u.username}`;
  },
};
