// «¿Se movió Google?» (como «Semrush Sensor», pero con TUS búsquedas): cuánto cambiaron los 5 primeros de Google
// entre una revisión de posiciones y la anterior, en una nota de 0 a 10. Si bajaste el mismo día que Google se movió
// mucho para todos, probablemente fue un cambio de Google y conviene esperar unos días antes de cambiar la página.
// Gratis: usa las revisiones de posiciones ya guardadas (rank.ts guarda los 5 primeros de cada búsqueda). Puro.
import type { RankReport, RankRow } from "@/lib/seo/rank";

/** Lugar que se usa para «ya no está entre los 5 primeros». */
const OUT = 6;
/** El cambio más grande posible: los 5 primeros cambian por completo (2 × (5 + 4 + 3 + 2 + 1)). */
const MAX_CHANGE = 30;

export type SensorLevel = "calm" | "normal" | "high" | "very-high";

export type SensorMove = {
  keyword: string;
  /** 0 a 10: cuánto cambiaron los 5 primeros de esta búsqueda. */
  score: number;
  /** Páginas que entraron a los 5 primeros y las que salieron. */
  entered: string[];
  left: string[];
};

export type SensorPoint = {
  /** La revisión nueva (ISO) y cuántos días pasaron desde la anterior. */
  at: string;
  days: number;
  /** 0 a 10: el promedio de todas las búsquedas comparables. */
  score: number;
  /** Cuántas búsquedas se pudieron comparar. */
  keywords: number;
  /** Las búsquedas que más se movieron (máx. 3). */
  moved: SensorMove[];
};

const domainsOf = (row: Pick<RankRow, "top">) => new Map(row.top.filter((x) => x.domain && x.position >= 1 && x.position <= 5).map((x) => [x.domain, x.position]));

/** Cuánto cambiaron los 5 primeros de una búsqueda entre dos revisiones (0 a 10). null si alguna no tiene resultados. */
export function serpChange(prev: Pick<RankRow, "top">, cur: Pick<RankRow, "top">): SensorMove["score"] | null {
  const a = domainsOf(prev);
  const b = domainsOf(cur);
  if (!a.size || !b.size) return null;
  let sum = 0;
  for (const d of new Set([...a.keys(), ...b.keys()])) sum += Math.abs((a.get(d) ?? OUT) - (b.get(d) ?? OUT));
  return Math.round(Math.min(1, sum / MAX_CHANGE) * 100) / 10;
}

/** Qué páginas entraron y cuáles salieron de los 5 primeros. */
export function serpMoves(prev: Pick<RankRow, "top">, cur: Pick<RankRow, "top">): { entered: string[]; left: string[] } {
  const a = domainsOf(prev);
  const b = domainsOf(cur);
  return { entered: [...b.keys()].filter((d) => !a.has(d)), left: [...a.keys()].filter((d) => !b.has(d)) };
}

/** Tranquilo (menos de 2), normal (2 a 5), movido (5 a 8) o muy movido (8 o más), como Semrush Sensor. */
export function sensorLevel(score: number): SensorLevel {
  return score < 2 ? "calm" : score < 5 ? "normal" : score < 8 ? "high" : "very-high";
}

/** [estilo de la píldora, español, inglés]. */
export const SENSOR_LABEL: Record<SensorLevel, [string, string, string]> = {
  calm: ["done", "Tranquilo", "Calm"],
  normal: ["draft", "Normal", "Normal"],
  high: ["partial", "Movido", "Shaky"],
  "very-high": ["failed", "Muy movido", "Very shaky"],
};

const DAY = 86_400_000;

/**
 * Un punto por cada par de revisiones seguidas de la misma zona (del más viejo al más nuevo). `reports` va del más
 * nuevo al más viejo, como los devuelve latestReports.
 */
export function sensorPoints(reports: Pick<RankReport, "rows" | "createdAt">[]): SensorPoint[] {
  const list = [...reports].sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt));
  const out: SensorPoint[] = [];
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const cur = list[i];
    const before = new Map(prev.rows.filter((r) => !r.error).map((r) => [r.keyword.toLowerCase(), r]));
    const moves: SensorMove[] = [];
    for (const row of cur.rows) {
      if (row.error) continue;
      const p = before.get(row.keyword.toLowerCase());
      if (!p) continue;
      const score = serpChange(p, row);
      if (score === null) continue;
      moves.push({ keyword: row.keyword, score, ...serpMoves(p, row) });
    }
    if (!moves.length) continue;
    const score = Math.round((moves.reduce((s, m) => s + m.score, 0) / moves.length) * 10) / 10;
    out.push({
      at: cur.createdAt,
      days: Math.max(0, Math.round((Date.parse(cur.createdAt) - Date.parse(prev.createdAt)) / DAY)),
      score,
      keywords: moves.length,
      moved: moves
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3),
    });
  }
  return out;
}

/**
 * Lo que quiere decir para el dueño: si Google se movió mucho y bajaste, espera; si estuvo tranquilo y bajaste, el
 * cambio es tuyo o de tu competencia.
 */
export function sensorAdvice(point: SensorPoint, youDropped: boolean): { es: string; en: string } {
  const level = sensorLevel(point.score);
  if ((level === "high" || level === "very-high") && youDropped)
    return {
      es: "Google se movió mucho para todos en tus búsquedas. Si bajaste, puede ser un cambio de Google: espera unos días antes de cambiar tu página.",
      en: "Google moved a lot for everyone on your searches. If you dropped, it may be a Google change: wait a few days before changing your website.",
    };
  if (level === "high" || level === "very-high")
    return {
      es: "Google se movió mucho en tus búsquedas. Vigila tus posiciones en la próxima revisión.",
      en: "Google moved a lot on your searches. Keep an eye on your rankings in the next check.",
    };
  const how = level === "calm" ? { es: "estuvo tranquilo", en: "was calm" } : { es: "se movió lo normal", en: "moved a normal amount" };
  if (youDropped)
    return {
      es: `Google ${how.es} pero bajaste: probablemente un competidor mejoró su página o la tuya cambió. Revisa «¿Quién está arriba de ti?».`,
      en: `Google ${how.en} but you dropped: probably a competitor improved their page or yours changed. Check “Who is above you?”.`,
    };
  return { es: `Google ${how.es} en tus búsquedas: los cambios que veas son por lo que hacen tú y tu competencia.`, en: `Google ${how.en} on your searches: any changes you see come from what you and your competitors do.` };
}
