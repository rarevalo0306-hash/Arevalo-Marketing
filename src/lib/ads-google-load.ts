// Datos para el plan de Google Ads: palabras que sigue el negocio + último reporte de palabras (DataForSEO) + zonas.
import { getAdsSettings, saveAdsSettings } from "@/lib/ads";
import { buildGooglePlan, googleTextsPrompt, GoogleTextsSchema, mergeGoogleTexts, readGooglePlan, type GooglePlan } from "@/lib/ads-google";
import { askGemini } from "@/lib/ai";
import { identityPrompt } from "@/lib/brand-identity";
import { db } from "@/lib/db";
import { readTrackedKeywords, readZones } from "@/lib/seo/dataforseo";
import { readKeywordsReport } from "@/lib/seo/keywords";
import { latestReports } from "@/lib/seo/reports";

export async function googlePlanFor(businessId: string): Promise<{ plan: GooglePlan; saved: GooglePlan | null; keywordsAt: string | null }> {
  const [b, kw, rank, settings] = await Promise.all([
    db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { name: true, website: true, phone: true, seoKeywords: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true },
    }),
    latestReports(businessId, "keywords"),
    latestReports(businessId, "rank"),
    getAdsSettings(businessId),
  ]);
  const report = kw[0] ? readKeywordsReport(kw[0].data) : null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const plan = buildGooglePlan({
    business: { name: b.name, website: b.website, phone: b.phone },
    tracked: readTrackedKeywords(b.seoKeywords),
    rows: report?.keywords ?? [],
    ideas: report?.ideas ?? [],
    related: relatedFrom(rank[0]?.data),
    places: zones.map((z) => z.name),
    language: b.seoLanguage === "en" ? "en" : "es",
  });
  const saved = readGooglePlan(settings.googlePlan);
  return { plan, saved, keywordsAt: kw[0]?.createdAt.toISOString() ?? null };
}

/** «Mejorar textos con IA»: la IA escribe títulos y descripciones; se cortan a los límites y se guardan. */
export async function improveGooglePlan(businessId: string): Promise<GooglePlan> {
  const { plan } = await googlePlanFor(businessId);
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { aiProfile: true, brandIdentity: true } });
  const { system, user } = googleTextsPrompt(plan, b.aiProfile, identityPrompt(b));
  const ai = await askGemini(GoogleTextsSchema, system, user, 8000);
  const next = mergeGoogleTexts(plan, ai);
  await saveAdsSettings(businessId, { googlePlan: next });
  return next;
}

/** Las «búsquedas relacionadas» guardadas en el último reporte de posiciones (sin repetir, máx. 30). */
function relatedFrom(data: unknown): string[] {
  const rows = (data as { rows?: { related?: unknown }[] } | null)?.rows;
  if (!Array.isArray(rows)) return [];
  const all = rows.flatMap((r) => (Array.isArray(r?.related) ? r.related.filter((x): x is string => typeof x === "string") : []));
  return [...new Set(all.map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 30);
}
