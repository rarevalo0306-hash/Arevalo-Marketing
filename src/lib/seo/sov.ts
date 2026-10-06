// "Tu parte del mercado" (share of voice): qué parte de los clics de Google, de los primeros lugares del mapa y de las
// menciones de las IAs se lleva el negocio frente a sus competidores. Todo se calcula con reportes YA GUARDADOS
// (posiciones "rank", palabras "keywords", mapa "maprank" e IAs "ai"): no llama a ninguna API y no cuesta nada.
// Son estimaciones, como el "share of voice" de Semrush Position Tracking y su AI Toolkit.
import { isDirectory, normalizeDomain } from "@/lib/seo/competitors";
import { type KeywordsReport, reportLookup } from "@/lib/seo/keywords";
import type { MapReport } from "@/lib/seo/maprank-shared";
import { domainMatches, normalizeName, type RankReport } from "@/lib/seo/rank";
import { rankCompetitors, type VisibilityReport, type VisibilityResult } from "@/lib/seo/visibility";
import { TEXT_PROVIDERS, type TextProvider } from "@/lib/ai";

// ---------- Curva de clics (CTR) por posición en Google ----------

/**
 * Qué parte de la gente que busca hace clic en cada lugar de los resultados normales de Google (estudios públicos de
 * CTR orgánico, redondeados; parecida a la que usa Semrush para su "share of voice"):
 * 1: 28 %, 2: 15 %, 3: 11 %, 4: 8 %, 5: 7 %, 6: 5 %, 7: 4 %, 8: 3 %, 9: 3 %, 10: 2.5 %,
 * 11-20: de 1 % a 0.3 % (bajando de a poco). Más abajo del 20: 0.
 */
export const CTR_CURVE: readonly number[] = [0.28, 0.15, 0.11, 0.08, 0.07, 0.05, 0.04, 0.03, 0.03, 0.025, 0.01, 0.009, 0.008, 0.007, 0.006, 0.005, 0.0045, 0.004, 0.0035, 0.003];

/** Clics esperados en un lugar (0 a 1). null, 0 o más abajo del 20 → 0. */
export function ctrAt(position: number | null | undefined): number {
  if (!position || position < 1) return 0;
  return CTR_CURVE[Math.floor(position) - 1] ?? 0;
}

/** Los clics que se reparten los primeros 20 resultados: el 100 % de "los clics posibles". */
export const CTR_TOTAL = CTR_CURVE.reduce((a, b) => a + b, 0);

/**
 * Peso de una búsqueda sin dato de Google (Google no da el número cuando casi nadie la busca): cuenta como 5 al mes.
 * Si ninguna búsqueda tiene dato, todas pesan lo mismo.
 */
export const LOW_VOLUME_WEIGHT = 5;

/** Cuántos competidores se muestran en cada bloque. */
export const SHARE_TOP = 5;

// ---------- Tipos ----------

/** Una parte del total. share: 0 a 1. */
export type ShareSlice = { key: string; label: string; share: number };

export type OrganicShare = {
  /** Tu parte de los clics posibles (0 a 1). */
  you: number;
  /** Los competidores que más se llevan (sin directorios ni redes), de mayor a menor. */
  competitors: ShareSlice[];
  /** Directorios, redes sociales, buscadores, gobierno y noticias, todos juntos. */
  directories: number;
  /** Los directorios que más se llevan (para mostrar de ejemplo). */
  directoryNames: string[];
  /** El resto: competidores más chicos y los resultados del 6 al 20 (no se guardan sus dominios). */
  others: number;
  /** Búsquedas (palabra × zona) que se contaron. */
  keywords: number;
  /** volume = pesadas por búsquedas al mes; equal = todas pesan igual (no hay reporte de palabras clave). */
  weighting: "volume" | "equal";
  /** El competidor que más se lleva (null si no hay). */
  leader: ShareSlice | null;
};

export type MapShareSlice = ShareSlice & { points: number };
export type MapShare = {
  /** En qué parte de los puntos del mapa sales entre los 3 primeros (0 a 1). */
  you: number;
  youPoints: number;
  /** Puntos revisados (sin errores), sumando todos los mapas. */
  points: number;
  /** Las búsquedas de los mapas que se contaron (el último mapa de cada una). */
  keywords: string[];
  /** Los competidores que más salen en el top 3, con en qué parte de los puntos (0 a 1). No suman 100 %. */
  competitors: MapShareSlice[];
  leader: MapShareSlice | null;
};

export type AiShareSlice = ShareSlice & { count: number };
export type AiShare = {
  /** Tu parte de todas las veces que las IAs nombran un negocio (0 a 1). */
  you: number;
  /** Respuestas que te nombran. */
  youMentions: number;
  /** Todas las menciones de negocios (tú + competidores; cada negocio cuenta una vez por respuesta). */
  mentions: number;
  /** Respuestas que sí llegaron (sin errores). */
  answers: number;
  competitors: AiShareSlice[];
  /** Los demás negocios que nombran, juntos. */
  others: number;
  leader: AiShareSlice | null;
  /** Tu parte en cada IA (null si esa IA no nombró ningún negocio). */
  byProvider: { provider: TextProvider; you: number | null; mentions: number; answers: number }[];
};

// ---------- Ayudantes ----------

/** Agrupa una lista (de la más nueva a la más vieja) por una clave, manteniendo el orden. */
export function groupNewestFirst<R>(list: (R | null | undefined)[], keyOf: (r: R) => string | number): Map<string | number, R[]> {
  const out = new Map<string | number, R[]>();
  for (const r of list) {
    if (!r) continue;
    const k = keyOf(r);
    const cur = out.get(k);
    if (cur) cur.push(r);
    else out.set(k, [r]);
  }
  return out;
}

const sortSlices = <S extends ShareSlice>(list: S[]) => list.sort((a, b) => b.share - a.share || a.label.localeCompare(b.label));

/** Porcentaje entero para mostrar ("12%"); "<1%" si es más de 0 pero menos de 0.5 %. */
export function pctText(share: number): string {
  if (share > 0 && share < 0.005) return "<1%";
  return `${Math.round(share * 100)}%`;
}

/** Cambio en puntos porcentuales, redondeado a 1 decimal (positivo = subió). */
const points = (now: number, before: number) => Math.round((now - before) * 1000) / 10;

// ---------- Google (resultados normales) ----------

/** Búsquedas al mes de cada palabra en la zona del reporte (o en el primer reporte de palabras, si esa zona no tiene). */
function volumeLookup(keywords: KeywordsReport[]): (zone: number, keyword: string) => number | null | undefined {
  const byZone = new Map<number, Map<string, { volume: number | null }>>();
  for (const k of keywords) if (!byZone.has(k.locationCode)) byZone.set(k.locationCode, reportLookup(k));
  const fallback = keywords[0] ? byZone.get(keywords[0].locationCode) : undefined;
  return (zone, keyword) => {
    const key = keyword.trim().toLowerCase();
    const row = (byZone.get(zone) ?? fallback)?.get(key) ?? fallback?.get(key);
    return row ? row.volume : undefined;
  };
}

/**
 * Qué parte de los clics posibles de tus búsquedas se lleva cada sitio, con la curva CTR_CURVE.
 * `reports`: el último reporte de posiciones de cada zona. `keywords`: el último reporte de palabras clave de cada zona
 * (opcional): cada búsqueda pesa según cuánta gente la busca al mes. Los directorios y redes (isDirectory) van juntos.
 * Solo se guardan los 5 primeros resultados de cada búsqueda (y tu lugar hasta el 20): los clics de los lugares 6 a 20
 * que no son tuyos van a "Otros". null si no hay ninguna búsqueda revisada.
 */
export function organicShare(reports: RankReport[], opts: { website: string; keywords?: KeywordsReport[]; top?: number }): OrganicShare | null {
  const lookup = volumeLookup(opts.keywords ?? []);
  const rows = reports.flatMap((r) => r.rows.filter((row) => !row.error).map((row) => ({ row, volume: lookup(r.locationCode, row.keyword) })));
  if (!rows.length) return null;
  const anyVolume = rows.some((x) => typeof x.volume === "number" && x.volume > 0);
  let total = 0;
  let you = 0;
  let directories = 0;
  const comps = new Map<string, number>();
  const dirs = new Map<string, number>();
  for (const { row, volume } of rows) {
    const w = anyVolume ? (typeof volume === "number" && volume > 0 ? volume : LOW_VOLUME_WEIGHT) : 1;
    total += w * CTR_TOTAL;
    let mineInTop = false;
    for (const t of row.top) {
      const clicks = w * ctrAt(t.position);
      if (!clicks) continue;
      if (domainMatches(t.domain || t.url, opts.website)) {
        you += clicks;
        mineInTop = true;
        continue;
      }
      const d = normalizeDomain(t.domain || t.url) ?? (t.domain || "").toLowerCase();
      if (!d) continue;
      if (isDirectory(d)) {
        directories += clicks;
        dirs.set(d, (dirs.get(d) ?? 0) + clicks);
      } else comps.set(d, (comps.get(d) ?? 0) + clicks);
    }
    // Tu lugar puede estar más abajo de los 5 que se guardan.
    if (!mineInTop && row.position) you += w * ctrAt(row.position);
  }
  const all = sortSlices([...comps.entries()].map(([key, clicks]) => ({ key, label: key, share: clicks / total })));
  const competitors = all.slice(0, opts.top ?? SHARE_TOP);
  const shown = competitors.reduce((s, c) => s + c.share, 0);
  const youShare = you / total;
  const dirShare = directories / total;
  return {
    you: youShare,
    competitors,
    directories: dirShare,
    directoryNames: [...dirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d),
    others: Math.max(0, 1 - youShare - dirShare - shown),
    keywords: rows.length,
    weighting: anyVolume ? "volume" : "equal",
    leader: all[0] ?? null,
  };
}

/**
 * Cuánto cambió tu parte de los clics frente a la revisión anterior (en puntos porcentuales), comparando solo las
 * zonas que tienen dos revisiones y solo las palabras que están en las dos. null si no hay con qué comparar.
 * `byZone`: los reportes de cada zona, del más nuevo al más viejo.
 */
export function organicChange(byZone: RankReport[][], opts: { website: string; keywords?: KeywordsReport[] }): number | null {
  const pairs = byZone.filter((l) => l.length >= 2).map(([now, before]) => {
    const ok = (r: RankReport) => new Set(r.rows.filter((x) => !x.error).map((x) => x.keyword.toLowerCase()));
    const a = ok(now);
    const b = ok(before);
    const common = (r: RankReport) => ({ ...r, rows: r.rows.filter((x) => !x.error && a.has(x.keyword.toLowerCase()) && b.has(x.keyword.toLowerCase())) });
    return [common(now), common(before)] as const;
  });
  if (!pairs.length) return null;
  const now = organicShare(pairs.map((p) => p[0]), opts);
  const before = organicShare(pairs.map((p) => p[1]), opts);
  return now && before ? points(now.you, before.you) : null;
}

// ---------- Google Maps ----------

const mapKey = (m: MapReport) => m.keyword.trim().toLowerCase();

/**
 * En qué parte de los puntos del mapa sale cada negocio entre los 3 primeros, sumando los mapas que se le pasan
 * (el último de cada búsqueda). El negocio es el lugar del mapa (place): sale en el top 3 si su lugar es 1, 2 o 3.
 * null si no hay puntos revisados.
 */
export function mapShare(maps: MapReport[], top = SHARE_TOP): MapShare | null {
  let total = 0;
  let you = 0;
  const tally = new Map<string, { label: string; points: number }>();
  for (const m of maps) {
    const own = normalizeName(m.place.title);
    for (const p of m.points) {
      if (p.error) continue;
      total++;
      if (p.rank !== null && p.rank <= 3) you++;
      const seen = new Set<string>();
      for (const t of p.top3) {
        if (p.rank !== null && t.rank === p.rank) continue;
        if (m.place.cid && t.cid && t.cid === m.place.cid) continue;
        const name = normalizeName(t.title);
        if (!t.cid && own && name === own) continue;
        const key = name || (t.cid ? `cid:${t.cid}` : "");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const cur = tally.get(key) ?? { label: t.title.trim(), points: 0 };
        cur.points++;
        tally.set(key, cur);
      }
    }
  }
  if (!total) return null;
  const all = sortSlices([...tally.entries()].map(([key, c]) => ({ key, label: c.label, points: c.points, share: c.points / total })));
  return {
    you: you / total,
    youPoints: you,
    points: total,
    keywords: [...new Set(maps.map((m) => m.keyword.trim()))],
    competitors: all.slice(0, top),
    leader: all[0] ?? null,
  };
}

/** El último mapa de cada búsqueda, y el anterior de las búsquedas que tienen dos. `maps`: del más nuevo al más viejo. */
export function latestMaps(maps: MapReport[]): { latest: MapReport[]; pairs: [MapReport, MapReport][] } {
  const groups = [...groupNewestFirst(maps, mapKey).values()];
  return { latest: groups.map((g) => g[0]), pairs: groups.filter((g) => g.length >= 2).map((g) => [g[0], g[1]]) };
}

/** Cambio de tu parte del mapa (puntos porcentuales) en las búsquedas que tienen dos mapas. null si ninguna. */
export function mapChange(pairs: [MapReport, MapReport][]): number | null {
  if (!pairs.length) return null;
  const now = mapShare(pairs.map((p) => p[0]));
  const before = mapShare(pairs.map((p) => p[1]));
  return now && before ? points(now.you, before.you) : null;
}

// ---------- IAs ----------

function aiCounts(results: Pick<VisibilityResult, "mentioned" | "competitors" | "error">[]) {
  const ok = results.filter((r) => !r.error);
  const you = ok.filter((r) => r.mentioned).length;
  const comps = rankCompetitors(ok, 1000);
  const mentions = you + comps.reduce((s, c) => s + c.count, 0);
  return { ok: ok.length, you, comps, mentions };
}

/**
 * Qué parte de las veces que las IAs nombran un negocio eres tú. Cada negocio cuenta una vez por respuesta.
 * Ejemplo: 5 respuestas, te nombran en 4 y nombran 20 veces a otros negocios → 4 / 24 = 17 %.
 * null si ninguna IA contestó.
 */
export function aiShare(report: VisibilityReport, top = SHARE_TOP): AiShare | null {
  const c = aiCounts(report.results);
  if (!c.ok) return null;
  const all: AiShareSlice[] = c.comps.map((x) => ({ key: x.name.toLowerCase(), label: x.name, count: x.count, share: c.mentions ? x.count / c.mentions : 0 }));
  const competitors = all.slice(0, top);
  const you = c.mentions ? c.you / c.mentions : 0;
  const byProvider = TEXT_PROVIDERS.flatMap((p) => {
    const list = report.results.filter((r) => r.provider === p.id);
    if (!list.length) return [];
    const x = aiCounts(list);
    if (!x.ok) return [];
    return [{ provider: p.id, you: x.mentions ? x.you / x.mentions : null, mentions: x.mentions, answers: x.ok }];
  });
  return {
    you,
    youMentions: c.you,
    mentions: c.mentions,
    answers: c.ok,
    competitors,
    others: c.mentions ? Math.max(0, 1 - you - competitors.reduce((s, x) => s + x.share, 0)) : 0,
    leader: all[0] ?? null,
    byProvider,
  };
}

/** Cambio de tu parte de las menciones frente a la revisión anterior (puntos porcentuales). */
export function aiChange(now: VisibilityReport | null | undefined, before: VisibilityReport | null | undefined): number | null {
  const a = now ? aiShare(now) : null;
  const b = before ? aiShare(before) : null;
  return a && b && a.mentions && b.mentions ? points(a.you, b.you) : null;
}

// ---------- Veredictos en una línea ----------

type Bi = { es: string; en: string };
const tie = (a: number, b: number) => Math.abs(a - b) < 1e-9;

export function organicVerdict(s: OrganicShare): Bi {
  const you = pctText(s.you);
  const l = s.leader;
  if (!s.you)
    return l
      ? { es: `Todavía no te llevas clics de tus búsquedas en Google; ${l.label} se lleva el ${pctText(l.share)}.`, en: `You don't get clicks from your Google searches yet; ${l.label} gets ${pctText(l.share)}.` }
      : { es: "Todavía no te llevas clics de tus búsquedas en Google.", en: "You don't get clicks from your Google searches yet." };
  if (l && tie(s.you, l.share))
    return { es: `Te llevas el ${you} de los clics posibles en tus búsquedas, igual que ${l.label}.`, en: `You get ${you} of the possible clicks on your searches, the same as ${l.label}.` };
  if (!l || s.you > l.share) {
    // Si los directorios y redes se llevan más que tú, se dice: ahí está el resto de los clics.
    const dirs = s.directories > s.you ? { es: ` (los directorios y redes se llevan el ${pctText(s.directories)})`, en: ` (directories and social media get ${pctText(s.directories)})` } : { es: "", en: "" };
    return { es: `Te llevas el ${you} de los clics posibles en tus búsquedas: más que cualquier competidor${dirs.es}.`, en: `You get ${you} of the possible clicks on your searches: more than any competitor${dirs.en}.` };
  }
  return { es: `Te llevas el ${you} de los clics posibles en tus búsquedas; ${l.label} se lleva el ${pctText(l.share)}.`, en: `You get ${you} of the possible clicks on your searches; ${l.label} gets ${pctText(l.share)}.` };
}

export function mapVerdict(s: MapShare): Bi {
  const you = pctText(s.you);
  const l = s.leader;
  if (!s.you)
    return l
      ? { es: `No sales entre los 3 primeros del mapa en ningún punto; ${l.label} sale en el ${pctText(l.share)} del mapa.`, en: `You're not in the map's top 3 at any point; ${l.label} is in ${pctText(l.share)} of the map.` }
      : { es: "No sales entre los 3 primeros del mapa en ningún punto.", en: "You're not in the map's top 3 at any point." };
  if (l && tie(s.you, l.share))
    return { es: `Sales entre los 3 primeros en el ${you} del mapa, igual que ${l.label}.`, en: `You're in the top 3 in ${you} of the map, the same as ${l.label}.` };
  if (!l || s.you > l.share)
    return { es: `Sales entre los 3 primeros en el ${you} del mapa: más que cualquier competidor.`, en: `You're in the top 3 in ${you} of the map: more than any competitor.` };
  return { es: `Sales entre los 3 primeros en el ${you} del mapa; ${l.label} en el ${pctText(l.share)}.`, en: `You're in the top 3 in ${you} of the map; ${l.label} in ${pctText(l.share)}.` };
}

export function aiVerdict(s: AiShare): Bi {
  const you = pctText(s.you);
  const l = s.leader;
  if (!s.mentions) return { es: "Las IAs no nombraron ningún negocio en sus respuestas.", en: "The AIs didn't name any business in their answers." };
  if (!s.you)
    return l
      ? { es: `Las IAs no te nombran; ${l.label} se lleva el ${pctText(l.share)} de las menciones.`, en: `The AIs don't name you; ${l.label} gets ${pctText(l.share)} of the mentions.` }
      : { es: "Las IAs no te nombran.", en: "The AIs don't name you." };
  if (l && tie(s.you, l.share))
    return { es: `Te llevas el ${you} de las menciones de negocios en las IAs, igual que ${l.label}.`, en: `You get ${you} of the business mentions in the AIs, the same as ${l.label}.` };
  if (!l || s.you > l.share)
    return { es: `Te llevas el ${you} de las menciones de negocios en las IAs: más que cualquier competidor.`, en: `You get ${you} of the business mentions in the AIs: more than any competitor.` };
  return { es: `Te llevas el ${you} de las menciones de negocios en las IAs; ${l.label} se lleva el ${pctText(l.share)}.`, en: `You get ${you} of the business mentions in the AIs; ${l.label} gets ${pctText(l.share)}.` };
}
