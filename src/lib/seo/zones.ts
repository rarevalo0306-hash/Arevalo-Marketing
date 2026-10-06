// Ayudantes puros para trabajar con varias zonas de Google (Business.seoLocations, hasta 5).
// Cada reporte guardado ("keywords", "rank") es de UNA zona y trae su locationCode.
import type { Zone } from "@/lib/seo/dataforseo";

/**
 * Reparte los reportes (del más nuevo al más viejo) por zona, manteniendo ese orden.
 * Los reportes sin código de zona (0, muy viejos) cuentan como de la zona principal.
 * Los de zonas que ya no están elegidas se ignoran.
 */
export function groupByZone<R extends { locationCode: number }>(reports: (R | null | undefined)[], zones: Zone[]): Map<number, R[]> {
  const out = new Map<number, R[]>(zones.map((z) => [z.code, []]));
  const main = zones[0]?.code;
  for (const r of reports) {
    if (!r) continue;
    const code = r.locationCode > 0 ? r.locationCode : main;
    if (code === undefined) continue;
    out.get(code)?.push(r);
  }
  return out;
}

/** El reporte más reciente de cada zona (solo las zonas que tienen alguno). */
export function latestByZone<R extends { locationCode: number }>(reports: (R | null | undefined)[], zones: Zone[]): Map<number, R> {
  const out = new Map<number, R>();
  for (const [code, list] of groupByZone(reports, zones)) if (list[0]) out.set(code, list[0]);
  return out;
}

/** Las zonas que todavía no tienen reporte. */
export function zonesWithout(zones: Zone[], have: Map<number, unknown>): Zone[] {
  return zones.filter((z) => !have.has(z.code));
}
