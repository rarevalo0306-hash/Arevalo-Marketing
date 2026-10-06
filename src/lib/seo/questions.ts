// "Preguntas que hace la gente": las preguntas del cuadro "La gente también pregunta" de Google, gratis.
// Salen de lo que ya se paga: la revisión de posiciones (rank.ts guarda `questions` por palabra clave) y las
// investigaciones del escritor de artículos (writer.ts, research.questions). Se juntan sin repetir, se quitan las
// que no tienen que ver con el negocio (gap.ts) y se marca cuáles ya responde la web (títulos, H1 y H2 de la
// revisión de la página y de "Mejora tus páginas") o un artículo guardado. Todo es puro salvo loadQuestions.
import { db } from "@/lib/db";
import { readAuditReport, type AuditReport } from "@/lib/seo/audit";
import { readZones, zoneLabel } from "@/lib/seo/dataforseo";
import { businessTopicVocab, gbpCategory, GENERIC_WORDS, isRelevantKeyword } from "@/lib/seo/gap";
import { readOnPageReport, type OnPageReport } from "@/lib/seo/onpage";
import { domainMatches, readRankReport, siteDomain, type RankReport } from "@/lib/seo/rank";
import { latestReports } from "@/lib/seo/reports";
import { MAX_ARTICLES, norm, parseMarkdown, readArticleReport, stem, STOPWORDS, type ArticleReport } from "@/lib/seo/writer";
import { latestByZone } from "@/lib/seo/zones";

/** Máximo de preguntas por palabra clave y en total. */
export const QUESTIONS_PER_KEYWORD = 10;
export const QUESTIONS_MAX = 80;
/** Búsquedas relacionadas que se muestran por palabra clave. */
export const RELATED_PER_KEYWORD = 6;

export type QuestionFrom = "google" | "article";

/** Un texto de la web o de un artículo que puede responder una pregunta (título, H1 o subtítulo). */
export type AnswerText = {
  text: string;
  where: "site" | "article";
  /** Lo que se muestra: el título de la página o del artículo. */
  label: string;
  /** La página de la web (where = site). */
  url?: string;
  /** El artículo guardado (where = article). */
  articleId?: string;
};

export type RawQuestion = { question: string; keyword: string; zone?: string; from: QuestionFrom };

export type QuestionItem = {
  question: string;
  /** Las palabras clave donde Google la mostró (la primera es su grupo). */
  keywords: string[];
  /** Las zonas donde salió (nombres cortos). */
  zones: string[];
  from: QuestionFrom[];
  /** null = nadie la responde todavía. */
  answered: Omit<AnswerText, "text"> | null;
  /** Lo que se le pasa al escritor de artículos. */
  topic: string;
};

export type QuestionGroup = { keyword: string; questions: QuestionItem[]; related: string[] };

export type QuestionsData = {
  groups: QuestionGroup[];
  total: number;
  unanswered: number;
  answeredSite: number;
  answeredArticle: number;
  /** Preguntas que no tienen que ver con el negocio (se ocultan). */
  hidden: number;
  /** ¿La revisión de posiciones ya es nueva (guarda las preguntas, aunque Google no haya mostrado ninguna)? Las viejas no. */
  rankHasQuestions: boolean;
  /** Cuántas revisiones de posiciones hay (la más nueva de cada zona). */
  rankReports: number;
  /** Cuándo se revisaron las posiciones por última vez (ISO) o null. */
  checkedAt: string | null;
  /** Cuántos textos de la web se usaron para saber si ya se responde. */
  siteTexts: number;
  /** ¿Hay auditoría del sitio o revisión de tus páginas? Sin ellas casi todo sale "sin responder". */
  siteChecked: boolean;
};

// ---------- ¿La pregunta ya se responde? ----------

/** Palabras que dicen qué se pregunta ("cuánto", "cómo", "qué"…). */
const QUESTION_WORDS = new Set(
  "que cual cuales cuanto cuanta cuantos cuantas como donde cuando quien quienes porque how what why where when which who".split(" "),
);

const words = (s: string) => norm(s).split(" ").filter(Boolean);

/** Las palabras que dicen el tema de la pregunta (sin palabras vacías, lugares, precios ni "cuánto/cómo"). */
export function topicWords(question: string): string[] {
  return words(question).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w) && !GENERIC_WORDS.has(w) && !QUESTION_WORDS.has(w));
}

/** Lugares: no dicen de qué trata la pregunta («en Managua», «en Nicaragua»). */
const PLACES = new Set(
  ("nicaragua managua masaya granada leon chinandega esteli rivas matagalpa jinotega carazo boaco chontales miami florida hialeah doral " +
    "orlando tampa houston texas usa mexico guatemala honduras salvador costa rica panama colombia venezuela peru chile argentina espana")
    .split(" "),
);
/** Palabras de precio: «cuánto cuesta» ≈ «precio» ≈ «costo». */
const PRICE = new Set("cuesta cuestan precio precios costo costos cost costs price prices vale valen".split(" "));

/** Las raíces con significado para comparar preguntas con títulos (sin lugares, sin palabras de 1-2 letras, precio = una sola). */
function contentStems(s: string): string[] {
  const out = new Set<string>();
  for (const w of words(s)) {
    if (w.length < 3 || /^\d+$/.test(w) || STOPWORDS.has(w) || PLACES.has(w)) continue;
    out.add(PRICE.has(w) ? "$precio" : stem(w));
  }
  return [...out];
}

/**
 * ¿El texto (título, H1 o subtítulo) responde la pregunta? Tiene al menos el 75 % de las palabras con significado
 * de la pregunta (mínimo 2; sin contar lugares; «cuánto cuesta» = «precio»). Si la pregunta tiene 1 o 2 palabras
 * con significado («¿Qué es una cortina metálica?»), hace falta que tenga todas y también la frase que pregunta
 * («qué es»): así el título de la página de inicio «Cortinas metálicas en Managua» no cuenta como respuesta.
 */
export function answers(text: string, question: string): boolean {
  const q = contentStems(question);
  if (!q.length) return false;
  const have = new Set(contentStems(text));
  const hit = q.filter((w) => have.has(w)).length;
  if (q.length <= 2) {
    if (hit < q.length) return false;
    // La frase que pregunta («qué es», «cuánto dura», «cómo funciona») tiene que estar en el texto.
    const qw = words(question);
    const i = qw.findIndex((w) => QUESTION_WORDS.has(w));
    if (i < 0) return true;
    return ` ${words(text).join(" ")} `.includes(` ${qw.slice(i, i + 2).join(" ")} `);
  }
  return hit >= 2 && hit / q.length >= 0.75;
}

/** El primer texto que responde la pregunta: primero la web, después los artículos guardados. */
export function answeredBy(question: string, texts: AnswerText[]): AnswerText | null {
  return texts.find((t) => t.where === "site" && answers(t.text, question)) ?? texts.find((t) => t.where === "article" && answers(t.text, question)) ?? null;
}

const okPage = (status: number, error?: string) => !error && (!status || status < 400);

/**
 * Los títulos, H1 y H2 de la web: la revisión de la página (título y H1 de cada página), "Mejora tus páginas"
 * (título, H1 y H2) y las páginas propias que salen en Google en la revisión de posiciones (su título).
 */
export function siteTexts(input: { audit?: AuditReport | null; onpage?: OnPageReport | null; rank?: RankReport[]; domain?: string }): AnswerText[] {
  const out: AnswerText[] = [];
  const seen = new Set<string>();
  const add = (text: string, label: string, url: string) => {
    const k = `${norm(text)}|${url}`;
    if (!norm(text) || seen.has(k)) return;
    seen.add(k);
    out.push({ text, where: "site", label: label || text, url });
  };
  for (const p of input.audit?.pages ?? []) {
    if (!okPage(p.status, p.error)) continue;
    const url = p.finalUrl || p.url;
    add(p.title, p.title || p.h1, url);
    add(p.h1, p.title || p.h1, url);
  }
  for (const p of input.onpage?.pages ?? []) {
    if (p.error) continue;
    const label = p.stats?.title || p.title || p.stats?.h1 || "";
    add(p.title, label, p.url);
    if (p.stats) for (const h of [p.stats.title, p.stats.h1, ...p.stats.h2]) add(h, label, p.url);
  }
  const domain = siteDomain(input.domain);
  if (domain)
    for (const r of input.rank ?? [])
      for (const row of r.rows) for (const t of row.top) if (t.title && domainMatches(t.domain || t.url, domain)) add(t.title, t.title, t.url);
  return out;
}

/** Los subtítulos de un borrador (## y ###) y las líneas que son solo negritas (preguntas frecuentes escritas así). */
function draftHeadings(md: string): string[] {
  return parseMarkdown(md).flatMap((b) => {
    if (b.type === "heading") return b.level >= 2 ? [b.text] : [];
    const bold = b.type === "paragraph" ? /^\*\*(.+?)\*\*/.exec(b.text)?.[1] : undefined;
    return bold ? [bold] : [];
  });
}

/** El título, el H1 y los subtítulos de los artículos guardados. */
export function articleTexts(articles: { id: string; report: ArticleReport }[]): AnswerText[] {
  return articles.flatMap(({ id, report }) => {
    const label = report.draft.title || report.draft.h1 || report.keyword;
    return [report.draft.title, report.draft.h1, ...draftHeadings(report.draft.markdown)]
      .filter((t) => norm(t))
      .map((text) => ({ text, where: "article" as const, label, articleId: id }));
  });
}

// ---------- Juntar las preguntas ----------

/** Las preguntas de la última revisión de cada zona, con la palabra clave de donde salieron (zona principal primero). */
export function rankQuestions(reports: RankReport[]): RawQuestion[] {
  return reports.flatMap((r) =>
    r.rows.filter((row) => !row.error).flatMap((row) => (row.questions ?? []).map((question) => ({ question, keyword: row.keyword, zone: zoneLabel(r.location) || r.location, from: "google" as const }))),
  );
}

/** Las preguntas que encontró el escritor de artículos (las de Google para la búsqueda de cada artículo). */
export function articleQuestions(articles: { report: ArticleReport }[]): RawQuestion[] {
  return articles.flatMap(({ report }) => {
    const list = report.research.questions.length ? report.research.questions : report.targets.questions;
    return list.map((question) => ({ question, keyword: report.keyword, zone: zoneLabel(report.zone.name) || undefined, from: "article" as const }));
  });
}

/** Lo que se le pasa al escritor: la pregunta, o la palabra clave si la pregunta no dice el tema («¿Cuánto cuesta?»). */
export function writerTopic(question: string, keyword: string): string {
  return topicWords(question).length ? question.replace(/[¿?¡!]/g, "").replace(/\s+/g, " ").trim() : keyword;
}

/**
 * Junta las preguntas sin repetir (sin importar mayúsculas, acentos ni signos), quita las que no tienen que ver
 * con el negocio, marca cuáles ya se responden y las agrupa por palabra clave (en el orden en que llegan).
 * Dentro de cada grupo van primero las que nadie responde.
 */
export function buildQuestions(input: {
  raw: RawQuestion[];
  vocab: string[];
  texts: AnswerText[];
  /** Búsquedas relacionadas por palabra clave (de la revisión de posiciones). */
  related?: { keyword: string; related: string[] }[];
}): Pick<QuestionsData, "groups" | "total" | "unanswered" | "answeredSite" | "answeredArticle" | "hidden"> {
  const byKey = new Map<string, QuestionItem>();
  const hiddenKeys = new Set<string>();
  const groups = new Map<string, QuestionGroup>();
  let total = 0;
  for (const r of input.raw) {
    const question = r.question.replace(/\s+/g, " ").trim().slice(0, 200);
    const key = norm(question);
    const keyword = r.keyword.trim();
    if (!key || !keyword || hiddenKeys.has(key)) continue;
    const known = byKey.get(key);
    if (known) {
      if (!known.keywords.some((k) => norm(k) === norm(keyword))) known.keywords.push(keyword);
      if (r.zone && !known.zones.includes(r.zone)) known.zones.push(r.zone);
      if (!known.from.includes(r.from)) known.from.push(r.from);
      continue;
    }
    // ¿Tiene que ver con el negocio? Una pregunta sin tema propio («¿Cuánto cuesta?») se juzga por su palabra clave.
    const relevant = topicWords(question).length ? isRelevantKeyword(question, input.vocab) : isRelevantKeyword(keyword, input.vocab);
    if (!relevant) {
      hiddenKeys.add(key);
      continue;
    }
    const gk = norm(keyword);
    let group = groups.get(gk);
    if (!group) {
      group = { keyword, questions: [], related: [] };
      groups.set(gk, group);
    }
    if (group.questions.length >= QUESTIONS_PER_KEYWORD || total >= QUESTIONS_MAX) continue;
    const hit = answeredBy(question, input.texts);
    const item: QuestionItem = {
      question,
      keywords: [keyword],
      zones: r.zone ? [r.zone] : [],
      from: [r.from],
      answered: hit ? { where: hit.where, label: hit.label, ...(hit.url ? { url: hit.url } : {}), ...(hit.articleId ? { articleId: hit.articleId } : {}) } : null,
      topic: writerTopic(question, keyword),
    };
    byKey.set(key, item);
    group.questions.push(item);
    total++;
  }
  // Búsquedas relacionadas: solo las que tienen que ver con el negocio y no son la misma palabra clave.
  for (const { keyword, related } of input.related ?? []) {
    const group = groups.get(norm(keyword));
    if (!group) continue;
    for (const s of related) {
      if (group.related.length >= RELATED_PER_KEYWORD) break;
      const k = norm(s);
      if (!k || k === norm(group.keyword) || group.related.some((x) => norm(x) === k) || !isRelevantKeyword(s, input.vocab)) continue;
      group.related.push(s);
    }
  }
  const list = [...groups.values()].filter((g) => g.questions.length);
  for (const g of list) g.questions.sort((a, b) => Number(!!a.answered) - Number(!!b.answered));
  const all = list.flatMap((g) => g.questions);
  return {
    groups: list,
    total: all.length,
    unanswered: all.filter((q) => !q.answered).length,
    answeredSite: all.filter((q) => q.answered?.where === "site").length,
    answeredArticle: all.filter((q) => q.answered?.where === "article").length,
    hidden: hiddenKeys.size,
  };
}

/** Las búsquedas relacionadas de cada palabra clave (zona principal primero, sin repetir palabra clave). */
export function rankRelated(reports: RankReport[]): { keyword: string; related: string[] }[] {
  const out = new Map<string, { keyword: string; related: string[] }>();
  for (const r of reports)
    for (const row of r.rows) {
      if (row.error || !row.related?.length) continue;
      const k = norm(row.keyword);
      const cur = out.get(k);
      if (cur) cur.related.push(...row.related);
      else out.set(k, { keyword: row.keyword, related: [...row.related] });
    }
  return [...out.values()];
}

// ---------- Cargar ----------

/** Junta todo para un negocio con los reportes guardados (no llama a Google ni gasta nada). */
export async function loadQuestions(businessId: string): Promise<QuestionsData | null> {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { website: true, seoKeywords: true, study: true, seoLocations: true, seoLocationCode: true, seoLocationName: true },
  });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const [rankRows, articleRows, [auditRow], [onpageRow], [gbpRow]] = await Promise.all([
    zones.length ? latestReports(businessId, "rank", 3 * zones.length) : Promise.resolve([]),
    latestReports(businessId, "article", MAX_ARTICLES),
    latestReports(businessId, "audit", 1),
    latestReports(businessId, "onpage", 1),
    latestReports(businessId, "gbp", 1),
  ]);
  const byZone = latestByZone(
    rankRows.map((r) => readRankReport(r.data)),
    zones,
  );
  // La zona principal primero (sus preguntas mandan el orden de los grupos).
  const rank = zones.map((z) => byZone.get(z.code)).filter((r): r is RankReport => !!r);
  const articles = articleRows.map((r) => ({ id: r.id, report: readArticleReport(r.data) })).filter((x): x is { id: string; report: ArticleReport } => !!x.report);
  const vocab = businessTopicVocab({ ...b, category: gbpRow ? gbpCategory(gbpRow.data) : null });
  const site = siteTexts({ audit: auditRow ? readAuditReport(auditRow.data) : null, onpage: onpageRow ? readOnPageReport(onpageRow.data) : null, rank, domain: b.website });
  const built = buildQuestions({
    raw: [...rankQuestions(rank), ...articleQuestions(articles)],
    vocab,
    texts: [...site, ...articleTexts(articles)],
    related: rankRelated(rank),
  });
  const checked = rank.map((r) => r.createdAt).sort().pop() ?? null;
  return {
    ...built,
    rankHasQuestions: rank.some((r) => r.rows.some((row) => row.questions !== undefined)),
    rankReports: rank.length,
    checkedAt: checked,
    siteTexts: site.length,
    siteChecked: !!auditRow || !!onpageRow,
  };
}
