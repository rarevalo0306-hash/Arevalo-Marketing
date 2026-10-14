"use server";

import type { Prisma } from "@prisma/client";
import { deniedText, hasBusiness } from "@/lib/auth";
import { db } from "@/lib/db";
import { looksLikeDomain } from "@/lib/dashboard";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import { findLookup, type Lookup, LOOKUP_KIND, lookupFresh, runDomainLookup, runKeywordLookup } from "@/lib/seo/lookup";
import { latestReports, saveReport } from "@/lib/seo/reports";

export type LookupResult = { ok: true; lookup: Lookup; reused: boolean } | { ok: false; message: string } | null;

/** Cuántas búsquedas guardadas se revisan para no pagar dos veces lo mismo. */
const RECENT = 60;

/**
 * «Ver quién sale ahora»: busca en vivo la palabra o la página que escribió en el buscador del Tablero. Si ya se buscó
 * en los últimos días, devuelve la guardada sin gastar (salvo que pida revisarla otra vez).
 */
export async function lookupNow(businessId: string, q: string, again: boolean): Promise<LookupResult> {
  ensure.text(businessId, q);
  ensure.flag(again);
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const query = q.trim().slice(0, 120);
  if (!query) return { ok: false, message: t("Escribe una búsqueda o una página web.", "Type a search or a website.") };
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true },
  });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  if (!zones.length) return { ok: false, message: t("Primero elige la zona donde buscan tus clientes en SEO → «⚙ Ajustes».", "First pick the area where your customers search in SEO → “⚙ Settings”.") };
  const type = looksLikeDomain(query) ? "domain" : "keyword";
  if (!again) {
    const saved = await latestReports(businessId, LOOKUP_KIND, RECENT);
    const found = findLookup(saved.map((r) => r.data), type, query);
    if (found && lookupFresh(found)) return { ok: true, lookup: found, reused: true };
  }
  const language = b.seoLanguage === "en" ? "en" : "es";
  try {
    const lookup =
      type === "domain"
        ? await runDomainLookup({ q: query, zone: zones[0], language })
        : await runKeywordLookup({ q: query, zone: zones[0], language, website: b.website, businessName: b.name });
    await saveReport(businessId, LOOKUP_KIND, lookup as unknown as Prisma.InputJsonValue);
    return { ok: true, lookup, reused: false };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
