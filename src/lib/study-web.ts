// Lee la página web del negocio para el estudio: la de inicio y unas pocas páginas internas
// (servicios, nosotros, zonas, contacto), con las mismas protecciones que la auditoría de SEO:
// nada de direcciones internas, tiempo máximo por página y en total, y tamaño máximo.
import { analyzePage, fetchPublicHtml, isFileUrl, startUrl } from "@/lib/seo/audit";
import { htmlToText } from "@/lib/study-shape";

export type SitePage = { url: string; title: string; text: string };
export type SiteRead = { pages: SitePage[]; lang: string; error: string | null };

// Las páginas que suelen decir qué vende el negocio, dónde trabaja y a quién atiende.
const HINTS: [RegExp, number][] = [
  [/servic|service|product|que-hacemos|what-we-do|soluciones|solutions|tipos|claims|reclamo/i, 5],
  [/area|zona|cobertura|coverage|locations?|ubicaci|ciudades|cities|counties|condados|service-area|donde/i, 6],
  [/about|nosotros|quienes|quiénes|acerca|empresa|company|who-we|historia|equipo|team/i, 3],
  [/contact|contacto|cita|appointment|cotiza|quote|estimate/i, 2],
  [/faq|preguntas|clientes|customers|industr|residential|commercial|residencial|comercial/i, 1],
];
const SKIP = /blog\/.+|\/(tag|category|categoria|author|autor|page|wp-|feed|cart|carrito|checkout|login|cuenta|account|privacy|privacidad|terms|terminos|cookies?)\b/i;

/** Puntaje de una URL interna según su dirección: más alto = más útil para entender el negocio. */
export function pageHint(url: string): number {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return 0;
  }
  if (path === "/" || SKIP.test(path) || isFileUrl(url)) return 0;
  const depth = path.split("/").filter(Boolean).length;
  const score = HINTS.reduce((s, [re, pts]) => (re.test(path) ? Math.max(s, pts) : s), 0);
  return score ? score * 10 - depth : 0;
}

/** Elige hasta `n` páginas internas: primero la mejor de cada tipo (servicios, zonas, nosotros, contacto…), después las demás. */
export function pickPages(links: string[], home: string, n: number): string[] {
  const seen = new Set([home.replace(/\/$/, "")]);
  const ranked = links
    .map((url) => ({ url, score: pageHint(url) }))
    .filter((l) => l.score > 0 && !seen.has(l.url.replace(/\/$/, "")) && seen.add(l.url.replace(/\/$/, "")))
    .sort((a, b) => b.score - a.score);
  const kind = (score: number) => Math.ceil(score / 10);
  const firsts = ranked.filter((l, i) => ranked.findIndex((x) => kind(x.score) === kind(l.score)) === i);
  return [...firsts, ...ranked.filter((l) => !firsts.includes(l))].slice(0, n).map((l) => l.url);
}

const errText = (e: unknown) => (e instanceof Error ? (e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : e.message) : String(e)).slice(0, 200);

/**
 * Lee la página de inicio y hasta `maxPages - 1` páginas internas. Nunca lanza error: si no se puede leer,
 * devuelve las páginas que sí se leyeron y el motivo en `error`.
 */
export async function readWebsite(website: string, opts: { maxPages?: number; totalMs?: number } = {}): Promise<SiteRead> {
  const maxPages = opts.maxPages ?? 5;
  const deadline = Date.now() + (opts.totalMs ?? 25_000);
  if (!website.trim()) return { pages: [], lang: "", error: null };
  let home: { html: string; url: string };
  try {
    home = await fetchPublicHtml(startUrl(website).href, 10_000);
  } catch (e) {
    return { pages: [], lang: "", error: errText(e) };
  }
  const info = analyzePage(home.html, home.url);
  const pages: SitePage[] = [{ url: home.url, title: info.title, text: htmlToText(home.html, 6000) }];
  const more = pickPages(info.links, home.url, maxPages - 1);
  const left = () => Math.max(0, deadline - Date.now());
  const results = await Promise.allSettled(
    more.map(async (url) => {
      if (left() < 1000) throw new Error("timeout");
      const r = await fetchPublicHtml(url, Math.min(8_000, left()));
      return { url: r.url, title: analyzePage(r.html, r.url).title, text: htmlToText(r.html, 3500) } satisfies SitePage;
    }),
  );
  for (const r of results) if (r.status === "fulfilled" && r.value.text.trim()) pages.push(r.value);
  return { pages, lang: info.lang, error: null };
}

/** Las páginas leídas como un solo texto para la IA (con la dirección de cada una). */
export function siteDigest(site: SiteRead, max = 16_000): string {
  return site.pages
    .map((p) => `--- ${p.url}${p.title ? ` (${p.title})` : ""}\n${p.text}`)
    .join("\n\n")
    .slice(0, max);
}
