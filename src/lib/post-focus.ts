// Lo que se sabe de una foto de «Tus fotos» por su dirección (su punto importante, para recortarla bien en cada
// red, y lo que muestra) y las palabras clave del negocio (las que sigue en SEO + las del estudio). Con la base de
// datos; no depende de media-formats (que lo usa al recortar).
import type { Business } from "@prisma/client";
import { db } from "@/lib/db";
import { readDescription } from "@/lib/library-shape";
import { readEnhanceInfo } from "@/lib/photo-enhance-shape";
import { mergeKeywords } from "@/lib/post-keywords";
import type { Focus } from "@/lib/post-media";
import { readTrackedKeywords } from "@/lib/seo/dataforseo";
import { readStudy, topKeywords } from "@/lib/study-shape";

/** Las palabras clave del negocio: primero las que sigue en SEO, después las mejores del estudio. */
export function businessKeywords(b: Pick<Business, "seoKeywords" | "study">, max = 20): string[] {
  const study = readStudy(b.study);
  return mergeKeywords(readTrackedKeywords(b.seoKeywords), study ? topKeywords(study, 12) : []).slice(0, max);
}

/** Las direcciones con las que se puede buscar una foto: tal cual y, si es una copia local, solo /media/…. */
function urlForms(url: string): string[] {
  const out = [url];
  const local = /^https?:\/\/[^/]+(\/media\/[^/?#]+)$/.exec(url);
  if (local) out.push(local[1]);
  return out;
}

export type LibraryPhotoInfo = { focus?: Focus; what?: { es: string; en: string } };

/**
 * Lo que se sabe de una foto de «Tus fotos» por su dirección: su punto importante (enhanceInfo.focus en la
 * mejorada; en la original, el que vio la IA) y lo que muestra. Vacío si no es de la biblioteca.
 */
export async function libraryPhotoInfo(url: string, businessId?: string): Promise<LibraryPhotoInfo> {
  if (!url) return {};
  try {
    const forms = urlForms(url);
    const item = await db.libraryItem.findFirst({
      where: { ...(businessId ? { businessId } : {}), OR: [{ enhancedUrl: { in: forms } }, { url: { in: forms } }] },
      select: { url: true, enhancedUrl: true, enhanceInfo: true, description: true },
    });
    if (!item) return {};
    const info = readEnhanceInfo(item.enhanceInfo);
    const isEnhanced = !!item.enhancedUrl && forms.includes(item.enhancedUrl);
    // En la mejorada vale el punto de la mejora; en la original, el que vio la IA al revisarla.
    const focus = isEnhanced ? (info && info.focusFrom !== "center" ? info.focus : undefined) : (info?.hints?.focus ?? undefined);
    const d = readDescription(item.description);
    return { ...(focus ? { focus } : {}), ...(d ? { what: { es: d.es, en: d.en } } : {}) };
  } catch {
    return {};
  }
}

/** Solo el punto importante (para recortar). */
export async function focusForUrl(url: string, businessId?: string): Promise<Focus | undefined> {
  return (await libraryPhotoInfo(url, businessId)).focus;
}

