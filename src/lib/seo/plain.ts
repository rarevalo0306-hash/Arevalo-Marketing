// La página de SEO en palabras simples, sin IA y sin costo: qué quiere decir cada posición, si la página que
// muestra Google trata de lo que se busca, y un resumen de 3 a 6 frases armado con los últimos reportes guardados.
// Todo es puro (sin base de datos ni red) y se prueba con los datos reales de Fameseg en tests/seo-plain.test.ts.
import { GENERIC_WORDS } from "@/lib/seo/gap";
import type { KeywordsReport } from "@/lib/seo/keywords";
import type { RankReport, RankRow } from "@/lib/seo/rank";
import { errorKind, PROVIDER_SHORT, type VisibilityReport } from "@/lib/seo/visibility";
import { norm, stem, STOPWORDS } from "@/lib/seo/writer";
import { TEXT_PROVIDERS } from "@/lib/ai";

export type Bi = { es: string; en: string };

/** Lugar en palabras: 2 → "2°" / "#2". */
export const ordinal = (n: number): Bi => ({ es: `${n}°`, en: `#${n}` });

/** «a», «b» y «c» / “a”, “b” and “c” (con "y N más" si son muchas). */
export function joinNames(list: string[], max = 3): Bi {
  const shown = list.slice(0, max);
  const extra = list.length - shown.length;
  const join = (items: string[], open: string, close: string, and: string, more: (n: number) => string) => {
    const q = items.map((x) => `${open}${x}${close}`);
    if (extra > 0) q.push(more(extra));
    return q.length <= 1 ? (q[0] ?? "") : `${q.slice(0, -1).join(", ")} ${and} ${q[q.length - 1]}`;
  };
  return {
    es: join(shown, "«", "»", "y", (n) => `${n} más`),
    en: join(shown, "“", "”", "and", (n) => `${n} more`),
  };
}

// ---------- Qué quiere decir una posición ----------

export type Verdict = "excellent" | "good" | "close" | "far" | "none" | "map";

/** Excelente (1-3), Bien (4-10, primera página), Casi (11-15), Lejos (16-20), No sales (no está en los primeros 20). */
export function verdictOf(position: number | null, mapPosition: number | null = null): Verdict {
  // Fuera de la primera página pero entre los 3 del mapa: el mapa sale arriba de todo, así que va bien.
  if ((position === null || position < 1 || position > 10) && mapPosition !== null && mapPosition >= 1 && mapPosition <= 3) return "map";
  if (position === null || position < 1) return "none";
  if (position <= 3) return "excellent";
  if (position <= 10) return "good";
  if (position <= 15) return "close";
  return "far";
}

/** La píldora (estilo de globals.css), la palabra y qué hacer, para cada veredicto. */
export const VERDICTS: Record<Verdict, { pill: string; label: Bi; meaning: Bi }> = {
  excellent: {
    pill: "done",
    label: { es: "Excelente", en: "Excellent" },
    meaning: {
      es: "Estás entre los 3 primeros: ahí se van casi todos los clics. Mantén esa página al día.",
      en: "You're in the top 3: that's where almost all the clicks go. Keep that page up to date.",
    },
  },
  good: {
    pill: "scheduled",
    label: { es: "Bien", en: "Good" },
    meaning: {
      es: "Estás en la primera página, pero los 3 primeros se llevan la mayoría de los clics. Mejora esa página (título con la búsqueda, más texto útil, fotos) para subir.",
      en: "You're on page one, but the top 3 get most of the clicks. Improve that page (search in the title, more useful text, photos) to move up.",
    },
  },
  close: {
    pill: "partial",
    label: { es: "Casi", en: "Almost" },
    meaning: {
      es: "Estás al principio de la segunda página: casi nadie llega ahí, pero te falta poco. Mejora la página o escribe un artículo sobre esta búsqueda.",
      en: "You're at the top of page two: almost nobody gets there, but you're close. Improve the page or write an article about this search.",
    },
  },
  far: {
    pill: "partial",
    label: { es: "Lejos", en: "Far" },
    meaning: {
      es: "Estás al final de la segunda página: casi nadie te ve. Crea una página o un artículo dedicado a esta búsqueda.",
      en: "You're at the bottom of page two: almost nobody sees you. Create a page or an article dedicated to this search.",
    },
  },
  map: {
    pill: "done",
    label: { es: "Bien en el mapa", en: "Good on the map" },
    meaning: {
      es: "En la lista normal de Google no estás arriba, pero sí sales entre los 3 negocios del mapa, que aparece arriba de todo: ahí te llaman directo. Para salir también en la lista, escribe un artículo sobre esta búsqueda.",
      en: "You're not near the top of Google's regular list, but you are among the 3 businesses on the map, which shows above everything: people call you straight from there. To also show in the list, write an article about this search.",
    },
  },
  none: {
    pill: "failed",
    label: { es: "No sales", en: "Not showing" },
    meaning: {
      es: "No sales en los primeros 20 resultados: casi nadie te encuentra así. Escribe un artículo o crea una página sobre esta búsqueda.",
      en: "You're not in the top 20 results: almost nobody finds you this way. Write an article or create a page about this search.",
    },
  },
};

/** La posición en palabras: "2° en Google" / "No sales (top 20)", y el mapa: "3° en el mapa" / "Google no mostró mapa". */
export function positionText(row: Pick<RankRow, "position" | "localPack">): { organic: Bi; map: Bi } {
  const organic: Bi =
    row.position === null ? { es: "No sales (top 20)", en: "Not in top 20" } : { es: `${ordinal(row.position).es} en Google`, en: `${ordinal(row.position).en} on Google` };
  const map: Bi = !row.localPack
    ? { es: "Google no mostró mapa", en: "Google showed no map" }
    : row.localPack.position === null
      ? { es: "Hay mapa, pero no sales", en: "There's a map, but you're not on it" }
      : { es: `${ordinal(row.localPack.position).es} en el mapa`, en: `${ordinal(row.localPack.position).en} on the map` };
  return { organic, map };
}

// ---------- ¿La página que muestra Google trata de lo que se busca? ----------

const meaningStems = (s: string) =>
  norm(s)
    .split(" ")
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w) && !GENERIC_WORDS.has(w))
    .map(stem)
    .filter((w) => !GENERIC_WORDS.has(w));

const stemsMatch = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));

/** La parte de la dirección que dice de qué trata la página: "fameseg.com/blog/equipos-de-proteccion" → "blog/equipos-de-proteccion". */
export function urlPath(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname).replace(/^\/+|\/+$/g, "").replace(/\.(html?|php|aspx?)$/i, "");
  } catch {
    return "";
  }
}

/**
 * Google muestra para la búsqueda una página tuya que trata de otra cosa: ninguna palabra con significado de la
 * búsqueda (sin lugares ni palabras genéricas) aparece en la dirección ni en el título de la página.
 * La página principal ("/") no cuenta: habla de todo el negocio.
 */
export function pageMismatch(keyword: string, url: string | null | undefined, title = ""): boolean {
  if (!url) return false;
  const path = urlPath(url);
  if (!path) return false;
  const need = meaningStems(keyword);
  if (!need.length) return false;
  const have = meaningStems(`${path.replace(/[/_.-]+/g, " ")} ${title}`);
  return !need.some((w) => have.some((h) => stemsMatch(w, h)));
}

/** El título de tu página que sale (si está entre los 5 primeros, viene en `top`), o su dirección corta. */
export function rankedPageName(row: Pick<RankRow, "url" | "top">): string {
  if (!row.url) return "";
  const hit = row.top.find((x) => x.url === row.url);
  return hit?.title?.trim() || urlPath(row.url) || row.url;
}

export type RowAdvice = { verdict: Verdict; mismatch: boolean; page: string };

/** Qué decir de una fila de posiciones: el veredicto y si la página que sale trata de otra cosa. */
export function rowAdvice(row: Pick<RankRow, "keyword" | "position" | "url" | "top"> & { localPack?: RankRow["localPack"] }): RowAdvice {
  const hit = row.url ? row.top.find((x) => x.url === row.url) : undefined;
  return { verdict: verdictOf(row.position, row.localPack?.position ?? null), mismatch: row.position !== null && pageMismatch(row.keyword, row.url, hit?.title ?? ""), page: rankedPageName(row) };
}

// ---------- El resumen en palabras simples ----------

export type PlainTone = "good" | "warn" | "bad" | "info";
export type PlainLink = { href: string; label: Bi };
export type PlainLine = {
  id: string;
  icon: string;
  tone: PlainTone;
  text: Bi;
  /** La sección de la página que lo explica (#posiciones, #ia…). */
  link: PlainLink;
  /** Algo que hacer ya (escribir un artículo…), si aplica. */
  action?: PlainLink;
};

export type PlainInput = {
  businessId: string;
  /** El último reporte de posiciones de la zona principal. */
  rank: RankReport | null;
  /** El último reporte de búsquedas de la zona principal. */
  keywords?: KeywordsReport | null;
  /** Las palabras que sigue el negocio. */
  tracked?: string[];
  ai?: VisibilityReport | null;
  /** Las oportunidades del gap que sí tienen que ver con el negocio, la mejor primero. */
  gap?: { keyword: string; volume: number | null }[] | null;
  /** Máximo de frases (por defecto 6). */
  max?: number;
  /** Si se pueden revisar posiciones (DataForSEO conectado): si no, no se pide empezar por ahí. */
  canRank?: boolean;
};

const writeHref = (businessId: string, kw: string) => `/b/${businessId}/seo/escribir?kw=${encodeURIComponent(kw)}`;

/** Las frases del resumen, de la más importante a la menos, entre 0 y `max` (6). Sin datos: lista vacía. */
export function plainSummary(input: PlainInput): PlainLine[] {
  const { businessId, rank } = input;
  const max = input.max ?? 6;
  const lines: PlainLine[] = [];
  const toRank: PlainLink = { href: "#posiciones", label: { es: "Ver posiciones", en: "See rankings" } };
  const write = (kw: string): PlainLink => ({ href: writeHref(businessId, kw), label: { es: "Escribir un artículo", en: "Write an article" } });

  if (!rank) {
    if (input.canRank !== false)
      lines.push({
        id: "no-rank",
        icon: "ℹ️",
        tone: "info",
        text: {
          es: "Todavía no revisas en qué lugar sales en Google. Empieza por ahí: presiona «Revisar mis posiciones».",
          en: "You haven't checked where you show up on Google yet. Start there: press “Check my rankings”.",
        },
        link: toRank,
      });
  } else {
    const rows = rank.rows.filter((r) => !r.error);
    const advice = new Map(rows.map((r) => [r.keyword, rowAdvice(r)]));

    // 1) Lo que va bien: los 3 primeros.
    const top3 = rows.filter((r) => r.position !== null && r.position <= 3).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    if (top3.length === 1) {
      const r = top3[0];
      lines.push({
        id: "top3",
        icon: "✅",
        tone: "good",
        text: {
          es: `Para «${r.keyword}» sales ${ordinal(r.position!).es} en Google: muy bien, casi todos los clics se los llevan los 3 primeros.`,
          en: `For “${r.keyword}” you're ${ordinal(r.position!).en} on Google: great, the top 3 get almost all the clicks.`,
        },
        link: toRank,
      });
    } else if (top3.length > 1) {
      const names = joinNames(top3.map((r) => r.keyword));
      lines.push({
        id: "top3",
        icon: "✅",
        tone: "good",
        text: {
          es: `Para ${names.es} sales entre los 3 primeros de Google: muy bien, casi todos los clics se los llevan los 3 primeros.`,
          en: `For ${names.en} you're in Google's top 3: great, the top 3 get almost all the clicks.`,
        },
        link: toRank,
      });
    }

    // 2) Lo que más urge: no sales ni en Google ni en el mapa.
    const missing = rows.filter((r) => r.position === null && !(r.localPack && r.localPack.position !== null));
    if (missing.length) {
      const names = joinNames(missing.map((r) => r.keyword));
      const one = missing.length === 1;
      lines.push({
        id: "missing",
        icon: "⚠️",
        tone: "bad",
        text: {
          es: `Para ${names.es} no sales en los primeros 20 resultados: casi nadie te encuentra. Escribe un artículo o crea una página sobre ${one ? "eso" : "esos temas"}.`,
          en: `For ${names.en} you're not in the top 20 results: almost nobody finds you. Write an article or create a page about ${one ? "it" : "those topics"}.`,
        },
        link: toRank,
        action: write(missing[0].keyword),
      });
    }

    // 3) La segunda página (11 a 20).
    const page2 = rows.filter((r) => r.position !== null && r.position > 10).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    if (page2.length) {
      const r = page2[0];
      const others = page2.length - 1;
      lines.push({
        id: "page2",
        icon: "🔸",
        tone: "warn",
        text: {
          es: `Para «${r.keyword}» sales ${ordinal(r.position!).es}, en la segunda página de Google: casi nadie llega ahí. Mejora esa página o escribe un artículo para pasar a la primera.${others ? ` (Igual con ${others} búsqueda${others === 1 ? "" : "s"} más.)` : ""}`,
          en: `For “${r.keyword}” you're ${ordinal(r.position!).en}, on Google's second page: almost nobody gets there. Improve that page or write an article to reach page one.${others ? ` (Same for ${others} more search${others === 1 ? "" : "es"}.)` : ""}`,
        },
        link: toRank,
        action: write(r.keyword),
      });
    }

    // 4) La página que sale trata de otra cosa.
    const wrong = rows.filter((r) => advice.get(r.keyword)?.mismatch).sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
    if (wrong.length) {
      const r = wrong[0];
      const page = advice.get(r.keyword)!.page;
      lines.push({
        id: "mismatch",
        icon: "🔀",
        tone: "warn",
        text: {
          es: `Para «${r.keyword}» Google muestra tu página «${page}», que no habla específicamente de eso. Una página o artículo sobre «${r.keyword}» te ayudaría a subir.`,
          en: `For “${r.keyword}” Google shows your page “${page}”, which isn't specifically about it. A page or article about “${r.keyword}” would help you move up.`,
        },
        link: toRank,
        action: write(r.keyword),
      });
    }

    // 5) El mapa de Google.
    const onMap = rows.filter((r) => r.localPack && r.localPack.position !== null).sort((a, b) => a.localPack!.position! - b.localPack!.position!);
    if (onMap.length) {
      const parts = onMap.slice(0, 3).map((r) => ({ es: `${ordinal(r.localPack!.position!).es} para «${r.keyword}»`, en: `${ordinal(r.localPack!.position!).en} for “${r.keyword}”` }));
      const join = (xs: string[], and: string) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`);
      lines.push({
        id: "map",
        icon: "📍",
        tone: "good",
        text: {
          es: `En el mapa de Google sales ${join(parts.map((p) => p.es), "y")}. El mapa sale arriba de todo: ahí te llaman directo.`,
          en: `On Google's map you're ${join(parts.map((p) => p.en), "and")}. The map shows above everything: people call you straight from there.`,
        },
        link: toRank,
      });
    }

    // Para el final: primera página (4 a 10) y mapas donde no sales.
    const page1 = rows.filter((r) => r.position !== null && r.position >= 4 && r.position <= 10 && !advice.get(r.keyword)?.mismatch);
    if (page1.length) {
      const r = page1[0];
      lines.push({
        id: "page1",
        icon: "👍",
        tone: "info",
        text: {
          es: `Para «${r.keyword}» sales ${ordinal(r.position!).es} en Google: estás en la primera página, pero los 3 primeros se llevan la mayoría de los clics.`,
          en: `For “${r.keyword}” you're ${ordinal(r.position!).en} on Google: you're on page one, but the top 3 get most of the clicks.`,
        },
        link: toRank,
      });
    }
    const offMap = rows.filter((r) => r.localPack && r.localPack.position === null);
    if (offMap.length) {
      const names = joinNames(offMap.map((r) => r.keyword), 2);
      lines.push({
        id: "off-map",
        icon: "🗺️",
        tone: "warn",
        text: {
          es: `Para ${names.es} Google muestra un mapa con 3 negocios y tú no estás. Completa tu Perfil de Google y pide reseñas a tus clientes.`,
          en: `For ${names.en} Google shows a map with 3 businesses and you're not there. Complete your Google profile and ask customers for reviews.`,
        },
        link: { href: "#perfil", label: { es: "Ver tu Perfil de Google", en: "See your Google profile" } },
      });
    }
  }

  // 6) Las IAs.
  const ai = input.ai;
  if (ai) {
    const ok = TEXT_PROVIDERS.map((p) => p.id).filter((p) => (ai.byProvider[p]?.total ?? 0) > 0);
    const failed = TEXT_PROVIDERS.map((p) => p.id).filter((p) => {
      const s = ai.byProvider[p];
      return s && s.total === 0 && s.errors > 0;
    });
    const said = ok.map((p) => {
      const s = ai.byProvider[p]!;
      return s.mentioned === 0
        ? { es: `${PROVIDER_SHORT[p]} no te recomendó en ninguna de ${s.total} preguntas`, en: `${PROVIDER_SHORT[p]} didn't recommend you in any of ${s.total} questions` }
        : { es: `${PROVIDER_SHORT[p]} te recomienda en ${s.mentioned} de ${s.total} preguntas`, en: `${PROVIDER_SHORT[p]} recommends you in ${s.mentioned} of ${s.total} questions` };
    });
    const join = (xs: string[], and: string) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join("; ")} ${and} ${xs[xs.length - 1]}`);
    const why = (p: (typeof failed)[number]) => {
      const err = ai.results.find((r) => r.provider === p && r.error)?.error ?? "";
      return errorKind(err) === "limit"
        ? { es: `${PROVIDER_SHORT[p]} no se pudo revisar (llegó a su límite gratis por minuto): vuelve a intentar en un rato`, en: `${PROVIDER_SHORT[p]} couldn't be checked (it hit its free per-minute limit): try again in a while` }
        : { es: `${PROVIDER_SHORT[p]} no se pudo revisar (no contestó)`, en: `${PROVIDER_SHORT[p]} couldn't be checked (it didn't answer)` };
    };
    const failText = failed.map(why);
    if (said.length || failText.length) {
      const es = [said.length ? `${join(said.map((x) => x.es), "y")}.` : "", failText.length ? `${failText.map((x) => x.es).join(". ")}.` : ""].filter(Boolean).join(" ");
      const en = [said.length ? `${join(said.map((x) => x.en), "and")}.` : "", failText.length ? `${failText.map((x) => x.en).join(". ")}.` : ""].filter(Boolean).join(" ");
      lines.push({
        id: "ai",
        icon: "🤖",
        tone: ai.score === null ? "warn" : ai.score >= 60 ? "good" : ai.score >= 25 ? "warn" : "bad",
        text: { es, en },
        link: { href: "#ia", label: { es: "Ver qué dicen las IAs", en: "See what the AIs say" } },
      });
    }
  }

  // 7) La mejor oportunidad de la competencia (solo las que tienen que ver con el negocio).
  const best = input.gap?.[0];
  if (best) {
    const vol = best.volume !== null && best.volume > 0;
    lines.push({
      id: "gap",
      icon: "🎯",
      tone: "info",
      text: {
        es: `Tu competencia sale en Google por «${best.keyword}»${vol ? ` (${best.volume} búsquedas al mes)` : ""} y tú no: es tu mejor oportunidad para escribir.`,
        en: `Your competitors show up on Google for “${best.keyword}”${vol ? ` (${best.volume} searches a month)` : ""} and you don't: it's your best opportunity to write about.`,
      },
      link: { href: "#gap", label: { es: "Ver oportunidades", en: "See opportunities" } },
      action: write(best.keyword),
    });
  }

  // 8) Palabras que casi no se buscan.
  const kw = input.keywords;
  if (kw) {
    const tracked = new Set((input.tracked ?? kw.keywords.map((k) => k.keyword)).map((k) => k.toLowerCase()));
    const mine = kw.keywords.filter((k) => tracked.has(k.keyword.toLowerCase()));
    const none = mine.filter((k) => k.volume === null || k.volume === 0);
    if (mine.length && none.length) {
      lines.push({
        id: "volume",
        icon: "ℹ️",
        tone: "info",
        text: {
          es: `${none.length} de tus ${mine.length} palabras clave casi no se buscan en Google (menos de unas 10 veces al mes, por eso salen con «—»). Sigue también alguna de las ideas que sí se buscan.`,
          en: `${none.length} of your ${mine.length} keywords are barely searched on Google (fewer than about 10 times a month, that's why they show “—”). Also track some of the ideas people do search.`,
        },
        link: { href: "#palabras", label: { es: "Ver búsquedas", en: "See searches" } },
      });
    }
  }

  // De lo más importante a lo menos: lo que va bien, lo que urge, y después lo demás.
  const order = ["no-rank", "top3", "missing", "page2", "mismatch", "map", "ai", "gap", "page1", "off-map", "volume"];
  return lines.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).slice(0, max);
}
