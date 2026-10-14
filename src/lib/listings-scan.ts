// «Buscar mis fichas automáticamente» (lo gratis de «Listing Management» de Semrush): busca en Google el nombre del
// negocio con su ciudad y su teléfono, y reconoce en los resultados las fichas en los directorios de su lista (Yelp,
// BBB, Facebook, Páginas Amarillas…). Dice si la ficha muestra el mismo teléfono.
// No publica nada en ningún directorio: publicar los datos en todos a la vez necesita un servicio pagado (tipo Yext),
// que no se usa sin autorización del dueño. Las fichas encontradas se anotan solas en «Directorios y reseñas» solo si
// estaban «por hacer» (no cambia lo que el dueño marcó a mano).
// 2 consultas a Google (DataForSEO SERP live): nombre + ciudad (50 resultados, US$0.008) y teléfono (30, US$0.005).
import { type Directory, normName, samePhone } from "@/lib/directories";
import { dfsPost } from "@/lib/seo/dataforseo";
import { nameMatches, type SerpItem, type SerpResult, siteDomain } from "@/lib/seo/rank";

export const SCAN_KIND = "listings-scan";
/** Resultados que se piden en cada búsqueda y lo que cuestan (US$0.002 la primera página + US$0.0015 cada otra). */
export const SCAN_NAME_DEPTH = 50;
export const SCAN_PHONE_DEPTH = 30;
const serpCost = (depth: number) => 0.002 + (Math.ceil(depth / 10) - 1) * 0.0015;
export const scanCostEstimate = (withPhone: boolean) => Math.round((serpCost(SCAN_NAME_DEPTH) + (withPhone ? serpCost(SCAN_PHONE_DEPTH) : 0)) * 10000) / 10000;

export type PhoneCheck = "ok" | "different" | "unknown";

export type ScanHit = {
  /** Clave del directorio (directories.ts). */
  id: string;
  name: string;
  url: string;
  title: string;
  /** ¿El teléfono de la ficha es el tuyo? (por la búsqueda del teléfono o por el texto de Google). */
  phone: PhoneCheck;
};

export type ScanReport = {
  query: string;
  phoneQuery: string;
  /** Las fichas encontradas. */
  hits: ScanHit[];
  /** Los directorios revisados que no salieron. */
  missing: string[];
  /** Cuántas se anotaron solas en la lista. */
  marked: number;
  cost: number;
  createdAt: string;
};

// ---------- Ayudantes puros ----------

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** ¿Esta dirección es de ese directorio? Por dominio (yelp.com, m.yelp.com) o por nombre ("chamber" en cualquier cámara). */
export function directoryOf(url: string, dirs: Pick<Directory, "id" | "domain">[]): string | null {
  const host = siteDomain(url);
  if (!host) return null;
  for (const d of dirs) {
    const dom = d.domain.toLowerCase();
    if (!dom.includes(".") ? host.includes(dom) : host === dom || host.endsWith(`.${dom}`)) return d.id;
  }
  return null;
}

/** El teléfono para buscarlo en Google: (305) 394-8090 → "305-394-8090"; otros países, como está escrito. */
export function phoneQuery(phone: string): string {
  const d = phone.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d.length === 10 ? d : "";
  if (ten) return `"${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}"`;
  return d.length >= 7 ? `"${phone.trim()}"` : "";
}

/** Los números de teléfono que aparecen en un texto (7 dígitos o más). */
export function phonesIn(text: string): string[] {
  return [...text.matchAll(/\+?\(?\d[\d\s().-]{6,}\d/g)]
    .map((m) => m[0])
    .filter((p) => p.replace(/\D/g, "").length >= 7 && p.replace(/\D/g, "").length <= 15)
    // «desde 2005 2010 2015» no es un teléfono.
    .filter((p) => !/^(?:(?:19|20)\d{2}[\s.-]+)+(?:19|20)\d{2}$/.test(p.trim()));
}

/** ¿El texto de Google de la ficha muestra tu teléfono, otro o ninguno? */
export function phoneInSnippet(text: string, official: string): PhoneCheck {
  if (!official.replace(/\D/g, "")) return "unknown";
  const found = phonesIn(text);
  if (!found.length) return "unknown";
  return found.some((p) => samePhone(p, official)) ? "ok" : "different";
}

type Item = SerpItem & { description?: string };
const organic = (r: SerpResult | null | undefined): Item[] =>
  (Array.isArray(r?.items) ? r.items : []).filter((i): i is Item => !!i && typeof i === "object" && (i.type === "organic" || i.type === "local_pack") && !!str(i.url));

/**
 * Las fichas de los directorios en los resultados. Por nombre: la página debe nombrar al negocio (así no cuenta una
 * lista tipo «Los 10 mejores techadores»). Por teléfono: cualquier página del directorio con tu teléfono es tuya.
 */
export function scanHits(input: { byName: SerpResult | null; byPhone: SerpResult | null; dirs: Pick<Directory, "id" | "name" | "domain">[]; businessName: string; phone: string }): ScanHit[] {
  // Google (el Perfil de Google) se revisa en su propia sección; aquí solo los directorios.
  const dirs = input.dirs.filter((d) => d.id !== "google");
  const out = new Map<string, ScanHit>();
  const phoneHits = new Map<string, Item>();
  for (const it of organic(input.byPhone)) {
    const id = directoryOf(str(it.url), dirs);
    if (id && !phoneHits.has(id)) phoneHits.set(id, it);
  }
  for (const it of organic(input.byName)) {
    const id = directoryOf(str(it.url), dirs);
    if (!id || out.has(id)) continue;
    const title = str(it.title);
    const named = nameMatches(title, input.businessName) || (normName(input.businessName).length >= 4 && normName(title).includes(normName(input.businessName)));
    if (!named) continue;
    const snippet = `${title} ${str(it.description)}`;
    const phone: PhoneCheck = phoneHits.has(id) ? "ok" : phoneInSnippet(snippet, input.phone);
    out.set(id, { id, name: input.dirs.find((d) => d.id === id)?.name ?? id, url: str(it.url), title, phone });
  }
  // Las que solo salieron buscando el teléfono: son tuyas aunque el título no tenga tu nombre exacto.
  for (const [id, it] of phoneHits) if (!out.has(id)) out.set(id, { id, name: input.dirs.find((d) => d.id === id)?.name ?? id, url: str(it.url), title: str(it.title), phone: "ok" });
  const order = new Map(input.dirs.map((d, i) => [d.id, i]));
  return [...out.values()].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

/** Lo que se anota en la lista para cada ficha encontrada (solo si estaba «por hacer»). */
export function listingUpdate(hit: ScanHit, current: { status: string; napOk: boolean | null } | undefined, at: string): { status: string; url: string; napOk: boolean | null; notes: string } | null {
  if (current && current.status !== "todo") return null;
  return {
    status: "listed",
    url: hit.url.slice(0, 500),
    napOk: hit.phone === "ok" ? true : hit.phone === "different" ? false : null,
    notes: `Encontrada por la revisión automática (${at.slice(0, 10)}).${hit.phone === "different" ? " El teléfono no coincide." : ""}`,
  };
}

/** Lee una revisión guardada sin confiar en su forma. */
export function readScanReport(json: unknown): ScanReport | null {
  const r = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  if (!r || !Array.isArray(r.hits) || !str(r.createdAt)) return null;
  const hits: ScanHit[] = r.hits
    .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
    .map((h): ScanHit => ({ id: str(h.id), name: str(h.name), url: str(h.url), title: str(h.title), phone: h.phone === "ok" || h.phone === "different" ? h.phone : "unknown" }))
    .filter((h) => h.id && /^https?:\/\//.test(h.url));
  return {
    query: str(r.query),
    phoneQuery: str(r.phoneQuery),
    hits,
    missing: Array.isArray(r.missing) ? r.missing.filter((m): m is string => typeof m === "string") : [],
    marked: typeof r.marked === "number" ? r.marked : 0,
    cost: typeof r.cost === "number" ? r.cost : 0,
    createdAt: str(r.createdAt),
  };
}

// ---------- Búsqueda ----------

/** Busca las fichas del negocio en Google. Lanza el error si falla la búsqueda por nombre. */
export async function runListingsScan(input: { name: string; city: string; phone: string; dirs: Pick<Directory, "id" | "name" | "domain" | "kind">[]; locationCode: number; language: string }): Promise<Omit<ScanReport, "marked">> {
  const dirs = input.dirs.filter((d) => d.kind === "listing");
  const query = `"${input.name.trim()}"${input.city ? ` ${input.city.trim()}` : ""}`;
  const pq = phoneQuery(input.phone);
  const ask = (keyword: string, depth: number) =>
    dfsPost<SerpResult>("/serp/google/organic/live/advanced", { keyword, location_code: input.locationCode, language_code: input.language, device: "desktop", depth }, 60_000);
  const [byName, byPhone] = await Promise.all([ask(query, SCAN_NAME_DEPTH), pq ? ask(pq, SCAN_PHONE_DEPTH).catch(() => null) : Promise.resolve(null)]);
  const hits = scanHits({ byName: byName.result[0] ?? null, byPhone: byPhone?.result[0] ?? null, dirs, businessName: input.name, phone: input.phone });
  return {
    query,
    phoneQuery: pq,
    hits,
    missing: dirs.filter((d) => d.id !== "google" && !hits.some((h) => h.id === d.id)).map((d) => d.id),
    cost: Math.round((byName.cost + (byPhone?.cost ?? 0)) * 10000) / 10000,
    createdAt: new Date().toISOString(),
  };
}
