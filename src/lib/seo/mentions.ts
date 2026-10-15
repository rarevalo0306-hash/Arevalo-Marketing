// «Quién habla de ti» (como «Brand Monitoring» de Semrush): páginas de internet (noticias, blogs, foros, directorios)
// que nombran al negocio, si hablan bien o mal y cuáles NO enlazan a la página (cada una es una oportunidad fácil de
// conseguir un enlace: ya te conocen, solo falta pedirlo). DataForSEO Content Analysis API
// (content_analysis/search/live, una llamada de hasta MENTIONS_LIMIT páginas, unos US$0.02 + algo por página).
// «Te enlaza» se sabe abriendo la página de la mención (solo GET, máx. MENTIONS_VERIFY páginas, 6 s cada una) y viendo
// si tiene un enlace a tu página; si no se pudo abrir, con el último reporte de enlaces (backlinks.ts).
// Lo puro está aquí y se prueba en tests/seo-mentions.test.ts.
import { bi } from "@/lib/i18n";
import { type BiText, normalizeDomain, sameSite } from "@/lib/seo/competitors";
import { fetchPublicHtml } from "@/lib/seo/audit";
import { dfsPost } from "@/lib/seo/dataforseo";
import { pool } from "@/lib/seo/rank";

export const MENTIONS_KIND = "mentions";
export const MENTIONS_LIMIT = 100;
export const MENTIONS_KEEP = 6;
/** Cuántas páginas de menciones (las más nuevas) se abren para ver si enlazan a tu página. */
export const MENTIONS_VERIFY = 25;
/** Precio aproximado de una búsqueda (el real queda anotado en el reporte). */
export const MENTIONS_COST_ESTIMATE = 0.03;

export type Sentiment = "positive" | "negative" | "neutral";
export type Mention = {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  /** ISO o null si no se sabe cuándo se publicó. */
  date: string | null;
  sentiment: Sentiment | null;
  /** news, blogs, message-boards, ecommerce, organization… */
  pageType: string;
  /** Fuerza del sitio (0 a 1000). */
  rank: number | null;
  /** Ese sitio ya te enlaza (según tu último reporte de enlaces). null = no se sabe. */
  linked: boolean | null;
};

export type MentionsReport = { query: string; total: number | null; mentions: Mention[]; backlinksChecked: boolean; notes: BiText[]; cost: number; createdAt: string };

// ---------- Ayudantes puros ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** "2026-10-01 10:00:00 +00:00" → ISO (null si no es fecha). */
export function contentDate(v: unknown): string | null {
  const s = str(v).trim();
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})$/.exec(s);
  const d = new Date(m ? `${m[1]}T${m[2]}${m[3]}:${m[4]}` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Lo que más pesa de connotation_types (positive, negative, neutral); null si no hay datos. */
export function sentimentOf(types: unknown): Sentiment | null {
  const t = obj(types);
  const scores: [Sentiment, number][] = [
    ["positive", num(t.positive) ?? -1],
    ["negative", num(t.negative) ?? -1],
    ["neutral", num(t.neutral) ?? -1],
  ];
  const best = scores.sort((a, b) => b[1] - a[1])[0];
  return best[1] < 0 ? null : best[0];
}

/** La búsqueda exacta del nombre (entre comillas), sin «LLC», «Inc.» ni signos raros. */
export function mentionQuery(name: string): string {
  const clean = name
    .replace(/["“”]/g, "")
    .trim()
    .replace(/[,\s]+(l\.?l\.?c\.?|inc\.?|corp\.?|s\.?a\.?|ltd\.?)$/i, "")
    .replace(/[,.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return clean ? `"${clean}"` : "";
}

/**
 * Lee content_analysis/search: result[0].items[] con url, domain/main_domain, domain_rank, page_types y content_info
 * (title, main_title, snippet, date_published, connotation_types). Quita tu propia página y repite una por dirección.
 */
export function parseMentions(result: unknown[], ownDomain: string | null): { total: number | null; mentions: Mention[] } {
  const r = obj(result[0]);
  const seen = new Set<string>();
  const mentions: Mention[] = [];
  for (const raw of arr(r.items)) {
    const it = obj(raw);
    const url = str(it.url).trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    const domain = normalizeDomain(str(it.main_domain) || str(it.domain) || url) ?? "";
    if (!domain || (ownDomain && sameSite(domain, ownDomain))) continue;
    seen.add(url);
    const ci = obj(it.content_info);
    mentions.push({
      url: url.slice(0, 600),
      domain,
      title: (str(ci.title) || str(ci.main_title)).replace(/\s+/g, " ").trim().slice(0, 200),
      snippet: str(ci.snippet).replace(/\s+/g, " ").trim().slice(0, 400),
      date: contentDate(ci.date_published),
      sentiment: sentimentOf(ci.connotation_types),
      pageType: str(arr(it.page_types)[0]) || "",
      rank: num(it.domain_rank),
      linked: null,
    });
  }
  return { total: num(r.total_count), mentions };
}

/** ¿El HTML tiene un enlace (href) a tu dominio o a un subdominio? */
export function htmlLinksTo(html: string, domain: string): boolean {
  const own = normalizeDomain(domain);
  if (!own) return false;
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)/gi)) {
    const href = m[1].replace(/&amp;/g, "&");
    const host = normalizeDomain(href.startsWith("//") ? `https:${href}` : href);
    if (host && sameSite(host, own)) return true;
  }
  return false;
}

/** Marca cuáles ya te enlazan (con la lista de sitios del último reporte de enlaces). Sin lista, queda null. */
export function markLinked(mentions: Mention[], referring: string[] | null): Mention[] {
  if (!referring) return mentions.map((m) => ({ ...m, linked: null }));
  const set = referring.map((d) => normalizeDomain(d) ?? d).filter(Boolean);
  return mentions.map((m) => ({ ...m, linked: set.some((d) => sameSite(d, m.domain)) }));
}

/** Las más nuevas primero (las sin fecha al final); a igual fecha, la del sitio más fuerte. */
export function sortMentions(list: Mention[]): Mention[] {
  return [...list].sort((a, b) => Date.parse(b.date ?? "1970-01-01") - Date.parse(a.date ?? "1970-01-01") || (b.rank ?? 0) - (a.rank ?? 0));
}

/** Lo que conviene ver primero: las negativas y las que no te enlazan. */
export function mentionsSummary(list: Mention[]): { total: number; negative: number; unlinked: number; positive: number } {
  return {
    total: list.length,
    negative: list.filter((m) => m.sentiment === "negative").length,
    unlinked: list.filter((m) => m.linked === false).length,
    positive: list.filter((m) => m.sentiment === "positive").length,
  };
}

/** Lee un reporte guardado sin confiar en su forma; null si no es válido. */
export function readMentionsReport(json: unknown): MentionsReport | null {
  const r = obj(json);
  if (!Array.isArray(r.mentions) || !str(r.createdAt)) return null;
  const SENT: Sentiment[] = ["positive", "negative", "neutral"];
  const mentions: Mention[] = arr(r.mentions)
    .map(obj)
    .map((m) => ({
      url: /^https?:\/\//i.test(str(m.url)) ? str(m.url) : "",
      domain: str(m.domain),
      title: str(m.title),
      snippet: str(m.snippet),
      date: contentDate(m.date),
      sentiment: SENT.includes(m.sentiment as Sentiment) ? (m.sentiment as Sentiment) : null,
      pageType: str(m.pageType),
      rank: num(m.rank),
      linked: typeof m.linked === "boolean" ? m.linked : null,
    }))
    .filter((m) => m.url && m.domain)
    .slice(0, MENTIONS_LIMIT);
  return {
    query: str(r.query),
    total: num(r.total),
    mentions,
    backlinksChecked: r.backlinksChecked === true,
    notes: arr(r.notes)
      .map(obj)
      .filter((n) => typeof n.es === "string" && typeof n.en === "string")
      .map((n) => ({ es: n.es as string, en: n.en as string })),
    cost: num(r.cost) ?? 0,
    createdAt: str(r.createdAt),
  };
}

// ---------- Llamada ----------

export type HtmlFetch = (url: string) => Promise<string>;
const defaultHtml: HtmlFetch = async (url) => (await fetchPublicHtml(url, 6_000, 800_000)).html;

/**
 * Abre las páginas más nuevas (máx. MENTIONS_VERIFY, de a 5) y marca si enlazan a tu página. Las que no se pudieron
 * abrir quedan como estaban (con el dato del reporte de enlaces o null).
 */
export async function verifyLinks(mentions: Mention[], ownDomain: string, fetchHtml: HtmlFetch = defaultHtml, max = MENTIONS_VERIFY): Promise<Mention[]> {
  const head = mentions.slice(0, max);
  const checked = await pool(head, 5, async (m) => {
    try {
      return { ...m, linked: htmlLinksTo(await fetchHtml(m.url), ownDomain) };
    } catch {
      return m;
    }
  });
  return [...checked, ...mentions.slice(max)];
}

/** Busca las páginas que nombran al negocio (una llamada) y revisa cuáles te enlazan. */
export async function runMentions(input: { name: string; website: string; referring: string[] | null; fetchHtml?: HtmlFetch }): Promise<MentionsReport> {
  const query = mentionQuery(input.name);
  if (!query) throw bi("Falta el nombre del negocio en Ajustes del negocio.", "The business name is missing in Business settings.");
  const own = normalizeDomain(input.website);
  const r = await dfsPost<unknown>("/content_analysis/search/live", { keyword: query, search_mode: "as_is", limit: MENTIONS_LIMIT }, 90_000);
  const parsed = parseMentions(r.result, own);
  const sorted = sortMentions(markLinked(parsed.mentions, input.referring));
  const mentions = own ? await verifyLinks(sorted, own, input.fetchHtml) : sorted;
  const notes: BiText[] = [];
  if (!own) notes.push({ es: "Agrega tu página web en Ajustes del negocio para saber qué menciones te enlazan.", en: "Add your website in Business settings to know which mentions link to you." });
  return {
    query,
    total: parsed.total,
    mentions,
    backlinksChecked: Boolean(input.referring),
    notes,
    cost: Math.round(r.cost * 10000) / 10000,
    createdAt: new Date().toISOString(),
  };
}
