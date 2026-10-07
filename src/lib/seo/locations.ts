// Zonas de Google por país, con su "padre" (ciudad → estado → país), para escogerlas en cascada en Ajustes.
// Docs: docs.dataforseo.com/v3/keywords_data/google_ads/locations/ (gratis). La lista de un país es grande
// (Estados Unidos trae decenas de miles con los códigos postales) y casi no cambia: se guarda en memoria un día.
import { dfsGet, rankLocations, type DfsLocation } from "@/lib/seo/dataforseo";
import { PICKABLE_TYPES, type TreeLocation } from "@/lib/seo/setup-shared";

type ApiLocation = { location_code: number; location_name: string; location_code_parent: number | null; location_type: string; country_iso_code: string };

const cache = new Map<string, { at: number; list: TreeLocation[]; byParent: Map<number | null, TreeLocation[]> }>();
const loading = new Map<string, Promise<TreeLocation[]>>();
const DAY_MS = 24 * 3600_000;

const TYPE_ORDER: Record<string, number> = { Country: 0, State: 1, Department: 1, Province: 1, Region: 2, County: 3, Municipality: 4, City: 5, District: 6 };
const byTypeThenName = (a: TreeLocation, b: TreeLocation) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || a.name.localeCompare(b.name);

/** Todas las zonas de Google de un país (ISO de 2 letras). */
export async function countryLocations(iso: string): Promise<TreeLocation[]> {
  const key = iso.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(key)) return [];
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY_MS) return hit.list;
  const pending = loading.get(key);
  if (pending) return pending;
  const p = (async () => {
    const r = await dfsGet<ApiLocation>(`/keywords_data/google_ads/locations/${key}`, 90_000);
    const list = r.result.map((l) => ({ code: l.location_code, name: l.location_name, type: l.location_type, parent: l.location_code_parent ?? null }));
    const byParent = new Map<number | null, TreeLocation[]>();
    for (const l of list) {
      if (!PICKABLE_TYPES.has(l.type)) continue;
      const k = l.type === "Country" ? null : l.parent;
      byParent.set(k, [...(byParent.get(k) ?? []), l]);
    }
    for (const v of byParent.values()) v.sort(byTypeThenName);
    cache.set(key, { at: Date.now(), list, byParent });
    return list;
  })();
  loading.set(key, p);
  try {
    return await p;
  } finally {
    loading.delete(key);
  }
}

/**
 * Lo que hay dentro de una zona, para la siguiente lista de la cascada. parent = null → el país mismo.
 * Solo los tipos que se entienden (estados, condados, ciudades…); barrios y códigos postales salen con el buscador.
 */
export async function locationChildren(iso: string, parent: number | null): Promise<TreeLocation[]> {
  await countryLocations(iso);
  const c = cache.get(iso.trim().toLowerCase());
  return (c?.byParent.get(parent) ?? []).slice(0, 1500);
}

/** Busca por nombre dentro del país (incluye barrios y códigos postales). */
export async function searchCountry(iso: string, query: string, limit = 20): Promise<TreeLocation[]> {
  const list = await countryLocations(iso);
  // rankLocations devuelve los mismos objetos (filtra y ordena), así que conservan su "parent".
  const asDfs: (DfsLocation & { parent: number | null })[] = list.map((l) => ({ ...l, country: iso.toUpperCase() }));
  return (rankLocations(asDfs, query, limit) as (DfsLocation & { parent: number | null })[]).map((l) => ({ code: l.code, name: l.name, type: l.type, parent: l.parent }));
}

/**
 * La zona de Google que mejor corresponde a un lugar nombrado ("Miami-Dade County", tipo "County").
 * Prefiere el tipo pedido; si no, la más grande que se llame así.
 */
export async function findPlace(iso: string, name: string, type?: string): Promise<TreeLocation | null> {
  const found = (await searchCountry(iso, name, 40)).filter((l) => PICKABLE_TYPES.has(l.type));
  if (!found.length) {
    // "Miami-Dade County" → "Miami-Dade": Google a veces lo nombra sin la palabra del tipo.
    const short = name.replace(/\b(county|condado|city|ciudad|state|estado|department|departamento|province|provincia)\b/gi, "").replace(/\s+/g, " ").trim();
    if (short && short !== name) return findPlace(iso, short, type);
    return null;
  }
  return (type && found.find((l) => l.type === type)) || found[0];
}
