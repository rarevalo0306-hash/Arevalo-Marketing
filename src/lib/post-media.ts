// Qué lleva una publicación de «Posts»: una foto o diseño, un carrusel (2 a 10 fotos), una historia (9:16) o un
// video. Las fotos van en Post.media ([{ url, alt, focus? }]) y la primera también en mediaUrl/mediaType, así lo
// viejo (historial, reintentos, publicadores) sigue funcionando igual. Sin servidor ni base de datos: se puede
// usar en pantalla y en las pruebas.

export const POST_KINDS = ["post", "carousel", "story", "video"] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const isPostKind = (v: unknown): v is PostKind => typeof v === "string" && (POST_KINDS as readonly string[]).includes(v);

/** Instagram y Facebook aceptan de 2 a 10 fotos en un carrusel. */
export const CAROUSEL_MIN = 2;
export const CAROUSEL_MAX = 10;
/** Texto alternativo: Instagram acepta hasta 1000 caracteres; lo recomendable es menos de 125. */
export const ALT_MAX = 250;

export type Focus = { x: number; y: number };
export type PostMediaItem = { url: string; alt: string; focus?: Focus; type: "photo" | "video" };

export function readFocus(v: unknown): Focus | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { x, y } = v as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : undefined;
}

const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u);
const cleanAlt = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, ALT_MAX) : "");

/**
 * Las fotos (o el video) de una publicación, en orden. Lee Post.media sin confiar en lo guardado; si falta,
 * arma la lista con mediaUrl/mediaType/altText (las publicaciones de antes).
 */
export function readPostMedia(json: unknown, post: { mediaUrl?: string; mediaType?: string; altText?: string } = {}): PostMediaItem[] {
  const out: PostMediaItem[] = [];
  if (Array.isArray(json)) {
    for (const raw of json.slice(0, CAROUSEL_MAX)) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const url = typeof o.url === "string" ? o.url.trim() : "";
      if (!url || !/^(https?:\/\/|\/media\/)/i.test(url)) continue;
      const type = o.type === "video" || (o.type !== "photo" && isVideoUrl(url)) ? "video" : "photo";
      const focus = readFocus(o.focus);
      out.push({ url, alt: cleanAlt(o.alt), type, ...(focus ? { focus } : {}) });
    }
  }
  if (!out.length && post.mediaUrl && (post.mediaType === "photo" || post.mediaType === "video")) {
    out.push({ url: post.mediaUrl, alt: cleanAlt(post.altText), type: post.mediaType });
  }
  // La primera foto sin texto alternativo propio usa el de la publicación.
  if (out[0] && !out[0].alt && post.altText) out[0].alt = cleanAlt(post.altText);
  return out;
}

export type MediaProblem = { es: string; en: string };

/** Revisa que la publicación tenga lo que su tipo necesita. null = todo bien. */
export function checkPostMedia(kind: PostKind, items: Pick<PostMediaItem, "type">[]): MediaProblem | null {
  if (kind === "carousel") {
    if (items.some((i) => i.type !== "photo")) return { es: "El carrusel solo lleva fotos. Para videos usa la sección Videos.", en: "A carousel only takes photos. For videos use the Videos section." };
    if (items.length < CAROUSEL_MIN) return { es: `Un carrusel necesita al menos ${CAROUSEL_MIN} fotos.`, en: `A carousel needs at least ${CAROUSEL_MIN} photos.` };
    if (items.length > CAROUSEL_MAX) return { es: `Un carrusel lleva como mucho ${CAROUSEL_MAX} fotos.`, en: `A carousel takes ${CAROUSEL_MAX} photos at most.` };
  }
  if (kind === "story" && items.length !== 1) return { es: "Una historia necesita una foto o un video.", en: "A story needs one photo or one video." };
  if (kind === "video" && (items.length !== 1 || items[0].type !== "video")) return { es: "Falta el video.", en: "The video is missing." };
  return null;
}

/** El tipo que se guarda: una foto suelta es "post"; un video suelto, "video". */
export function postKindFor(wanted: string, mediaType: string): PostKind {
  if (wanted === "carousel" || wanted === "story") return wanted;
  return mediaType === "video" ? "video" : "post";
}
