"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { aiEnabled, pickText, suggestOnPageFix } from "@/lib/ai";
import { db } from "@/lib/db";
import { bi, errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { readAuditReport } from "@/lib/seo/audit";
import { dataForSeoEnabled, readTrackedKeywords, readZones, type Zone } from "@/lib/seo/dataforseo";
import { asGscReport } from "@/lib/seo/gsc";
import { cleanKeyword, costText, uniqueKeywords } from "@/lib/seo/keywords";
import {
  applyOverride,
  candidatePages,
  checkPages,
  cleanSuggestion,
  type KeywordSignals,
  MAX_ONPAGE_REPORTS,
  mergePage,
  type OnPagePage,
  type OnPageReport,
  overrideFor,
  pathOf,
  planPages,
  readOnPageReport,
  urlKey,
} from "@/lib/seo/onpage";
import { readRankReport, siteDomain } from "@/lib/seo/rank";
import { latestReports, saveReport } from "@/lib/seo/reports";
import { latestByZone } from "@/lib/seo/zones";
import { readStudy, topKeywords } from "@/lib/study-shape";

export type OnPageResult = { ok: boolean; message: string } | null;

const KIND = "onpage";

const BUSINESS_FIELDS = {
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
  seoLanguage: true,
  seoKeywords: true,
} as const;

const paths = (businessId: string) => revalidatePath(`/b/${businessId}/seo`);

/** El último reporte "onpage" (fila y datos), o null. */
async function latestOnPage(businessId: string): Promise<{ id: string; report: OnPageReport } | null> {
  const row = (await latestReports(businessId, KIND, 1))[0];
  const report = row ? readOnPageReport(row.data) : null;
  return row && report ? { id: row.id, report } : null;
}

/** Deja solo los últimos MAX_ONPAGE_REPORTS reportes del negocio. */
async function prune(businessId: string) {
  const old = await db.seoReport.findMany({ where: { businessId, kind: KIND }, orderBy: { createdAt: "desc" }, skip: MAX_ONPAGE_REPORTS, select: { id: true } });
  if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

const save = async (businessId: string, report: OnPageReport) => {
  await saveReport(businessId, KIND, report as unknown as Prisma.InputJsonValue);
  await prune(businessId);
};

/** Las sugerencias de la IA de antes se conservan si la página sigue con la misma palabra clave. */
function keepSuggestions(pages: OnPagePage[], before: OnPagePage[] | undefined): OnPagePage[] {
  return pages.map((p) => {
    if (p.suggestion || !p.keyword) return p;
    const old = before?.find((o) => urlKey(o.url) === urlKey(p.url) && o.keyword?.toLowerCase() === p.keyword?.toLowerCase());
    return old?.suggestion ? { ...p, suggestion: old.suggestion } : p;
  });
}

/** Lo que sirve para elegir la palabra de cada página: Search Console, tus posiciones (zona principal), tus palabras y las del estudio. */
async function keywordSignals(businessId: string, b: { name: string; seoKeywords: unknown; study: unknown }, zones: Zone[]) {
  const [gscRows, rankRows] = await Promise.all([latestReports(businessId, "gsc", 1), latestReports(businessId, "rank", 20)]);
  const gsc = gscRows[0] ? asGscReport(gscRows[0].data) : null;
  const rank = latestByZone(rankRows.map((r) => readRankReport(r.data)), zones).get(zones[0].code) ?? null;
  const study = readStudy(b.study);
  const candidates = uniqueKeywords([...readTrackedKeywords(b.seoKeywords), ...(study ? topKeywords(study, 20) : [])], 60);
  const signals: KeywordSignals = {
    gsc: gsc?.pageQueries ?? [],
    rank: rank?.rows.map((r) => ({ keyword: r.keyword, url: r.url, position: r.position })) ?? [],
    candidates,
    brand: b.name,
  };
  return { signals, rankRows: rank?.rows ?? [] };
}

/**
 * Revisa las páginas del sitio (o una sola, si viene `url`): elige la palabra clave de cada una, mira quién gana
 * en Google (DataForSEO, unos US$0.002 por página) y guarda la lista de ideas como reporte "onpage".
 */
export async function runOnPage(businessId: string, _prev: OnPageResult, f: FormData): Promise<OnPageResult> {
  void _prev;
  const startedAt = Date.now();
  const { lang, t } = await getT();
  const only = String(f.get("url") ?? "").trim();
  try {
    if (!dataForSeoEnabled())
      throw bi("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).");
    const b = await db.business.findUnique({ where: { id: businessId }, select: BUSINESS_FIELDS });
    if (!b) throw bi("Negocio no encontrado.", "Business not found.");
    const domain = siteDomain(b.website);
    if (!domain) throw bi("Primero agrega la dirección de tu página web en Ajustes del negocio.", "First add your website address in Business settings.");
    const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
    if (!zones.length)
      throw bi("Primero elige tu zona de Google en Datos reales de Google (DataForSEO) y guarda.", "First pick your Google area in Real Google data (DataForSEO) and save.");
    const auditRow = (await latestReports(businessId, "audit", 1))[0];
    const audit = auditRow ? readAuditReport(auditRow.data) : null;
    if (!audit) throw bi("Primero revisa tu página con «Revisar mi página» (Auditoría del sitio).", "First check your website with \"Check my website\" (Site audit).");

    const latest = await latestOnPage(businessId);
    const overrides = latest?.report.overrides ?? {};
    const { signals, rankRows } = await keywordSignals(businessId, b, zones);
    const language = b.seoLanguage === "en" ? "en" : "es";
    const ctx = { zone: zones[0], language, domain, home: audit.site.home || audit.pages[0]?.finalUrl || b.website, audit, rankRows, startedAt } as const;

    if (only) {
      // Una sola página: se usa la palabra elegida (o la que ya tenía) y los enlaces guardados de las demás.
      const prev = latest?.report.pages.find((p) => urlKey(p.url) === urlKey(only));
      if (!latest || !prev) throw bi("No encontramos esa página en la última revisión. Revisa todas tus páginas otra vez.", "We couldn't find that page in the last check. Check all your pages again.");
      const owner = overrideFor(overrides, prev.url);
      const keyword = owner ?? prev.keyword;
      if (!keyword) throw bi("Primero elige la palabra clave de esta página (Cambiar).", "First pick this page's keyword (Change).");
      const item = { url: prev.url, title: prev.title, h1: prev.stats?.h1 ?? "", isHome: urlKey(prev.url) === urlKey(ctx.home), keyword, source: owner ? ("owner" as const) : prev.keywordSource };
      const { pages, cost } = await checkPages([item], ctx, latest.report.pages);
      const page = keepSuggestions(pages, latest.report.pages)[0];
      await save(businessId, mergePage({ ...latest.report, overrides }, page, cost));
      paths(businessId);
      if (page.error) return { ok: false, message: errorText(bi(page.error.es, page.error.en), lang) };
      return {
        ok: true,
        message:
          prev.score !== null && !prev.needsRecheck
            ? t(`Listo: ${pathOf(page.url)} sacó ${page.score}/100 (antes ${prev.score}). Costo: ${costText(cost)}.`, `Done: ${pathOf(page.url)} scored ${page.score}/100 (before: ${prev.score}). Cost: ${costText(cost)}.`)
            : t(`Listo: ${pathOf(page.url)} sacó ${page.score}/100. Costo: ${costText(cost)}.`, `Done: ${pathOf(page.url)} scored ${page.score}/100. Cost: ${costText(cost)}.`),
      };
    }

    const candidates = candidatePages(audit);
    if (!candidates.length)
      throw bi(
        "La última revisión de tu página no encontró páginas que Google pueda mostrar. Vuelve a revisar tu página primero.",
        "Your last website check found no pages Google can show. Check your website again first.",
      );
    const plan = planPages(candidates, { ...signals, overrides });
    const checked = await checkPages(plan, ctx);
    const { cost, stoppedEarly } = checked;
    const pages = keepSuggestions(checked.pages, latest?.report.pages);
    const report: OnPageReport = {
      version: 1,
      zone: { code: zones[0].code, name: zones[0].name },
      language,
      pages,
      overrides,
      cost,
      createdAt: new Date().toISOString(),
      stoppedEarly,
    };
    await save(businessId, report);
    paths(businessId);
    const scored = pages.filter((p) => p.score !== null);
    const noKw = pages.filter((p) => !p.keyword && !p.error).length;
    const failed = pages.filter((p) => p.error && !p.skipped).length;
    const skipped = pages.filter((p) => p.skipped).length;
    const avg = scored.length ? Math.round(scored.reduce((s, p) => s + (p.score ?? 0), 0) / scored.length) : null;
    const extra = [
      noKw ? t(`${noKw} sin palabra clave (elige una)`, `${noKw} without a keyword (pick one)`) : "",
      failed ? t(`${failed} no se pudieron leer`, `${failed} couldn't be read`) : "",
      skipped ? t(`${skipped} no se alcanzaron a revisar`, `${skipped} weren't checked in time`) : "",
    ].filter(Boolean);
    if (!scored.length && failed && failed === pages.filter((p) => p.keyword).length) {
      const first = pages.find((p) => p.error)?.error;
      if (first) return { ok: false, message: t(first.es, first.en) };
    }
    return {
      ok: true,
      message:
        t(
          `Listo: revisamos ${scored.length} ${scored.length === 1 ? "página" : "páginas"}${avg !== null ? `, puntaje promedio ${avg}/100` : ""}. Costo de DataForSEO: ${costText(cost)}.`,
          `Done: we checked ${scored.length} ${scored.length === 1 ? "page" : "pages"}${avg !== null ? `, average score ${avg}/100` : ""}. DataForSEO cost: ${costText(cost)}.`,
        ) + (extra.length ? ` ${t("Además:", "Also:")} ${extra.join(" · ")}.` : ""),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/**
 * Guarda la palabra clave que el dueño eligió para una página (vacía = volver a la automática). Copia el último
 * reporte con el cambio y deja esa página marcada para volver a revisarla; la próxima revisión la usa.
 */
export async function setPageKeyword(businessId: string, url: string, keyword: string): Promise<{ ok: boolean; message: string }> {
  const { lang, t } = await getT();
  try {
    const latest = await latestOnPage(businessId);
    if (!latest || !latest.report.pages.some((p) => urlKey(p.url) === urlKey(url)))
      throw bi("No encontramos esa página en la última revisión.", "We couldn't find that page in the last check.");
    const kw = cleanKeyword(keyword);
    if (keyword.trim() && kw.length < 2) throw bi("Escribe una palabra clave de al menos 2 letras.", "Enter a keyword of at least 2 characters.");
    const page = latest.report.pages.find((p) => urlKey(p.url) === urlKey(url))!;
    await save(businessId, applyOverride(latest.report, page.url, kw));
    paths(businessId);
    return {
      ok: true,
      message: kw
        ? t(`Guardado: “${kw}”. Presiona «Volver a revisar esta página» para ver las ideas.`, `Saved: “${kw}”. Press "Check this page again" to see the ideas.`)
        : t("Listo: la próxima revisión elige la palabra sola.", "Done: the next check picks the keyword automatically."),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** La IA propone título SEO, descripción, H1 y subtítulos para una página, y se guardan en el último reporte. */
export async function suggestPageFix(businessId: string, url: string, _prev: OnPageResult, _f: FormData): Promise<OnPageResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  try {
    if (!aiEnabled())
      throw bi("Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en Vercel.", "The AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is missing in Vercel.");
    const [b, latest] = await Promise.all([db.business.findUnique({ where: { id: businessId }, select: BUSINESS_FIELDS }), latestOnPage(businessId)]);
    if (!b) throw bi("Negocio no encontrado.", "Business not found.");
    const page = latest?.report.pages.find((p) => urlKey(p.url) === urlKey(url));
    if (!latest || !page) throw bi("No encontramos esa página en la última revisión.", "We couldn't find that page in the last check.");
    if (!page.keyword) throw bi("Primero elige la palabra clave de esta página.", "First pick this page's keyword.");
    const fix = await suggestOnPageFix({
      business: b,
      keyword: page.keyword,
      language: latest.report.language,
      zone: latest.report.zone.name,
      page: {
        url: page.url,
        title: page.stats?.title ?? page.title,
        metaDescription: page.stats?.meta ?? "",
        h1: page.stats?.h1 ?? "",
        h2s: page.stats?.h2 ?? [],
        words: page.stats?.words ?? 0,
      },
      brief: page.brief ?? { headings: [], questions: [], terms: [], serpTitles: [] },
    });
    const suggestion = cleanSuggestion(fix, pickText(b.aiText) ?? "");
    const next: OnPageReport = { ...latest.report, pages: latest.report.pages.map((p) => (urlKey(p.url) === urlKey(page.url) ? { ...p, suggestion } : p)) };
    await db.seoReport.update({ where: { id: latest.id }, data: { data: next as unknown as Prisma.InputJsonValue } });
    paths(businessId);
    return { ok: true, message: t("Listo: copia los textos y pégalos en tu editor de página.", "Done: copy the texts and paste them into your website editor.") };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
