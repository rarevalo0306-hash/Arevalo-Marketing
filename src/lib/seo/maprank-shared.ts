// Lo del mapa de calor que también usa el navegador: tipos, opciones, costo y colores.
// Sin dependencias (no importa la base de datos), para poder usarlo en componentes "use client".
// La lógica que llama a Google Maps está en src/lib/seo/maprank.ts (que reexporta todo esto).

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

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Costo estimado de un mapa (USD): una búsqueda por punto. */
export function mapCostEstimate(size: number): number {
  return round4(size * size * MAP_COST_PER_POINT);
}

export const isMapSize = (n: number): n is MapSize => (MAP_SIZES as readonly number[]).includes(n);
export const isMapSpacing = (n: number) => (MAP_SPACINGS as readonly number[]).includes(n);

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

/** Las imágenes del mapa (tiles) que usa Leaflet. */
export type MapTiles = { url: string; attribution: string; subdomains: string; maxZoom: number };

/**
 * CARTO Voyager (mapa claro y limpio). Desde el 23 de septiembre de 2026 CARTO pide una clave gratis
 * (https://carto.com/basemaps/apikey, se pone como ?key=...); sin clave sus mapas salen con una marca de agua
 * "API key required". Sin clave se usa el mapa estándar de OpenStreetMap.
 */
export function mapTiles(cartoKey: string | null | undefined): MapTiles {
  const key = (cartoKey ?? "").trim();
  const osm = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
  if (key)
    return {
      url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`,
      attribution: `${osm} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>`,
      subdomains: "abcd",
      maxZoom: 20,
    };
  return { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: osm, subdomains: "", maxZoom: 19 };
}
