// El núcleo de «Escribir un artículo» (servidor): mira los 10 primeros de Google, la IA escribe, se revisa con un puntaje y se
// guarda como reporte «article». Lo usan la acción del escritor (actions-seo-writer.ts, con su formulario y sus permisos) y la
// herramienta `writeArticle` del equipo de agentes (que cuida el dinero y los permisos por su cuenta). Aquí no hay formularios,
// permisos de la persona ni idioma de la app: lo que falta se avisa con un BiError (español e inglés) antes de gastar nada.
import type { Prisma } from "@prisma/client";
import { pickText, writeSeoArticle, aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db";
import { bi } from "@/lib/i18n";
import { dataForSeoEnabled, readZones, type Zone } from "@/lib/seo/dataforseo";
import { cleanKeyword } from "@/lib/seo/keywords";
import {
  type ArticleReport,
  briefFor,
  cleanDraft,
  contentTargets,
  MAX_ARTICLES,
  researchKeyword,
  scoreDraft,
  type WriterLang,
} from "@/lib/seo/writer";

/** Tipo de reporte en la tabla SeoReport para los artículos. */
export const ARTICLE_KIND = "article";

/** Los datos del negocio que usan el escritor y «Mejorar con IA». */
export const BUSINESS_FIELDS = {
  name: true,
  website: true,
  phone: true,
  aiProfile: true,
  aiText: true,
  brandVoice: true,
  study: true,
  seoLocations: true,
  seoLocationCode: true,
  seoLocationName: true,
} as const;

/** Deja solo los últimos MAX_ARTICLES artículos del negocio. */
export async function pruneArticles(businessId: string) {
  const old = await db.seoReport.findMany({
    where: { businessId, kind: ARTICLE_KIND },
    orderBy: { createdAt: "desc" },
    skip: MAX_ARTICLES,
    select: { id: true },
  });
  if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

export type WriterSetup = {
  /** La búsqueda ya limpia. */
  keyword: string;
  business: NonNullable<Awaited<ReturnType<typeof readBusiness>>>;
  /** La zona principal de Google del negocio. */
  zone: Zone;
};

const readBusiness = (businessId: string) =>
  db.business.findUnique({ where: { id: businessId }, select: BUSINESS_FIELDS });

/**
 * Todo lo que hace falta antes de gastar: la búsqueda, DataForSEO, la clave de la IA, el negocio y su zona de Google.
 * Lanza un BiError que dice qué falta. No llama a Google ni a la IA: es gratis.
 */
export async function articleSetup(businessId: string, rawKeyword: string): Promise<WriterSetup> {
  const keyword = cleanKeyword(rawKeyword);
  if (keyword.length < 2) throw bi("Escribe la búsqueda para la que quieres salir en Google.", "Enter the search you want to show up for on Google.");
  if (!dataForSeoEnabled())
    throw bi("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).");
  if (!aiEnabled())
    throw bi("Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en Vercel.", "The AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is missing in Vercel.");
  const business = await readBusiness(businessId);
  if (!business) throw bi("Negocio no encontrado.", "Business not found.");
  const zone = readZones(business.seoLocations, business.seoLocationCode, business.seoLocationName)[0];
  if (!zone)
    throw bi("Primero elige tu zona de Google en SEO y visibilidad, pestaña «⚙ Ajustes», y guarda.", "First pick your Google area in SEO and visibility, “⚙ Settings” tab, and save.");
  return { keyword, business, zone };
}

/**
 * Escribe un artículo para Google: mira los 10 primeros (DataForSEO), lee las páginas que ganan, arma las metas, la IA escribe
 * y se revisa con un puntaje. Se guarda como reporte «article» del negocio. Devuelve su id, el puntaje, lo que costó Google (USD),
 * cuántas páginas se leyeron y la IA que lo escribió. Es de pago: una consulta de Google y una llamada a la IA, sin reintentos.
 */
export async function createArticleReport(
  businessId: string,
  rawKeyword: string,
  language: WriterLang,
): Promise<{ id: string; score: number; cost: number; pagesRead: number; provider: string }> {
  const { keyword, business: b, zone } = await articleSetup(businessId, rawKeyword);
  const research = await researchKeyword(keyword, zone, language);
  if (!research.organic.length)
    throw bi("Google no devolvió resultados para esa búsqueda en tu zona. Prueba con otras palabras.", "Google returned no results for that search in your area. Try other words.");
  const targets = contentTargets(research);
  const brief = briefFor(research, targets, zone.name);
  const draft = cleanDraft(await writeSeoArticle({ business: b, keyword, language, brief }));
  const { score, checklist } = scoreDraft(draft, keyword, targets, { phone: b.phone, website: b.website });
  const provider = pickText(b.aiText) ?? "";
  const report: ArticleReport = {
    version: 1,
    keyword,
    language,
    zone: { code: zone.code, name: zone.name },
    research,
    targets,
    draft,
    score,
    checklist,
    cost: research.cost,
    provider,
    createdAt: new Date().toISOString(),
  };
  const saved = await db.seoReport.create({ data: { businessId, kind: ARTICLE_KIND, data: report as unknown as Prisma.InputJsonValue } });
  await pruneArticles(businessId);
  return { id: saved.id, score, cost: research.cost, pagesRead: research.pages.filter((p) => !p.error).length, provider };
}
