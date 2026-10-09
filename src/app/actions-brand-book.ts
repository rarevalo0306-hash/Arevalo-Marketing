"use server";

// Imágenes del manual de marca: el navegador manda las páginas de a poco, la IA encuentra logos, símbolo, patrones,
// íconos, fotos y ejemplos de piezas, y quedan como propuestas que el dueño acepta o rechaza.
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { saveBrandLogo } from "@/app/actions-brand";
import { saveDesignMaster, startBookConvert } from "@/app/actions-design-ai";
import { acceptedBookAssets, addBrandAssets, type BrandAsset, type BrandAssetStatus, bookProposals, newAssetId, removeBrandAsset, setBrandAssetStatus } from "@/lib/brand-assets";
import { loadBrandAssets, updateBrandAssets } from "@/lib/brand-assets-db";
import {
  type BookItem,
  type Crop,
  cropItem,
  dedupe,
  findOnPage,
  imageHash,
  isLogoKind,
  isSocialAsset,
  isSocialPiece,
  itemPriority,
  type KnownCrop,
  MAX_BATCH_BYTES,
  MAX_BATCH_PAGES,
  MAX_BOOK_PAGES,
  MAX_BOOK_PROPOSALS,
  MAX_PAGE_BYTES,
  PAGE_TYPES,
} from "@/lib/brand-book-extract";
import { db } from "@/lib/db";
import { BiError, errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { isOwnFile, readMedia, storeBuffer } from "@/lib/media";

export type BookBatchResult =
  | { ok: true; added: number; failedPages: number[]; known: KnownCrop[]; full: boolean }
  | { ok: false; message: string };

export type BookActionResult = { ok: boolean; message: string };

const refresh = (businessId: string) => revalidatePath(`/b/${businessId}`, "layout");

/** ¿El error es porque Gemini llegó a su límite por minuto? (vale la pena esperar y reintentar). */
const isRateLimit = (e: unknown) => e instanceof BiError && /límite|ocupado/i.test(e.message);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Una página, con un reintento si Gemini está saturado o en su límite. */
async function readPage(image: Buffer, mime: string, page: number, total: number, name: string): Promise<BookItem[]> {
  try {
    return await findOnPage(image, mime, page, total, name);
  } catch (e) {
    if (!isRateLimit(e)) throw e;
    await wait(12000);
    return findOnPage(image, mime, page, total, name);
  }
}

/** Huellas de lo ya aceptado del manual, para no volver a proponer lo mismo al leerlo otra vez. */
async function acceptedHashes(items: BrandAsset[]): Promise<KnownCrop[]> {
  const out: KnownCrop[] = [];
  for (const a of items.slice(0, 40)) {
    try {
      out.push({ id: a.id, kind: a.kind, hash: await imageHash(await readMedia(a.url)), w: a.w, h: a.h, locked: true });
    } catch {
      // Si no se puede leer, simplemente no se compara.
    }
  }
  return out;
}

function parseKnown(raw: FormDataEntryValue | null): KnownCrop[] {
  try {
    const list = JSON.parse(String(raw ?? "[]")) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((k): k is KnownCrop => Boolean(k) && typeof k.id === "string" && typeof k.kind === "string" && typeof k.hash === "string" && /^[0-9a-f]{16}$/.test(k.hash) && typeof k.w === "number" && typeof k.h === "number")
      .slice(0, 200)
      .map((k) => ({ id: k.id.slice(0, 40), kind: k.kind, hash: k.hash, w: k.w, h: k.h, ...(k.locked ? { locked: true } : {}) }));
  } catch {
    return [];
  }
}

/**
 * Lee un grupo de páginas del manual (imágenes que armó el navegador) y guarda lo que la IA encontró como propuestas.
 * FormData: `page` (número de cada página), `img` (la imagen de cada página, en el mismo orden), `total` (páginas que
 * se van a leer), `first` ("1" en el primer envío: reemplaza las propuestas viejas sin aceptar) y `known` (lo que ya
 * se encontró en envíos anteriores, para no repetir).
 */
export async function readBookPages(businessId: string, f: FormData): Promise<BookBatchResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true, name: true } });
  if (!b) return { ok: false, message: t("No encontramos este negocio.", "We couldn't find this business.") };
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, message: t("Para sacar imágenes del manual hace falta la clave de Gemini (la IA de Google) en la configuración del servidor.", "Pulling images from the brand book needs the Gemini key (Google's AI) in the server settings.") };
  }

  // Lo que manda el navegador: se revisa todo (tipo, tamaño, cantidad, números de página).
  const pagesIn = f.getAll("page").map((v) => Number(v));
  const files = f.getAll("img");
  const total = Math.min(MAX_BOOK_PAGES, Math.max(1, Math.floor(Number(f.get("total")) || 1)));
  const first = f.get("first") === "1";
  const unreadable = t("No pudimos leer las páginas del manual. Prueba con otro PDF o una imagen PNG o JPG.", "We couldn't read the brand book pages. Try another PDF or a PNG or JPG image.");
  if (!files.length || files.length !== pagesIn.length) return { ok: false, message: unreadable };
  if (files.length > MAX_BATCH_PAGES) return { ok: false, message: t("Llegaron demasiadas páginas juntas. Intenta de nuevo.", "Too many pages arrived at once. Please try again.") };
  let bytes = 0;
  const pages: { page: number; data: Buffer; mime: string }[] = [];
  for (const [i, file] of files.entries()) {
    const n = pagesIn[i];
    if (!(file instanceof File) || !PAGE_TYPES.includes(file.type) || !Number.isInteger(n) || n < 1 || n > MAX_BOOK_PAGES) return { ok: false, message: unreadable };
    if (file.size > MAX_PAGE_BYTES) return { ok: false, message: t("Una página del manual es muy pesada. Prueba con un PDF más liviano.", "A brand book page is too heavy. Try a lighter PDF.") };
    bytes += file.size;
    if (bytes > MAX_BATCH_BYTES) return { ok: false, message: t("Llegaron demasiadas páginas juntas. Intenta de nuevo.", "Too many pages arrived at once. Please try again.") };
    const data = Buffer.from(await file.arrayBuffer());
    const meta = await sharp(data).metadata().catch(() => null);
    if (!meta?.width || !meta.height || meta.width > 5000 || meta.height > 5000 || !["jpeg", "png", "webp"].includes(meta.format ?? "")) return { ok: false, message: unreadable };
    pages.push({ page: n, data, mime: file.type });
  }

  let known = parseKnown(f.get("known"));
  const lockedNow: KnownCrop[] = [];
  if (first) {
    // Al empezar: se compara también con lo que el dueño ya había aceptado.
    lockedNow.push(...(await acceptedHashes(acceptedBookAssets(await loadBrandAssets(businessId)))));
    known = [...known.filter((k) => !k.locked), ...lockedNow];
  }

  // La IA mira cada página (en paralelo) y se recorta lo que encontró.
  const failedPages: number[] = [];
  let lastError: unknown = null;
  const found: { crop: Crop; item: BookItem; page: number; id: string }[] = [];
  const results = await Promise.allSettled(pages.map((p) => readPage(p.data, p.mime, p.page, total, b.name)));
  for (const [i, r] of results.entries()) {
    const p = pages[i];
    if (r.status === "rejected") {
      failedPages.push(p.page);
      lastError = r.reason;
      continue;
    }
    for (const item of r.value) {
      const crop = await cropItem(p.data, item).catch(() => null);
      if (crop) found.push({ crop, item, page: p.page, id: newAssetId() });
    }
  }
  if (failedPages.length === pages.length) {
    const why = lastError instanceof BiError ? errorText(lastError, lang) : t("No pudimos conectar con la IA. Revisa tu internet e intenta de nuevo.", "We couldn't reach the AI. Check your internet and try again.");
    return { ok: false, message: t(`La IA no pudo leer ${pages.length > 1 ? "estas páginas" : "esta página"} del manual. ${why}`, `The AI couldn't read ${pages.length > 1 ? "these pages" : "this page"} of the brand book. ${why}`) };
  }

  // Sin repetidas (de varias casi iguales queda la más grande) y sin pasar el máximo por manual.
  const fresh: KnownCrop[] = found.map((x) => ({ id: x.id, kind: x.item.kind, hash: x.crop.hash, w: x.crop.w, h: x.crop.h }));
  const { add, remove } = dedupe(known, fresh);
  const proposed = known.filter((k) => !k.locked).length - remove.length;
  const room = Math.max(0, MAX_BOOK_PROPOSALS - proposed);
  const chosen = found
    .filter((x) => add.includes(x.id))
    // Las plantillas de redes primero (lo que más le sirve al dueño), después logos, después el resto.
    .sort((a, b) => itemPriority(b.item) - itemPriority(a.item))
    .slice(0, room);

  const now = new Date().toISOString();
  const assets: BrandAsset[] = [];
  for (const x of chosen) {
    const { url } = await storeBuffer(x.crop.data, x.crop.contentType, businessId);
    assets.push({
      id: x.id,
      kind: x.item.kind,
      url,
      w: x.crop.w,
      h: x.crop.h,
      source: "book",
      status: "proposed",
      label: x.item.label,
      ...(x.item.note ? { note: x.item.note } : {}),
      page: x.page,
      // La pieza (post, historia, tarjeta…) va en `format`; `group` dice si es de redes sociales.
      ...(x.item.kind === "template" ? { format: x.item.piece ?? "other", group: isSocialPiece(x.item.piece) ? "social" : "print" } : {}),
      ...(x.crop.transparent ? { transparent: true } : {}),
      createdAt: now,
    });
  }

  await updateBrandAssets(businessId, (cur) => {
    let next = cur;
    // Solo se quitan las viejas que siguen sin decidir (si el dueño ya aceptó una, se queda).
    for (const id of remove) if (next.items.some((a) => a.id === id && a.status === "proposed")) next = removeBrandAsset(next, id);
    const space = Math.max(0, MAX_BOOK_PROPOSALS - (first ? 0 : bookProposals(next).length));
    next = addBrandAssets(next, assets.slice(0, space), { replaceBookProposals: first });
    return first ? { ...next, bookReadAt: now, bookPages: total } : next;
  });
  revalidatePath(`/b/${businessId}/marca`);

  const keptIds = new Set(assets.map((a) => a.id));
  return {
    ok: true,
    added: assets.length,
    failedPages,
    known: [...(first ? lockedNow : []), ...fresh.filter((k) => keptIds.has(k.id))],
    full: room <= chosen.length && found.length > chosen.length,
  };
}

// ---------- Decidir ----------

/** El logo con una dirección local (/media/…, sin Supabase) o pública. */
async function setLogo(businessId: string, field: "logoUrl" | "logoLightUrl", url: string): Promise<{ ok: boolean; message: string }> {
  if (/^https:\/\//.test(url)) return saveBrandLogo(businessId, field, url);
  // Sin Supabase (en la computadora) las imágenes viven en /media/…; saveBrandLogo solo acepta https.
  if (!/^\/media\/[a-f0-9]{24}\.(png|jpg|webp)$/.test(url)) return { ok: false, message: "" };
  await db.business.update({ where: { id: businessId }, data: { [field]: url } });
  return { ok: true, message: "" };
}

const LOGO_FOR_LIGHT = new Set(["logo", "logo-dark"]);

/** Acepta, rechaza o vuelve a dejar pendiente una imagen del manual. Al aceptar el primer logo, queda como logo. */
export async function decideBookAsset(businessId: string, assetId: string, status: BrandAssetStatus): Promise<BookActionResult> {
  const { t } = await getT();
  if (!["accepted", "rejected", "proposed"].includes(status)) return { ok: false, message: t("Opción no válida.", "Invalid option.") };
  const b = await db.business.findUnique({ where: { id: businessId }, select: { logoUrl: true, logoLightUrl: true } });
  if (!b) return { ok: false, message: t("No encontramos este negocio.", "We couldn't find this business.") };
  const cur = await loadBrandAssets(businessId);
  const a = cur.items.find((x) => x.id === assetId && x.source === "book");
  if (!a) return { ok: false, message: t("Esa imagen ya no está. Recarga la página.", "That image is gone. Reload the page.") };
  await updateBrandAssets(businessId, (c) => setBrandAssetStatus(c, assetId, status));
  let message = status === "accepted" ? t("Aceptada.", "Accepted.") : status === "rejected" ? t("Rechazada.", "Rejected.") : "";
  if (status === "accepted") {
    if (LOGO_FOR_LIGHT.has(a.kind) && !b.logoUrl && (await setLogo(businessId, "logoUrl", a.url)).ok) {
      message = t("Aceptada. Como no tenías logo, la pusimos como tu logo principal.", "Accepted. Since you had no logo, we made it your main logo.");
    } else if (a.kind === "logo-light" && !b.logoLightUrl && (await setLogo(businessId, "logoLightUrl", a.url)).ok) {
      message = t("Aceptada. La pusimos como tu logo para fondos oscuros.", "Accepted. We made it your logo for dark backgrounds.");
    }
  }
  refresh(businessId);
  return { ok: true, message };
}

/** Acepta todas las que están por revisar. Si no había logo, se usa el primero (el más grande). */
export async function acceptAllBookAssets(businessId: string): Promise<BookActionResult> {
  const { t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { logoUrl: true, logoLightUrl: true } });
  if (!b) return { ok: false, message: t("No encontramos este negocio.", "We couldn't find this business.") };
  const pending = bookProposals(await loadBrandAssets(businessId));
  if (!pending.length) return { ok: true, message: "" };
  const ids = new Set(pending.map((a) => a.id));
  await updateBrandAssets(businessId, (c) => ({ ...c, items: c.items.map((a) => (ids.has(a.id) && a.status === "proposed" ? { ...a, status: "accepted" as const } : a)) }));
  let setMain = false;
  let setLight = false;
  const biggest = (list: BrandAsset[]) => [...list].sort((x, y) => y.w * y.h - x.w * x.h)[0];
  const main = biggest(pending.filter((a) => a.kind === "logo")) ?? biggest(pending.filter((a) => a.kind === "logo-dark"));
  if (!b.logoUrl && main) setMain = (await setLogo(businessId, "logoUrl", main.url)).ok;
  const light = biggest(pending.filter((a) => a.kind === "logo-light"));
  if (!b.logoLightUrl && light) setLight = (await setLogo(businessId, "logoLightUrl", light.url)).ok;
  refresh(businessId);
  const n = pending.length;
  const extra =
    setMain && setLight
      ? t(" Como no tenías logos, pusimos uno como logo principal y otro para fondos oscuros.", " Since you had no logos, we set one as your main logo and another for dark backgrounds.")
      : setMain
        ? t(" Como no tenías logo, pusimos uno como tu logo principal.", " Since you had no logo, we set one as your main logo.")
        : setLight
          ? t(" Como no tenías logo para fondos oscuros, pusimos el blanco.", " Since you had no logo for dark backgrounds, we set the white one.")
          : "";
  return { ok: true, message: t(`Listo: aceptaste ${n} ${n === 1 ? "imagen" : "imágenes"}.`, `Done: you accepted ${n} ${n === 1 ? "image" : "images"}.`) + extra };
}

/**
 * Usa una imagen aceptada: como logo principal, como logo para fondos oscuros, o como plantilla de diseño (la pieza de
 * ejemplo de fondo; la foto va arriba y el titular abajo, con letras claras u oscuras según el fondo).
 */
export async function applyBookAsset(businessId: string, assetId: string, use: "logo" | "logoLight" | "template"): Promise<BookActionResult> {
  const { lang, t } = await getT();
  const exists = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!exists) return { ok: false, message: t("No encontramos este negocio.", "We couldn't find this business.") };
  const a = (await loadBrandAssets(businessId)).items.find((x) => x.id === assetId && x.source === "book");
  if (!a) return { ok: false, message: t("Esa imagen ya no está. Recarga la página.", "That image is gone. Reload the page.") };

  if (use === "logo" || use === "logoLight") {
    if (!isLogoKind(a.kind)) return { ok: false, message: t("Esa imagen no es un logo.", "That image isn't a logo.") };
    const r = await setLogo(businessId, use === "logo" ? "logoUrl" : "logoLightUrl", a.url);
    refresh(businessId);
    if (!r.ok) return { ok: false, message: r.message || t("No se pudo usar como logo.", "Couldn't use it as the logo.") };
    if (a.status !== "accepted") await updateBrandAssets(businessId, (c) => setBrandAssetStatus(c, assetId, "accepted"));
    return { ok: true, message: use === "logo" ? t("Listo: ahora es tu logo principal.", "Done: it's now your main logo.") : t("Listo: ahora es tu logo para fondos oscuros.", "Done: it's now your logo for dark backgrounds.") };
  }

  if (use !== "template") return { ok: false, message: t("Opción no válida.", "Invalid option.") };
  // Las plantillas son solo para redes sociales: tarjetas, papelería o letreros quedan como referencia.
  if (!isSocialAsset(a)) return { ok: false, message: t("Solo las piezas para redes sociales se convierten en plantillas. Esta queda como referencia de tu marca.", "Only social media pieces can become templates. This one stays as a reference for your brand.") };
  // Sin pagar: se tapa el texto de ejemplo y se usan las cajas que ve la IA en la pieza (para limpiarla con IA de
  // edición y ajustar las cajas, está «Convertir en plantilla» en la pantalla).
  try {
    const r = await startBookConvert(businessId, assetId, "none");
    if (!r.ok || !r.id) return { ok: false, message: r.message };
    return await saveDesignMaster(businessId, r.id);
  } catch (e) {
    return { ok: false, message: t(`No se pudo usar como plantilla: ${errorText(e, lang)}`, `Couldn't use it as a template: ${errorText(e, lang)}`) };
  }
}

/** Guarda el manual que el dueño subió (y su nombre) como el manual en uso. No lo lee: eso pasa al presionar «Crear mi marca». */
export async function saveBrandBook(businessId: string, url: string, name: string): Promise<BookActionResult> {
  const { t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  if (!isOwnFile(url, businessId)) return { ok: false, message: t("El archivo no es de este negocio.", "That file doesn't belong to this business.") };
  await db.business.update({ where: { id: businessId }, data: { brandBookUrl: url } });
  await updateBrandAssets(businessId, (cur) => ({ ...cur, bookName: name.trim().slice(0, 120) || undefined }));
  refresh(businessId);
  return { ok: true, message: t("Manual guardado.", "Brand book saved.") };
}
