// «Reseñas en otros sitios» (como «Review Management» de Semrush): las reseñas del negocio fuera de Google —Yelp,
// Tripadvisor, Trustpilot, Facebook y otros— en un solo lugar, con respuestas escritas por la IA para copiar y pegar en
// cada sitio (esos sitios no dejan contestar desde otra app).
// De DataForSEO Business Data API (solo por tareas, se pide con prioridad alta para que llegue en segundos):
// - Google «Extended Reviews» por el cid del negocio: incluye las reseñas de otros sitios que Google muestra en el
//   perfil («Reseñas de la web»). Así se ven Yelp y Facebook, que no tienen API propia en DataForSEO.
// - Trustpilot por el dominio de la página del negocio (si tiene perfil ahí).
// - Tripadvisor por el enlace de su ficha (el dueño lo pega; sirve sobre todo a restaurantes, hoteles y tours).
// Las reseñas de Google se ven en «Tu Perfil de Google»: aquí solo las de otros sitios. Lo puro se prueba en
// tests/seo-web-reviews.test.ts.
import { bi, BiError } from "@/lib/i18n";
import { type BiText, normalizeDomain } from "@/lib/seo/competitors";
import { dfsError, dfsTask, type Zone } from "@/lib/seo/dataforseo";
import { parseDfsTime, reviewStats } from "@/lib/seo/gbp";
import type { GbpReview, ReviewStats } from "@/lib/seo/gbp-shared";
import type { MapPlace } from "@/lib/seo/maprank-shared";

export const WEB_REVIEWS_KIND = "web-reviews";
export const WEB_REVIEWS_TASK_KIND = "web-reviews-task";
/** Cuántas reseñas se piden de cada fuente. */
export const EXTENDED_DEPTH = 100;
export const TRUSTPILOT_DEPTH = 40;
export const TRIPADVISOR_DEPTH = 30;

export type WebReview = GbpReview & {
  /** yelp, tripadvisor, trustpilot, facebook… (o el dominio si es otro sitio). */
  source: string;
  sourceName: string;
  /** Cuándo el dueño copió la respuesta para pegarla en ese sitio. */
  copiedAt?: string;
};

export type WebSource = { id: string; name: string; rating: number | null; total: number | null; count: number; url: string };

export type WebReviewsReport = {
  version: 1;
  sources: WebSource[];
  reviews: WebReview[];
  stats: ReviewStats;
  /** La ficha de Tripadvisor que pegó el dueño (url_path) y el dominio que se buscó en Trustpilot. */
  tripadvisorPath: string;
  trustpilotDomain: string;
  notes: BiText[];
  cost: number;
  createdAt: string;
};

// ---------- Ayudantes puros ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const KNOWN: [RegExp, string, string][] = [
  [/(^|\.)yelp\./, "yelp", "Yelp"],
  [/(^|\.)tripadvisor\./, "tripadvisor", "Tripadvisor"],
  [/(^|\.)trustpilot\./, "trustpilot", "Trustpilot"],
  [/(^|\.)facebook\.|^fb\.com$/, "facebook", "Facebook"],
  [/(^|\.)google\./, "google", "Google"],
  [/(^|\.)bbb\.org$/, "bbb", "BBB"],
  [/(^|\.)angi\.com$|angieslist/, "angi", "Angi"],
  [/(^|\.)houzz\./, "houzz", "Houzz"],
  [/(^|\.)thumbtack\.com$/, "thumbtack", "Thumbtack"],
  [/(^|\.)homeadvisor\.com$/, "homeadvisor", "HomeAdvisor"],
  [/(^|\.)nextdoor\.com$/, "nextdoor", "Nextdoor"],
  [/(^|\.)foursquare\.com$/, "foursquare", "Foursquare"],
];

/** De qué sitio es una reseña (por el dominio o el nombre que da Google). */
export function sourceOf(domain: string, title = ""): { id: string; name: string } {
  const d = (normalizeDomain(domain) ?? domain.toLowerCase().replace(/^www\./, "")).trim();
  for (const [re, id, name] of KNOWN) if (re.test(d) || re.test(`${title.toLowerCase()}.`)) return { id, name };
  if (!d) return { id: title.trim().toLowerCase() || "web", name: title.trim() || "Web" };
  return { id: d, name: title.trim() || d };
}

/** El url_path de una ficha de Tripadvisor ("https://www.tripadvisor.com/Restaurant_Review-g34438-d123-Reviews-Joes-Miami.html"). "" si no es una ficha. */
export function tripadvisorPath(url: string): string {
  const m = /tripadvisor\.[a-z.]+\/((?:Restaurant|Hotel|Attraction|Vacation|AttractionProduct|ShowUser)?[A-Za-z_]*Review[s]?-g\d+-d\d+[^?#\s]*\.html)/i.exec(url.trim());
  return m ? m[1].slice(0, 300) : "";
}

const reviewOf = (r: {
  id: string;
  source: { id: string; name: string };
  name: string;
  rating: number | null;
  text: string;
  originalText?: string;
  language?: string;
  timestamp: string;
  timeAgo?: string;
  ownerAnswer: string;
  ownerTimestamp: string;
  url: string;
}): WebReview => ({
  id: r.id.slice(0, 300),
  name: r.name.trim().slice(0, 120),
  profileUrl: "",
  localGuide: false,
  rating: r.rating !== null && r.rating >= 1 && r.rating <= 5 ? r.rating : null,
  text: r.text.trim().slice(0, 5000),
  originalText: r.originalText && r.originalText.trim() !== r.text.trim() ? r.originalText.trim().slice(0, 5000) : "",
  language: (r.language ?? "").slice(0, 10),
  timestamp: r.timestamp,
  timeAgo: (r.timeAgo ?? "").slice(0, 60),
  ownerAnswer: r.ownerAnswer.trim().slice(0, 5000),
  ownerTimestamp: r.ownerTimestamp,
  url: /^https?:\/\//i.test(r.url) ? r.url.slice(0, 600) : "",
  images: [],
  source: r.source.id,
  sourceName: r.source.name,
});

/** Google «Extended Reviews»: solo las de otros sitios (items[].source.domain / title distinto de Google). */
export function parseExtended(result: unknown[]): WebReview[] {
  const out: WebReview[] = [];
  for (const raw of arr(obj(result[0]).items)) {
    const it = obj(raw);
    const src = obj(it.source);
    const source = sourceOf(str(src.domain), str(src.title));
    if (source.id === "google") continue;
    const name = str(it.profile_name);
    const timestamp = parseDfsTime(it.timestamp);
    out.push(
      reviewOf({
        id: `${source.id}:${str(it.review_id) || `${name}|${timestamp}`}`,
        source,
        name,
        rating: num(obj(it.rating).value),
        text: str(it.review_text),
        originalText: str(it.original_review_text),
        language: str(it.original_language),
        timestamp,
        timeAgo: str(it.time_ago),
        ownerAnswer: str(it.owner_answer) || str(it.original_owner_answer),
        ownerTimestamp: parseDfsTime(it.owner_timestamp),
        url: str(it.review_url),
      }),
    );
  }
  return out;
}

/** Trustpilot y Tripadvisor: result[0] (title, rating.value, reviews_count) e items[] (rating.value, review_text, title, user_profile.name, responses[]). */
export function parseDirect(result: unknown[], source: { id: string; name: string }): { reviews: WebReview[]; rating: number | null; total: number | null } {
  const r = obj(result[0]);
  const reviews: WebReview[] = [];
  for (const raw of arr(r.items)) {
    const it = obj(raw);
    const name = str(obj(it.user_profile).name);
    const timestamp = parseDfsTime(it.timestamp);
    const title = str(it.title).trim();
    const body = str(it.review_text).trim();
    const reply = obj(arr(it.responses)[0]);
    reviews.push(
      reviewOf({
        id: `${source.id}:${str(it.review_id) || str(it.url) || `${name}|${timestamp}`}`,
        source,
        name,
        rating: num(obj(it.rating).value),
        text: title && !body.startsWith(title) ? `${title}. ${body}` : body,
        language: str(it.language),
        timestamp,
        ownerAnswer: str(reply.text),
        ownerTimestamp: parseDfsTime(reply.timestamp),
        url: str(it.url),
      }),
    );
  }
  return { reviews, rating: num(obj(r.rating).value), total: num(r.reviews_count) };
}

// La misma persona, en el mismo sitio y el mismo día, es la misma reseña (Google y Trustpilot la escriben un poco distinto).
const key = (r: WebReview) => (r.name && r.timestamp ? `${r.source}|${r.name.toLowerCase()}|${r.timestamp.slice(0, 10)}` : `${r.source}|${r.text.slice(0, 60).toLowerCase()}`);

/** Junta las reseñas de todas las fuentes sin repetir (Google puede mostrar la misma de Trustpilot) y de la más nueva a la más vieja. */
export function mergeWebReviews(...lists: WebReview[][]): WebReview[] {
  const seen = new Set<string>();
  const out: WebReview[] = [];
  for (const r of lists.flat()) {
    const k = key(r);
    if (seen.has(k) || seen.has(r.id)) continue;
    seen.add(k);
    seen.add(r.id);
    out.push(r);
  }
  return out.sort((a, b) => Date.parse(b.timestamp || "1970-01-01") - Date.parse(a.timestamp || "1970-01-01"));
}

/** El resumen por sitio: el promedio y el total que da el sitio (si se pidió directo) o los de las reseñas traídas. */
export function webSources(reviews: WebReview[], direct: Record<string, { rating: number | null; total: number | null; url: string }> = {}): WebSource[] {
  const map = new Map<string, WebSource>();
  for (const r of reviews) {
    const s = map.get(r.source) ?? { id: r.source, name: r.sourceName, rating: null, total: null, count: 0, url: "" };
    s.count++;
    map.set(r.source, s);
  }
  for (const [id, d] of Object.entries(direct)) {
    const s = map.get(id) ?? { id, name: sourceOf(id).name, rating: null, total: null, count: 0, url: "" };
    map.set(id, { ...s, rating: d.rating, total: d.total, url: d.url });
  }
  for (const s of map.values())
    if (s.rating === null) {
      const rated = reviews.filter((r) => r.source === s.id && r.rating !== null);
      s.rating = rated.length ? Math.round((rated.reduce((a, r) => a + (r.rating as number), 0) / rated.length) * 10) / 10 : null;
    }
  return [...map.values()].sort((a, b) => (b.total ?? b.count) - (a.total ?? a.count));
}

/** Pasa las respuestas escritas (borradores y copiadas) de las reseñas de antes a las nuevas. */
export function carryWebDrafts(next: WebReview[], prev: WebReview[]): WebReview[] {
  const old = new Map(prev.map((r) => [r.id, r]));
  return next.map((r) => {
    const o = old.get(r.id);
    if (!o || r.ownerAnswer) return r;
    return { ...r, ...(o.draft ? { draft: o.draft, draftAt: o.draftAt } : {}), ...(o.copiedAt ? { copiedAt: o.copiedAt } : {}) };
  });
}

/** Lee un reporte guardado sin confiar en su forma; null si no es válido. */
export function readWebReviewsReport(json: unknown): WebReviewsReport | null {
  const r = obj(json);
  if (r.version !== 1 || !Array.isArray(r.reviews)) return null;
  const reviews: WebReview[] = arr(r.reviews)
    .map(obj)
    .map((x) => {
      const base = reviewOf({
        id: str(x.id),
        source: { id: str(x.source) || "web", name: str(x.sourceName) || str(x.source) || "Web" },
        name: str(x.name),
        rating: num(x.rating),
        text: str(x.text),
        originalText: str(x.originalText),
        language: str(x.language),
        timestamp: parseDfsTime(x.timestamp),
        timeAgo: str(x.timeAgo),
        ownerAnswer: str(x.ownerAnswer),
        ownerTimestamp: parseDfsTime(x.ownerTimestamp),
        url: str(x.url),
      });
      const draft = str(x.draft).slice(0, 2000);
      const copiedAt = parseDfsTime(x.copiedAt);
      return { ...base, ...(draft ? { draft, draftAt: parseDfsTime(x.draftAt) } : {}), ...(copiedAt ? { copiedAt } : {}) };
    })
    .filter((x) => x.id);
  const sources: WebSource[] = arr(r.sources)
    .map(obj)
    .map((s) => ({ id: str(s.id), name: str(s.name), rating: num(s.rating), total: num(s.total), count: num(s.count) ?? 0, url: /^https?:\/\//i.test(str(s.url)) ? str(s.url) : "" }))
    .filter((s) => s.id);
  return {
    version: 1,
    sources,
    reviews,
    stats: reviewStats(reviews),
    tripadvisorPath: str(r.tripadvisorPath).slice(0, 300),
    trustpilotDomain: str(r.trustpilotDomain).slice(0, 200),
    notes: arr(r.notes)
      .map(obj)
      .filter((n) => typeof n.es === "string" && typeof n.en === "string")
      .map((n) => ({ es: n.es as string, en: n.en as string })),
    cost: num(r.cost) ?? 0,
    createdAt: str(r.createdAt),
  };
}

// ---------- Tareas pendientes ----------

export type WebTasks = { extended?: string; trustpilot?: string; tripadvisor?: string };

/** Las tareas siguen en la cola de DataForSEO: se guardan sus ids para no pagar otra vez. */
export class WebReviewsPendingError extends BiError {
  constructor(
    readonly tasks: WebTasks,
    readonly cost: number,
  ) {
    super(
      "Los sitios todavía están juntando tus reseñas. Vuelve a presionar «Traer reseñas» en un minuto: no se cobra otra vez.",
      "The sites are still gathering your reviews. Press “Get reviews” again in a minute: you won't be charged again.",
    );
  }
}

/** Lee las tareas pendientes guardadas (si tienen menos de 1 día). */
export function readWebTasks(json: unknown, now = Date.now()): { tasks: WebTasks; cost: number } | null {
  const r = obj(json);
  const at = Date.parse(str(r.createdAt));
  if (!at || now - at > 24 * 3600_000) return null;
  const t = obj(r.tasks);
  const tasks: WebTasks = {};
  for (const k of ["extended", "trustpilot", "tripadvisor"] as const) if (/^[\w-]{10,80}$/.test(str(t[k]))) tasks[k] = str(t[k]);
  return Object.keys(tasks).length ? { tasks, cost: num(r.cost) ?? 0 } : null;
}

// ---------- Llamadas ----------

type TaskFn = typeof dfsTask;
export type WebApi = { task: TaskFn; sleep: (ms: number) => Promise<void>; now: () => number };
const defaultApi: WebApi = { task: dfsTask, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now };
const PENDING = new Set([40601, 40602]);
const POLL_MS = 4_000;
const WAIT_MS = 120_000;

export type WebFetchInput = {
  place: Pick<MapPlace, "title" | "cid" | "placeId" | "lat" | "lng"> | null;
  zone: Zone | null;
  lang: "es" | "en";
  website: string;
  tripadvisorPath: string;
  resume?: WebTasks;
};

/** Pide las reseñas a cada fuente (o sigue esperando las tareas ya pagadas) y espera hasta ~2 minutos. */
export async function fetchWebReviews(input: WebFetchInput, api: WebApi = defaultApi): Promise<{ reviews: WebReview[]; direct: Record<string, { rating: number | null; total: number | null; url: string }>; notes: BiText[]; cost: number; trustpilotDomain: string }> {
  const start = api.now();
  const notes: BiText[] = [];
  const tasks: WebTasks = { ...(input.resume ?? {}) };
  let cost = 0;
  const trustpilotDomain = normalizeDomain(input.website) ?? "";
  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const r = await api.task("POST", path, body);
    if (r.statusCode !== 20100 && r.statusCode !== 20000) throw dfsError(r.statusCode, r.statusMessage);
    if (!r.id) throw bi("DataForSEO no devolvió el número de la tarea.", "DataForSEO didn't return the task id.");
    cost += r.cost;
    return r.id;
  };
  if (!input.resume) {
    const where = input.zone?.code ? { location_code: input.zone.code } : input.place ? { location_coordinate: `${input.place.lat},${input.place.lng},5000` } : null;
    const target = input.place?.cid ? { cid: input.place.cid } : input.place?.placeId ? { place_id: input.place.placeId } : null;
    const jobs: Promise<void>[] = [];
    if (target && where)
      jobs.push(
        post("/business_data/google/extended_reviews/task_post", { ...target, ...where, language_code: input.lang, depth: EXTENDED_DEPTH, priority: 2 }).then(
          (id) => void (tasks.extended = id),
          () => void notes.push({ es: "No se pudieron pedir las reseñas de la web que muestra Google.", en: "Couldn't request the web reviews Google shows." }),
        ),
      );
    else notes.push({ es: "Para ver las reseñas de Yelp, Facebook y otros sitios, elige tu negocio en «Mapa de calor en Google Maps».", en: "To see reviews from Yelp, Facebook and other sites, pick your business in “Google Maps heatmap”." });
    if (trustpilotDomain)
      jobs.push(
        post("/business_data/trustpilot/reviews/task_post", { domain: trustpilotDomain, depth: TRUSTPILOT_DEPTH, sort_by: "recency", priority: 2 }).then(
          (id) => void (tasks.trustpilot = id),
          () => void notes.push({ es: "No se pudieron pedir las reseñas de Trustpilot.", en: "Couldn't request the Trustpilot reviews." }),
        ),
      );
    if (input.tripadvisorPath)
      jobs.push(
        post("/business_data/tripadvisor/reviews/task_post", { url_path: input.tripadvisorPath, depth: TRIPADVISOR_DEPTH, priority: 2 }).then(
          (id) => void (tasks.tripadvisor = id),
          () => void notes.push({ es: "No se pudieron pedir las reseñas de Tripadvisor.", en: "Couldn't request the Tripadvisor reviews." }),
        ),
      );
    await Promise.all(jobs);
    if (!Object.keys(tasks).length) throw bi("No hay de dónde traer reseñas todavía: elige tu negocio en el mapa de calor o agrega tu página web.", "There's nowhere to get reviews from yet: pick your business in the heatmap or add your website.");
  }
  const paths: Record<keyof WebTasks, string> = {
    extended: "/business_data/google/extended_reviews/task_get/",
    trustpilot: "/business_data/trustpilot/reviews/task_get/",
    tripadvisor: "/business_data/tripadvisor/reviews/task_get/",
  };
  const done: Partial<Record<keyof WebTasks, unknown[] | null>> = {};
  for (;;) {
    await api.sleep(POLL_MS);
    const left = (Object.keys(tasks) as (keyof WebTasks)[]).filter((k) => !(k in done));
    await Promise.all(
      left.map(async (k) => {
        const r = await api.task<unknown>("GET", `${paths[k]}${encodeURIComponent(tasks[k] as string)}`, undefined, 30_000);
        if (r.statusCode === 20000) done[k] = r.result;
        else if (r.statusCode === 40102) done[k] = null;
        else if (!PENDING.has(r.statusCode)) {
          done[k] = null;
          notes.push({ es: `Un sitio no respondió: ${r.statusMessage}`, en: `A site didn't answer: ${r.statusMessage}` });
        }
      }),
    );
    if ((Object.keys(tasks) as (keyof WebTasks)[]).every((k) => k in done)) break;
    if (api.now() - start + POLL_MS > WAIT_MS) {
      // Se guardan todas: las que ya llegaron se vuelven a leer gratis al reanudar (task_get no cobra).
      throw new WebReviewsPendingError(tasks, Math.round(cost * 10000) / 10000);
    }
  }
  const direct: Record<string, { rating: number | null; total: number | null; url: string }> = {};
  const lists: WebReview[][] = [];
  if (done.extended) lists.push(parseExtended(done.extended));
  if (done.trustpilot) {
    const p = parseDirect(done.trustpilot, { id: "trustpilot", name: "Trustpilot" });
    lists.push(p.reviews);
    if (p.total) direct.trustpilot = { rating: p.rating, total: p.total, url: `https://www.trustpilot.com/review/${trustpilotDomain}` };
  }
  if (done.tripadvisor) {
    const p = parseDirect(done.tripadvisor, { id: "tripadvisor", name: "Tripadvisor" });
    lists.push(p.reviews);
    direct.tripadvisor = { rating: p.rating, total: p.total, url: `https://www.tripadvisor.com/${input.tripadvisorPath}` };
  }
  return { reviews: mergeWebReviews(...lists), direct, notes, cost: Math.round(cost * 10000) / 10000, trustpilotDomain };
}
