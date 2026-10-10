// «Publicar en mi web» del escritor de artículos (servidor): preparar la versión bilingüe con la IA, elegir la foto,
// y publicar con un clic del dueño. Lo puro está en site-article.ts; GitHub en publishers/website.ts.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { aiEnabled, ask, askGemini } from "@/lib/ai";
import { logAiAction } from "@/lib/ai-actions";
import { aiImageCents } from "@/lib/campaign-shape";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { bi, BiError } from "@/lib/i18n";
import { createImage, imagesEnabled, pickImage } from "@/lib/imagegen";
import { markUsed } from "@/lib/library";
import { publicMediaUrl } from "@/lib/media";
import { photoContextFor } from "@/lib/media-formats";
import type { Creds } from "@/lib/publishers/types";
import { freeSiteSlug, publishSiteArticle, readSiteArticles, siteArticleUrl, slugify, translateForSite, type SiteCopy } from "@/lib/publishers/website";
import {
  approveCostCents,
  draftVersion,
  needsAiPick,
  photoOption,
  photoOptions,
  rankArticlePhotos,
  readArticleSite,
  sameShape,
  SITE_TEXT_CENTS,
  siteArticleId,
  siteErrorText,
  sourceCopy,
  usd,
  type ArticleSite,
  type PhotoItem,
  type SitePhoto,
  type SitePrepared,
  type SitePublished,
} from "@/lib/seo/site-article";
import { readArticleReport, type ArticleReport } from "@/lib/seo/writer";
import { readStudy } from "@/lib/study-shape";

const BIZ = {
  name: true,
  website: true,
  aiText: true,
  aiImage: true,
  aiProfile: true,
  color: true,
  hashtags: true,
  study: true,
  studyInput: true,
  seoMapPlace: true,
  seoLocations: true,
  seoLocationName: true,
  seoKeywords: true,
} as const;

/** La conexión «Sitio web» del negocio (canal seo), o null. Nunca sale del servidor con el token. */
export async function siteConnection(businessId: string): Promise<{ creds: Creds; siteUrl: string } | null> {
  const conn = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel: "seo" } } });
  if (!conn) return null;
  try {
    const creds = decryptJson<Creds>(conn.secret);
    return { creds, siteUrl: (creds.siteUrl ?? "").trim() };
  } catch {
    return null;
  }
}

/** Los errores de GitHub y de la conexión en palabras simples (los BiError ya vienen bien). */
function friendly(e: unknown): BiError {
  if (e instanceof BiError) return e;
  const t = siteErrorText(e instanceof Error ? e.message : String(e));
  return bi(t.es, t.en);
}

async function load(businessId: string, reportId: string) {
  const [b, row] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: BIZ }),
    db.seoReport.findFirst({ where: { id: reportId, businessId, kind: "article" } }),
  ]);
  if (!b) throw bi("Negocio no encontrado.", "Business not found.");
  const report = row ? readArticleReport(row.data) : null;
  if (!row || !report) throw bi("No encontramos ese artículo.", "We couldn't find that article.");
  const raw = (row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : {}) as Record<string, unknown>;
  return { b, row, raw, report, site: readArticleSite(raw.site) };
}

async function saveSite(rowId: string, raw: Record<string, unknown>, site: ArticleSite) {
  await db.seoReport.update({ where: { id: rowId }, data: { data: { ...raw, site } as unknown as Prisma.InputJsonValue } });
}

const imageCents = (pref: string) => (imagesEnabled() ? aiImageCents(pickImage(pref)) : 0);

/** El lugar del negocio en palabras («Miami, Florida»), para la foto y la traducción. */
const placeOf = (b: Parameters<typeof photoContextFor>[0]) => photoContextFor(b).place ?? "";

export const LIB_SELECT = {
  id: true,
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
  usedCount: true,
  lastUsedAt: true,
  enhancedUrl: true,
  useEnhanced: true,
} as const;

const AiPhotoPick = z.object({
  best: z.number().int().describe("Number of the photo that truly fits the article, or 0 if none of them fits"),
  why_es: z.string().describe("One short sentence in Spanish (correct accents) explaining the choice"),
  why_en: z.string().describe("The same sentence in English"),
});

/** La IA (Gemini si está, que es lo más barato) mira las descripciones y elige; solo cuando la mejor no es clara. */
async function aiPickPhoto(pref: string, topic: string, ranked: { item: PhotoItem }[]): Promise<{ index: number; why: { es: string; en: string } }> {
  const list = ranked
    .map((r, i) => {
      const d = (r.item.description ?? {}) as { en?: string; es?: string; scene?: string; topics?: string[] };
      return `${i + 1}. ${d.en || d.es || ""} | scene: ${d.scene ?? "?"} | topics: ${(d.topics ?? []).join(", ")} | tags: ${r.item.tags.join(", ")} | folder: ${r.item.folderPath}`;
    })
    .join("\n");
  const system =
    "You choose the hero photo for a business's website article from its own photo library. Only choose a photo that truly shows the article's topic; if none does, answer 0. Never choose a photo that would mislead (for example a different service).";
  const user = `Article topic:\n${topic.slice(0, 1500)}\n\nPhotos:\n${list}`;
  const out = process.env.GEMINI_API_KEY ? await askGemini(AiPhotoPick, system, user, 800) : await ask(pref, AiPhotoPick, system, user, 800);
  return { index: Math.max(0, Math.min(ranked.length, Math.round(out.best))), why: { es: out.why_es.slice(0, 200), en: out.why_en.slice(0, 200) } };
}

/** Elige la foto: primero la biblioteca (ordenada por parecido; la IA solo desempata), si no, una creada por la IA. */
async function choosePhoto(businessId: string, pref: string, report: ArticleReport, copy: Omit<SiteCopy, "category">, idea: string) {
  const items = (await db.libraryItem.findMany({
    where: { businessId, kind: "photo", status: "ready", NOT: { choice: "skip" }, url: { not: "" } },
    select: LIB_SELECT,
  })) as PhotoItem[];
  const topic = [report.keyword, copy.title, copy.description, ...copy.sections.map((s) => s.title)].join("\n");
  const ranked = rankArticlePhotos(items, { text: topic, keywords: [report.keyword] });
  const options = photoOptions(items, ranked).map((i) => photoOption(i));
  let chosen: PhotoItem | null = ranked[0]?.item ?? null;
  let why = chosen
    ? { es: "Es de tu biblioteca y es la que más se parece al tema del artículo.", en: "It's from your library and it's the closest match to the article's topic." }
    : { es: "Ninguna foto de tu biblioteca va con este tema.", en: "No photo in your library fits this topic." };
  if (chosen && needsAiPick(ranked) && aiEnabled()) {
    try {
      const pick = await aiPickPhoto(pref, topic, ranked);
      chosen = pick.index > 0 ? ranked[pick.index - 1].item : null;
      why = pick.why.es ? pick.why : why;
    } catch {
      // Si la IA falla, se queda la que ganó por parecido.
    }
  }
  let photo: SitePhoto;
  if (chosen) {
    const o = photoOption(chosen);
    photo = { kind: "library", itemId: o.id, url: o.url, thumb: o.thumb, label: o.label };
  } else if (imagesEnabled()) {
    // El precio ya sale en el título de la foto y en el botón de autorizar.
    photo = { kind: "generate", idea };
  } else {
    photo = { kind: "stock" };
    why = { es: `${why.es} No hay una IA de imágenes conectada: tu web usa su foto del tema.`, en: `${why.en} No image AI is connected: your website uses its topic photo.` };
  }
  return { photo, options, why };
}

/** ¿El sitio ya muestra algo en esa dirección? (por ejemplo un artículo escrito a mano). Si no se puede saber: no. */
async function liveTaken(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000), cache: "no-store" });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * «Publicar en mi web»: lee el sitio (gratis), la IA traduce el artículo al otro idioma (unos centavos), arma las
 * secciones y elige la foto. Nada se publica ni se gasta en fotos: queda la vista previa para que el dueño autorice.
 */
export async function prepareForSite(businessId: string, reportId: string): Promise<SitePrepared> {
  const { b, row, raw, report, site } = await load(businessId, reportId);
  const conn = await siteConnection(businessId);
  if (!conn) throw bi("Tu web no está conectada. Conéctala en Conexiones → Sitio web.", "Your website isn't connected. Connect it in Connections → Website.");
  if (!aiEnabled()) throw bi("Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en Vercel.", "The AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is missing in Vercel.");
  const version = draftVersion(report);
  if (site.published && site.published.draftAt === version)
    throw bi("Este artículo ya está publicado en tu web.", "This article is already published on your website.");
  const mode = site.published ? "update" : "new";

  // 1. Leer el sitio primero (gratis): si la conexión falla, no se gasta nada en la IA.
  let list: Awaited<ReturnType<typeof readSiteArticles>>["list"];
  try {
    list = (await readSiteArticles(conn.creds)).list;
  } catch (e) {
    throw friendly(e);
  }
  const id = siteArticleId(row.id);
  const onSite = list.find((a) => a.id === id);
  if (mode === "update" && !onSite) throw friendly(new Error("Ese artículo ya no está en tu sitio."));

  // 2. La versión del sitio en el idioma del artículo (sin la IA) y la traducción (con la IA).
  const source = sourceCopy(report);
  if (!source.sections.length) throw bi("El artículo no tiene texto para publicar.", "The article has no text to publish.");
  const study = readStudy(b.study);
  const place = placeOf(b);
  const tr = await translateForSite({ pref: b.aiText, businessName: b.name, about: (study?.summary || b.aiProfile).slice(0, 500), place, from: report.language, copy: source });
  const t = tr.translated;
  const other: SiteCopy = {
    slug: slugify(t.slug || t.title),
    seoTitle: t.seoTitle.trim(),
    title: t.title.trim(),
    description: t.description.trim(),
    category: (report.language === "es" ? tr.category.en : tr.category.es).trim(),
    sections: t.sections.map((s) => ({
      title: s.title.trim(),
      text: s.text.trim(),
      ...(s.items.filter((i) => i.trim()).length ? { items: s.items.map((i) => i.trim()).filter(Boolean) } : {}),
      ...(s.after.trim() ? { after: s.after.trim() } : {}),
    })),
    ...(t.faq.length ? { faq: t.faq.map((f) => [f.question.trim(), f.answer.trim()] as [string, string]) } : {}),
  };
  const own: SiteCopy = { ...source, category: (report.language === "es" ? tr.category.es : tr.category.en).trim() };
  if (!sameShape(own, other) || !other.title || !other.seoTitle)
    throw bi("La traducción salió incompleta (le faltaron partes). Toca «Publicar en mi web» otra vez.", "The translation came out incomplete (parts were missing). Tap “Publish on my website” again.");
  const es = report.language === "es" ? own : other;
  const en = report.language === "es" ? other : own;

  // 3. Las direcciones finales: al actualizar no cambian; si es nuevo, se evitan las que ya existen.
  if (mode === "update" && onSite) {
    es.slug = onSite.es.slug;
    en.slug = onSite.en.slug;
  } else {
    const takenEs = new Set(list.map((a) => a.es.slug));
    const takenEn = new Set(list.map((a) => a.en.slug));
    es.slug = freeSiteSlug(es.slug, takenEs);
    en.slug = freeSiteSlug(en.slug, takenEn);
    // Una página escrita a mano en el sitio con la misma dirección escondería el artículo: se busca otra.
    if (await liveTaken(siteArticleUrl(conn.siteUrl, "es", es.slug))) es.slug = freeSiteSlug(es.slug, new Set([...takenEs, es.slug]));
    if (await liveTaken(siteArticleUrl(conn.siteUrl, "en", en.slug))) en.slug = freeSiteSlug(en.slug, new Set([...takenEn, en.slug]));
  }

  // 4. La foto.
  const current = mode === "update" && onSite?.image ? `${conn.siteUrl.replace(/\/+$/, "")}${onSite.image}` : "";
  const chosen = await choosePhoto(businessId, b.aiText, report, own, tr.imageIdea);
  const prepared: SitePrepared = {
    at: new Date().toISOString(),
    draftAt: version,
    mode,
    photoKey: tr.photo,
    es,
    en,
    urlEs: siteArticleUrl(conn.siteUrl, "es", es.slug),
    urlEn: siteArticleUrl(conn.siteUrl, "en", en.slug),
    photo: current ? { kind: "current", url: current } : chosen.photo,
    imageIdea: tr.imageIdea.slice(0, 1000),
    options: chosen.options,
    photoWhy: current ? { es: "Se queda la foto que ya está en tu web.", en: "The photo already on your website stays." } : chosen.why,
    spentCents: site.prepared?.spentCents ?? 0,
  };
  await saveSite(row.id, raw, { ...site, prepared });
  return prepared;
}

async function loadPrepared(businessId: string, reportId: string) {
  const ctx = await load(businessId, reportId);
  const prepared = ctx.site.prepared;
  if (!prepared) throw bi("Primero toca «Publicar en mi web» para preparar la vista previa.", "First tap “Publish on my website” to prepare the preview.");
  if (prepared.draftAt !== draftVersion(ctx.report))
    throw bi("El artículo cambió después de preparar la vista previa. Prepárala otra vez.", "The article changed after the preview was prepared. Prepare it again.");
  return { ...ctx, prepared };
}

/** Cambiar la foto en la vista previa (gratis): otra de la biblioteca, que la IA cree una al autorizar, o la del tema. */
export async function chooseSitePhoto(businessId: string, reportId: string, choice: string): Promise<SitePrepared> {
  const { row, raw, site, prepared, b } = await loadPrepared(businessId, reportId);
  let photo: SitePhoto;
  if (choice === "generate") {
    if (!imagesEnabled()) throw bi("No hay una IA de imágenes conectada.", "No image AI is connected.");
    photo = { kind: "generate", idea: prepared.imageIdea };
  } else if (choice === "stock") photo = { kind: "stock" };
  else {
    const item = (await db.libraryItem.findFirst({ where: { id: choice, businessId, kind: "photo", status: "ready" }, select: LIB_SELECT })) as PhotoItem | null;
    if (!item) throw bi("Esa foto ya no está en tu biblioteca.", "That photo is no longer in your library.");
    const o = photoOption(item);
    photo = { kind: "library", itemId: o.id, url: o.url, thumb: o.thumb, label: o.label };
  }
  const why =
    photo.kind === "generate"
      ? { es: "Elegiste que la IA cree una cuando autorices.", en: "You chose to have the AI create one when you approve." }
      : photo.kind === "stock"
        ? { es: "Tu web usa su foto del tema.", en: "Your website uses its topic photo." }
        : { es: "La elegiste tú de tu biblioteca.", en: "You picked it from your library." };
  const next = { ...prepared, photo, photoWhy: why };
  await saveSite(row.id, raw, { ...site, prepared: next });
  return next;
}

/** Crea la foto ahora (el dueño tocó «Crear otra con IA», con el precio a la vista). Queda en la vista previa. */
export async function generateSitePhoto(businessId: string, reportId: string, expectedCents: number): Promise<SitePrepared> {
  const { b, row, raw, site, prepared, report } = await loadPrepared(businessId, reportId);
  if (!imagesEnabled()) throw bi("No hay una IA de imágenes conectada.", "No image AI is connected.");
  const cents = imageCents(b.aiImage);
  if (cents !== expectedCents) throw bi("El precio de la foto cambió. Revisa la vista previa otra vez.", "The photo price changed. Check the preview again.");
  const url = await createImage(b.aiImage, prepared.imageIdea, "horizontal", businessId, photoContextFor(b, { title: prepared.es.title, keywords: [report.keyword] }));
  await logAiAction({
    businessId,
    kind: "photo.generated",
    actor: "owner",
    costCents: cents,
    summary: { es: `Foto con IA para el artículo «${prepared.es.title}» (${usd(cents)}).`, en: `AI photo for the article “${prepared.en.title}” (${usd(cents)}).` },
    detail: { reportId: row.id, url },
  });
  const next: SitePrepared = {
    ...prepared,
    photo: { kind: "generated", url, idea: prepared.imageIdea, costCents: cents },
    photoWhy: { es: "La creó la IA para este artículo.", en: "The AI created it for this article." },
    spentCents: prepared.spentCents + cents,
  };
  await saveSite(row.id, raw, { ...site, prepared: next });
  return next;
}

/**
 * «Autorizar y publicar»: si toca, crea la foto (el precio estaba en el botón), la sube y agrega el artículo al
 * sitio. Guarda en el reporte que quedó publicado (dirección, fecha y slugs) para no publicarlo dos veces.
 */
export async function approveForSite(businessId: string, reportId: string, expectedCents: number): Promise<SitePublished & { photoFailed: boolean; already: boolean }> {
  const ctx = await loadPrepared(businessId, reportId);
  const { b, row, raw, report } = ctx;
  let { prepared } = ctx;
  const site = ctx.site;
  if (site.published && prepared.mode === "new") throw bi("Este artículo ya está publicado en tu web.", "This article is already published on your website.");
  const conn = await siteConnection(businessId);
  if (!conn) throw bi("Tu web no está conectada. Conéctala en Conexiones → Sitio web.", "Your website isn't connected. Connect it in Connections → Website.");
  const cents = approveCostCents(prepared.photo, imageCents(b.aiImage));
  if (cents !== expectedCents) throw bi("El costo cambió desde que lo viste. Revisa la vista previa otra vez.", "The cost changed since you saw it. Check the preview again.");

  // La foto con IA se crea solo ahora, con el clic del dueño. Se guarda enseguida: si publicar falla, no se paga dos veces.
  if (prepared.photo.kind === "generate") {
    prepared = await generateSitePhoto(businessId, reportId, cents);
  }
  const photo = prepared.photo;
  const photoUrl = photo.kind === "library" || photo.kind === "generated" ? publicMediaUrl(photo.url) : undefined;

  let out: Awaited<ReturnType<typeof publishSiteArticle>>;
  try {
    out = await publishSiteArticle({ id: siteArticleId(row.id), photo: prepared.photoKey, es: prepared.es, en: prepared.en }, conn.creds, { mode: prepared.mode, photoUrl });
  } catch (e) {
    throw friendly(e);
  }
  if (photo.kind === "library") await markUsed(businessId, [photo.itemId]).catch(() => {});
  const published: SitePublished = {
    at: new Date().toISOString(),
    date: out.article.published,
    ...(out.article.updated ? { updatedDate: out.article.updated } : {}),
    id: out.article.id,
    url: out.url,
    urlEn: out.urlEn,
    slugEs: out.article.es.slug,
    slugEn: out.article.en.slug,
    draftAt: prepared.draftAt,
    ...(out.article.image ? { image: out.article.image } : {}),
    costCents: (site.published?.costCents ?? 0) + prepared.spentCents + SITE_TEXT_CENTS,
  };
  await saveSite(row.id, raw, { published });
  if (!out.already)
    await logAiAction({
      businessId,
      kind: "article.published",
      actor: "approved",
      costCents: SITE_TEXT_CENTS,
      summary:
        prepared.mode === "update"
          ? { es: `Artículo actualizado en tu web: «${out.article.es.title}».`, en: `Article updated on your website: “${out.article.en.title}”.` }
          : { es: `Artículo publicado en tu web: «${out.article.es.title}».`, en: `Article published on your website: “${out.article.en.title}”.` },
      detail: { reportId: row.id, keyword: report.keyword, url: out.url, urlEn: out.urlEn, photo: photo.kind },
    });
  return { ...published, photoFailed: out.photoFailed, already: out.already };
}

/** Lo que cuesta crear una foto con la IA de imágenes del negocio (centavos), o 0 si no hay. */
export async function sitePhotoCents(businessId: string): Promise<number> {
  const b = await db.business.findUnique({ where: { id: businessId }, select: { aiImage: true } });
  return b ? imageCents(b.aiImage) : 0;
}
