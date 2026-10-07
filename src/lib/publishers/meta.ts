import { fetchJson, form, PublishError, required, sleep } from "./http";
import type { Publisher } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Permisos que la app necesita para publicar (los mismos que pide "Conectar con Facebook"). */
const NEED_FB = ["pages_manage_posts", "pages_read_engagement", "pages_show_list"];
const NEED_IG = ["instagram_basic", "instagram_content_publish"];

/**
 * Pregunta a Facebook (debug_token, con la clave de la app) si el token sigue vivo y qué permisos tiene.
 * Leer el nombre de la página funciona aunque falte el permiso de publicar, así que "Probar" no basta sin esto.
 * Sin META_APP_ID/META_APP_SECRET no se puede revisar: devuelve null y la prueba sigue como antes.
 */
export async function metaTokenProblem(token: string, need: string[]): Promise<string | null> {
  const id = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!id || !secret) return null;
  const r = await fetchJson<{ data?: { is_valid?: boolean; scopes?: string[]; expires_at?: number; error?: { message?: string } } }>(
    `${GRAPH}/debug_token?${new URLSearchParams({ input_token: token, access_token: `${id}|${secret}` })}`,
  );
  const d = r.data ?? {};
  if (d.is_valid === false)
    return `Facebook dice que la conexión ya no sirve${d.error?.message ? ` (${d.error.message})` : ""}. Vuelve a conectar con el botón «Conectar con Facebook».`;
  const missing = need.filter((x) => !(d.scopes ?? []).includes(x));
  if (missing.length)
    return `A la conexión le faltan permisos de Facebook: ${missing.join(", ")}. Vuelve a conectar con «Conectar con Facebook» y, cuando Facebook pregunte, marca tu página (y tu Instagram) y deja TODOS los permisos encendidos.`;
  if (d.expires_at && d.expires_at * 1000 < Date.now())
    return "La conexión con Facebook venció. Vuelve a conectar con «Conectar con Facebook».";
  return null;
}

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
    const problem = await metaTokenProblem(creds.accessToken, NEED_FB);
    if (problem) throw new PublishError(problem);
    return `Conectado a la página "${page.name}" con permiso para publicar`;
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
    const problem = await metaTokenProblem(creds.accessToken, NEED_IG);
    if (problem) throw new PublishError(problem);
    return `Conectado como @${u.username} con permiso para publicar`;
  },
};
