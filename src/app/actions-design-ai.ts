"use server";

// Diseños maestros con IA (sección Marca → Plantillas): comparar modelos, revisar, ajustar y guardar como plantilla.
// Cada diseño cuesta (se anota en el registro de la IA con su precio); nunca se gasta más que DESIGN_AI_MAX_USD por vez.
// TODO (opcional, más adelante): diseño premium por post (pedir a la IA de diseño un diseño único para un post
// especial). No se hace ahora: cada post usa el diseño maestro como plantilla, casi gratis.
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { designModels, estimateUsd, MASTER_SHAPES, maxUsd, type MasterShape, usdText } from "@/lib/design-ai";
import {
  bookName,
  cleanAdjust,
  editModels,
  ensureFrame,
  finishMaster,
  startBookConvert as startBookConvert_,
  MASTER_KIND,
  masterCustom,
  type MasterAdjust,
  type MasterCandidate,
  masterName,
  masterVariant,
  previewMaster,
  readDetail,
  shapeOfSize,
  startMasters,
  toCandidate,
} from "@/lib/design-ai-run";
import { customBase, isMaster, StoredTemplate } from "@/lib/design-shapes";
import { loadBrandAssets, updateBrandAssets } from "@/lib/brand-assets-db";
import { setBrandAssetStatus } from "@/lib/brand-assets";
import { isSocialAsset } from "@/lib/design-ai-pieces";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";

export type StartResult = { ok: boolean; message: string; ids?: string[] };
export type CheckResult = { ok: boolean; candidate?: MasterCandidate; message?: string };
export type PreviewResult = { ok: boolean; url?: string; message?: string };
export type SaveResult = { ok: boolean; message: string };

const BIZ = { id: true, name: true, aiProfile: true, color: true, color2: true, color3: true, fontHeading: true, fontBody: true, brandIdentity: true, logoUrl: true, logoLightUrl: true, phone: true, website: true, brandAssets: true } as const;

const asShapes = (v: unknown): MasterShape[] => [...new Set((Array.isArray(v) ? v : []).filter((s): s is MasterShape => MASTER_SHAPES.includes(s as MasterShape)))];

/** Empieza a crear diseños con los modelos y formas elegidos (o, con `parentId`, las otras formas de un maestro guardado). */
export async function startDesignMasters(businessId: string, input: { models: string[]; shapes: string[]; parentId?: string; bookStyle?: boolean }): Promise<StartResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: BIZ });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const available = designModels();
  if (!available.length)
    return {
      ok: false,
      message: t(
        "Todavía no hay una IA de diseño conectada. Agrega FAL_KEY (fal.ai) o IDEOGRAM_API_KEY (ideogram.ai) en Vercel.",
        "No design AI is connected yet. Add FAL_KEY (fal.ai) or IDEOGRAM_API_KEY (ideogram.ai) in Vercel.",
      ),
    };
  const models = [...new Set(input.models)].map((id) => available.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => Boolean(m)).slice(0, 4);
  const shapes = asShapes(input.shapes);
  if (!models.length) return { ok: false, message: t("Elige al menos un modelo.", "Choose at least one model.") };
  if (!shapes.length) return { ok: false, message: t("Elige al menos una forma.", "Choose at least one shape.") };
  let parent: { id: string; imageUrl: string } | undefined;
  if (input.parentId) {
    const row = await db.template.findFirst({ where: { id: input.parentId, businessId } });
    const p = row ? StoredTemplate.safeParse(row.spec) : null;
    const c = p?.success ? p.data.custom : undefined;
    if (!row || !c || !isMaster(p!.data!)) return { ok: false, message: t("No encontramos ese diseño maestro.", "We couldn't find that master design.") };
    parent = { id: row.id, imageUrl: c.imageUrl };
  }
  const usd = estimateUsd(models, shapes);
  const cap = maxUsd();
  if (usd > cap + 1e-9)
    return {
      ok: false,
      message: t(
        `Eso costaría ~${usdText(usd)} y el tope por vez es ${usdText(cap)}. Elige menos modelos o formas.`,
        `That would cost ~${usdText(usd)} and the limit per run is ${usdText(cap)}. Choose fewer models or shapes.`,
      ),
    };
  try {
    const started = await startMasters(b, { models: models.map((m) => m.id), shapes, parent, bookStyle: input.bookStyle !== false });
    const ids = started.filter((s) => s.id).map((s) => s.id);
    const errors = [...new Set(started.filter((s) => s.error).map((s) => s.error![lang]))];
    revalidatePath(`/b/${businessId}/marca`);
    if (!ids.length) return { ok: false, message: errors.join(" ") || t("No se pudo empezar.", "Couldn't start.") };
    const n = ids.length;
    return {
      ok: true,
      ids,
      message:
        t(`Creando ${n} ${n === 1 ? "diseño" : "diseños"}… tarda entre 20 segundos y 2 minutos.`, `Creating ${n} ${n === 1 ? "design" : "designs"}… it takes 20 seconds to 2 minutes.`) +
        (errors.length ? ` ${t("Algunos no se pudieron empezar:", "Some couldn't start:")} ${errors.join(" ")}` : ""),
    };
  } catch (e) {
    return { ok: false, message: t(`No se pudo empezar: ${errorText(e, lang)}`, `Couldn't start: ${errorText(e, lang)}`) };
  }
}

/** ¿Ya está el diseño? Si sí, lo guarda y busca dónde van la foto, el titular y el logo. */
export async function checkDesignMaster(businessId: string, id: string): Promise<CheckResult> {
  const { lang, t } = await getT();
  try {
    const d = await finishMaster(businessId, id);
    if (!d) return { ok: false, message: t("Ese diseño ya no existe.", "That design no longer exists.") };
    return { ok: true, candidate: toCandidate(id, d, lang) };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

async function readyDetail(businessId: string, id: string) {
  const row = await db.aiAction.findFirst({ where: { id, businessId, kind: MASTER_KIND } });
  const d = readDetail(row?.detail);
  return d && d.status === "ready" && d.url && d.w && d.h && d.areas ? d : null;
}

/** El post de ejemplo armado con el diseño (y los ajustes del dueño, si los hay). */
export async function previewDesignMaster(businessId: string, id: string, adjust?: Partial<MasterAdjust>): Promise<PreviewResult> {
  const { lang, t } = await getT();
  const [b, d] = await Promise.all([db.business.findUnique({ where: { id: businessId }, select: BIZ }), readyDetail(businessId, id)]);
  if (!b || !d) return { ok: false, message: t("Ese diseño todavía no está listo.", "That design isn't ready yet.") };
  try {
    const df = await ensureFrame(businessId, id, d);
    return { ok: true, url: await previewMaster(b, df, cleanAdjust(adjust, df), lang) };
  } catch (e) {
    return { ok: false, message: t(`No se pudo armar la vista previa: ${errorText(e, lang)}`, `Couldn't build the preview: ${errorText(e, lang)}`) };
  }
}

/**
 * «Usar como plantilla»: se guarda como una plantilla más del negocio (la usan los posts, las campañas y cada red).
 * Si es otra forma de un maestro guardado, se agrega a ese maestro.
 */
export async function saveDesignMaster(businessId: string, id: string, adjust?: Partial<MasterAdjust>): Promise<SaveResult> {
  const { lang, t } = await getT();
  const row = await db.aiAction.findFirst({ where: { id, businessId, kind: MASTER_KIND } });
  const d0 = await readyDetail(businessId, id);
  if (!row || !d0) return { ok: false, message: t("Ese diseño todavía no está listo.", "That design isn't ready yet.") };
  try {
    const d = await ensureFrame(businessId, id, d0);
    const a = cleanAdjust(adjust, d);
    let templateId = "";
    let name = "";
    const parent = d.parentId ? await db.template.findFirst({ where: { id: d.parentId, businessId } }) : null;
    const parsed = parent ? StoredTemplate.safeParse(parent.spec) : null;
    if (parent && parsed?.success && parsed.data.custom && isMaster(parsed.data)) {
      const c = parsed.data.custom;
      const variants = { ...(c.variants ?? {}), [d.shape]: masterVariant(d, a) };
      const shapes = [shapeOfSize(c.w, c.h), ...(Object.keys(variants) as MasterShape[])];
      name = masterName(d.modelName, shapes, lang);
      await db.template.update({ where: { id: parent.id }, data: { name, spec: { ...parsed.data, name, custom: { ...c, variants } } as unknown as Prisma.InputJsonValue } });
      templateId = parent.id;
    } else {
      name = d.source === "book" && d.book ? bookName(d.book.label, lang) : masterName(d.modelName, [d.shape], lang);
      const created = await db.template.create({ data: { businessId, name, spec: customBase(name, masterCustom(d, a)) as unknown as Prisma.InputJsonValue } });
      templateId = created.id;
    }
    await db.aiAction.update({ where: { id }, data: { detail: { ...d, status: "saved", templateId } as unknown as Prisma.InputJsonValue } });
    if (d.source === "book" && d.book) await updateBrandAssets(businessId, (c) => setBrandAssetStatus(c, d.book!.assetId, "accepted"));
    revalidatePath(`/b/${businessId}`, "layout");
    return {
      ok: true,
      message: t(`Listo: «${name}» quedó guardada. Tus posts la usarán primero.`, `Done: “${name}” is saved. Your posts will use it first.`),
    };
  } catch (e) {
    return { ok: false, message: t(`No se pudo guardar: ${errorText(e, lang)}`, `Couldn't save: ${errorText(e, lang)}`) };
  }
}

/** «Descartar»: deja de mostrarse (ya se pagó; no se borra del registro). */
export async function discardDesignMaster(businessId: string, id: string): Promise<SaveResult> {
  const { t } = await getT();
  const row = await db.aiAction.findFirst({ where: { id, businessId, kind: MASTER_KIND } });
  const d = readDetail(row?.detail);
  if (!row || !d) return { ok: false, message: t("Ese diseño ya no existe.", "That design no longer exists.") };
  await db.aiAction.update({ where: { id }, data: { detail: { ...d, status: "discarded" } as unknown as Prisma.InputJsonValue } });
  return { ok: true, message: t("Descartado.", "Discarded.") };
}

export type ConvertResult = { ok: boolean; message: string; id?: string };

/**
 * «Convertir en plantilla» una pieza de redes sociales del manual: con un modelo de edición (`model`, se cobra) quita el
 * texto de ejemplo y pone la caja gris de la foto; con "none" se hace gratis tapando el texto (puede notarse).
 * Solo piezas de redes sociales (regla del dueño: las plantillas son solo para redes).
 */
export async function startBookConvert(businessId: string, assetId: string, model: string): Promise<ConvertResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true, color: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const asset = (await loadBrandAssets(businessId)).items.find((a) => a.id === assetId && a.source === "book");
  if (!asset) return { ok: false, message: t("Esa imagen ya no está. Recarga la página.", "That image is gone. Reload the page.") };
  if (!isSocialAsset(asset)) return { ok: false, message: t("Solo las piezas para redes sociales se convierten en plantillas.", "Only social media pieces can become templates.") };
  const m = model === "none" ? null : (editModels().find((x) => x.id === model) ?? null);
  if (model !== "none" && !m) return { ok: false, message: t("Ese modelo no está disponible. Elige otro.", "That model isn't available. Choose another one.") };
  if (m && m.edit && m.edit.usd > maxUsd() + 1e-9) return { ok: false, message: t(`Eso pasa el tope por vez (${usdText(maxUsd())}).`, `That's over the limit per run (${usdText(maxUsd())}).`) };
  try {
    const id = await startBookConvert_(b, asset, m);
    if (asset.status !== "accepted") await updateBrandAssets(businessId, (c) => setBrandAssetStatus(c, assetId, "accepted"));
    revalidatePath(`/b/${businessId}/marca`);
    return {
      ok: true,
      id,
      message: m
        ? t(`Limpiando la pieza con ${m.name}… tarda entre 20 segundos y 2 minutos.`, `Cleaning the piece with ${m.name}… it takes 20 seconds to 2 minutes.`)
        : t("Listo. Revisa dónde van la foto y el titular.", "Done. Check where the photo and headline go."),
    };
  } catch (e) {
    return { ok: false, message: t(`No se pudo convertir: ${errorText(e, lang)}`, `Couldn't convert it: ${errorText(e, lang)}`) };
  }
}
