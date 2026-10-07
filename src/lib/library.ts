// Biblioteca de fotos y videos reales del negocio (tabla LibraryItem): leerla para la página «Tus fotos» y el
// compositor, y elegir la foto real que mejor va con una publicación antes de crear una con IA.
// Las reglas para elegir (sin base de datos) están en library-match.ts.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { rankLibrary, usableNow, type LibraryCard, type MatchItem, type MatchQuery } from "@/lib/library-match";
import { needsReview, readDescription } from "@/lib/library-shape";

export * from "@/lib/library-match";

// ---------- Filtros de la página ----------

export const LIBRARY_FILTERS = ["todas", "listas", "revisar", "no-usar", "problemas", "videos"] as const;
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
  description: true,
  width: true,
  height: true,
  durationSec: true,
  error: true,
  usedCount: true,
  lastUsedAt: true,
} satisfies Prisma.LibraryItemSelect;

type CardRow = Prisma.LibraryItemGetPayload<{ select: typeof CARD_SELECT }>;

export function toCard(r: CardRow): LibraryCard {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind === "video" ? "video" : "photo",
    thumb: r.thumbUrl || (r.kind === "video" ? "" : r.url),
    url: r.url,
    durationSec: r.durationSec,
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
    canUse: usableNow(r),
    needsReview: needsReview(r),
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
    select: { kind: true, url: true, status: true, usable: true, quality: true, privacy: true, choice: true },
  });
  return {
    todas: rows.length,
    listas: rows.filter((r) => usableNow(r)).length,
    revisar: rows.filter((r) => needsReview(r)).length,
    "no-usar": rows.filter((r) => r.choice === "skip").length,
    problemas: rows.filter((r) => r.status === "error").length,
    videos: rows.filter((r) => r.kind === "video").length,
  };
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
  let items: MatchItem[] = [];
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
    return { id: best.id, url: best.url };
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
