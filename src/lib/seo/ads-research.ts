// «Anuncios de tu competencia» (como «Advertising Research» de Semrush): qué anuncios pagan tus competidores en Google.
// 1) Gratis: los anuncios que salieron en TUS búsquedas, de las revisiones de posiciones ya guardadas (rank.ts guarda
//    los anuncios de cada búsqueda): quién anuncia, en qué búsquedas y con qué texto.
// 2) Pagado (botón, unos centavos): por cada competidor (hasta 3), las búsquedas por las que paga anuncios con su texto
//    y lo que gastaría (DataForSEO Labs ranked_keywords con item_types ["paid"]), y cuántos anuncios tiene en el Centro
//    de Transparencia de Anuncios de Google (SERP API google/ads_search, con su vista previa y fechas).
// Lo puro está aquí y se prueba en tests/seo-ads-research.test.ts.
import { bi } from "@/lib/i18n";
import { type BiText, isDirectory, normalizeDomain, resolveLocation, sameSite } from "@/lib/seo/competitors";
import { dfsPost, type Zone } from "@/lib/seo/dataforseo";
import { LABS_ITEM_COST, LABS_TASK_COST } from "@/lib/seo/labs";
import type { RankReport, SerpAd } from "@/lib/seo/rank";

export const ADS_KIND = "ads";
export const ADS_MAX_COMPETITORS = 3;
/** Búsquedas pagadas que se piden por competidor. */
export const ADS_KEYWORDS = 20;
/** Anuncios que se piden al Centro de Transparencia por competidor (una página = el precio más bajo). */
export const ADS_TRANSPARENCY_DEPTH = 40;
/** Precio de una página del Centro de Transparencia (SERP API). */
export const ADS_SEARCH_COST = 0.002;

/** Lo máximo que cuesta revisar `n` competidores. */
export function adsCostEstimate(n: number): number {
  const k = Math.max(1, Math.min(ADS_MAX_COMPETITORS, n));
  return Math.ceil(Math.round(k * (LABS_TASK_COST + ADS_KEYWORDS * LABS_ITEM_COST + ADS_SEARCH_COST) * 1e6) / 1e3) / 1000;
}

export type PaidKeyword = { keyword: string; position: number; volume: number | null; cpc: number | null; title: string; description: string; url: string };
export type TransparencyAd = { format: string; preview: string; url: string; firstShown: string | null; lastShown: string | null };

export type AdsCompetitor = {
  domain: string;
  /** Búsquedas por las que paga anuncios (en el país). */
  paidKeywords: number | null;
  /** Visitas al mes estimadas de sus anuncios. */
  paidTraffic: number | null;
  /** Lo que gastaría al mes en esos anuncios (US$, estimado). */
  paidCost: number | null;
  keywords: PaidKeyword[];
  /** Centro de Transparencia de Anuncios de Google (null si no se pudo leer). */
  transparency: { advertiser: string; total: number | null; recent: number; ads: TransparencyAd[] } | null;
  /** Se pudo leer algo. */
  ok: boolean;
};

export type AdsReport = { country: string; competitors: AdsCompetitor[]; notes: BiText[]; cost: number; createdAt: string };

// ---------- Gratis: los anuncios de tus búsquedas ----------

export type Advertiser = { domain: string; keywords: string[]; ads: (SerpAd & { keyword: string })[] };

/**
 * Quién anuncia en tus búsquedas (de las revisiones guardadas): cada dominio con las búsquedas donde salió y sus
 * anuncios (sin repetir el mismo texto). Del que sale en más búsquedas al que sale en menos. Sin tu propia página.
 */
export function advertisersFrom(reports: Pick<RankReport, "rows">[], website = ""): Advertiser[] {
  const own = normalizeDomain(website);
  const map = new Map<string, Advertiser>();
  for (const r of reports)
    for (const row of r.rows) {
      if (row.error) continue;
      for (const ad of row.ads ?? []) {
        const d = normalizeDomain(ad.domain) ?? ad.domain;
        if (!d || (own && sameSite(d, own))) continue;
        const a = map.get(d) ?? { domain: d, keywords: [], ads: [] };
        if (!a.keywords.includes(row.keyword)) a.keywords.push(row.keyword);
        if (!a.ads.some((x) => x.title === ad.title && x.description === ad.description)) a.ads.push({ ...ad, keyword: row.keyword });
        map.set(d, a);
      }
    }
  return [...map.values()].sort((a, b) => b.keywords.length - a.keywords.length || a.domain.localeCompare(b.domain));
}

/** ¿Hay anuncios guardados? (las revisiones viejas no los tienen). */
export const hasSavedAds = (reports: Pick<RankReport, "rows">[]) => reports.some((r) => r.rows.some((row) => Array.isArray(row.ads)));

// ---------- Lectura de las respuestas ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** "2023-06-03 09:57:49 +00:00" → ISO (null si no es fecha). */
export function dfsTime(v: unknown): string | null {
  const s = str(v).trim();
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})$/.exec(s);
  const d = new Date(m ? `${m[1]}T${m[2]}${m[3]}:${m[4]}` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * ranked_keywords con item_types ["paid"]: metrics.paid (count, etv, estimated_paid_traffic_cost) e items[] con
 * keyword_data (keyword, keyword_info.search_volume, cpc) y ranked_serp_element.serp_item (title, description, url, rank_group).
 */
export function parsePaidKeywords(result: unknown[]): Pick<AdsCompetitor, "paidKeywords" | "paidTraffic" | "paidCost" | "keywords"> {
  const r = obj(result[0]);
  const paid = obj(obj(r.metrics).paid);
  const keywords: PaidKeyword[] = [];
  for (const raw of arr(r.items)) {
    const it = obj(raw);
    const kd = obj(it.keyword_data);
    const serp = obj(obj(it.ranked_serp_element).serp_item);
    const keyword = str(kd.keyword).trim().toLowerCase();
    if (!keyword || keywords.some((k) => k.keyword === keyword)) continue;
    const info = obj(kd.keyword_info);
    keywords.push({
      keyword,
      position: num(serp.rank_group) ?? num(serp.rank_absolute) ?? 0,
      volume: num(info.search_volume),
      cpc: num(info.cpc),
      title: str(serp.title).replace(/\s+/g, " ").trim().slice(0, 200),
      description: str(serp.description).replace(/\s+/g, " ").trim().slice(0, 400),
      url: str(serp.url).slice(0, 500),
    });
  }
  return { paidKeywords: num(paid.count) ?? num(r.total_count), paidTraffic: num(paid.etv), paidCost: num(paid.estimated_paid_traffic_cost), keywords };
}

/** ads_search (Centro de Transparencia): items[] con title (anunciante), format, preview_image.url, url, first_shown, last_shown. */
export function parseTransparency(result: unknown[], now = Date.now()): NonNullable<AdsCompetitor["transparency"]> {
  const r = obj(result[0]);
  const items = arr(r.items).map(obj);
  const ads: TransparencyAd[] = items.map((it) => ({
    format: str(it.format) || "text",
    preview: str(obj(it.preview_image).url),
    url: str(it.url),
    firstShown: dfsTime(it.first_shown),
    lastShown: dfsTime(it.last_shown),
  }));
  const recent = ads.filter((a) => a.lastShown && now - Date.parse(a.lastShown) < 30 * 86_400_000).length;
  return {
    advertiser: str(items[0]?.title).slice(0, 120),
    total: num(r.total_count) ?? num(r.items_count) ?? ads.length,
    recent,
    ads: ads
      .filter((a) => a.preview || a.url)
      .sort((a, b) => Date.parse(b.lastShown ?? "0") - Date.parse(a.lastShown ?? "0"))
      .slice(0, 6),
  };
}

/** Los competidores a revisar: los que escribió el dueño, los del reporte de competencia y los que más anuncian en tus búsquedas. */
export function pickAdCompetitors(input: { typed?: string[]; competitors?: string[]; advertisers?: Advertiser[]; self?: string | null }, max = ADS_MAX_COMPETITORS): string[] {
  const out: string[] = [];
  const own = input.self ? normalizeDomain(input.self) : null;
  for (const raw of [...(input.typed ?? []), ...(input.competitors ?? []), ...(input.advertisers ?? []).map((a) => a.domain)]) {
    const d = normalizeDomain(raw);
    if (!d || (own && sameSite(d, own)) || isDirectory(d) || out.some((x) => sameSite(x, d))) continue;
    out.push(d);
    if (out.length >= max) break;
  }
  return out;
}

/** Lee un reporte guardado sin confiar en su forma; null si no es válido. */
export function readAdsReport(json: unknown): AdsReport | null {
  const r = obj(json);
  if (!Array.isArray(r.competitors) || !str(r.createdAt)) return null;
  const competitors: AdsCompetitor[] = arr(r.competitors)
    .map(obj)
    .map((c) => {
      const tr = c.transparency ? obj(c.transparency) : null;
      return {
        domain: str(c.domain),
        paidKeywords: num(c.paidKeywords),
        paidTraffic: num(c.paidTraffic),
        paidCost: num(c.paidCost),
        keywords: arr(c.keywords)
          .map(obj)
          .map((k) => ({ keyword: str(k.keyword), position: num(k.position) ?? 0, volume: num(k.volume), cpc: num(k.cpc), title: str(k.title), description: str(k.description), url: str(k.url) }))
          .filter((k) => k.keyword)
          .slice(0, ADS_KEYWORDS),
        transparency: tr
          ? {
              advertiser: str(tr.advertiser),
              total: num(tr.total),
              recent: num(tr.recent) ?? 0,
              ads: arr(tr.ads)
                .map(obj)
                .map((a) => ({ format: str(a.format), preview: /^https:\/\//.test(str(a.preview)) ? str(a.preview) : "", url: /^https:\/\//.test(str(a.url)) ? str(a.url) : "", firstShown: dfsTime(a.firstShown), lastShown: dfsTime(a.lastShown) }))
                .slice(0, 6),
            }
          : null,
        ok: c.ok === true,
      };
    })
    .filter((c) => c.domain)
    .slice(0, ADS_MAX_COMPETITORS);
  return {
    country: str(r.country),
    competitors,
    notes: arr(r.notes)
      .map(obj)
      .filter((n) => typeof n.es === "string" && typeof n.en === "string")
      .map((n) => ({ es: n.es as string, en: n.en as string })),
    cost: num(r.cost) ?? 0,
    createdAt: str(r.createdAt),
  };
}

/** El enlace al Centro de Transparencia de Anuncios de Google para ese dominio. */
export const transparencyUrl = (domain: string) => `https://adstransparency.google.com/?domain=${encodeURIComponent(domain)}`;

// ---------- Llamadas ----------

/** Revisa los anuncios de los competidores (en paralelo). Falla solo si no se pudo leer ninguno. */
export async function runAdsResearch(input: { domains: string[]; zone: Zone; language: string; now?: Date }): Promise<AdsReport> {
  if (!input.domains.length) throw bi("Todavía no sabemos quién es tu competencia. Busca primero tu competencia (arriba).", "We don't know your competitors yet. First look up your competitors (above).");
  const loc = await resolveLocation(input.zone.code, input.zone.name, input.language);
  const notes: BiText[] = [];
  let cost = 0;
  const competitors = await Promise.all(
    input.domains.slice(0, ADS_MAX_COMPETITORS).map(async (domain): Promise<AdsCompetitor> => {
      const [paid, tr] = await Promise.allSettled([
        dfsPost<unknown>("/dataforseo_labs/google/ranked_keywords/live", {
          target: domain,
          location_code: loc.countryCode,
          language_code: loc.language,
          item_types: ["paid"],
          limit: ADS_KEYWORDS,
          order_by: ["keyword_data.keyword_info.search_volume,desc"],
        }),
        dfsPost<unknown>("/serp/google/ads_search/live/advanced", { target: domain, location_code: loc.countryCode, platform: "google_search", depth: ADS_TRANSPARENCY_DEPTH }),
      ]);
      const out: AdsCompetitor = { domain, paidKeywords: null, paidTraffic: null, paidCost: null, keywords: [], transparency: null, ok: false };
      if (paid.status === "fulfilled") {
        cost += paid.value.cost;
        Object.assign(out, parsePaidKeywords(paid.value.result), { ok: true });
      } else notes.push({ es: `No se pudieron leer las búsquedas pagadas de ${domain}.`, en: `Couldn't read ${domain}'s paid keywords.` });
      if (tr.status === "fulfilled") {
        cost += tr.value.cost;
        out.transparency = parseTransparency(tr.value.result, (input.now ?? new Date()).getTime());
        out.ok = true;
      } else notes.push({ es: `No se pudo leer el Centro de Transparencia de Anuncios para ${domain}.`, en: `Couldn't read the Ads Transparency Center for ${domain}.` });
      return out;
    }),
  );
  if (!competitors.some((c) => c.ok)) throw bi("DataForSEO no pudo leer los anuncios esta vez. Intenta de nuevo en un minuto.", "DataForSEO couldn't read the ads this time. Try again in a minute.");
  return { country: loc.countryName, competitors, notes, cost: Math.round(cost * 10000) / 10000, createdAt: (input.now ?? new Date()).toISOString() };
}
