import type { MediaType } from "@/lib/channels";

export type Creds = Record<string, string>;

export type PublishInput = {
  text: string;
  subject: string;
  seoTitle: string;
  mediaType: MediaType;
  /** URL pública y absoluta del archivo, o "" si no hay. */
  mediaUrl: string;
  businessName: string;
  /** Palabras clave del estudio del negocio, para el artículo del sitio. */
  keywords?: string[];
  contacts: { name: string; email: string; phone: string; emailOptIn: boolean; smsOptIn: boolean }[];
  /**
   * Todas las fotos (carrusel) o la foto/video de la publicación, ya en el tamaño de este canal, con su texto
   * alternativo. Si falta, se usa mediaUrl/mediaType (como siempre). La primera es la misma que mediaUrl.
   */
  media?: PublishMedia[];
  /** post (foto, diseño o solo texto) | carousel | story | video. Si falta: post. */
  kind?: "post" | "carousel" | "story" | "video";
  /** Texto alternativo de la foto (con palabras clave), para las redes que lo aceptan. */
  altText?: string;
};

export type PublishMedia = { url: string; type: "photo" | "video"; alt?: string };

export type PublishResult = { url?: string; detail: string };

export type Publisher = {
  publish(input: PublishInput, creds: Creds): Promise<PublishResult>;
  /** Comprueba las credenciales sin publicar nada. Devuelve un texto como "Conectado como …". */
  test(creds: Creds): Promise<string>;
};

/** Las fotos (o el video) que se publican, en orden: input.media o, en publicaciones de antes, mediaUrl. */
export function mediaOf(input: Pick<PublishInput, "media" | "mediaUrl" | "mediaType" | "altText">): PublishMedia[] {
  if (input.media?.length) return input.media.filter((m) => m.url);
  if (!input.mediaUrl || input.mediaType === "none") return [];
  return [{ url: input.mediaUrl, type: input.mediaType, alt: input.altText || undefined }];
}
