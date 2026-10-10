import { fetchJson, form, PublishError, required, sleep } from "./http";
import { mediaOf, type PublishInput, type PublishMedia, type Publisher } from "./types";

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

/** Sube una foto a la página sin publicarla (para un post con varias fotos o una historia). Devuelve su id. */
async function unpublishedPhoto(pageId: string, accessToken: string, photo: PublishMedia): Promise<string> {
  const r = await fetchJson<{ id: string }>(`${GRAPH}/${pageId}/photos`, {
    method: "POST",
    body: form({ url: photo.url, published: "false", ...(photo.alt ? { alt_text_custom: photo.alt } : {}), access_token: accessToken }),
  });
  return r.id;
}

/** Post con varias fotos: se suben sin publicar y luego un post en el feed las junta (attached_media). */
export async function facebookMultiPhoto(pageId: string, accessToken: string, text: string, photos: PublishMedia[]): Promise<{ id?: string; post_id?: string }> {
  const ids: string[] = [];
  for (const p of photos.slice(0, 10)) ids.push(await unpublishedPhoto(pageId, accessToken, p));
  const body = form({ message: text, access_token: accessToken });
  ids.forEach((id, i) => body.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
  return fetchJson(`${GRAPH}/${pageId}/feed`, { method: "POST", body });
}

/** Historia de foto en la página: la foto sin publicar y luego /photo_stories con su id. */
export async function facebookPhotoStory(pageId: string, accessToken: string, photo: PublishMedia): Promise<{ post_id?: string }> {
  const photoId = await unpublishedPhoto(pageId, accessToken, photo);
  return fetchJson(`${GRAPH}/${pageId}/photo_stories`, { method: "POST", body: form({ photo_id: photoId, access_token: accessToken }) });
}

export const facebook: Publisher = {
  async publish(input, creds) {
    required(creds, ["pageId", "accessToken"]);
    const { pageId, accessToken } = creds;
    const media = mediaOf(input);
    const photos = media.filter((m) => m.type === "photo");
    const kind = input.kind ?? "post";
    let note = "";

    if (kind === "story" && media[0]?.type === "photo") {
      try {
        const r = await facebookPhotoStory(pageId, accessToken, media[0]);
        return { url: r.post_id ? `https://www.facebook.com/${r.post_id}` : undefined, detail: "Historia publicada en Facebook", ...(r.post_id ? { id: r.post_id } : {}) };
      } catch (e) {
        // Si Facebook no deja publicar la historia (permisos o tipo de página), se publica como post normal.
        note = ` (Facebook no aceptó la historia: ${(e as Error).message}; se publicó como post)`;
      }
    } else if (kind === "story" && media[0]?.type === "video") {
      note = " (Facebook no permite historias de video desde la app; se publicó como post)";
    }

    let res: { id?: string; post_id?: string };
    if (kind === "carousel" && photos.length >= 2) {
      res = await facebookMultiPhoto(pageId, accessToken, input.text, photos);
      note = ` con ${Math.min(10, photos.length)} fotos`;
    } else if (media[0]?.type === "photo") {
      res = await fetchJson(`${GRAPH}/${pageId}/photos`, {
        method: "POST",
        body: form({ url: media[0].url, caption: input.text, ...(media[0].alt ? { alt_text_custom: media[0].alt } : {}), access_token: accessToken }),
      });
    } else if (media[0]?.type === "video") {
      res = await fetchJson(`${GRAPH}/${pageId}/videos`, {
        method: "POST",
        body: form({ file_url: media[0].url, description: input.text, access_token: accessToken }),
      });
    } else {
      res = await fetchJson(`${GRAPH}/${pageId}/feed`, {
        method: "POST",
        body: form({ message: input.text, access_token: accessToken }),
      });
    }
    const id = res.post_id ?? res.id;
    return { url: id ? `https://www.facebook.com/${id}` : undefined, detail: `Publicado en Facebook${note}`, ...(id ? { id } : {}) };
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

/** Espera a que Instagram termine de procesar un contenedor (los videos tardan más). */
async function waitReady(containerId: string, accessToken: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const s = await fetchJson<{ status_code?: string }>(
      `${GRAPH}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (s.status_code === "FINISHED" || !s.status_code) return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED")
      throw new PublishError(`Instagram no pudo procesar el archivo (${s.status_code}).`);
    await sleep(4000);
  }
}

/** Crea el contenedor de Instagram para la publicación (foto, video/reel, carrusel o historia). Devuelve su id. */
export async function instagramContainer(igUserId: string, accessToken: string, input: Pick<PublishInput, "text" | "kind" | "media" | "mediaUrl" | "mediaType" | "altText">): Promise<string> {
  const media = mediaOf(input);
  if (!media.length) throw new PublishError("Instagram necesita una foto o un video.");
  const create = (params: Record<string, string>) =>
    fetchJson<{ id: string }>(`${GRAPH}/${igUserId}/media`, { method: "POST", body: form({ ...params, access_token: accessToken }) });
  const kind = input.kind ?? "post";
  const photos = media.filter((m) => m.type === "photo");

  if (kind === "carousel" && photos.length >= 2) {
    // Carrusel: un contenedor por foto (is_carousel_item) y luego el contenedor CAROUSEL con sus hijos.
    const children: string[] = [];
    for (const p of photos.slice(0, 10)) {
      const c = await create({ image_url: p.url, is_carousel_item: "true", ...(p.alt ? { alt_text: p.alt.slice(0, 1000) } : {}) });
      children.push(c.id);
    }
    for (const id of children) await waitReady(id, accessToken);
    return (await create({ media_type: "CAROUSEL", children: children.join(","), caption: input.text })).id;
  }
  const first = media[0];
  if (kind === "story") {
    // Historia: sin texto (Instagram no lo muestra) ni texto alternativo (no lo acepta en historias).
    return (await create(first.type === "video" ? { media_type: "STORIES", video_url: first.url } : { media_type: "STORIES", image_url: first.url })).id;
  }
  if (first.type === "video") return (await create({ media_type: "REELS", video_url: first.url, caption: input.text })).id;
  return (await create({ image_url: first.url, caption: input.text, ...(first.alt ? { alt_text: first.alt.slice(0, 1000) } : {}) })).id;
}

export const instagram: Publisher = {
  async publish(input, creds) {
    required(creds, ["igUserId", "accessToken"]);
    const { igUserId, accessToken } = creds;
    if (!mediaOf(input).length) throw new PublishError("Instagram necesita una foto o un video.");

    const containerId = await instagramContainer(igUserId, accessToken, input);
    // Instagram procesa el archivo antes de poder publicarlo (los videos tardan más).
    await waitReady(containerId, accessToken);

    const media = await fetchJson<{ id: string }>(`${GRAPH}/${igUserId}/media_publish`, {
      method: "POST",
      body: form({ creation_id: containerId, access_token: accessToken }),
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
    const kind = input.kind ?? "post";
    const n = mediaOf(input).filter((m) => m.type === "photo").length;
    const detail = kind === "story" ? "Historia publicada en Instagram" : kind === "carousel" && n >= 2 ? `Carrusel de ${Math.min(10, n)} fotos publicado en Instagram` : "Publicado en Instagram";
    return { url, detail, id: media.id };
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
