// Ideas de publicaciones según el SEO del negocio: lo que la gente busca, dónde no sale, lo que pregunta y lo que
// está perdiendo. Se arman con los reportes GUARDADOS (no llama a Google ni a la IA): Inicio y Publicar las leen al
// abrir. Cada idea dice "por qué" en una línea ("La buscan 320 veces al mes y no sales"). Las que ya se publicaron
// en los últimos 14 días se quitan, y la lista cambia un poco cada día para no ver siempre las mismas.
import { db } from "@/lib/db";
import type { UiLang } from "@/lib/i18n";
import { ideasFor } from "@/lib/ideas";
import { readTrackedKeywords, readZones } from "@/lib/seo/dataforseo";
import { readDecayReport, type DecayPage } from "@/lib/seo/decay";
import { businessTopicVocab, gbpCategory, isRelevantKeyword, readGapReport, type GapRow } from "@/lib/seo/gap";
import { asGscReport, type GscRow } from "@/lib/seo/gsc";
import { type KeywordsReport, readKeywordsReport } from "@/lib/seo/keywords";
import { readMapReport, type MapReport } from "@/lib/seo/maprank";
import { loadQuestions, type QuestionItem } from "@/lib/seo/questions";
import { readRankReport, type RankReport } from "@/lib/seo/rank";
import { hasKeyword, norm, stems } from "@/lib/seo/writer";
import { campaignIdea, readStudy, type SavedStudy } from "@/lib/study-shape";
import { latestByZone } from "@/lib/seo/zones";

export type IdeaSource = "rank" | "near" | "gap" | "question" | "decay" | "map" | "gsc" | "search" | "study" | "campaign" | "season" | "ai";

export type ContentIdea = {
  /** Clave para no repetir (raíces del tema). */
  id: string;
  /** Lo que se ve en el botón: corto. */
  topic: string;
  /** Lo que se le pasa a la IA (y se ve en la caja de la idea). */
  idea: string;
  /** Por qué conviene, en una línea. */
  why: string;
  source: IdeaSource;
  keyword?: string;
  score: number;
};

/** Días en que una idea ya publicada no se vuelve a sugerir. */
export const RECENT_DAYS = 14;
/** Cuántas ideas se muestran. */
export const IDEAS_SHOWN = 6;

type Tr = (es: string, en: string) => string;
const trFor = (lang: UiLang): Tr => (es, en) => (lang === "en" ? en : es);

/** Peso de cada fuente: lo que más clientes puede traer, primero. */
const WEIGHT: Record<IdeaSource, number> = {
  rank: 1,
  gap: 0.9,
  decay: 0.95,
  gsc: 0.9,
  question: 0.85,
  near: 0.85,
  map: 0.8,
  search: 0.7,
  study: 0.6,
  campaign: 0.5,
  season: 0.4,
  ai: 0.5,
};

/** Búsquedas al mes → puntos (10 → 1.3, 100 → 2, 1000 → 3). Sin dato (Google no da números chicos): 1.5. */
const volPoints = (v: number | null | undefined) => (v && v > 0 ? Math.log10(v + 10) : 1.5);

const keyOf = (s: string) => [...new Set(stems(s))].sort().join(" ") || norm(s);
const cap = (s: string) => (s ? s.charAt(0).toLocaleUpperCase("es") + s.slice(1) : s);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const fmtN = (n: number, lang: UiLang) => new Intl.NumberFormat(lang === "en" ? "en-US" : "es-ES", { useGrouping: "always" }).format(Math.round(n));

export type IdeaInput = {
  lang: UiLang;
  businessName: string;
  aiProfile: string;
  /** Palabras que sigue el negocio. */
  tracked: string[];
  /** Vocabulario del negocio (ver businessTopicVocab); vacío = todo cuenta como relevante. */
  vocab: string[];
  /** El último reporte de posiciones de cada zona (la principal primero). */
  rank: RankReport[];
  /** Búsquedas al mes de cada palabra (de los reportes de búsquedas). */
  volumes: Map<string, number | null>;
  /** El último reporte de búsquedas de la zona principal (para sus ideas nuevas). */
  keywords: KeywordsReport | null;
  gap: GapRow[];
  questions: QuestionItem[];
  decay: DecayPage[];
  maps: MapReport[];
  gsc: GscRow[];
  study: SavedStudy | null;
  /** Textos publicados (o por publicar) en los últimos 14 días. */
  recent: string[];
  month?: number;
};

/** Todas las ideas posibles, de la mejor a la peor, sin repetir ni las ya publicadas. */
export function buildIdeas(input: IdeaInput): ContentIdea[] {
  const { lang } = input;
  const t = trFor(lang);
  const n = (v: number) => fmtN(v, lang);
  const out: ContentIdea[] = [];
  const vol = (k: string) => input.volumes.get(norm(k)) ?? null;
  const relevant = (k: string) => isRelevantKeyword(k, input.vocab);
  const brand = norm(input.businessName);
  const branded = (k: string) => !!brand && brand.length >= 4 && norm(k).includes(brand);
  // Una sola palabra ("portón") es muy general para escribir una publicación.
  const specific = (k: string) => stems(k).length >= 2;

  const about = (kw: string) =>
    t(
      `Publicación sobre «${kw}»: explica lo que necesita saber quien busca eso en Google y usa esas palabras de forma natural.`,
      `Post about "${kw}": explain what someone searching that on Google needs to know, and use those words naturally.`,
    );
  const add = (x: Omit<ContentIdea, "id" | "topic"> & { topic: string; id?: string }) =>
    out.push({ ...x, id: x.id ?? keyOf(x.keyword ?? x.topic), topic: clip(cap(x.topic.trim()), 72) });

  // 1. Palabras que sigues y donde no sales arriba.
  for (const r of input.rank)
    for (const row of r.rows) {
      if (row.error || branded(row.keyword)) continue;
      const v = vol(row.keyword);
      const p = row.position;
      if (p !== null && p <= 3) continue;
      if (p === null || p > 10) {
        add({
          source: "rank",
          keyword: row.keyword,
          topic: row.keyword,
          idea: about(row.keyword),
          why:
            p === null
              ? v ? t(`La buscan ${n(v)} veces al mes y no sales en Google`, `Searched ${n(v)} times a month and you don't show up on Google`) : t("La gente la busca y todavía no sales en Google", "People search for it and you don't show up on Google yet")
              : v ? t(`La buscan ${n(v)} veces al mes y sales ${p}°: casi nadie llega ahí`, `Searched ${n(v)} times a month and you're #${p}: almost nobody scrolls that far`) : t(`Sales ${p}° en Google: casi nadie llega ahí`, `You're #${p} on Google: almost nobody scrolls that far`),
          score: WEIGHT.rank * volPoints(v) * (p === null ? 1 : 0.9),
        });
      } else {
        add({
          source: "near",
          keyword: row.keyword,
          topic: row.keyword,
          idea: about(row.keyword),
          why: t(`Sales ${p}° en Google: con más contenido puedes llegar a los 3 primeros`, `You're #${p} on Google: more content can get you into the top 3`),
          score: WEIGHT.near * volPoints(v) * 0.75,
        });
      }
    }

  // 2. Lo que tu competencia tiene y tú no.
  for (const g of input.gap) {
    if (!relevant(g.keyword) || branded(g.keyword) || !specific(g.keyword)) continue;
    const v = g.volume;
    add({
      source: "gap",
      keyword: g.keyword,
      topic: g.keyword,
      idea: about(g.keyword),
      why:
        g.type === "missing"
          ? v ? t(`Tu competencia sale y tú no (${n(v)} búsquedas al mes)`, `Your competitors show up and you don't (${n(v)} searches a month)`) : t("Tu competencia sale en Google y tú no", "Your competitors show up on Google and you don't")
          : v ? t(`Tu competencia te gana en Google (${n(v)} búsquedas al mes)`, `Your competitors beat you on Google (${n(v)} searches a month)`) : t("Tu competencia te gana en Google", "Your competitors beat you on Google"),
      score: WEIGHT.gap * volPoints(v) * (g.type === "missing" ? 1 : 0.85) * (0.6 + Math.min(1, (g.opportunity || 50) / 100) * 0.4),
    });
  }

  // 3. Preguntas que la gente le hace a Google y nadie responde.
  for (const q of input.questions) {
    if (q.answered) continue;
    const v = vol(q.keywords[0] ?? "");
    add({
      source: "question",
      topic: q.question,
      idea: t(
        `Responde esta pregunta que la gente le hace a Google: «${q.question}». Responde claro y sin inventar datos del negocio.`,
        `Answer this question people ask Google: "${q.question}". Answer clearly and don't invent facts about the business.`,
      ),
      why: t("La gente le pregunta esto a Google y nadie lo responde bien", "People ask Google this and nobody answers it well"),
      score: WEIGHT.question * Math.max(1.5, volPoints(v) * 0.9),
    });
  }

  // 4. Páginas que perdieron visitas: volver a hablar del tema.
  for (const d of input.decay) {
    const q = d.lostQueries[0]?.query;
    if (!q || branded(q)) continue;
    add({
      source: "decay",
      keyword: q,
      topic: q,
      idea: t(
        `Vuelve a hablar de «${q}»: lo que la gente quiere saber hoy sobre eso. Usa esas palabras de forma natural.`,
        `Talk again about "${q}": what people want to know about it today. Use those words naturally.`,
      ),
      why: d.clicksLost > 0 ? t(`Tu página perdió ${n(d.clicksLost)} visitas de Google: vuelve a hablar del tema`, `Your page lost ${n(d.clicksLost)} visits from Google: talk about it again`) : t("Tu página está perdiendo visitas de Google", "Your page is losing visits from Google"),
      score: WEIGHT.decay * Math.max(1.6, volPoints(d.clicksLost * 10)),
    });
  }

  // 5. Search Console: casi en la primera página.
  for (const r of input.gsc) {
    if (branded(r.key) || !relevant(r.key) || !specific(r.key)) continue;
    add({
      source: "gsc",
      keyword: r.key,
      topic: r.key,
      idea: about(r.key),
      why: t(`Google te muestra ${n(r.impressions)} veces en el lugar ${Math.round(r.position)}: una publicación te puede subir`, `Google shows you ${n(r.impressions)} times at #${Math.round(r.position)}: a post can move you up`),
      score: WEIGHT.gsc * volPoints(r.impressions),
    });
  }

  // 6. El mapa de Google: donde no sales entre los 3 primeros.
  for (const m of input.maps) {
    if (m.avgRank === null || m.avgRank <= 3 || branded(m.keyword)) continue;
    add({
      source: "map",
      keyword: m.keyword,
      topic: m.keyword,
      idea: t(
        `Publicación local sobre «${m.keyword}»: menciona la zona donde trabajas y cómo contactarte.`,
        `Local post about "${m.keyword}": mention the area you serve and how to reach you.`,
      ),
      why: t(`En el mapa de Google sales ${Math.round(m.avgRank)}° en promedio: ahí te llaman directo`, `On Google Maps you're #${Math.round(m.avgRank)} on average: that's where people call from`),
      score: WEIGHT.map * volPoints(vol(m.keyword)) * Math.min(1, m.avgRank / 10 + 0.5),
    });
  }

  // 6b. El mapa que Google muestra arriba de los resultados (local pack) en las revisiones de posiciones.
  for (const r of input.rank)
    for (const row of r.rows) {
      const lp = row.localPack;
      if (row.error || !lp || (lp.position !== null && lp.position <= 3) || branded(row.keyword)) continue;
      add({
        source: "map",
        keyword: row.keyword,
        topic: row.keyword,
        id: `map ${keyOf(row.keyword)}`,
        idea: t(
          `Publicación local sobre «${row.keyword}»: menciona la zona donde trabajas y cómo contactarte.`,
          `Local post about "${row.keyword}": mention the area you serve and how to reach you.`,
        ),
        why: lp.position === null
          ? t("Google muestra un mapa con 3 negocios y tú no estás", "Google shows a map with 3 businesses and you're not there")
          : t(`En el mapa de Google sales ${lp.position}°: los 3 primeros reciben las llamadas`, `On the Google map you're #${lp.position}: the top 3 get the calls`),
        score: WEIGHT.map * volPoints(vol(row.keyword)) * 0.9,
      });
    }

  // 7. Búsquedas nuevas que Google sugiere (no las sigues todavía).
  const tracked = new Set(input.tracked.map(norm));
  for (const k of input.keywords?.ideas ?? []) {
    if (!k.volume || k.volume < 10 || tracked.has(norm(k.keyword)) || !relevant(k.keyword) || branded(k.keyword) || !specific(k.keyword)) continue;
    add({
      source: "search",
      keyword: k.keyword,
      topic: k.keyword,
      idea: about(k.keyword),
      why: t(`La buscan ${n(k.volume)} veces al mes`, `Searched ${n(k.volume)} times a month`),
      score: WEIGHT.search * volPoints(k.volume),
    });
  }

  // 8. Del estudio del negocio: palabras clave (con su título) y campañas.
  const s = input.study;
  if (s) {
    // Volumen estimado por la IA del estudio: cuenta menos que un dato real de Google.
    const est = { alto: 60, medio: 30, bajo: 10 } as const;
    for (const k of s.keywords) {
      const v = vol(k.keyword);
      add({
        source: "study",
        keyword: k.keyword,
        topic: k.idea || k.keyword,
        idea: t(`${k.idea || k.keyword}. Usa la búsqueda «${k.keyword}» de forma natural.`, `${k.idea || k.keyword}. Use the search "${k.keyword}" naturally.`),
        why: v ? t(`La buscan ${n(v)} veces al mes`, `Searched ${n(v)} times a month`) : t("Lo que busca tu cliente ideal, según tu estudio", "What your ideal customer searches, from your study"),
        score: WEIGHT.study * volPoints(v ?? est[k.volume]) * (k.difficulty === "baja" ? 1.1 : k.difficulty === "alta" ? 0.85 : 1),
      });
    }
    for (const c of s.campaigns)
      add({
        source: "campaign",
        topic: c.title,
        idea: campaignIdea(c, lang),
        why: t(`Idea de campaña de tu estudio, para: ${c.audience}`, `Campaign idea from your study, for: ${c.audience}`),
        score: WEIGHT.campaign * 1.8,
      });
  }

  // 9. Siempre algo de temporada o general, al final.
  for (const x of ideasFor(input.aiProfile, input.businessName, input.month, lang))
    add({ source: "season", topic: x, idea: x, why: t("Buena idea para esta época del año", "A good idea for this time of year"), score: WEIGHT.season * 2 });

  return dedupe(out.filter((x) => !postedRecently(x, input.recent)));
}

/** ¿Ya se habló de esto en una publicación reciente? */
export function postedRecently(x: Pick<ContentIdea, "keyword" | "topic">, recent: string[]): boolean {
  if (!recent.length) return false;
  if (x.keyword) return recent.some((p) => hasKeyword(p, x.keyword!));
  const need = [...new Set(stems(x.topic))];
  if (need.length < 2) return false;
  return recent.some((p) => {
    const have = new Set(stems(p));
    return need.filter((w) => have.has(w)).length / need.length >= 0.7;
  });
}

/** Quita las repetidas (mismo tema o casi igual), quedándose con la de más puntos. */
function dedupe(list: ContentIdea[]): ContentIdea[] {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  const kept: { idea: ContentIdea; words: Set<string> }[] = [];
  for (const idea of sorted) {
    const words = new Set(idea.id.split(" ").filter(Boolean));
    const dup = kept.some((k) => {
      if (k.idea.id === idea.id) return true;
      if (!words.size || !k.words.size) return false;
      const inter = [...words].filter((w) => k.words.has(w)).length;
      return inter / Math.min(words.size, k.words.size) >= 0.8 && inter / Math.max(words.size, k.words.size) >= 0.6;
    });
    if (!dup) kept.push({ idea, words });
  }
  return kept.map((k) => k.idea);
}

/** Número de 0 a 1 que sale siempre igual para el mismo texto (para rotar las ideas cada día). */
function seeded(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Las ideas de hoy: entre las mejores (3 veces las que se muestran), un poco al azar según el día, y variadas
 * (máximo 2 de la misma fuente al principio). La primera es la mejor del día.
 */
export function pickDaily(list: ContentIdea[], n = IDEAS_SHOWN, seed = new Date().toISOString().slice(0, 10)): ContentIdea[] {
  const pool = list.slice(0, n * 3).map((x) => ({ x, s: x.score * (0.7 + 0.6 * seeded(`${seed}|${x.id}`)) }));
  pool.sort((a, b) => b.s - a.s);
  const picked: ContentIdea[] = [];
  const per = new Map<IdeaSource, number>();
  for (const { x } of pool) {
    if (picked.length >= n) break;
    if ((per.get(x.source) ?? 0) >= 2) continue;
    picked.push(x);
    per.set(x.source, (per.get(x.source) ?? 0) + 1);
  }
  for (const { x } of pool) if (picked.length < n && !picked.includes(x)) picked.push(x);
  return picked;
}

// ---------- Cargar (solo la base de datos) ----------

/** Texto de una publicación para compararla (Facebook si hay versión, si no el texto). */
function postText(p: { text: string; seoTitle: string; variants: unknown }): string {
  const v = p.variants && typeof p.variants === "object" ? (p.variants as Record<string, unknown>) : {};
  const fb = typeof v.facebook === "string" ? v.facebook : "";
  return `${p.seoTitle}\n${fb || p.text}`;
}

/** Publicaciones de los últimos días (incluye borradores y programadas: también cuentan como "ya se dijo"). */
export async function recentPostTexts(businessId: string, days = RECENT_DAYS, take = 40): Promise<string[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.post
    .findMany({
      where: { businessId, OR: [{ createdAt: { gte: since } }, { scheduledAt: { gte: since } }], status: { not: "failed" } },
      orderBy: { createdAt: "desc" },
      take,
      select: { text: true, seoTitle: true, variants: true },
    })
    .catch(() => []);
  return rows.map(postText);
}

/**
 * El comienzo de las últimas publicaciones (hasta 15): la primera línea con texto, para pedirle a la IA que no
 * repita esos ganchos ni esos temas.
 */
export async function recentOpenings(businessId: string, take = 15): Promise<string[]> {
  const rows = await db.post
    .findMany({ where: { businessId, status: { not: "failed" } }, orderBy: { createdAt: "desc" }, take, select: { text: true, seoTitle: true, variants: true } })
    .catch(() => []);
  return rows
    .map((p) => {
      const v = p.variants && typeof p.variants === "object" ? (p.variants as Record<string, unknown>) : {};
      const txt = (typeof v.facebook === "string" && v.facebook.trim()) || p.text;
      const first = txt.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
      return clip(first.replace(/\s+/g, " "), 160);
    })
    .filter(Boolean);
}

/** De dónde salen las ideas: del SEO, del estudio del negocio o solo de la temporada. */
export type IdeasBasis = "seo" | "study" | "season";

export type IdeasData = { ideas: ContentIdea[]; basis: IdeasBasis };

const SEO_SOURCES: IdeaSource[] = ["rank", "near", "gap", "question", "decay", "map", "gsc", "search"];

/** De dónde salen la mayoría de las ideas mostradas. */
export function ideasBasis(list: ContentIdea[]): IdeasBasis {
  if (list.some((x) => SEO_SOURCES.includes(x.source))) return "seo";
  if (list.some((x) => x.source === "study" || x.source === "campaign")) return "study";
  return "season";
}

/** Las ideas de hoy para un negocio, con sus reportes guardados (no llama a ninguna API). */
export async function loadContentIdeas(businessId: string, lang: UiLang, n = IDEAS_SHOWN): Promise<IdeasData> {
  const all = await loadAllIdeas(businessId, lang);
  const ideas = pickDaily(all.ideas, n, `${new Date().toISOString().slice(0, 10)}|${businessId}`);
  return { ideas, basis: ideasBasis(ideas) };
}

/** Todas las ideas posibles (para la IA de "Más ideas"). */
export async function loadAllIdeas(businessId: string, lang: UiLang): Promise<IdeasData> {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, website: true, aiProfile: true, seoKeywords: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, study: true },
  });
  if (!b) return { ideas: [], basis: "season" };
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const per = Math.max(1, zones.length);
  const latest = (kind: string, take = 1) =>
    db.seoReport.findMany({ where: { businessId, kind }, orderBy: { createdAt: "desc" }, take, select: { data: true } }).catch(() => []);
  const [rankRows, kwRows, gapRows, gbpRows, mapRows, gscRows, decayRows, questions, recent] = await Promise.all([
    latest("rank", 3 * per),
    latest("keywords", 3 * per),
    latest("gap"),
    latest("gbp"),
    latest("maprank", 10),
    latest("gsc"),
    latest("decay"),
    loadQuestions(businessId).catch(() => null),
    recentPostTexts(businessId),
  ]);

  const rankByZone = latestByZone(rankRows.map((r) => readRankReport(r.data)), zones);
  const kwByZone = latestByZone(kwRows.map((r) => readKeywordsReport(r.data)), zones);
  const rank = zones.map((z) => rankByZone.get(z.code)).filter((r): r is RankReport => !!r);
  // Búsquedas al mes: la zona principal manda; las otras llenan lo que falte.
  const volumes = new Map<string, number | null>();
  for (const z of [...zones].reverse()) {
    const k = kwByZone.get(z.code);
    if (k) for (const r of [...k.ideas, ...k.keywords]) volumes.set(norm(r.keyword), r.volume);
  }
  const vocab = businessTopicVocab({ ...b, category: gbpRows[0] ? gbpCategory(gbpRows[0].data) : null });
  const gap = gapRows[0] ? readGapReport(gapRows[0].data) : null;
  // El último mapa de cada búsqueda.
  const maps = new Map<string, MapReport>();
  for (const r of mapRows) {
    const m = readMapReport(r.data);
    if (m && !maps.has(norm(m.keyword))) maps.set(norm(m.keyword), m);
  }
  const gsc = gscRows[0] ? asGscReport(gscRows[0].data) : null;
  const decay = decayRows[0] ? readDecayReport(decayRows[0].data) : null;
  const study = readStudy(b.study);

  const input: IdeaInput = {
    lang,
    businessName: b.name,
    aiProfile: b.aiProfile,
    tracked: readTrackedKeywords(b.seoKeywords),
    vocab,
    rank,
    volumes,
    keywords: zones[0] ? (kwByZone.get(zones[0].code) ?? null) : null,
    gap: gap?.rows ?? [],
    questions: questions?.groups.flatMap((g) => g.questions) ?? [],
    decay: decay?.pages ?? [],
    maps: [...maps.values()],
    gsc: gsc?.opportunities ?? [],
    study,
    recent,
  };
  const ideas = buildIdeas(input);
  return { ideas, basis: ideasBasis(ideas) };
}
