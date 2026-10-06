// Mapa de calor en Google Maps (como Local Falcon o el Map Rank Tracker de Semrush): para una palabra clave se arma
// una cuadrícula de puntos alrededor del negocio y, en cada punto, se busca en Google Maps como si alguien buscara
// desde ahí. El número de cada punto es el lugar del negocio en esa búsqueda.
//
// DataForSEO SERP API, Google Maps, modo live: https://docs.dataforseo.com/v3/serp/google/maps/live/advanced/
// - `location_coordinate` = "latitud,longitud,zoom" (máx. 7 decimales; zoom de 3z a 21z; si no se da, 17z).
// - En celular Google Maps devuelve como mucho 20 resultados.
// - Precio (https://dataforseo.com/pricing/serp/google-maps-serp-api): live = US$0.002 por búsqueda
//   (se cobra por cada "página" de hasta 100 resultados; con depth 20 es una sola). Cada punto es una búsqueda.
import { bi } from "@/lib/i18n";
import { dfsPost, type DfsResult, type Zone } from "@/lib/seo/dataforseo";
import { biOf, domainMatches, normalizeName, pool, siteDomain } from "@/lib/seo/rank";

/** Tamaños de cuadrícula: 3×3, 5×5 o 7×7 puntos. */
export const MAP_SIZES = [3, 5, 7] as const;
export type MapSize = (typeof MAP_SIZES)[number];
/** Distancia entre puntos (km). */
export const MAP_SPACINGS = [0.5, 1, 2, 3, 5] as const;
/** Resultados por búsqueda: en celular Google Maps da máximo 20. */
export const MAP_DEPTH = 20;
/** Costo de cada búsqueda en Google Maps, modo live (USD). */
export const MAP_COST_PER_POINT = 0.002;
/** Los clientes locales buscan desde el celular. */
export const MAP_DEVICE = "mobile" as const;
/** Lugar que se usa en el promedio cuando el negocio no sale en los 20 primeros (como el ARP de Local Falcon). */
export const NOT_FOUND_RANK = MAP_DEPTH + 1;
/** Cuántos mapas guardados se conservan por negocio. */
export const MAP_KEEP = 30;

const CONCURRENCY = 8;
const CALL_TIMEOUT_MS = 60_000;
/** La página tiene maxDuration 300 s: después de esto ya no se empiezan búsquedas nuevas. */
const RUN_BUDGET_MS = 230_000;

export type LatLng = { lat: number; lng: number };

/** El negocio en Google Maps (Business.seoMapPlace). */
export type MapPlace = {
  title: string;
  cid: string;
  placeId: string;
  featureId: string;
  address: string;
  lat: number;
  lng: number;
  domain: string;
  rating: number | null;
  reviews: number | null;
};

/** Un negocio en los resultados de Google Maps. */
export type MapItem = MapPlace & { rank: number; category: string; url: string };

export type MapTop = { title: string; rank: number; cid?: string };
export type MapPoint = {
  lat: number;
  lng: number;
  /** Lugar del negocio en ese punto. null = no sale en los 20 primeros. */
  rank: number | null;
  /** Los 3 primeros negocios en ese punto. */
  top3: MapTop[];
  error?: { es: string; en: string };
};
export type MapCompetitor = { title: string; cid?: string; points: number; avgRank: number };

export type MapReport = {
  keyword: string;
  place: { title: string; cid: string };
  center: LatLng;
  size: number;
  spacingKm: number;
  zoom: number;
  language: string;
  /** Fila por fila, de norte a sur y de oeste a este. */
  points: MapPoint[];
  /** Lugar promedio (los puntos donde no sale cuentan como 21). null si ningún punto se pudo revisar. */
  avgRank: number | null;
  /** % de los puntos revisados donde sale en los 3 primeros (0-100). */
  top3Share: number;
  /** En cuántos puntos sale (en los 20 primeros). */
  found: number;
  competitors: MapCompetitor[];
  cost: number;
  createdAt: string;
};

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

// ---------- Cuadrícula ----------

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG_EQUATOR = 111.32;

/**
 * Puntos de la cuadrícula (size × size) centrados en el negocio, separados `spacingKm` km.
 * Fila por fila de norte a sur, y en cada fila de oeste a este; el punto del medio es el negocio.
 * Los grados de longitud se achican lejos del ecuador (× cos(latitud)).
 */
export function gridPoints(center: LatLng, size: number, spacingKm: number): LatLng[] {
  const n = Math.max(1, Math.floor(size));
  const half = (n - 1) / 2;
  const dLat = spacingKm / KM_PER_DEG_LAT;
  const cos = Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  const dLng = spacingKm / (KM_PER_DEG_LNG_EQUATOR * cos);
  const out: LatLng[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      out.push({ lat: round(center.lat + (half - r) * dLat, 7), lng: round(center.lng + (c - half) * dLng, 7) });
    }
  }
  return out;
}

/** Distancia en km entre dos puntos (fórmula de haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371.0088;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Zoom del mapa de Google para cada búsqueda. Google Maps busca "en esta zona": lo que se ve en la pantalla.
 * Un celular (~400 px de ancho) muestra ≈ 400 × 156 543 m × cos(lat) / 2^zoom de ancho:
 * en Managua o Miami ≈ 1.9 km a 15z, ≈ 3.8 km a 14z y ≈ 7.6 km a 13z. Se elige el zoom con el que cada punto
 * "ve" más o menos su propio pedazo de la cuadrícula (y un poco de los vecinos), como alguien que busca en su barrio:
 * 0.5-1 km → 15z, 2 km → 14z, 3-5 km → 13z.
 */
export function zoomFor(spacingKm: number): number {
  if (spacingKm <= 1) return 15;
  if (spacingKm <= 2) return 14;
  return 13;
}

/** "12.1364,-86.2514,15z" (máximo 7 decimales, como pide DataForSEO). */
export function coordinate(p: LatLng, zoom: number): string {
  const fix = (n: number) => String(round(n, 7));
  return `${fix(p.lat)},${fix(p.lng)},${Math.min(21, Math.max(3, Math.round(zoom)))}z`;
}

/** Costo estimado de un mapa (USD): una búsqueda por punto. */
export function mapCostEstimate(size: number): number {
  return round(size * size * MAP_COST_PER_POINT, 4);
}

export const isMapSize = (n: number): n is MapSize => (MAP_SIZES as readonly number[]).includes(n);
export const isMapSpacing = (n: number) => (MAP_SPACINGS as readonly number[]).includes(n);

// ---------- Lectura de la respuesta de Google Maps ----------

type RawMapsItem = {
  type?: string;
  rank_group?: number;
  rank_absolute?: number;
  title?: string;
  domain?: string;
  url?: string;
  cid?: string | number;
  place_id?: string;
  feature_id?: string;
  category?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  rating?: { value?: number; votes_count?: number } | null;
};
export type MapsResult = { keyword?: string; items?: RawMapsItem[] | null };

/** Los negocios de una respuesta de Google Maps, del 1° al último. Ignora lo que no sea un negocio. */
export function parseMapsItems(result: MapsResult | null | undefined): MapItem[] {
  const items = Array.isArray(result?.items) ? result.items : [];
  return items
    .filter((i): i is RawMapsItem => !!i && typeof i === "object" && (i.type === undefined || i.type === "maps_search"))
    .map((i): MapItem | null => {
      const rank = num(i.rank_group) ?? num(i.rank_absolute);
      const title = str(i.title).trim();
      if (rank === null || rank < 1 || !title) return null;
      const rating = i.rating && typeof i.rating === "object" ? i.rating : null;
      return {
        rank,
        title,
        cid: str(i.cid),
        placeId: str(i.place_id),
        featureId: str(i.feature_id),
        address: str(i.address),
        lat: num(i.latitude) ?? 0,
        lng: num(i.longitude) ?? 0,
        domain: siteDomain(str(i.domain) || str(i.url)),
        url: str(i.url),
        category: str(i.category),
        rating: num(rating?.value),
        reviews: num(rating?.votes_count),
      };
    })
    .filter((i): i is MapItem => i !== null)
    .sort((a, b) => a.rank - b.rank);
}

/**
 * Páginas que usan muchos negocios distintos (Facebook, Instagram, sitios gratis de Google…): que dos negocios
 * tengan "facebook.com" no quiere decir que sean el mismo, así que no sirven para reconocer al negocio.
 */
const SHARED_DOMAINS = new Set([
  "facebook.com",
  "fb.com",
  "instagram.com",
  "wa.me",
  "whatsapp.com",
  "api.whatsapp.com",
  "linktr.ee",
  "google.com",
  "goo.gl",
  "g.page",
  "business.site",
  "sites.google.com",
  "youtube.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "yelp.com",
  "wix.com",
  "wixsite.com",
  "godaddysites.com",
  "square.site",
  "blogspot.com",
  "wordpress.com",
]);

/** ¿Este dominio sirve para reconocer al negocio? (no vacío y no una red social o un sitio compartido). */
export function ownDomain(domain: string | null | undefined): string {
  const d = siteDomain(domain);
  if (!d) return "";
  for (const shared of SHARED_DOMAINS) if (d === shared || d.endsWith(`.${shared}`)) return "";
  return d;
}

/**
 * El lugar del negocio en los resultados de un punto: primero por cid (el número de Google del negocio), luego por
 * place_id / feature_id, luego por la página web (mismo dominio) y por último por el nombre (igual, sin acentos ni
 * "LLC/S.A."). null si no sale en los 20 primeros.
 */
export function findRank(items: MapItem[], place: Pick<MapPlace, "title" | "cid" | "placeId" | "featureId" | "domain">, website = ""): number | null {
  const by = (pred: (i: MapItem) => boolean) => items.find(pred)?.rank ?? null;
  if (place.cid) {
    const r = by((i) => i.cid === place.cid);
    if (r !== null) return r;
  }
  if (place.placeId || place.featureId) {
    const r = by((i) => (!!place.placeId && i.placeId === place.placeId) || (!!place.featureId && i.featureId === place.featureId));
    if (r !== null) return r;
  }
  const domains = [ownDomain(place.domain), ownDomain(website)].filter(Boolean);
  if (domains.length) {
    const r = by((i) => !!ownDomain(i.domain) && domains.some((d) => domainMatches(i.domain, d)));
    if (r !== null) return r;
  }
  const name = normalizeName(place.title);
  if (name) {
    const r = by((i) => normalizeName(i.title) === name);
    if (r !== null) return r;
  }
  return null;
}

// ---------- Resumen ----------

/** Lugar promedio, % del mapa en el top 3, en cuántos puntos sale y quién te gana. Los puntos con error no cuentan. */
export function summarizeMap(points: MapPoint[], place: { title: string; cid: string }): Pick<MapReport, "avgRank" | "top3Share" | "found" | "competitors"> {
  const ok = points.filter((p) => !p.error);
  const ranks = ok.map((p) => (p.rank === null ? NOT_FOUND_RANK : p.rank));
  const avgRank = ranks.length ? round(ranks.reduce((s, r) => s + r, 0) / ranks.length, 1) : null;
  const top3 = ok.filter((p) => p.rank !== null && p.rank <= 3).length;
  const found = ok.filter((p) => p.rank !== null).length;

  // Quién sale en los 3 primeros en más puntos (sin contar al negocio).
  const own = normalizeName(place.title);
  const tally = new Map<string, { title: string; cid?: string; points: number; sum: number }>();
  for (const p of ok) {
    for (const t of p.top3) {
      if (t.rank === p.rank) continue;
      if (place.cid && t.cid && t.cid === place.cid) continue;
      if (!t.cid && own && normalizeName(t.title) === own) continue;
      const key = t.cid ? `cid:${t.cid}` : `t:${normalizeName(t.title)}`;
      const cur = tally.get(key) ?? { title: t.title, ...(t.cid ? { cid: t.cid } : {}), points: 0, sum: 0 };
      cur.points += 1;
      cur.sum += t.rank;
      tally.set(key, cur);
    }
  }
  const competitors = [...tally.values()]
    .map((c) => ({ title: c.title, ...(c.cid ? { cid: c.cid } : {}), points: c.points, avgRank: round(c.sum / c.points, 1) }))
    .sort((a, b) => b.points - a.points || a.avgRank - b.avgRank || a.title.localeCompare(b.title))
    .slice(0, 10);

  return { avgRank, top3Share: ok.length ? Math.round((top3 / ok.length) * 100) : 0, found, competitors };
}

/** Color de un punto: verde 1-3, verde-amarillo 4-7, naranja 8-10, rojo 11-20, gris si no sale, "!" si falló. */
export type RankBand = "top3" | "good" | "mid" | "low" | "none" | "error";
export function rankBand(rank: number | null, error?: unknown): RankBand {
  if (error) return "error";
  if (rank === null) return "none";
  if (rank <= 3) return "top3";
  if (rank <= 7) return "good";
  if (rank <= 10) return "mid";
  return "low";
}

// ---------- Lectura segura de lo guardado ----------

/** Lee Business.seoMapPlace sin confiar en su forma. null si no tiene nombre o ubicación. */
export function readMapPlace(json: unknown): MapPlace | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const title = str(o.title).trim().slice(0, 200);
  const lat = num(o.lat);
  const lng = num(o.lng);
  if (!title || lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    title,
    cid: str(o.cid).slice(0, 40),
    placeId: str(o.placeId).slice(0, 200),
    featureId: str(o.featureId).slice(0, 200),
    address: str(o.address).slice(0, 300),
    lat,
    lng,
    domain: siteDomain(str(o.domain)),
    rating: num(o.rating),
    reviews: num(o.reviews),
  };
}

const readError = (err: unknown): { es: string; en: string } | undefined =>
  typeof err === "string"
    ? { es: err, en: err }
    : err && typeof err === "object" && typeof (err as { es?: unknown }).es === "string"
      ? { es: (err as { es: string }).es, en: str((err as { en?: unknown }).en) || (err as { es: string }).es }
      : err
        ? { es: "Falló", en: "Failed" }
        : undefined;

/** Lee un mapa guardado sin confiar en su forma. null si no es un mapa válido. */
export function readMapReport(json: unknown): MapReport | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const keyword = str(o.keyword).trim();
  if (!keyword || !Array.isArray(o.points)) return null;
  const points: MapPoint[] = [];
  for (const raw of o.points) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const lat = num(p.lat);
    const lng = num(p.lng);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const rank = num(p.rank);
    const error = readError(p.error);
    points.push({
      lat,
      lng,
      rank: rank !== null && rank >= 1 ? rank : null,
      top3: Array.isArray(p.top3)
        ? p.top3
            .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
            .map((t) => ({ title: str(t.title), rank: num(t.rank) ?? 0, ...(str(t.cid) ? { cid: str(t.cid) } : {}) }))
            .filter((t) => t.title && t.rank > 0)
            .slice(0, 3)
        : [],
      ...(error ? { error } : {}),
    });
  }
  if (!points.length) return null;
  const placeRaw = o.place && typeof o.place === "object" ? (o.place as Record<string, unknown>) : {};
  const place = { title: str(placeRaw.title), cid: str(placeRaw.cid) };
  const centerRaw = o.center && typeof o.center === "object" ? (o.center as Record<string, unknown>) : {};
  const mid = points[Math.floor(points.length / 2)];
  const center = { lat: num(centerRaw.lat) ?? mid.lat, lng: num(centerRaw.lng) ?? mid.lng };
  const sizeRaw = num(o.size);
  const size = sizeRaw !== null && sizeRaw >= 1 ? Math.round(sizeRaw) : Math.round(Math.sqrt(points.length));
  const s = summarizeMap(points, place);
  const created = str(o.createdAt);
  return {
    keyword,
    place,
    center,
    size,
    spacingKm: num(o.spacingKm) ?? 1,
    zoom: num(o.zoom) ?? zoomFor(num(o.spacingKm) ?? 1),
    language: str(o.language) || "es",
    points,
    // El resumen se vuelve a calcular con los puntos que sí se pudieron leer.
    ...s,
    cost: num(o.cost) ?? 0,
    createdAt: created && !Number.isNaN(Date.parse(created)) ? created : new Date(0).toISOString(),
  };
}

// ---------- Búsquedas ----------

type Post = <T>(path: string, task: Record<string, unknown>, timeoutMs?: number) => Promise<DfsResult<T>>;

/** Un negocio que podría ser el del dueño, con su lugar en la búsqueda. */
export type MapCandidate = MapItem & { matchesWebsite: boolean };

/** Busca el negocio por su nombre en Google Maps en la zona principal: hasta 10 opciones para que el dueño elija. */
export async function findMapPlaces(
  input: { query: string; zone: Zone; language: string; website: string },
  post: Post = dfsPost,
): Promise<{ candidates: MapCandidate[]; cost: number }> {
  const r = await post<MapsResult>(
    "/serp/google/maps/live/advanced",
    { keyword: input.query, location_code: input.zone.code, language_code: input.language, device: MAP_DEVICE, depth: MAP_DEPTH },
    CALL_TIMEOUT_MS,
  );
  const own = ownDomain(input.website);
  const candidates = parseMapsItems(r.result[0])
    .filter((i) => i.lat !== 0 || i.lng !== 0)
    .slice(0, 10)
    .map((i) => ({ ...i, matchesWebsite: !!own && !!ownDomain(i.domain) && domainMatches(i.domain, own) }));
  return { candidates, cost: r.cost };
}

/** Lo que se guarda del negocio elegido. */
export const toMapPlace = (i: MapPlace): MapPlace => ({
  title: i.title,
  cid: i.cid,
  placeId: i.placeId,
  featureId: i.featureId,
  address: i.address,
  lat: i.lat,
  lng: i.lng,
  domain: i.domain,
  rating: i.rating,
  reviews: i.reviews,
});

export type MapRunInput = {
  keyword: string;
  place: MapPlace;
  /** Página web del negocio (también sirve para reconocerlo). */
  website: string;
  size: number;
  spacingKm: number;
  language: string;
};

/**
 * Hace el mapa: una búsqueda en Google Maps (celular, 20 resultados) desde cada punto de la cuadrícula, con máximo
 * 8 a la vez. Si un punto falla queda marcado con error; si fallan todos, lanza el error.
 * 7×7 = 49 búsquedas ≈ 7 tandas de 8; cada búsqueda live tarda unos segundos (DataForSEO dice hasta 6 s),
 * así que suele terminar en menos de un minuto. Pasados ~230 s ya no se empiezan búsquedas nuevas.
 */
export async function runMapGrid(input: MapRunInput, post: Post = dfsPost, now: () => number = Date.now): Promise<MapReport> {
  const size = isMapSize(input.size) ? input.size : 5;
  const spacingKm = isMapSpacing(input.spacingKm) ? input.spacingKm : 1;
  const zoom = zoomFor(spacingKm);
  const center = { lat: input.place.lat, lng: input.place.lng };
  const grid = gridPoints(center, size, spacingKm);
  const start = now();
  const results = await pool(grid, CONCURRENCY, async (p): Promise<{ point: MapPoint; cost: number }> => {
    const left = RUN_BUDGET_MS - (now() - start);
    if (left < 5_000) {
      return { point: { ...p, rank: null, top3: [], error: { es: "No alcanzó el tiempo para este punto.", en: "Ran out of time for this point." } }, cost: 0 };
    }
    try {
      const r = await post<MapsResult>(
        "/serp/google/maps/live/advanced",
        {
          keyword: input.keyword,
          location_coordinate: coordinate(p, zoom),
          language_code: input.language,
          device: MAP_DEVICE,
          depth: MAP_DEPTH,
        },
        Math.min(CALL_TIMEOUT_MS, left),
      );
      const items = parseMapsItems(r.result[0]);
      return {
        point: {
          ...p,
          rank: findRank(items, input.place, input.website),
          top3: items.slice(0, 3).map((i) => ({ title: i.title, rank: i.rank, ...(i.cid ? { cid: i.cid } : {}) })),
        },
        cost: r.cost,
      };
    } catch (e) {
      return { point: { ...p, rank: null, top3: [], error: biOf(e) }, cost: 0 };
    }
  });
  const points = results.map((r) => r.point);
  if (points.every((p) => p.error)) {
    const e = points[0].error ?? { es: "Falló", en: "Failed" };
    throw bi(e.es, e.en);
  }
  const place = { title: input.place.title, cid: input.place.cid };
  return {
    keyword: input.keyword,
    place,
    center,
    size,
    spacingKm,
    zoom,
    language: input.language,
    points,
    ...summarizeMap(points, place),
    cost: round(results.reduce((s, r) => s + r.cost, 0), 4),
    createdAt: new Date(now()).toISOString(),
  };
}

/** Palabra clave escrita por el dueño: sin espacios de más, máximo 80 letras. */
export const cleanKeyword = (k: unknown) => (typeof k === "string" ? k.replace(/\s+/g, " ").trim().slice(0, 80) : "");
