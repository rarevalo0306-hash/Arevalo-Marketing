import sharp from "sharp";
import { z } from "zod";
import type { LibraryItem } from "@prisma/client";
import { askGemini, type GeminiPart } from "@/lib/ai";
import { db } from "@/lib/db";
import { downloadFile, getThumbnail, listMedia, type DriveFile } from "@/lib/drive";
import { serviceAccountEnabled } from "@/lib/google-sa";
import { bi, BiError, errorText, translator, type T, type UiLang } from "@/lib/i18n";
import { PRIVACY_FLAGS, type LibraryDescription, type PrivacyFlag } from "@/lib/library-shape";
import { storeBuffer } from "@/lib/media";
import { readInput, readStudy } from "@/lib/study-shape";

// Revisar la carpeta de Google Drive de un negocio: traer lo nuevo, marcar lo que ya no está y que la IA (Gemini) mire
// cada foto o video. Las carpetas grandes se llenan en varias vueltas (unas 25 fotos por vuelta, las más viejas primero).

/** Fotos más pesadas no se copian (la IA las mira por la miniatura de Drive). */
export const PHOTO_MAX_BYTES = 40 * 1024 * 1024;
/** Cuántos archivos se revisan por vuelta. */
export const BATCH_LIMIT = 25;
/** Cuántas imágenes van en cada pregunta a Gemini. */
const PER_CALL = 6;
const DAY = 86_400_000;

// ---------- Planear (sin base de datos, para las pruebas) ----------

/** Lo que ya está guardado de cada archivo. */
export type KnownItem = {
  id: string;
  externalId: string;
  status: string;
  name: string;
  folderPath: string;
  modifiedAt: Date | null;
  analyzed: boolean;
};

export type SyncPlan = {
  /** Archivos nuevos en la carpeta. */
  create: DriveFile[];
  /** Ya guardados: cambiaron de nombre o carpeta, volvieron a la carpeta o cambiaron en Drive (se vuelven a revisar). */
  update: {
    id: string;
    file: DriveFile;
    reanalyze: boolean;
    revive: boolean;
  }[];
  /** Ya no están en la carpeta (se marcan, no se borran). */
  gone: string[];
};

const time = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() || 0 : 0);

export function planSync(known: KnownItem[], listed: DriveFile[]): SyncPlan {
  const byExternal = new Map(known.map((k) => [k.externalId, k]));
  const listedIds = new Set(listed.map((f) => f.id));
  const plan: SyncPlan = { create: [], update: [], gone: [] };
  for (const f of listed) {
    const k = byExternal.get(f.id);
    if (!k) {
      plan.create.push(f);
      continue;
    }
    const reanalyze = Boolean(k.modifiedAt && f.modifiedTime && time(k.modifiedAt) !== time(f.modifiedTime));
    const revive = k.status === "gone";
    if (reanalyze || revive || k.name !== f.name || k.folderPath !== f.folderPath) plan.update.push({ id: k.id, file: f, reanalyze, revive });
  }
  for (const k of known) if (k.status !== "gone" && !listedIds.has(k.externalId)) plan.gone.push(k.id);
  return plan;
}

/** Los que toca revisar en esta vuelta: los nuevos, los más viejos primero (por fecha en Drive), hasta `limit`. */
export function pickBatch<
  I extends {
    id: string;
    status: string;
    modifiedAt: Date | null;
    createdAt: Date;
  },
>(items: I[], limit = BATCH_LIMIT): I[] {
  return items
    .filter((i) => i.status === "new")
    .sort((a, b) => (time(a.modifiedAt) || time(a.createdAt)) - (time(b.modifiedAt) || time(b.createdAt)) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

// ---------- Lo que contesta la IA ----------

const SCENES = ["done", "before", "after", "progress", "team", "place", "product", "damage", "other"] as const;

export const AnalysisSchema = z.object({
  items: z.array(
    z.object({
      n: z.number().describe("The item number given before its image"),
      es: z.string().describe("What it shows, 1-2 plain sentences in Spanish"),
      en: z.string().describe("The same in English"),
      scene: z.enum(SCENES),
      topics: z.array(z.string()).describe("1-4 services or topics of this business it fits, in the business language, lowercase"),
      tags: z.array(z.string()).describe("3-10 short lowercase words (objects, materials, colors, place), in the business language"),
      quality: z.number().describe("1 to 5"),
      usable: z.boolean(),
      reasonEs: z.string().describe("If not usable or quality <= 2: why, short, in Spanish. Otherwise empty"),
      reasonEn: z.string().describe("The same in English, or empty"),
      privacy: z.array(z.enum(PRIVACY_FLAGS)),
    }),
  ),
});

export type ItemAnalysis = {
  description: LibraryDescription;
  tags: string[];
  quality: number;
  usable: boolean;
  privacy: PrivacyFlag[];
};

const words = (list: unknown, max: number) =>
  [
    ...new Set(
      (Array.isArray(list) ? list : [])
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, " "))
        .filter((x) => x && x.length <= 40),
    ),
  ].slice(0, max);

/** Ordena la respuesta de la IA por número de archivo (1…count), limpia etiquetas y deja la calidad entre 1 y 5. */
export function parseAnalysis(raw: unknown, count: number): Map<number, ItemAnalysis> {
  const out = new Map<number, ItemAnalysis>();
  const items = raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: Record<string, unknown>[] }).items : [];
  for (const it of items) {
    const n = Math.round(Number(it?.n));
    if (!Number.isFinite(n) || n < 1 || n > count || out.has(n)) continue;
    const es = typeof it.es === "string" ? it.es.trim() : "";
    const en = typeof it.en === "string" ? it.en.trim() : "";
    if (!es && !en) continue;
    const q = Math.round(Number(it.quality));
    const quality = Number.isFinite(q) ? Math.min(5, Math.max(1, q)) : 3;
    const usable = it.usable !== false;
    const rEs = typeof it.reasonEs === "string" ? it.reasonEs.trim() : "";
    const rEn = typeof it.reasonEn === "string" ? it.reasonEn.trim() : "";
    const scene = (SCENES as readonly string[]).includes(String(it.scene)) ? (it.scene as LibraryDescription["scene"]) : "other";
    const description: LibraryDescription = {
      es: es || en,
      en: en || es,
      scene,
      topics: words(it.topics, 6),
    };
    if ((rEs || rEn) && (!usable || quality <= 2)) description.reason = { es: rEs || rEn, en: rEn || rEs };
    const privacy = [
      ...new Set((Array.isArray(it.privacy) ? it.privacy : []).filter((p): p is PrivacyFlag => (PRIVACY_FLAGS as readonly string[]).includes(String(p)))),
    ];
    out.set(n, {
      description,
      tags: words(it.tags, 12),
      quality,
      usable,
      privacy,
    });
  }
  return out;
}

type BizContext = {
  name: string;
  aiProfile: string;
  services: string[];
  lang: "es" | "en";
};

function analysisSystem(b: BizContext): string {
  const language = b.lang === "en" ? "English" : "Spanish";
  return `You catalog the real photos and videos that a small business keeps in its own Google Drive folder, so its marketing assistant can pick real photos for social media posts and ads.

The business: "${b.name}".
<business_profile>
${b.aiProfile.trim().slice(0, 1500) || "(no profile yet)"}
</business_profile>
${b.services.length ? `Its services: ${b.services.join("; ")}.\n` : ""}
You get several numbered items. Each one has a label (number, photo or video, file name, subfolder) followed by its image. For a video you only see one frame (its preview). Return one entry per item, using the same number in "n".

For each item:
- es / en: what it shows in 1-2 plain, concrete sentences (no marketing language, no guesses about who the people are).
- scene: done = finished job; before / after = state before or after the work; progress = work in progress; team = staff working or posing; place = the shop, office or work vehicle; product = a product shown by itself; damage = damage to a property or object; other.
- topics: 1-4 services or topics of THIS business that the item fits (prefer the service names above), in ${language}, lowercase.
- tags: 3-10 short lowercase words in ${language}: objects, materials, colors, kind of place.
- quality 1-5: 5 = sharp, well lit, well framed, ready to post; 4 = good; 3 = acceptable; 2 = blurry, dark, tilted or badly cut; 1 = unusable. Small previews are low resolution on purpose: do not lower the quality for resolution alone.
- usable: false for screenshots, memes, documents, receipts or invoices, images that are mostly text, and anything unrelated to the business (personal photos, random objects). Otherwise true.
- reasonEs / reasonEn: when usable is false or quality is 2 or less, say why in a few plain words; otherwise empty strings.
- privacy: list every flag that applies: "faces" = the face of an identifiable person (not tiny, blurred or from behind); "address" = a readable address, house number or street sign; "plate" = a readable vehicle license plate; "document" = a readable document, ID, invoice or screen with personal data; "child" = a child appears. Empty list if none.`;
}

// ---------- Copias de las fotos ----------

/** Copia una foto: girada según la cámara, máx. 2048 px en JPG, miniatura de 512 px y una vista chica para la IA. */
export async function copyPhoto(
  data: Buffer,
  folder: string,
): Promise<{
  url: string;
  thumbUrl: string;
  preview: Buffer;
  width: number;
  height: number;
}> {
  const meta = await sharp(data, { failOn: "none" }).metadata();
  const big = await sharp(data, { failOn: "none" })
    .rotate()
    .resize({
      width: 2048,
      height: 2048,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  const thumb = await sharp(big)
    .resize({
      width: 512,
      height: 512,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  const preview = await sharp(big)
    .resize({
      width: 768,
      height: 768,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 72 })
    .toBuffer();
  const swap = (meta.orientation ?? 1) >= 5;
  const [url, thumbUrl] = await Promise.all([storeBuffer(big, "image/jpeg", folder), storeBuffer(thumb, "image/jpeg", folder)]);
  return {
    url: url.url,
    thumbUrl: thumbUrl.url,
    preview,
    width: (swap ? meta.height : meta.width) ?? 0,
    height: (swap ? meta.width : meta.height) ?? 0,
  };
}

/** La miniatura de Drive como JPG: una de 512 px para guardar y otra de 768 px para la IA. */
async function driveThumb(link: string, folder: string): Promise<{ thumbUrl: string; preview: Buffer } | null> {
  const raw = await getThumbnail(link, 800);
  if (!raw) return null;
  try {
    const preview = await sharp(raw)
      .rotate()
      .resize({
        width: 768,
        height: 768,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 72 })
      .toBuffer();
    const thumb = await sharp(preview)
      .resize({
        width: 512,
        height: 512,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
    return {
      thumbUrl: (await storeBuffer(thumb, "image/jpeg", folder)).url,
      preview,
    };
  } catch {
    return null;
  }
}

const isHeic = (item: Pick<LibraryItem, "mimeType" | "name">) => /hei[cf]/i.test(item.mimeType) || /\.(heic|heif)$/i.test(item.name);

type Prepared = {
  item: LibraryItem;
  preview: Buffer | null;
  data: { url?: string; thumbUrl?: string; width?: number; height?: number };
  error: string;
  wait?: boolean;
};

/** Deja lista la vista para la IA: copia la foto, o usa la miniatura de Drive (videos, HEIC, fotos muy pesadas). */
async function prepare(item: LibraryItem, file: DriveFile | undefined, lang: UiLang): Promise<Prepared> {
  const t = translator(lang);
  const folder = item.businessId;
  const link = file?.thumbnailLink ?? "";
  if (item.kind === "video") {
    const th = await driveThumb(link, folder);
    if (th)
      return {
        item,
        preview: th.preview,
        data: { thumbUrl: th.thumbUrl },
        error: "",
      };
    // Drive tarda un rato en hacer la vista previa de un video recién subido: se espera hasta un día.
    if (Date.now() - time(item.modifiedAt ?? item.createdAt) < DAY) return { item, preview: null, data: {}, error: "", wait: true };
    return {
      item,
      preview: null,
      data: {},
      error: t(
        "Google Drive no tiene una vista previa de este video, así que la IA no lo pudo mirar.",
        "Google Drive has no preview for this video, so the AI couldn't look at it.",
      ),
    };
  }
  const fallback = async (error: string): Promise<Prepared> => {
    const th = await driveThumb(link, folder);
    return {
      item,
      preview: th?.preview ?? null,
      data: th ? { thumbUrl: th.thumbUrl } : {},
      error,
    };
  };
  if (item.sizeBytes > PHOTO_MAX_BYTES) {
    return fallback(
      t(
        "La foto pesa más de 40 MB y no se copió. Súbela en un tamaño más liviano.",
        "The photo is larger than 40 MB and wasn't copied. Upload a lighter version.",
      ),
    );
  }
  let data: Buffer;
  try {
    data = await downloadFile(item.externalId, PHOTO_MAX_BYTES);
  } catch (e) {
    return fallback(t("No se pudo descargar la foto de Drive: ", "Couldn't download the photo from Drive: ") + errorText(e, lang));
  }
  try {
    const c = await copyPhoto(data, folder);
    return {
      item,
      preview: c.preview,
      data: {
        url: c.url,
        thumbUrl: c.thumbUrl,
        width: c.width || item.width,
        height: c.height || item.height,
      },
      error: "",
    };
  } catch {
    if (isHeic(item)) {
      return fallback(
        t(
          "Foto HEIC sin convertir: es el formato de fotos del iPhone y la app no lo pudo abrir. La IA la miró por la vista previa, pero no se puede publicar. En el iPhone: Ajustes → Cámara → Formatos → «Más compatible», y vuelve a subirla.",
          "HEIC photo not converted: it's the iPhone photo format and the app couldn't open it. The AI looked at the preview, but it can't be posted. On the iPhone: Settings → Camera → Formats → \"Most Compatible\", then upload it again.",
        ),
      );
    }
    return fallback(
      t(
        "La app no pudo abrir esta foto (el archivo puede estar dañado o en un formato raro).",
        "The app couldn't open this photo (the file may be damaged or in an unusual format).",
      ),
    );
  }
}

const isRateLimit = (e: unknown) => e instanceof BiError && /límite|limit/i.test(`${e.message} ${e.en}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mapLimit<A, B>(list: A[], n: number, fn: (a: A) => Promise<B>): Promise<B[]> {
  const out: B[] = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        out[i] = await fn(list[i]);
      }
    }),
  );
  return out;
}

async function businessContext(businessId: string) {
  const b = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      aiProfile: true,
      study: true,
      studyInput: true,
      seoLanguage: true,
      driveFolderId: true,
    },
  });
  const study = readStudy(b.study);
  const input = readInput(b.studyInput);
  const lang: "es" | "en" = input?.lang === "en" || (!input && b.seoLanguage === "en") ? "en" : "es";
  const ctx: BizContext = {
    name: b.name,
    aiProfile: b.aiProfile,
    services: (study?.services ?? []).map((s) => s.name).slice(0, 10),
    lang,
  };
  return { b, ctx };
}

// ---------- Revisar la carpeta ----------

export type SyncResult = {
  ok: boolean;
  added: number;
  analyzed: number;
  pending: number;
  gone: number;
  errors: number;
  /** Se paró antes por el límite de Gemini o por tiempo (lo que falta sigue en la próxima vuelta). */
  stopped: "" | "rate" | "time" | "noai";
  /** Error de Drive en palabras simples ("" si salió bien). */
  error: string;
};

/**
 * Revisa la carpeta del negocio: lista Drive, guarda lo nuevo, marca lo que ya no está y la IA mira hasta `limit`
 * archivos (los más viejos primero) mientras quede tiempo. Guarda driveSyncedAt y driveError.
 */
export async function syncLibrary(businessId: string, opts: { lang?: UiLang; limit?: number; budgetMs?: number } = {}): Promise<SyncResult> {
  const start = Date.now();
  const lang = opts.lang ?? "es";
  const t = translator(lang);
  const budget = opts.budgetMs ?? 55_000;
  const result: SyncResult = {
    ok: false,
    added: 0,
    analyzed: 0,
    pending: 0,
    gone: 0,
    errors: 0,
    stopped: "",
    error: "",
  };
  const { b, ctx } = await businessContext(businessId);
  if (!b.driveFolderId)
    return {
      ...result,
      error: t("Este negocio no tiene una carpeta de Drive conectada.", "This business has no Drive folder connected."),
    };

  let listed: DriveFile[];
  try {
    if (!serviceAccountEnabled())
      throw bi(
        "Falta configurar la cuenta de servicio de Google en el servidor (GOOGLE_SERVICE_ACCOUNT_JSON).",
        "The Google service account isn't set up on the server yet (GOOGLE_SERVICE_ACCOUNT_JSON).",
      );
    listed = await listMedia(b.driveFolderId);
  } catch (e) {
    const error = errorText(e, lang);
    await db.business.update({
      where: { id: businessId },
      data: { driveSyncedAt: new Date(), driveError: error },
    });
    return { ...result, error };
  }

  // 1) Guardar lo nuevo, marcar lo que ya no está y lo que cambió.
  const known = await db.libraryItem.findMany({
    where: { businessId },
    select: {
      id: true,
      externalId: true,
      status: true,
      name: true,
      folderPath: true,
      modifiedAt: true,
      description: true,
    },
  });
  const plan = planSync(
    known.map((k) => ({ ...k, analyzed: k.description !== null })),
    listed,
  );
  const fields = (f: DriveFile) => ({
    name: f.name.slice(0, 300),
    folderPath: f.folderPath.slice(0, 500),
    mimeType: f.mimeType,
    kind: f.kind,
    width: f.width,
    height: f.height,
    durationSec: f.durationSec,
    sizeBytes: Math.min(f.sizeBytes, 2_147_483_647),
    takenAt: f.takenAt,
    modifiedAt: f.modifiedTime ? new Date(f.modifiedTime) : null,
  });
  if (plan.create.length) {
    const r = await db.libraryItem.createMany({
      data: plan.create.map((f) => ({
        businessId,
        source: "drive",
        externalId: f.id,
        status: "new",
        ...fields(f),
      })),
      skipDuplicates: true,
    });
    result.added = r.count;
  }
  for (const u of plan.update) {
    const k = known.find((x) => x.id === u.id)!;
    const status = u.reanalyze ? "new" : u.revive ? (k.description !== null ? "ready" : "new") : undefined;
    await db.libraryItem.update({
      where: { id: u.id },
      data: {
        ...fields(u.file),
        ...(status ? { status, error: "" } : {}),
        ...(u.reanalyze ? { url: "", thumbUrl: "" } : {}),
      },
    });
  }
  if (plan.gone.length)
    result.gone = (
      await db.libraryItem.updateMany({
        where: { id: { in: plan.gone } },
        data: { status: "gone" },
      })
    ).count;

  // 2) Que la IA mire lo nuevo (por tandas, los más viejos primero).
  const queued = await db.libraryItem.findMany({
    where: { businessId, status: "new" },
  });
  const batch = pickBatch(queued, opts.limit ?? BATCH_LIMIT);
  if (batch.length && !process.env.GEMINI_API_KEY) result.stopped = "noai";
  const byId = new Map(listed.map((f) => [f.id, f]));
  const system = analysisSystem(ctx);

  for (let i = 0; i < batch.length && !result.stopped && process.env.GEMINI_API_KEY; i += PER_CALL) {
    if (Date.now() - start > budget) {
      result.stopped = "time";
      break;
    }
    const prepared = await mapLimit(batch.slice(i, i + PER_CALL), 3, async (item) => {
      try {
        return await prepare(item, byId.get(item.externalId), lang);
      } catch (e) {
        return {
          item,
          preview: null,
          data: {},
          error: errorText(e, lang),
        } as Prepared;
      }
    });
    const seen = prepared.filter((p) => p.preview);
    // Sin vista para la IA: error en palabras simples (o se espera, si Drive aún prepara la vista previa del video).
    for (const p of prepared.filter((x) => !x.preview && !x.wait)) {
      await db.libraryItem.update({
        where: { id: p.item.id },
        data: {
          ...p.data,
          status: "error",
          error: p.error || t("La IA no pudo mirar este archivo.", "The AI couldn't look at this file."),
        },
      });
      result.errors++;
    }
    if (!seen.length) continue;

    const parts: GeminiPart[] = [];
    seen.forEach((p, j) => {
      const it = p.item;
      const label = [
        `Item ${j + 1}: ${it.kind}`,
        `file "${it.name}"`,
        it.folderPath ? `subfolder "${it.folderPath}"` : "",
        it.kind === "video" && it.durationSec ? `${Math.round(it.durationSec)} s long (you see one frame)` : "",
        p.error ? "small preview" : "",
      ]
        .filter(Boolean)
        .join(", ");
      parts.push(
        { text: label },
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: p.preview!.toString("base64"),
          },
        },
      );
    });
    const ask = () =>
      askGemini(AnalysisSchema, system, `Describe these ${seen.length} items. Topics and tags in ${ctx.lang === "en" ? "English" : "Spanish"}.`, 8192, parts);
    let raw: unknown;
    try {
      try {
        raw = await ask();
      } catch (e) {
        if (!isRateLimit(e)) throw e;
        // Gemini llegó a su límite: una pausa y un intento más; si sigue, se para y la próxima vuelta continúa.
        await sleep(Math.min(20_000, Math.max(0, budget - (Date.now() - start))));
        raw = await ask();
      }
    } catch (e) {
      if (isRateLimit(e)) {
        // Se guardan las copias ya hechas y quedan "new" para la próxima vuelta.
        for (const p of seen)
          if (Object.keys(p.data).length)
            await db.libraryItem.update({
              where: { id: p.item.id },
              data: p.data,
            });
        result.stopped = "rate";
        break;
      }
      const msg = errorText(e, lang);
      for (const p of seen)
        await db.libraryItem.update({
          where: { id: p.item.id },
          data: { ...p.data, status: "error", error: msg },
        });
      result.errors += seen.length;
      continue;
    }
    const answers = parseAnalysis(raw, seen.length);
    for (const [j, p] of seen.entries()) {
      const a = answers.get(j + 1);
      if (!a) {
        await db.libraryItem.update({
          where: { id: p.item.id },
          data: {
            ...p.data,
            status: "error",
            error: t("La IA no contestó sobre este archivo. Se puede volver a intentar.", "The AI didn't answer about this file. It can be tried again."),
          },
        });
        result.errors++;
        continue;
      }
      await db.libraryItem.update({
        where: { id: p.item.id },
        data: {
          ...p.data,
          description: a.description,
          tags: a.tags,
          quality: a.quality,
          usable: a.usable,
          privacy: a.privacy,
          status: p.error ? "error" : "ready",
          error: p.error,
        },
      });
      if (p.error) result.errors++;
      else result.analyzed++;
    }
  }

  result.pending = await db.libraryItem.count({
    where: { businessId, status: "new" },
  });
  await db.business.update({
    where: { id: businessId },
    data: { driveSyncedAt: new Date(), driveError: "" },
  });
  return { ...result, ok: true };
}

/** El resultado en una frase simple para el dueño. */
export function syncMessage(r: SyncResult, t: T): string {
  if (!r.ok) return r.error;
  const parts: string[] = [];
  parts.push(
    r.added
      ? t(`${r.added} archivo${r.added === 1 ? "" : "s"} nuevo${r.added === 1 ? "" : "s"}`, `${r.added} new file${r.added === 1 ? "" : "s"}`)
      : t("Nada nuevo en la carpeta", "Nothing new in the folder"),
  );
  if (r.analyzed) parts.push(t(`la IA revisó ${r.analyzed}`, `the AI reviewed ${r.analyzed}`));
  if (r.gone) parts.push(t(`${r.gone} ya no está${r.gone === 1 ? "" : "n"} en la carpeta`, `${r.gone} no longer in the folder`));
  if (r.errors) parts.push(t(`${r.errors} con problema`, `${r.errors} with a problem`));
  let msg = `${parts.join(", ")}.`;
  if (r.stopped === "noai")
    msg += t(
      ` Faltan ${r.pending} por revisar: falta la clave de Gemini (GEMINI_API_KEY) para que la IA las mire. Quedan guardadas para después.`,
      ` ${r.pending} still to review: the Gemini key (GEMINI_API_KEY) is missing, so the AI can't look at them yet. They're saved for later.`,
    );
  else if (r.stopped === "rate")
    msg += t(
      ` Gemini llegó a su límite por ahora; faltan ${r.pending} y se revisan en la próxima vuelta.`,
      ` Gemini hit its limit for now; ${r.pending} left, they'll be reviewed on the next run.`,
    );
  else if (r.pending)
    msg += t(
      ` Faltan ${r.pending} por revisar: se revisan solas cada día, o presiona «Revisar ahora» otra vez.`,
      ` ${r.pending} still to review: they're reviewed on their own every day, or press "Check now" again.`,
    );
  return msg;
}

/**
 * Para el publicador automático: revisa como mucho UN negocio por llamada, el que lleve más tiempo sin revisar
 * (más de 24 horas; o más de 1 hora si en la última vuelta quedaron archivos por revisar).
 */
export async function runDueDriveSync(now = new Date(), budgetMs = 120_000): Promise<{ businessId: string; result: SyncResult } | null> {
  if (!serviceAccountEnabled() || budgetMs < 20_000) return null;
  const list = await db.business.findMany({
    where: { driveFolderId: { not: "" } },
    select: {
      id: true,
      driveSyncedAt: true,
      _count: { select: { library: { where: { status: "new" } } } },
    },
  });
  const due = list
    .filter((b) => {
      const age = now.getTime() - time(b.driveSyncedAt);
      return age > DAY || (b._count.library > 0 && age > DAY / 24);
    })
    .sort((a, b) => time(a.driveSyncedAt) - time(b.driveSyncedAt))[0];
  if (!due) return null;
  // Reservar el turno: si otra llamada lo tomó primero, no hacer nada.
  const claimed = await db.business.updateMany({
    where: { id: due.id, driveSyncedAt: due.driveSyncedAt },
    data: { driveSyncedAt: now },
  });
  if (!claimed.count) return null;
  return {
    businessId: due.id,
    result: await syncLibrary(due.id, {
      lang: "es",
      limit: 60,
      budgetMs: Math.min(budgetMs, 150_000),
    }),
  };
}

/** Cuántos hay de cada cosa, para la tarjeta de Conexiones. */
export async function libraryCounts(businessId: string) {
  const [groups, review] = await Promise.all([
    db.libraryItem.groupBy({
      by: ["kind", "status"],
      where: { businessId, status: { not: "gone" } },
      _count: { _all: true },
    }),
    db.libraryItem.count({
      where: {
        businessId,
        status: "ready",
        choice: "",
        usable: true,
        privacy: { isEmpty: false },
      },
    }),
  ]);
  const sum = (f: (g: (typeof groups)[number]) => boolean) => groups.filter(f).reduce((n, g) => n + g._count._all, 0);
  return {
    photos: sum((g) => g.kind === "photo"),
    videos: sum((g) => g.kind === "video"),
    ready: sum((g) => g.status === "ready"),
    pending: sum((g) => g.status === "new"),
    errors: sum((g) => g.status === "error"),
    review,
  };
}
export type LibraryCounts = Awaited<ReturnType<typeof libraryCounts>>;

/** Para las copias que se piden al usarlas (library-files): la foto desde Drive, con su miniatura si no se puede abrir. */
export async function copyPhotoFromDrive(item: LibraryItem): Promise<{ url: string; thumbUrl: string }> {
  const data = await downloadFile(item.externalId, PHOTO_MAX_BYTES);
  try {
    const c = await copyPhoto(data, item.businessId);
    return { url: c.url, thumbUrl: c.thumbUrl };
  } catch {
    throw isHeic(item)
      ? bi(
          "Esta foto está en formato HEIC (del iPhone) y la app no la pudo convertir. Súbela en JPG.",
          "This photo is in HEIC format (from the iPhone) and the app couldn't convert it. Upload it as JPG.",
        )
      : bi("La app no pudo abrir esta foto.", "The app couldn't open this photo.");
  }
}
