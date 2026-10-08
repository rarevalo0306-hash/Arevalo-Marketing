// Fotos listas para cada red: el tamaño correcto por canal y los datos del negocio dentro del archivo.
//
// - Los diseños con la marca guardan una nota (sidecar .json) con cómo se hicieron; al publicar se
//   vuelven a dibujar en el tamaño de cada red (sin cortar el titular ni el logo).
// - Las fotos sin letras (las de la IA) se recortan con recorte inteligente (busca lo importante).
// - Las fotos subidas (que pueden tener letras) se mandan tal cual si la red las acepta; si no, se
//   centran sobre un fondo desenfocado, sin cortar nada.
// Cada copia lleva autor, lugar y palabras clave (src/lib/photo-meta.ts). Las marcas de "hecho con IA"
// se conservan siempre.
import { createHash } from "crypto";
import sharp from "sharp";
import type { Business } from "@prisma/client";
import { renderDesign, fitToShape, type Brand, type DesignInput } from "@/lib/design";
import { DESIGN_SHAPES, StoredTemplate } from "@/lib/design-shapes";
import { adaptPlan, formatFor, formatKey } from "@/lib/formats";
import { db } from "@/lib/db";
import { guessLang, sloganFrom } from "@/lib/design-layout";
import { mediaExists, mediaUrlFor, publicMediaUrl, readMedia, readSidecar, seoMediaName, storeBuffer, writeSidecar } from "@/lib/media";
import { readProvenance, writePhotoMeta, type PhotoMeta, type Provenance } from "@/lib/photo-meta";
import { readMapPlace } from "@/lib/seo/maprank";
import { readStudy, topKeywords } from "@/lib/study-shape";
import { smartCrop } from "@/lib/post-crop";
import { businessKeywords, focusForUrl } from "@/lib/post-focus";
import { pickPostKeywords, seoSlug } from "@/lib/post-keywords";
import type { Focus, PostKind } from "@/lib/post-media";

// ---------- Nota que acompaña a cada foto ----------

export type Sidecar =
  | {
      v: 1;
      kind: "design";
      brand: Brand;
      headline: string;
      steps?: string[];
      template: StoredTemplate;
      photoUrl?: string;
      /** Campos opcionales del diseño (texto corto, botón, eslogan y punto importante de la foto). */
      sub?: string;
      cta?: string;
      slogan?: string;
      focus?: { x: number; y: number };
      provenance?: Omit<Provenance, "c2pa">;
    }
  | { v: 1; kind: "photo"; ai: boolean; provenance?: Omit<Provenance, "c2pa"> };

function readNote(json: unknown): Sidecar | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (o.kind === "photo") return { v: 1, kind: "photo", ai: Boolean(o.ai), provenance: (o.provenance as Sidecar["provenance"]) ?? undefined };
  if (o.kind !== "design" || typeof o.headline !== "string" || !o.brand) return null;
  const tpl = StoredTemplate.safeParse(o.template);
  if (!tpl.success) return null;
  return {
    v: 1,
    kind: "design",
    brand: o.brand as Brand,
    headline: o.headline,
    steps: Array.isArray(o.steps) ? o.steps.map(String).slice(0, 3) : [],
    template: tpl.data,
    photoUrl: typeof o.photoUrl === "string" ? o.photoUrl : undefined,
    sub: typeof o.sub === "string" ? o.sub : undefined,
    cta: typeof o.cta === "string" ? o.cta : undefined,
    slogan: typeof o.slogan === "string" ? o.slogan : undefined,
    focus: readFocus(o.focus),
    provenance: (o.provenance as Sidecar["provenance"]) ?? undefined,
  };
}

function readFocus(v: unknown): { x: number; y: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { x, y } = v as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : undefined;
}

// ---------- Datos del negocio para la foto ----------

type BizForMeta = Pick<Business, "name" | "website" | "hashtags" | "study" | "studyInput" | "seoMapPlace" | "seoLocations" | "seoLocationName"> & {
  /** Palabras que el negocio sigue en SEO: las que van con el post van primero (y dan el nombre del archivo). */
  seoKeywords?: Business["seoKeywords"];
};

const COUNTRY_CODES: Record<string, string> = {
  "united states": "US", usa: "US", "estados unidos": "US", nicaragua: "NI", mexico: "MX", méxico: "MX", "costa rica": "CR", honduras: "HN",
  guatemala: "GT", "el salvador": "SV", panama: "PA", panamá: "PA", colombia: "CO", spain: "ES", españa: "ES", "puerto rico": "PR", "dominican republic": "DO", "república dominicana": "DO",
};
const US_STATES: Record<string, string> = { FL: "Florida", TX: "Texas", CA: "California", NY: "New York", GA: "Georgia", NC: "North Carolina", SC: "South Carolina", LA: "Louisiana", AL: "Alabama", NJ: "New Jersey" };

/** Ciudad, estado y país del negocio: del lugar en Google Maps, de la zona de SEO o del estudio. */
export function businessPlace(b: Pick<BizForMeta, "study" | "studyInput" | "seoMapPlace" | "seoLocations" | "seoLocationName">): Pick<PhotoMeta, "city" | "state" | "country" | "countryCode" | "location" | "gps"> {
  const out: Pick<PhotoMeta, "city" | "state" | "country" | "countryCode" | "location" | "gps"> = {};
  const place = readMapPlace(b.seoMapPlace);
  if (place) {
    out.gps = { lat: place.lat, lng: place.lng };
    // "123 SW 8th St, Miami, FL 33130, United States" o "Km 5 Carretera Norte, Managua, Nicaragua"
    const parts = place.address.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const stateZip = /^([A-Z]{2})\s*\d{5}/.exec(parts[parts.length - 2] ?? "");
      if (stateZip) {
        out.country = last;
        out.state = US_STATES[stateZip[1]] ?? stateZip[1];
        out.city = parts[parts.length - 3];
      } else if (/^[A-Z]{2}\s*\d{5}/.test(last)) {
        out.country = "United States";
        out.state = US_STATES[last.slice(0, 2)] ?? last.slice(0, 2);
        out.city = parts[parts.length - 2];
      } else {
        out.country = last;
        out.city = parts[parts.length - 2];
      }
    }
  }
  if (!out.city) {
    const zones = Array.isArray(b.seoLocations) ? (b.seoLocations as { name?: unknown }[]) : [];
    const name = String(zones[0]?.name ?? b.seoLocationName ?? "");
    const parts = name.split(",").map((p) => p.trim()).filter(Boolean);
    const uniq = parts.filter((p, i) => i === 0 || p !== parts[i - 1]);
    if (uniq.length >= 3) Object.assign(out, { city: uniq[0], state: uniq[uniq.length - 2], country: uniq[uniq.length - 1] });
    else if (uniq.length === 2) Object.assign(out, { city: uniq[0], country: uniq[1] });
    else if (uniq.length === 1 && !out.country) out.country = uniq[0];
  }
  if (!out.city) {
    const study = readStudy(b.study);
    const first = study?.market.places?.[0]?.trim();
    if (first) out.city = first.split(",")[0].trim().slice(0, 64);
  }
  if (!out.city && b.studyInput && typeof b.studyInput === "object") {
    const zone = String((b.studyInput as { zone?: unknown }).zone ?? "").split(/[,;\n]/)[0].trim();
    if (zone && zone.length <= 40) out.city = zone;
  }
  if (out.country) out.countryCode = COUNTRY_CODES[out.country.toLowerCase()];
  return out;
}

const hashtagsIn = (s: string) => [...s.matchAll(/#([\p{L}\p{N}_]{2,40})/gu)].map((m) => m[1].replace(/_/g, " "));
const firstLine = (s: string, max: number) => s.replace(/https?:\/\/\S+/g, "").replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim().slice(0, max);

/** Todos los datos para escribir en la foto: negocio, lugar, título, descripción y palabras clave. */
export function photoMetaFor(b: BizForMeta, post: { title?: string; text?: string; keywords?: string[] } = {}): PhotoMeta {
  const study = readStudy(b.study);
  // Las palabras del negocio que van con este post (las que sigue en SEO primero).
  const own = businessKeywords({ seoKeywords: b.seoKeywords ?? null, study: b.study });
  const picked = own.length && (post.title || post.text) ? pickPostKeywords(`${post.title ?? ""}\n${post.text ?? ""}`, own, 3) : [];
  const kws = [...(post.keywords ?? []), ...picked, ...hashtagsIn(post.text ?? ""), ...(study ? topKeywords(study, 6) : []), ...hashtagsIn(b.hashtags ?? "")];
  const seen = new Set<string>();
  const keywords = kws.map((k) => k.trim()).filter((k) => k && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase())).slice(0, 15);
  const place = businessPlace(b);
  const title = (post.title?.trim() || firstLine(post.text ?? "", 120)).slice(0, 200);
  const description = firstLine(post.text ?? "", 300) || title;
  if (place.city && !keywords.some((k) => k.toLowerCase().includes(place.city!.toLowerCase()))) keywords.push(place.city);
  return { creator: b.name, title: title || undefined, description: description || undefined, keywords, website: b.website || undefined, ...place };
}

/** Lo que necesita la IA de fotos: el lugar (para que se vea local), el color de la marca y los datos del archivo. */
export function photoContextFor(b: BizForMeta & { color: string }, post: { title?: string; text?: string; keywords?: string[] } = {}) {
  const meta = photoMetaFor(b, post);
  const place = [meta.city, meta.state ?? (meta.city ? undefined : meta.country)].filter(Boolean).join(", ");
  return { place: place || undefined, color: b.color, meta };
}

// ---------- Guardar fotos y diseños ----------

/** Nombre del archivo con palabras clave para Google: "portones-enrollables-managua-a1b2c3d4e5f6.jpg". */
export function seoNameFor(meta: Pick<PhotoMeta, "keywords" | "city"> | undefined, ext: "jpg" | "png" | "webp", hex?: string): string | undefined {
  if (!meta) return hex ? seoMediaName("", ext, hex) : undefined;
  const slug = seoSlug(meta.keywords?.[0], meta.city);
  return slug ? seoMediaName(slug, ext, hex) : hex ? seoMediaName("", ext, hex) : undefined;
}
const EXT: Record<string, "jpg" | "png" | "webp"> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Guarda una foto hecha por la IA con los datos del negocio (sin tocar las marcas de IA) y su nota. */
export async function storeAiPhoto(data: Buffer, contentType: string, folder: string, meta?: PhotoMeta): Promise<string> {
  const prov = readProvenance(data);
  const file = meta ? writePhotoMeta(data, meta) : data;
  const ext = EXT[contentType];
  const { url } = await storeBuffer(file, contentType, folder, ext ? seoNameFor(meta, ext) : undefined);
  const { c2pa: _c2pa, ...provenance } = prov;
  void _c2pa;
  await writeSidecar(url, { v: 1, kind: "photo", ai: true, provenance } satisfies Sidecar).catch(() => {});
  return url;
}

/** Dibuja un diseño con la marca, le pone los datos del negocio, lo guarda y anota cómo se hizo. */
export async function storeDesign(input: DesignInput, folder: string, meta?: PhotoMeta): Promise<string> {
  // El eslogan de la marca (sección Marca) va en el pie si quien llama no lo pasó.
  if (input.slogan === undefined && input.brand.slogan === undefined) input = { ...input, slogan: await businessSlogan(folder, input.headline) };
  const jpg = await renderDesign(input);
  // Si la foto de fondo era de IA, el diseño lo sigue diciendo (se copia la marca de origen).
  let provenance: Omit<Provenance, "c2pa"> | undefined;
  if (input.photoUrl && !input.template.custom) {
    const note = readNote(await readSidecar(input.photoUrl));
    provenance = note?.provenance;
  }
  const keep = provenance?.digitalSourceType ? { digitalSourceType: compositeOf(provenance.digitalSourceType) } : {};
  const file = meta ? writePhotoMeta(jpg, meta, keep) : jpg;
  const { url } = await storeBuffer(file, "image/jpeg", folder, seoNameFor(meta, "jpg"));
  const note: Sidecar = { v: 1, kind: "design", brand: input.brand, headline: input.headline, steps: input.steps, template: input.template, photoUrl: input.photoUrl, sub: input.sub, cta: input.cta, slogan: input.slogan, focus: input.focus, provenance: keep.digitalSourceType ? keep : undefined };
  await writeSidecar(url, note).catch(() => {});
  return url;
}

/** El eslogan del negocio (Business.brandIdentity.slogan, texto o { es, en }) en el idioma del titular, o "". */
export async function businessSlogan(businessId: string, headline: string): Promise<string> {
  try {
    const row = await db.business.findUnique({ where: { id: businessId }, select: { brandIdentity: true } });
    return sloganFrom(row?.brandIdentity, guessLang(headline));
  } catch {
    return "";
  }
}

/** Un diseño hecho sobre una imagen de IA es una "composición con IA" (vocabulario IPTC). */
function compositeOf(type: string): string {
  return /trainedAlgorithmicMedia$/.test(type) && !/composite/i.test(type) ? "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia" : type;
}

// ---------- La foto de cada canal ----------

export type PostForMedia = {
  id?: string;
  businessId: string;
  mediaUrl: string;
  mediaType: string;
  text?: string;
  subject?: string;
  seoTitle?: string;
  business: BizForMeta;
};

/**
 * La foto de `mediaUrl` en el tamaño de `channel`, exactamente como se publica (sin guardarla): los diseños
 * se vuelven a dibujar en la forma de la red; las fotos sin letras se recortan con recorte inteligente; las
 * demás se mandan tal cual si la red las acepta, o centradas sobre un fondo desenfocado.
 * Devuelve null si la red no tiene formato propio o si la original ya sirve tal cual (con credenciales C2PA).
 * La usa la vista previa de cada red (/api/plantilla/canal) para mostrar el recorte real.
 */
export async function imageForChannel(
  mediaUrl: string,
  channel: string,
  note?: Sidecar | null,
  opts: { focus?: Focus | null; exact?: boolean } = {},
): Promise<{ out: Buffer; keep: Omit<Provenance, "c2pa"> } | null> {
  const f = formatFor(channel);
  if (!f) return null;
  const { w, h } = DESIGN_SHAPES[f.shape];
  if (note === undefined) note = readNote(await readSidecar(mediaUrl));
  let keep: Omit<Provenance, "c2pa"> = note?.provenance ?? {};
  if (note?.kind === "design") {
    // Diseño con la marca: se vuelve a dibujar en el tamaño de la red.
    const out = await renderDesign({ brand: note.brand, headline: note.headline, steps: note.steps, template: note.template, photoUrl: note.photoUrl, shape: f.shape, sub: note.sub, cta: note.cta, slogan: note.slogan, focus: note.focus ?? (note.photoUrl ? await focusForUrl(note.photoUrl) : undefined) });
    return { out, keep };
  }
  // El punto importante: el que vino con la publicación o, si la foto es de «Tus fotos», el que se guardó al
  // mejorarla. Una foto revisada de la biblioteca es una foto real (no un diseño con letras): se puede recortar.
  const focus = opts.focus === undefined ? await focusForUrl(mediaUrl) : (opts.focus ?? undefined);
  const src = await readMedia(mediaUrl);
  const info = await sharp(src).metadata();
  const prov = readProvenance(src);
  keep = { digitalSourceType: keep.digitalSourceType ?? prov.digitalSourceType, creatorTool: keep.creatorTool ?? prov.creatorTool, credit: keep.credit ?? prov.credit };
  const rw = (info.orientation ?? 1) >= 5 ? info.height ?? w : info.width ?? w;
  const rh = (info.orientation ?? 1) >= 5 ? info.width ?? h : info.height ?? h;
  const plan = adaptPlan(rw / rh, f, { hasText: note?.kind !== "photo" && !focus, exact: opts.exact, focus: !!focus });
  if (plan === "keep") {
    // Ya sirve: si trae credenciales C2PA se manda la original sin tocar. Las redes piden JPEG.
    if (prov.c2pa) return null;
    return { out: info.format === "jpeg" ? src : await sharp(src).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 92, mozjpeg: true }).toBuffer(), keep };
  }
  if (plan === "crop") return { out: await smartCrop(src, w, h, focus), keep };
  return { out: await fitToShape(await sharp(src).rotate().toBuffer(), w, h), keep };
}

/**
 * La dirección de la foto que se manda a `channel`, ya en su tamaño y con los datos del negocio.
 * Videos, canales sin formato propio y cualquier error: devuelve la foto original (nunca bloquea la publicación).
 */
export async function mediaForChannel(post: PostForMedia, channel: string, opts: { kind?: PostKind | string; focus?: Focus | null } = {}): Promise<string> {
  const original = publicMediaUrl(post.mediaUrl);
  // Historias de Instagram y Facebook: 9:16. Carruseles: todas las fotos con la forma exacta (Instagram recorta
  // todas a la forma de la primera).
  const key = formatKey(channel, opts.kind);
  const f = formatFor(key);
  if (post.mediaType !== "photo" || !post.mediaUrl || !f) return original;
  const exact = opts.kind === "carousel" || key.endsWith(":story");
  try {
    const note = readNote(await readSidecar(post.mediaUrl));
    const meta = photoMetaFor(post.business, { title: post.seoTitle || post.subject || (note?.kind === "design" ? note.headline : ""), text: post.text });
    // Nombre fijo por publicación, foto y forma (con palabras clave para Google): si ya se hizo (por ejemplo al
    // reintentar), se reutiliza.
    const focus = opts.focus === undefined ? await focusForUrl(post.mediaUrl, post.businessId) : opts.focus;
    const hex = createHash("sha1").update(`${post.id ?? ""}|${post.mediaUrl}|${f.shape}|${exact ? "x" : ""}|${focus ? `${focus.x},${focus.y}` : ""}|v3`).digest("hex");
    const name = seoNameFor(meta, "jpg", hex)!;
    if (await mediaExists(post.businessId, name)) return publicMediaUrl(mediaUrlFor(post.businessId, name));

    const made = await imageForChannel(post.mediaUrl, key, note, { focus: focus ?? null, exact });
    if (!made) return original;
    const { out, keep } = made;
    const stored = await storeBuffer(writePhotoMeta(out, meta, keep), "image/jpeg", post.businessId, name);
    return publicMediaUrl(stored.url);
  } catch {
    return original;
  }
}
