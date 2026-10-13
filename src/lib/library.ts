// Biblioteca de fotos y videos reales del negocio (tabla LibraryItem): leerla para la página «Tus fotos» y el
// compositor, y elegir la foto real que mejor va con una publicación antes de crear una con IA.
// Las reglas para elegir (sin base de datos) están en library-match.ts.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { rankLibrary, usableNow, type LibraryCard, type MatchItem, type MatchQuery } from "@/lib/library-match";
import { needsReview, readDescription } from "@/lib/library-shape";
import { libraryPhotoUrl, readEnhanceInfo } from "@/lib/photo-enhance-shape";

export * from "@/lib/library-match";
export { libraryPhotoUrl } from "@/lib/photo-enhance-shape";

// ---------- Filtros de la página ----------

export const LIBRARY_FILTERS = ["todas", "listas", "revisar", "no-usar", "problemas", "videos", "ia"] as const;
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number];

export const asLibraryFilter = (v: string | undefined | null): LibraryFilter =>
  LIBRARY_FILTERS.includes(v as LibraryFilter) ? (v as LibraryFilter) : "todas";

/** El filtro como consulta. «Listas» y «Revisar» se terminan de filtrar con canUse/needsReview (ver `matchesFilter`). */
export function filterWhere(businessId: string, f: LibraryFilter): Prisma.LibraryItemWhereInput {
  const base: Prisma.LibraryItemWhereInput = { businessId, status: { not: "gone" } };
  switch (f) {
    case "listas":
      return { ...base, status: "ready", NOT: { choice: "skip" } };
    case "revisar":
      return { ...base, status: "ready", choice: "", usable: true, NOT: { privacy: { isEmpty: true } } };
    case "no-usar":
      return { ...base, choice: "skip" };
    case "problemas":
      return { ...base, status: "error" };
    case "videos":
      return { ...base, kind: "video" };
    case "ia":
      return { ...base, source: "ai" };
    default:
      return base;
  }
}

/** Lo que la consulta no puede decir sola (calidad y avisos de privacidad de «Listas»). */
export function matchesFilter(x: MatchItem, f: LibraryFilter): boolean {
  if (f === "listas") return usableNow(x);
  if (f === "revisar") return needsReview(x);
  return true;
}

// ---------- Base de datos ----------

const CARD_SELECT = {
  id: true,
  name: true,
  kind: true,
  url: true,
  thumbUrl: true,
  status: true,
  usable: true,
  quality: true,
  privacy: true,
  choice: true,
  tags: true,
  folderPath: true,
  source: true,
  description: true,
  width: true,
  height: true,
  durationSec: true,
  error: true,
  usedCount: true,
  lastUsedAt: true,
  enhancedUrl: true,
  enhanceInfo: true,
  useEnhanced: true,
} satisfies Prisma.LibraryItemSelect;

type CardRow = Prisma.LibraryItemGetPayload<{ select: typeof CARD_SELECT }>;

export function toCard(r: CardRow): LibraryCard {
  const info = readEnhanceInfo(r.enhanceInfo);
  const enhanced = r.kind === "photo" && r.enhancedUrl && r.useEnhanced;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind === "video" ? "video" : "photo",
    thumb: (enhanced && info?.thumb) || r.thumbUrl || (r.kind === "video" ? "" : r.url),
    // La que va en las publicaciones: la mejorada si existe y el dueño no eligió la original.
    url: r.kind === "photo" ? libraryPhotoUrl(r) : r.url,
    durationSec: r.durationSec,
    width: r.width,
    height: r.height,
    description: readDescription(r.description),
    tags: r.tags,
    quality: r.quality,
    privacy: r.privacy,
    status: r.status,
    error: r.error,
    choice: r.choice,
    usedCount: r.usedCount,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    folderPath: r.folderPath,
    source: r.source === "upload" ? "upload" : r.source === "ai" ? "ai" : "drive",
    canUse: usableNow(r),
    needsReview: needsReview(r),
    originalUrl: r.url,
    enhancedUrl: r.enhancedUrl,
    useEnhanced: r.useEnhanced,
    enhance: info ? { ...info, hints: null } : null,
  };
}

/** Páginas de 60. */
export const PAGE_SIZE = 60;

/** Archivos de la biblioteca con un filtro, los más nuevos primero. `more` = hay más para «Ver más». */
export async function loadLibrary(businessId: string, f: LibraryFilter, limit = PAGE_SIZE): Promise<{ items: LibraryCard[]; more: boolean }> {
  const where = filterWhere(businessId, f);
  const order: Prisma.LibraryItemOrderByWithRelationInput[] = [{ takenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
  if (f !== "listas" && f !== "revisar") {
    const rows = await db.libraryItem.findMany({ where, select: CARD_SELECT, orderBy: order, take: limit + 1 });
    return { items: rows.slice(0, limit).map(toCard), more: rows.length > limit };
  }
  // Calidad y avisos se revisan aquí; se leen todas las candidatas (son pocas columnas).
  const rows = (await db.libraryItem.findMany({ where, select: CARD_SELECT, orderBy: order })).filter((r) => matchesFilter(r, f));
  return { items: rows.slice(0, limit).map(toCard), more: rows.length > limit };
}

/** Cuántos hay en cada filtro (para las pestañas). */
export async function libraryCounts(businessId: string): Promise<Record<LibraryFilter, number>> {
  const rows = await db.libraryItem.findMany({
    where: { businessId, status: { not: "gone" } },
    select: { kind: true, url: true, status: true, usable: true, quality: true, privacy: true, choice: true, source: true },
  });
  return {
    todas: rows.length,
    listas: rows.filter((r) => usableNow(r)).length,
    revisar: rows.filter((r) => needsReview(r)).length,
    "no-usar": rows.filter((r) => r.choice === "skip").length,
    problemas: rows.filter((r) => r.status === "error").length,
    videos: rows.filter((r) => r.kind === "video").length,
    ia: rows.filter((r) => r.source === "ai").length,
  };
}

// ---------- Lo que crea la IA ----------

/** Lo que se sabe de una foto o video que creó la IA (para encontrarla después y volver a usarla). */
export type AiMediaInfo = {
  kind: "photo" | "video";
  /** Título o titular del post, en el idioma del negocio. */
  title?: string;
  /** Lo que se le pidió a la IA (en inglés). */
  prompt?: string;
  keywords?: string[];
  /** De qué foto de la biblioteca salió (variantes y videos hechos de una foto). */
  parentId?: string;
  width?: number;
  height?: number;
  /** Miniatura (videos). */
  thumbUrl?: string;
  /** false cuando todavía no se usó en una publicación (ej. la creó el compositor). */
  used?: boolean;
};

/** Los datos de la biblioteca para un archivo creado por la IA (sin base de datos, para probarlo). */
export function aiLibraryData(businessId: string, url: string, info: AiMediaInfo, now = new Date()): Prisma.LibraryItemUncheckedCreateInput {
  const words = (info.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const topics = [...new Set(words)].slice(0, 12);
  const title = (info.title ?? "").trim().slice(0, 200);
  const prompt = (info.prompt ?? "").trim().slice(0, 600);
  const ext = /\.(\w+)(?:$|\?)/.exec(url)?.[1]?.toLowerCase() ?? "";
  const mime = info.kind === "video" ? "video/mp4" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return {
    businessId,
    source: "ai",
    externalId: `ai:${url}`.slice(0, 1000),
    name: (title || prompt || (info.kind === "video" ? "Video con IA" : "Foto con IA")).slice(0, 120),
    folderPath: info.parentId ? "IA / variantes" : "IA",
    mimeType: mime,
    kind: info.kind,
    url,
    thumbUrl: info.thumbUrl ?? "",
    width: info.width ?? 0,
    height: info.height ?? 0,
    description: { es: title || prompt, en: prompt || title, scene: "other", topics },
    tags: topics,
    // Las de IA salen limpias y sin personas reconocibles: se pueden usar sin revisar.
    quality: 4,
    usable: true,
    privacy: [],
    status: "ready",
    usedCount: info.used === false ? 0 : 1,
    lastUsedAt: info.used === false ? null : now,
    modifiedAt: now,
  };
}

/**
 * Guarda en la biblioteca («Tus fotos y videos», filtro «Hechas con IA») una foto o video que creó la IA, para no
 * perderlo y volver a usarlo. Nunca falla: si la base de datos no responde, el archivo igual queda guardado.
 */
export async function recordAiMedia(businessId: string, url: string, info: AiMediaInfo): Promise<string | null> {
  if (!businessId || !url) return null;
  try {
    const data = aiLibraryData(businessId, url, info);
    const row = await db.libraryItem.upsert({
      where: { businessId_externalId: { businessId, externalId: data.externalId } },
      create: data,
      update: info.used === false ? {} : { usedCount: { increment: 1 }, lastUsedAt: new Date() },
      select: { id: true },
    });
    return row.id;
  } catch (e) {
    console.error(`[library] no se pudo guardar lo creado por la IA (${businessId}):`, e);
    return null;
  }
}

// ---------- Fotos editadas con IA ----------

/** Dónde quedan las ediciones con IA de una foto de la biblioteca. */
export const EDIT_FOLDER = { cutout: "IA / recortes", upscale: "IA / agrandadas", fix: "IA / arregladas" } as const;
export type PhotoEdit = keyof typeof EDIT_FOLDER;
const EDIT_NAME: Record<PhotoEdit, string> = { cutout: "Recortada", upscale: "Agrandada", fix: "Arreglada" };

/** Una foto real editada con IA (recortada o agrandada). Las arregladas siguen siendo «hechas con IA». */
export const editedByAi = (folderPath: string) => folderPath === EDIT_FOLDER.cutout || folderPath === EDIT_FOLDER.upscale;

/** Lo que se copia de la foto original a su edición. */
export type EditSource = Pick<Prisma.LibraryItemGetPayload<object>, "name" | "description" | "tags" | "quality" | "privacy" | "choice" | "usable">;

/**
 * Los datos de la biblioteca para una foto editada con IA a partir de otra (sin base de datos, para probarlo). Hereda
 * lo que la IA vio y lo que eligió el dueño en la original (avisos de privacidad, «usar» o «no usar»): editar nunca se
 * salta una revisión pendiente. Los recortes (fondo transparente) la IA no los usa sola: se usan a mano.
 */
export function editedLibraryData(businessId: string, url: string, from: EditSource, edit: PhotoEdit, size: { width: number; height: number }, now = new Date()): Prisma.LibraryItemUncheckedCreateInput {
  return {
    businessId,
    source: "ai",
    externalId: `ai:${url}`.slice(0, 1000),
    name: `${EDIT_NAME[edit]}: ${from.name}`.slice(0, 120),
    folderPath: EDIT_FOLDER[edit],
    mimeType: /\.png(?:$|\?)/i.test(url) ? "image/png" : "image/jpeg",
    kind: "photo",
    url,
    thumbUrl: "",
    width: size.width,
    height: size.height,
    description: from.description ?? Prisma.JsonNull,
    tags: from.tags,
    quality: from.quality,
    usable: edit === "cutout" ? false : from.usable,
    privacy: from.privacy,
    choice: from.choice,
    status: "ready",
    usedCount: 0,
    modifiedAt: now,
  };
}

/** Guarda la foto editada en la biblioteca. Devuelve su id (null si la base de datos no respondió). */
export async function recordEditedPhoto(businessId: string, url: string, from: EditSource, edit: PhotoEdit, size: { width: number; height: number }): Promise<string | null> {
  try {
    const data = editedLibraryData(businessId, url, from, edit, size);
    const row = await db.libraryItem.upsert({ where: { businessId_externalId: { businessId, externalId: data.externalId } }, create: data, update: {}, select: { id: true } });
    return row.id;
  } catch (e) {
    console.error(`[library] no se pudo guardar la foto editada (${businessId}):`, e);
    return null;
  }
}

/** Para el selector del compositor: todo lo que se puede usar (fotos y videos), los menos usados primero. */
export async function usableLibrary(businessId: string, limit = 300): Promise<LibraryCard[]> {
  const rows = await db.libraryItem.findMany({
    where: { businessId, status: "ready", NOT: { choice: "skip" } },
    select: CARD_SELECT,
    orderBy: [{ takenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  return rows.map(toCard).filter((c) => c.canUse).slice(0, limit);
}

/** Cuenta una vez más que se usó. */
export async function markUsed(businessId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.libraryItem.updateMany({ where: { businessId, id: { in: ids } }, data: { usedCount: { increment: 1 }, lastUsedAt: new Date() } });
}

/**
 * Para cada publicación, la foto real que mejor le va (o null: la IA crea una). En un mismo plan no se repite foto.
 * Las elegidas quedan marcadas como usadas. Nunca falla: si la biblioteca no se puede leer, todas quedan en null.
 */
export async function pickLibraryPhotos(businessId: string, posts: MatchQuery[]): Promise<({ id: string; url: string } | null)[]> {
  let items: (MatchItem & { enhancedUrl?: string; useEnhanced?: boolean })[] = [];
  try {
    items = await db.libraryItem.findMany({
      where: { businessId, kind: "photo", status: "ready", NOT: { choice: "skip" }, url: { not: "" } },
      select: {
        id: true,
        kind: true,
        url: true,
        status: true,
        usable: true,
        quality: true,
        privacy: true,
        choice: true,
        tags: true,
        folderPath: true,
        description: true,
        width: true,
        height: true,
        usedCount: true,
        lastUsedAt: true,
        enhancedUrl: true,
        useEnhanced: true,
      },
    });
  } catch {
    return posts.map(() => null);
  }
  if (!items.length) return posts.map(() => null);
  const taken = new Set<string>();
  const now = new Date();
  const out = posts.map((q) => {
    const best = rankLibrary(items, { ...q, exclude: [...(q.exclude ?? []), ...taken] }, now);
    if (!best) return null;
    taken.add(best.id);
    // La mejorada si existe y el dueño no eligió la original.
    return { id: best.id, url: libraryPhotoUrl(best as (typeof items)[number]) };
  });
  try {
    await markUsed(businessId, [...taken]);
  } catch {
    // Contar el uso no es indispensable.
  }
  return out;
}

/** La mejor foto real para una publicación (o null). La marca como usada. */
export async function pickLibraryPhoto(businessId: string, q: MatchQuery): Promise<{ id: string; url: string } | null> {
  return (await pickLibraryPhotos(businessId, [q]))[0];
}
