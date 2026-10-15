// YouTube: lo que una persona aprueba antes de cada subida (título, descripción, etiquetas, quién puede verlo y si es
// para niños). Se guarda en Post.variants.youtubeOptions y solo lo escriben las acciones con sesión cuando alguien
// envía los campos de YouTube. Sin esa aprobación, y para ese mismo video, nada se sube (lo revisa publish.ts).
// Sin fs ni crypto: también lo usan las pantallas (Composer, Videos, Campañas, Plan).
import type { Prisma } from "@prisma/client";
import type { UiLang } from "@/lib/i18n";
import { readStudy, topKeywords } from "@/lib/study-shape";
import { fitTags } from "@/lib/video-plan";

export const YT_PRIVACY = ["public", "unlisted", "private"] as const;
export type YoutubePrivacy = (typeof YT_PRIVACY)[number];

/** La clave dentro de Post.variants (no es un canal: los textos de cada red no la ven). */
export const YT_KEY = "youtubeOptions";

/** Lo que queda en PostTarget.detail cuando YouTube se salta por falta de aprobación (en español, como los demás). */
export const YOUTUBE_NEEDS_APPROVAL =
  "YouTube: no se subió. Este video necesita tu aprobación antes de subirse (título, descripción, etiquetas y visibilidad).";

export const YT_TITLE_MAX = 100;
export const YT_DESCRIPTION_MAX = 5000;

export type YoutubeApproval = {
  title: string;
  description: string;
  /** Las etiquetas exactas que se mandan (≤ 500 caracteres en total). */
  tags: string[];
  privacy: YoutubePrivacy;
  madeForKids: boolean;
  /** El video aprobado: si la publicación cambia de video, la aprobación ya no sirve. */
  mediaUrl: string;
  /** Id de la persona que aprobó. */
  approvedBy: string;
  /** Cuándo (ISO). */
  approvedAt: string;
};

type Bi = { es: string; en: string };

const noAngles = (s: string) => s.replace(/[<>]/g, "");
const isPrivacy = (v: unknown): v is YoutubePrivacy => typeof v === "string" && (YT_PRIVACY as readonly string[]).includes(v);

/** El título tal cual lo escribió la persona: sin < > y como mucho 100 caracteres. */
export const cleanYoutubeTitle = (s: string) => noAngles(s).trim().slice(0, YT_TITLE_MAX).trim();
/** La descripción: sin < > y como mucho 5000 caracteres. */
export const cleanYoutubeDescription = (s: string) => noAngles(s).trim().slice(0, YT_DESCRIPTION_MAX);
/** «a, b, a» → ["a", "b"] (sin repetir, ≤ 500 caracteres). */
export const parseYoutubeTags = (raw: string) => fitTags(raw.split(",").map((x) => x.trim()).filter(Boolean));

const firstLine = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/https?:\/\/\S+/g, "").replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim())
    .find(Boolean) ?? "";

/** Título sugerido: el seoTitle de la publicación, o la primera línea del texto, o el nombre del negocio (≤ 100). */
export function youtubeTitleFor(input: { seoTitle: string; text: string; businessName: string }): string {
  const raw = noAngles(input.seoTitle.trim() || firstLine(input.text) || input.businessName).replace(/\s+/g, " ").trim();
  return raw.length <= YT_TITLE_MAX ? raw : raw.slice(0, YT_TITLE_MAX + 1).replace(/\s+\S*$/, "").slice(0, YT_TITLE_MAX);
}

/** «#CortinasMetalicas» → «Cortinas Metalicas». */
const words = (tag: string) => tag.replace(/^#/, "").replace(/_/g, " ").replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, "$1 $2");

/** Etiquetas sugeridas: las palabras clave del negocio y los hashtags del texto (sin #Shorts), ≤ 500 caracteres. */
export function youtubeTags(text: string, keywords: string[] = []): string[] {
  const tags = [...text.matchAll(/#([\p{L}\p{N}_]{2,60})/gu)].map((m) => m[1]).filter((t) => t.toLowerCase() !== "shorts");
  return fitTags([...keywords, ...tags.map(words)]);
}

/** Las palabras clave del estudio del negocio para sugerir etiquetas (las mismas que usaba la subida). */
export function youtubeKeywords(study: unknown): string[] {
  const s = readStudy(study);
  return s ? topKeywords(s, 15) : [];
}

/**
 * La aprobación guardada en la publicación, solo si sirve para este video: privacidad válida, «para niños» elegido,
 * quién aprobó, título, y el mismo video que tiene la publicación ahora. Si no, null (y YouTube no se sube).
 */
export function readYoutubeApproval(variants: unknown, mediaUrl: string): YoutubeApproval | null {
  const all = variants && typeof variants === "object" && !Array.isArray(variants) ? (variants as Record<string, unknown>) : null;
  const o = all?.[YT_KEY];
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const a = o as Record<string, unknown>;
  if (!isPrivacy(a.privacy) || typeof a.madeForKids !== "boolean") return null;
  const approvedBy = typeof a.approvedBy === "string" ? a.approvedBy.trim() : "";
  const url = typeof a.mediaUrl === "string" ? a.mediaUrl : "";
  if (!approvedBy || !url || !mediaUrl || url !== mediaUrl) return null;
  const title = typeof a.title === "string" ? cleanYoutubeTitle(a.title) : "";
  if (!title) return null;
  return {
    title,
    description: typeof a.description === "string" ? cleanYoutubeDescription(a.description) : "",
    tags: Array.isArray(a.tags) ? fitTags(a.tags.filter((x): x is string => typeof x === "string")) : [],
    privacy: a.privacy,
    madeForKids: a.madeForKids,
    mediaUrl: url,
    approvedBy,
    approvedAt: typeof a.approvedAt === "string" ? a.approvedAt : "",
  };
}

export type YoutubeApprovalResult = { ok: true; value: YoutubeApproval } | { ok: false; error: Bi };

/** La categoría de YouTube de cada subida: 22 = «Gente y blogs» (la que muestra la pantalla de aprobación). */
export const YT_CATEGORY_ID = "22";

/**
 * Lo que la persona eligió en los campos de YouTube (YoutubeOptionsFields): yt_title, v_youtube (descripción),
 * yt_tags, yt_privacy y yt_kids. La privacidad y «para niños» son obligatorias: nunca se ponen por defecto.
 * `description` reemplaza a v_youtube cuando la pantalla manda su propio texto (Nueva publicación).
 */
export function youtubeApprovalFromForm(f: FormData, o: { mediaUrl: string; approvedBy: string; description?: string; now?: Date }): YoutubeApprovalResult {
  const str = (k: string) => {
    const v = f.get(k);
    return typeof v === "string" ? v : "";
  };
  const fail = (es: string, en: string): YoutubeApprovalResult => ({ ok: false, error: { es, en } });
  const privacy = str("yt_privacy");
  if (!isPrivacy(privacy))
    return fail("Elige quién puede ver el video en YouTube: público, no listado o privado.", "Choose who can see the video on YouTube: public, unlisted or private.");
  const kids = str("yt_kids");
  if (kids !== "yes" && kids !== "no") return fail("Indica si el video es para niños (YouTube lo pide en cada video).", "Say whether the video is made for kids (YouTube asks for every video).");
  const title = cleanYoutubeTitle(str("yt_title"));
  if (!title) return fail("Escribe el título del video para YouTube.", "Write the video's title for YouTube.");
  if (!o.mediaUrl) return fail("El video todavía no está listo.", "The video isn't ready yet.");
  if (!o.approvedBy.trim()) return fail("Vuelve a entrar para aprobar la subida a YouTube.", "Sign in again to approve the YouTube upload.");
  return {
    ok: true,
    value: {
      title,
      description: cleanYoutubeDescription(o.description ?? str("v_youtube")),
      tags: parseYoutubeTags(str("yt_tags")),
      privacy,
      madeForKids: kids === "yes",
      mediaUrl: o.mediaUrl,
      approvedBy: o.approvedBy.trim(),
      approvedAt: (o.now ?? new Date()).toISOString(),
    },
  };
}

/** Quita la aprobación de unas variantes (al copiar o volver a guardar: solo se pone con los campos enviados). */
export function withoutYoutubeApproval(variants: unknown): Record<string, unknown> {
  const all = variants && typeof variants === "object" && !Array.isArray(variants) ? { ...(variants as Record<string, unknown>) } : {};
  delete all[YT_KEY];
  return all;
}

/** La constancia en el registro (AiAction) de que una persona aprobó la subida: va en la misma transacción que la publicación. */
export function youtubeApprovalLog(businessId: string, postId: string, a: YoutubeApproval, campaignId: string | null = null): Prisma.AiActionUncheckedCreateInput {
  const title = a.title.slice(0, 80);
  return {
    businessId,
    campaignId,
    postId,
    kind: "post.youtube_approved",
    actor: "owner",
    summary: { es: `Aprobaste subir a YouTube «${title}».`, en: `You approved uploading “${title}” to YouTube.` },
    detail: a as unknown as Prisma.InputJsonValue,
  };
}

export const PRIVACY_LABEL: Record<YoutubePrivacy, Bi> = {
  public: { es: "Público", en: "Public" },
  unlisted: { es: "No listado", en: "Unlisted" },
  private: { es: "Privado", en: "Private" },
};

/** «YouTube: “Título” · No listado · No es para niños · Etiquetas: a, b» (lo que se va a subir, en una línea). */
export function youtubeSummary(a: Pick<YoutubeApproval, "title" | "privacy" | "madeForKids" | "tags">, lang: UiLang): string {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const kids = a.madeForKids ? t("Para niños", "Made for kids") : t("No es para niños", "Not made for kids");
  const tags = a.tags.length ? t(`Etiquetas: ${a.tags.join(", ")}`, `Tags: ${a.tags.join(", ")}`) : t("Sin etiquetas", "No tags");
  return `YouTube: ${t(`«${a.title}»`, `“${a.title}”`)} · ${PRIVACY_LABEL[a.privacy][lang]} · ${kids} · ${tags}`;
}
