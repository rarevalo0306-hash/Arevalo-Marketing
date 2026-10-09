// Diseños maestros con IA, la parte del servidor: empezar los trabajos (cada uno queda anotado en AiAction con su
// costo), terminarlos (descargar la imagen ya, porque las direcciones de la IA caducan; guardarla; encontrar las cajas
// de la foto, del titular y del logo), mostrarlos con una foto y un titular de ejemplo, y guardarlos como plantillas.
// Lo que no necesita servidor (modelos, pedidos, cajas) está en design-ai.ts.
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import sharp from "sharp";
import { logAiAction } from "@/lib/ai-actions";
import { askGemini } from "@/lib/ai";
import { readBrandIdentity } from "@/lib/brand-identity-shape";
import { db } from "@/lib/db";
import { renderDesign, samplePhoto, type Brand } from "@/lib/design";
import {
  type Areas,
  DETECT_SYSTEM,
  DETECT_USER,
  DetectSchema,
  designModels,
  inkFor,
  type MasterBrief,
  type MasterJob,
  masterPrompt,
  type MasterShape,
  placeholderBox,
  pollMaster,
  resolveAreas,
  submitMaster,
} from "@/lib/design-ai";
import { customBase, CustomSpec, CustomVariant, type Box, StoredTemplate, UnitBox } from "@/lib/design-shapes";
import { sloganFrom } from "@/lib/design-layout";
import { bi, type UiLang } from "@/lib/i18n";
import { libraryPhotoUrl } from "@/lib/photo-enhance-shape";
import { readMedia, readSidecar } from "@/lib/media";
import { storeAiPhoto } from "@/lib/media-formats";

export const MASTER_KIND = "design.master";

export type Ink = CustomSpec["ink"];
export type MasterStatus = "pending" | "storing" | "ready" | "failed" | "discarded" | "saved";

/** Lo que se guarda en AiAction.detail de cada diseño pedido. */
export type MasterDetail = {
  v: 1;
  key: string;
  status: MasterStatus;
  model: string;
  modelName: string;
  shape: MasterShape;
  usd: number;
  job: MasterJob;
  prompt: string;
  startedAt: number;
  etaSec: number;
  /** Plantilla maestra a la que se le agrega esta forma («Hacer más con este estilo»). */
  parentId?: string;
  url?: string;
  w?: number;
  h?: number;
  areas?: Areas;
  ink?: Ink;
  error?: { es: string; en: string };
  templateId?: string;
  /** Cuándo se empezó a guardar (para reintentar si la función se cortó). */
  storingAt?: number;
};

/** Lo que ve la pantalla de cada diseño. */
export type MasterCandidate = {
  id: string;
  status: MasterStatus;
  model: string;
  modelName: string;
  shape: MasterShape;
  usd: number;
  etaSec: number;
  startedAt: number;
  parentId?: string;
  url?: string;
  w?: number;
  h?: number;
  areas?: Areas;
  ink?: Ink;
  error?: string;
};

export function readDetail(raw: unknown): MasterDetail | null {
  const d = raw as MasterDetail | null;
  return d && typeof d === "object" && d.v === 1 && typeof d.key === "string" && d.job ? d : null;
}

export const toCandidate = (id: string, d: MasterDetail, lang: UiLang): MasterCandidate => ({
  id,
  status: d.status,
  model: d.model,
  modelName: d.modelName,
  shape: d.shape,
  usd: d.usd,
  etaSec: d.etaSec,
  startedAt: d.startedAt,
  parentId: d.parentId,
  url: d.url,
  w: d.w,
  h: d.h,
  areas: d.areas,
  ink: d.ink,
  error: d.error ? d.error[lang] : undefined,
});

type BizRow = {
  id: string;
  name: string;
  aiProfile: string;
  color: string;
  color2: string;
  color3: string;
  fontHeading: string;
  fontBody: string;
  brandIdentity: unknown;
};

/** Lo que la IA de diseño necesita saber de la marca. */
export function briefOf(b: BizRow): MasterBrief {
  const id = readBrandIdentity(b.brandIdentity);
  const about = (id.tagline.en || id.tagline.es || b.aiProfile.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ")).trim();
  return {
    name: b.name,
    about,
    color: b.color,
    color2: b.color2,
    color3: b.color3,
    fontHeading: b.fontHeading,
    fontBody: b.fontBody,
    personality: id.voice.personality,
    photoStyle: id.photoStyle,
    audience: id.audience,
  };
}

const SHAPE_NAME: Record<MasterShape, { es: string; en: string }> = {
  square: { es: "Cuadrado", en: "Square" },
  portrait: { es: "Vertical", en: "Portrait" },
  story: { es: "Historia", en: "Story" },
};
export const shapeName = (s: MasterShape, lang: UiLang) => SHAPE_NAME[s][lang];

/** La forma de una imagen por su proporción. */
export function shapeOfSize(w: number, h: number): MasterShape {
  const r = w / h;
  return r > 0.9 ? "square" : r > 0.68 ? "portrait" : "story";
}

async function findByKey(businessId: string, key: string) {
  return db.aiAction.findFirst({ where: { businessId, kind: MASTER_KIND, detail: { path: ["key"], equals: key } }, select: { id: true } });
}

async function writeDetail(id: string, d: MasterDetail) {
  await db.aiAction.update({ where: { id }, data: { detail: d as unknown as Prisma.InputJsonValue } });
}

/** Imagen de referencia de estilo: data: si no es una dirección pública (los modelos de fal la aceptan así). */
async function styleRefOf(url: string): Promise<{ url: string; data: Buffer; type: string }> {
  const data = await readMedia(url);
  const meta = await sharp(data).metadata();
  const type = meta.format === "png" ? "image/png" : meta.format === "webp" ? "image/webp" : "image/jpeg";
  return { url: /^https:\/\//.test(url) ? url : `data:${type};base64,${data.toString("base64")}`, data, type };
}

/**
 * Empieza los diseños (cada modelo en cada forma) a la vez. Cada uno queda anotado en el registro de la IA con su
 * costo. Los que no se pudieron empezar vuelven con su error (no se cobran).
 */
export async function startMasters(b: BizRow, ask: { models: string[]; shapes: MasterShape[]; parent?: { id: string; imageUrl: string } }): Promise<{ id: string; error?: { es: string; en: string } }[]> {
  const all = designModels();
  const models = ask.models.map((id) => all.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const brief = briefOf(b);
  const ref = ask.parent ? await styleRefOf(ask.parent.imageUrl) : null;
  const jobs = models.flatMap((m) => ask.shapes.map((shape) => ({ m, shape })));
  return Promise.all(
    jobs.map(async ({ m, shape }) => {
      const key = randomBytes(9).toString("hex");
      const prompt = masterPrompt(brief, shape, { styleRef: Boolean(ref && m.styleRef), compact: Boolean(m.maxPrompt && m.maxPrompt < 1500) }).prompt;
      let job: MasterJob;
      try {
        job = await submitMaster(m, { brief, shape, styleRefUrl: ref && m.styleRef ? ref.url : undefined }, { ref: ref && m.styleRef && m.provider === "ideogram" ? { data: ref.data, type: ref.type } : undefined });
      } catch (e) {
        const err = e as Error & { en?: string };
        return { id: "", error: { es: err.message, en: err.en ?? err.message } };
      }
      const usd = m.usd[shape];
      const detail: MasterDetail = { v: 1, key, status: "pending", model: m.id, modelName: m.name, shape, usd, job, prompt, startedAt: Date.now(), etaSec: m.etaSec, parentId: ask.parent?.id };
      await logAiAction({
        businessId: b.id,
        kind: MASTER_KIND,
        actor: "owner",
        costCents: Math.ceil(usd * 100),
        summary: {
          es: `Diseño maestro con IA: ${m.name}, ${SHAPE_NAME[shape].es.toLowerCase()} (US$${usd.toFixed(2)})`,
          en: `AI master design: ${m.name}, ${SHAPE_NAME[shape].en.toLowerCase()} (US$${usd.toFixed(2)})`,
        },
        detail: detail as unknown as Prisma.InputJsonValue,
      });
      const row = await findByKey(b.id, key);
      return row ? { id: row.id } : { id: "", error: { es: "No se pudo anotar el diseño.", en: "Couldn't record the design." } };
    }),
  );
}

// ---------- Terminar: guardar la imagen y encontrar las cajas ----------

/** El color medio de una parte de la imagen. */
async function meanColor(buf: Buffer, b: Box): Promise<string> {
  const meta = await sharp(buf).metadata();
  const iw = meta.width ?? 1;
  const ih = meta.height ?? 1;
  const left = Math.min(iw - 1, Math.round(b.x * iw));
  const top = Math.min(ih - 1, Math.round(b.y * ih));
  // stats() mira la imagen entera: primero se recorta de verdad y luego se promedia.
  const { data, info } = await sharp(buf).extract({ left, top, width: Math.max(1, Math.min(iw - left, Math.round(b.w * iw))), height: Math.max(1, Math.min(ih - top, Math.round(b.h * ih))) }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (let i = 0; i < info.width * info.height; i++) for (let k = 0; k < 3; k++) sum[k] += data[i * info.channels + k];
  const n = Math.max(1, info.width * info.height);
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hex(sum[0])}${hex(sum[1])}${hex(sum[2])}`;
}

/**
 * Dónde van la foto, el titular y el logo: una mirada barata de Gemini (si hay clave) + la caja gris buscada en los
 * píxeles. Si nada funciona, cajas de siempre y se le pide al dueño que las ajuste.
 */
export async function detectAreas(buf: Buffer, shape: MasterShape, brandColor: string): Promise<{ areas: Areas; ink: Ink }> {
  const small = await sharp(buf).resize(96, 96, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = placeholderBox(small.data, small.info.width, small.info.height, small.info.channels);
  let ai = null;
  if (process.env.GEMINI_API_KEY) {
    try {
      const jpg = await sharp(buf).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
      ai = await askGemini(DetectSchema, DETECT_SYSTEM, DETECT_USER, 1200, [{ inlineData: { mimeType: "image/jpeg", data: jpg.toString("base64") } }]);
    } catch (e) {
      console.warn("[design-ai] detect", (e as Error).message);
    }
  }
  const areas = resolveAreas({ ai, pixel, shape });
  const ink = inkFor(await meanColor(buf, areas.textBox).catch(() => "#ffffff"), brandColor);
  return { areas, ink };
}

/** ¿Ya está? Si sí: se descarga enseguida (las direcciones de la IA caducan), se guarda y se buscan las cajas. */
export async function finishMaster(businessId: string, id: string): Promise<MasterDetail | null> {
  const row = await db.aiAction.findFirst({ where: { id, businessId, kind: MASTER_KIND } });
  const d = readDetail(row?.detail);
  if (!row || !d) return null;
  // Uno que se quedó guardándose más de 3 minutos (la función se cortó) se vuelve a intentar.
  const stuck = d.status === "storing" && Date.now() - (d.storingAt ?? 0) > 3 * 60_000;
  if (d.status !== "pending" && !stuck) return d;
  let url: string;
  try {
    const r = await pollMaster(d.job);
    if (!r.done) return d;
    url = r.url;
  } catch (e) {
    const err = e as Error & { en?: string };
    const failed: MasterDetail = { ...d, status: "failed", error: { es: err.message, en: err.en ?? err.message } };
    await writeDetail(id, failed);
    return failed;
  }
  // Solo uno lo guarda (si la pantalla pregunta dos veces a la vez).
  const claimed = await db.aiAction.updateMany({
    where: { id, ...(stuck ? {} : { detail: { path: ["status"], equals: "pending" } }) },
    data: { detail: { ...d, status: "storing", storingAt: Date.now() } as unknown as Prisma.InputJsonValue },
  });
  if (!claimed.count) return { ...d, status: "storing" };
  try {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) throw bi(`No se pudo descargar el diseño (${res?.status ?? "sin conexión"}). Intenta crearlo de nuevo.`, `Couldn't download the design (${res?.status ?? "no connection"}). Try creating it again.`);
    const raw = Buffer.from(await res.arrayBuffer());
    // PNG sin transparencia, tal cual (la caja gris tiene que quedar exacta).
    const png = await sharp(raw).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
    const meta = await sharp(png).metadata();
    const stored = await storeAiPhoto(png, "image/png", businessId);
    const biz = await db.business.findUnique({ where: { id: businessId }, select: { color: true } });
    const { areas, ink } = await detectAreas(png, d.shape, biz?.color ?? "#126BBC");
    const ready: MasterDetail = { ...d, status: "ready", url: stored, w: meta.width, h: meta.height, areas, ink, error: undefined };
    await writeDetail(id, ready);
    return ready;
  } catch (e) {
    const err = e as Error & { en?: string };
    const failed: MasterDetail = { ...d, status: "failed", error: { es: err.message, en: err.en ?? err.message } };
    await writeDetail(id, failed);
    return failed;
  }
}

// ---------- Ajustes del dueño y plantilla ----------

export type MasterAdjust = { photoBox: Box; textBox: Box; logoBox?: Box | null; ink: Ink; textAlign: "izquierda" | "centro" };

/** Ajustes válidos (o los detectados si llegan mal). */
export function cleanAdjust(a: Partial<MasterAdjust> | undefined, d: MasterDetail): MasterAdjust {
  const det = d.areas!;
  const box = (v: unknown, fb: Box) => {
    const p = UnitBox.safeParse(v);
    return p.success ? p.data : fb;
  };
  return {
    photoBox: box(a?.photoBox, det.photoBox),
    textBox: box(a?.textBox, det.textBox),
    logoBox: a?.logoBox === null ? null : box(a?.logoBox, det.logoBox),
    ink: a?.ink && ["claro", "oscuro", "marca"].includes(a.ink) ? a.ink : (d.ink ?? "claro"),
    textAlign: a?.textAlign === "centro" ? "centro" : a?.textAlign === "izquierda" ? "izquierda" : det.textAlign,
  };
}

/** La plantilla propia de un diseño maestro (lo que se guarda en Template.spec.custom). */
export function masterCustom(d: MasterDetail, a: MasterAdjust): CustomSpec {
  return CustomSpec.parse({
    imageUrl: d.url,
    w: d.w,
    h: d.h,
    mode: "fondo",
    photo: "arriba",
    text: "abajo",
    ink: a.ink,
    photoBox: a.photoBox,
    textBox: a.textBox,
    ...(a.logoBox ? { logoBox: a.logoBox } : {}),
    photoRadius: d.areas?.photoRadius ?? 0,
    textAlign: a.textAlign,
    source: "ai-master",
    model: d.model,
    prompt: d.prompt.slice(0, 6000),
    preferred: true,
  });
}

export function masterVariant(d: MasterDetail, a: MasterAdjust): CustomVariant {
  return CustomVariant.parse({
    imageUrl: d.url,
    w: d.w,
    h: d.h,
    photoBox: a.photoBox,
    textBox: a.textBox,
    ...(a.logoBox ? { logoBox: a.logoBox } : {}),
    photoRadius: d.areas?.photoRadius ?? 0,
    textAlign: a.textAlign,
    ink: a.ink,
  });
}

/** Nombre de la plantilla: «Maestro IA · Ideogram 3.0 · Cuadrado» (+ las otras formas que tenga). */
export function masterName(modelName: string, shapes: MasterShape[], lang: UiLang): string {
  const list = [...new Set(shapes)].map((s) => SHAPE_NAME[s][lang]).join(" + ");
  return `${lang === "en" ? "AI master" : "Maestro IA"} · ${modelName} · ${list}`.slice(0, 80);
}

// ---------- Vista previa con una foto y un titular de ejemplo ----------

/** Una foto real del negocio para la vista previa (de «Tus fotos», o la de un post), o la de ejemplo. No la marca como usada. */
export async function samplePhotoFor(businessId: string, color: string): Promise<string> {
  try {
    const item = await db.libraryItem.findFirst({
      where: { businessId, kind: "photo", status: "ready", usable: true, privacy: { isEmpty: true }, NOT: [{ choice: "skip" }, { url: "" }] },
      orderBy: [{ quality: "desc" }, { createdAt: "desc" }],
      select: { url: true, enhancedUrl: true, useEnhanced: true },
    });
    if (item) return libraryPhotoUrl(item);
    const posts = await db.post.findMany({ where: { businessId, mediaType: "photo", NOT: { mediaUrl: "" } }, orderBy: { createdAt: "desc" }, take: 5, select: { mediaUrl: true } });
    for (const p of posts) {
      const note = (await readSidecar(p.mediaUrl)) as { kind?: unknown; photoUrl?: unknown } | null;
      if (note?.kind === "design" && typeof note.photoUrl === "string" && note.photoUrl.startsWith("https://")) return note.photoUrl;
      if (note?.kind === "photo" && p.mediaUrl.startsWith("https://")) return p.mediaUrl;
    }
  } catch {
    // Sin biblioteca: la foto de ejemplo.
  }
  return samplePhoto(color);
}

/** Un titular de ejemplo con la voz de la marca (de la identidad), o uno general. */
export function sampleHeadline(brandIdentity: unknown, lang: UiLang): string {
  const id = readBrandIdentity(brandIdentity);
  const chosen = id.proposals.find((p) => p.id === id.chosenProposal) ?? id.proposals[0];
  if (chosen?.headline) return chosen.headline;
  return lang === "en" ? "Quality you can see in every detail" : "Calidad que se nota en cada detalle";
}

type BrandBiz = { name: string; color: string; color2: string; color3: string; logoUrl: string; logoLightUrl: string; phone: string; website: string; fontHeading: string; fontBody: string; brandIdentity: unknown };
export const brandOf = (b: BrandBiz, lang: UiLang): Brand => ({ name: b.name, color: b.color, color2: b.color2, color3: b.color3, logoUrl: b.logoUrl, logoLightUrl: b.logoLightUrl, phone: b.phone, website: b.website, fontHeading: b.fontHeading, fontBody: b.fontBody, slogan: sloganFrom(b.brandIdentity, lang) });

/** El post ya armado (foto + titular + logo) con un diseño y sus cajas, como data: JPEG chico para la pantalla. */
export async function previewMaster(b: BrandBiz & { id: string }, d: MasterDetail, a: MasterAdjust, lang: UiLang): Promise<string> {
  const custom = masterCustom(d, a);
  const template = StoredTemplate.parse(customBase("Maestro", custom));
  const jpg = await renderDesign({ brand: brandOf(b, lang), template, headline: sampleHeadline(b.brandIdentity, lang), photoUrl: await samplePhotoFor(b.id, b.color), shape: d.shape });
  const small = await sharp(jpg).resize(720, 720, { fit: "inside" }).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${small.toString("base64")}`;
}

// ---------- Para la pantalla ----------

export type MasterTemplateInfo = { id: string; name: string; model: string; shapes: MasterShape[]; imageUrl: string; createdAt: string };

/** Las plantillas maestras guardadas del negocio (la más nueva primero) con sus formas. */
export async function masterTemplates(businessId: string): Promise<MasterTemplateInfo[]> {
  const rows = await db.template.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } });
  const out: MasterTemplateInfo[] = [];
  for (const r of rows) {
    const p = StoredTemplate.safeParse(r.spec);
    const c = p.success ? p.data.custom : undefined;
    if (!c || c.source !== "ai-master") continue;
    const shapes = [shapeOfSize(c.w, c.h), ...(Object.keys(c.variants ?? {}) as MasterShape[])];
    out.push({ id: r.id, name: r.name, model: c.model ?? "", shapes: [...new Set(shapes)], imageUrl: c.imageUrl, createdAt: r.createdAt.toISOString() });
  }
  return out;
}

/** Los diseños pedidos en las últimas 2 semanas que todavía no se guardaron ni descartaron. */
export async function openCandidates(businessId: string, lang: UiLang): Promise<MasterCandidate[]> {
  const rows = await db.aiAction.findMany({
    where: { businessId, kind: MASTER_KIND, createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, detail: true },
  });
  return rows
    .map((r) => ({ id: r.id, d: readDetail(r.detail) }))
    .filter((x): x is { id: string; d: MasterDetail } => Boolean(x.d && ["pending", "storing", "ready", "failed"].includes(x.d.status)))
    .slice(0, 16)
    .map((x) => toCandidate(x.id, x.d, lang));
}
