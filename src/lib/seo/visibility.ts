// Visibilidad en IA: ¿ChatGPT, Gemini y Claude recomiendan a este negocio cuando un cliente les pregunta?
// Se hacen las preguntas que haría un cliente (con búsqueda en internet), se busca el nombre o la página
// del negocio en cada respuesta y se anotan los competidores que sí aparecen.
import { z } from "zod";
import { ask, availableText, searchAnswer, TEXT_PROVIDERS, type TextProvider } from "@/lib/ai";
import { bi, errorText, type UiLang } from "@/lib/i18n";
import { readInput, readStudy, type SavedStudy, type StudySource, topKeywords } from "@/lib/study-shape";

export const MAX_QUESTIONS = 5;
export const MAX_QUESTION_LENGTH = 200;
const ANSWER_MAX = 1500;
const SOURCES_MAX = 6;

export type VisibilityResult = {
  question: string;
  provider: TextProvider;
  /** Extracto de la respuesta de la IA. */
  answer: string;
  mentioned: boolean;
  /** Lugar del negocio entre los negocios que nombra la respuesta (1 = el primero), si aparece en la lista. */
  position: number | null;
  sources: StudySource[];
  /** Otros negocios que recomienda la respuesta, en orden. */
  competitors: string[];
  error?: string;
};

export type ProviderScore = { score: number | null; mentioned: number; total: number; errors: number };
export type Recommendation = { title: string; detail: string };

export type VisibilityReport = {
  questions: string[];
  results: VisibilityResult[];
  /** % de respuestas (pregunta × IA, sin contar errores) que mencionan al negocio; null si ninguna IA contestó. */
  score: number | null;
  byProvider: Partial<Record<TextProvider, ProviderScore>>;
  topCompetitors: { name: string; count: number }[];
  /** Páginas que más citan las IAs (directorios, reseñas, competidores). */
  topDomains: { domain: string; count: number }[];
  recommendations: Recommendation[];
  lang: UiLang;
  startedAt: string;
  finishedAt: string;
};

type BusinessVis = { name: string; website: string; aiProfile: string; aiText?: string; study?: unknown; studyInput?: unknown };

// ---------- Detección de menciones (funciones puras) ----------

/** Minúsculas, sin acentos ni signos: "Arévalo & Co., LLC" → "arevalo and co llc". */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LEGAL = new Set(["llc", "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "pllc", "llp", "lp", "pa", "plc"]);

/** Las formas del nombre a buscar: completo, y sin "The" ni LLC/Inc/Corp al final. */
export function nameVariants(name: string): string[] {
  const full = normalizeText(name.replace(/\./g, ""));
  const tokens = full.split(" ").filter(Boolean);
  if (tokens[0] === "the" && tokens.length > 1) tokens.shift();
  while (tokens.length > 1 && LEGAL.has(tokens[tokens.length - 1])) tokens.pop();
  // "Ricardo PA, LLC" → también "ricardo pa"; si queda una sola palabra, debe tener al menos 3 letras.
  return [...new Set([full, tokens.join(" ")])].filter((v) => v.replace(/ /g, "").length >= 3);
}

/** El dominio de la página del negocio, sin "www." ("https://www.ricardopa.com/x" → "ricardopa.com"). */
export function domainOf(website: string): string {
  const w = website.trim();
  if (!w) return "";
  try {
    const host = new URL(/^[a-z]+:\/\//i.test(w) ? w : `https://${w}`).hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : "";
  } catch {
    return "";
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** El dominio de una fuente. Gemini da enlaces de redirección de Google y pone el dominio real en el título. */
export function sourceDomain(s: StudySource): string {
  let host = "";
  try {
    host = new URL(s.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {}
  if (!host || host.endsWith("vertexaisearch.cloud.google.com")) {
    const t = s.title.trim().toLowerCase().replace(/^www\./, "");
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t)) return t;
  }
  return host;
}

export type MentionMatcher = {
  inText: (text: string) => boolean;
  inSources: (sources: StudySource[]) => boolean;
  /** Si un nombre de la lista de negocios recomendados es este negocio. */
  isBusiness: (entry: string) => boolean;
};

export function mentionMatcher(business: { name: string; website: string }): MentionMatcher {
  const variants = nameVariants(business.name);
  const domain = domainOf(business.website);
  const hasWords = (text: string) => {
    const n = ` ${normalizeText(text)} `;
    return variants.some((v) => n.includes(` ${v} `));
  };
  const domainRe = domain ? new RegExp(`(^|[^a-z0-9.-])(www\\.)?${escapeRe(domain)}($|[^a-z0-9-])`, "i") : null;
  const ownDomain = (d: string) => Boolean(domain) && (d === domain || d.endsWith(`.${domain}`));
  return {
    inText: (text) => hasWords(text) || Boolean(domainRe?.test(text)),
    inSources: (sources) =>
      sources.some((s) => ownDomain(sourceDomain(s)) || hasWords(s.url.replace(/^https?:\/\/[^/]+/i, "").replace(/[-_/]+/g, " "))),
    isBusiness: (entry) => {
      if (hasWords(entry) || Boolean(domainRe?.test(entry))) return true;
      const e = nameVariants(entry);
      return e.some((v) => variants.includes(v));
    },
  };
}

/** Lugar del negocio en la lista de negocios que nombra la respuesta (1 = primero), o null. */
export function positionOf(list: string[], m: MentionMatcher): number | null {
  const i = list.findIndex((name) => m.isBusiness(name));
  return i < 0 ? null : i + 1;
}

// ---------- Puntaje y resumen (funciones puras) ----------

type Scored = Pick<VisibilityResult, "provider" | "mentioned" | "error">;

export function computeScores(results: Scored[]): { score: number | null; byProvider: Partial<Record<TextProvider, ProviderScore>> } {
  const pct = (list: Scored[]) => {
    const ok = list.filter((r) => !r.error);
    return { score: ok.length ? Math.round((100 * ok.filter((r) => r.mentioned).length) / ok.length) : null, mentioned: ok.filter((r) => r.mentioned).length, total: ok.length, errors: list.length - ok.length };
  };
  const byProvider: Partial<Record<TextProvider, ProviderScore>> = {};
  for (const p of TEXT_PROVIDERS) {
    const list = results.filter((r) => r.provider === p.id);
    if (list.length) byProvider[p.id] = pct(list);
  }
  return { score: pct(results).score, byProvider };
}

/** Competidores que más aparecen: en cuántas respuestas sale cada uno. */
export function rankCompetitors(results: Pick<VisibilityResult, "competitors">[], max = 10): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const r of results) {
    const seen = new Set<string>();
    for (const name of r.competitors) {
      const key = nameVariants(name).at(-1) ?? normalizeText(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const c = counts.get(key);
      if (c) c.count++;
      else counts.set(key, { name: name.trim(), count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, max);
}

/** Páginas que más citan las IAs (sin contar la del negocio). */
export function rankDomains(results: Pick<VisibilityResult, "sources">[], ownWebsite: string, max = 10): { domain: string; count: number }[] {
  const own = domainOf(ownWebsite);
  const counts = new Map<string, number>();
  for (const r of results) {
    const seen = new Set<string>();
    for (const s of r.sources) {
      const d = sourceDomain(s);
      if (!d || seen.has(d) || (own && (d === own || d.endsWith(`.${own}`)))) continue;
      seen.add(d);
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)).slice(0, max);
}

const isProvider = (v: unknown): v is TextProvider => TEXT_PROVIDERS.some((p) => p.id === v);
const str = (v: unknown, max = 5000) => (typeof v === "string" ? v.slice(0, max) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Lee un reporte guardado sin fallar si es viejo o está incompleto. */
export function readVisibilityReport(json: unknown): VisibilityReport | null {
  const o = obj(json);
  if (!Array.isArray(o.results)) return null;
  const results: VisibilityResult[] = arr(o.results).flatMap((raw) => {
    const r = obj(raw);
    if (!isProvider(r.provider)) return [];
    return [
      {
        question: str(r.question, 300),
        provider: r.provider,
        answer: str(r.answer, ANSWER_MAX + 10),
        mentioned: r.mentioned === true,
        position: num(r.position),
        sources: arr(r.sources)
          .map((s) => ({ url: str(obj(s).url, 2000), title: str(obj(s).title, 300) }))
          .filter((s) => /^https?:\/\//.test(s.url))
          .slice(0, SOURCES_MAX),
        competitors: arr(r.competitors).map((c) => str(c, 200)).filter(Boolean),
        ...(typeof r.error === "string" && r.error ? { error: r.error.slice(0, 500) } : {}),
      },
    ];
  });
  const computed = computeScores(results);
  const questions = arr(o.questions).map((q) => str(q, 300)).filter(Boolean);
  return {
    questions: questions.length ? questions : [...new Set(results.map((r) => r.question))],
    results,
    score: num(o.score) ?? computed.score,
    byProvider: computed.byProvider,
    topCompetitors: arr(o.topCompetitors)
      .map((c) => ({ name: str(obj(c).name, 200), count: num(obj(c).count) ?? 0 }))
      .filter((c) => c.name),
    topDomains: arr(o.topDomains)
      .map((c) => ({ domain: str(obj(c).domain, 200), count: num(obj(c).count) ?? 0 }))
      .filter((c) => c.domain),
    recommendations: arr(o.recommendations)
      .map((r) => (typeof r === "string" ? { title: r.slice(0, 300), detail: "" } : { title: str(obj(r).title, 300), detail: str(obj(r).detail, 1500) }))
      .filter((r) => r.title || r.detail),
    lang: o.lang === "en" ? "en" : "es",
    startedAt: str(o.startedAt, 40),
    finishedAt: str(o.finishedAt, 40),
  };
}

/** Limpia las preguntas que escribe el dueño: sin vacías ni repetidas, máximo 5 de 200 letras. */
export function cleanQuestions(list: unknown[]): string[] {
  const seen = new Set<string>();
  return list
    .map((q) => String(q ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION_LENGTH))
    .filter((q) => q && !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase()))
    .slice(0, MAX_QUESTIONS);
}

// ---------- Preguntas para probar ----------

type CustLang = "es" | "en" | "both";

/** En qué idioma buscan los clientes: lo que dijo el dueño en el estudio, o el idioma de las palabras clave. */
export function customerLang(business: Pick<BusinessVis, "study" | "studyInput">): CustLang | null {
  const input = readInput(business.studyInput);
  if (input) return input.lang;
  const study = readStudy(business.study);
  if (!study) return null;
  const langs = new Set(study.keywords.map((k) => k.lang));
  return langs.has("es") && langs.has("en") ? "both" : langs.has("en") ? "en" : langs.has("es") ? "es" : null;
}

/** Preguntas armadas del estudio, sin IA: las búsquedas locales y comerciales más útiles, con la ciudad en mayúscula. */
export function questionsFromStudy(study: SavedStudy, lang: CustLang): string[] {
  const order = topKeywords(study, study.keywords.length);
  const kws = order
    .map((k) => study.keywords.find((x) => x.keyword === k)!)
    .filter((k) => k && k.intent !== "informativa");
  const es = kws.filter((k) => k.lang === "es");
  const en = kws.filter((k) => k.lang === "en");
  let chosen: typeof kws = [];
  if (lang === "both") {
    // Una en español y una en inglés, alternando.
    for (let i = 0; i < Math.max(es.length, en.length); i++) chosen.push(...(es[i] ? [es[i]] : []), ...(en[i] ? [en[i]] : []));
  } else chosen = (lang === "es" ? es : en).length ? (lang === "es" ? es : en) : kws;
  const places = study.market.places;
  const fixCase = (kw: string) =>
    places.reduce((s, p) => s.replace(new RegExp(`\\b${escapeRe(p)}\\b`, "gi"), p), kw.replace(/\s+/g, " ").trim());
  const out = chosen.slice(0, 4).map((k) => (k.lang === "en" ? `I'm looking for ${fixCase(k.keyword)}. Who do you recommend?` : `Busco ${fixCase(k.keyword)}. ¿A quién me recomiendas?`));
  const service = study.services[0]?.name;
  const place = places[0];
  if (service && place && lang !== "en") out.push(`¿A quién me recomiendas para ${service.charAt(0).toLowerCase()}${service.slice(1)} en ${place}?`);
  return cleanQuestions(out);
}

const QuestionsSchema = z.object({ questions: z.array(z.string()).describe("3 to 5 questions") });

/** 3 a 5 preguntas que haría un cliente a ChatGPT, Gemini o Claude para encontrar un negocio como este. */
export async function suggestQuestions(business: BusinessVis, lang: UiLang): Promise<string[]> {
  const study = readStudy(business.study);
  const cust = customerLang(business) ?? lang;
  const langText = { es: "Spanish (correct accents, ¿…?)", en: "English", both: "a mix of Spanish (correct accents, ¿…?) and English, since customers speak both" }[cust];
  const context = study
    ? `Services: ${study.services.map((s) => s.name).join("; ")}
Areas: ${study.market.places.slice(0, 8).join(", ")}
What customers search on Google (local and commercial): ${topKeywords(study, 25)
        .filter((k) => study.keywords.find((x) => x.keyword === k)?.intent !== "informativa")
        .slice(0, 12)
        .join("; ")}
Summary: ${study.summary}`
    : `What the business says about itself: ${business.aiProfile.trim().slice(0, 2500) || "(no profile)"}${business.website ? `\nWebsite: ${business.website}` : ""}`;
  const system = `You write the questions real customers type into AI assistants (ChatGPT, Gemini, Claude) when they look for a business like this one, to test whether the assistants recommend it.
Rules:
- Natural questions a customer would ask, e.g. "¿Quién es el mejor ajustador público en Hialeah?" or "best public adjuster near Miami for roof damage".
- Never include the business's own name or website.
- Include the city or area when the business is local; vary the services and the areas.
- Write them in ${langText}.
- 3 to 5 questions, each under 150 characters. No numbering, no quotes, no markdown.`;
  try {
    const r = await ask(business.aiText ?? "", QuestionsSchema, system, `Business type and market (do not name the business "${business.name}"):\n${context}\n\nWrite the questions.`, 2000);
    const m = mentionMatcher(business);
    const list = cleanQuestions(r.questions.filter((q) => !m.inText(q)));
    if (list.length) return list;
  } catch (e) {
    if (!study) throw e;
  }
  if (study) return questionsFromStudy(study, cust);
  throw bi("La IA no devolvió preguntas. Intenta de nuevo.", "The AI didn't send back any questions. Please try again.");
}

// ---------- La revisión ----------

const NEUTRAL_SYSTEM =
  "You are a helpful assistant. Answer the user's question using up-to-date information from the web. When the question is about finding a service or a business, recommend specific local businesses by name when relevant. Answer in the language of the question.";

const ExtractSchema = z.object({
  answers: z.array(
    z.object({
      id: z.number().int().describe("The answer id"),
      businesses: z.array(z.string()).describe("Businesses, companies or brands the answer recommends or names as options, in the order they first appear"),
    }),
  ),
});

const RecsSchema = z.object({
  recommendations: z
    .array(z.object({ title: z.string().describe("Short action, max 10 words"), detail: z.string().describe("1-3 sentences: what to do exactly and why, based on what was found") }))
    .describe("3 to 5 actions"),
});

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(bi("La IA tardó demasiado en contestar.", "The AI took too long to answer.")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Pide a la IA la lista ordenada de negocios que recomienda cada respuesta (una sola llamada para todas). */
async function extractBusinesses(pref: string, answers: { id: number; question: string; text: string }[]): Promise<Map<number, string[]>> {
  const system = `You read answers that AI assistants gave to customers and list the specific businesses they recommend.
Rules:
- For each answer, list the businesses, companies or brands it recommends or names as options for the customer, in the order they first appear, with the name as written.
- Do not include directories or websites used only as sources (Google Maps, Yelp, BBB, Angi, Facebook) unless the answer recommends them as the provider, and do not include generic categories ("a local roofer").
- An empty list when the answer names no business. Return every answer id.`;
  const user = answers.map((a) => `<answer id="${a.id}">\nQuestion: ${a.question}\n${a.text.slice(0, 3500)}\n</answer>`).join("\n\n");
  const r = await timeout(ask(pref, ExtractSchema, system, user, 6000), 90000);
  const map = new Map<number, string[]>();
  for (const a of r.answers) map.set(a.id, [...new Set(a.businesses.map((b) => b.trim().slice(0, 120)).filter(Boolean))].slice(0, 15));
  return map;
}

async function recommend(business: BusinessVis, report: Omit<VisibilityReport, "recommendations" | "finishedAt">, lang: UiLang): Promise<Recommendation[]> {
  const study = readStudy(business.study);
  const name = (p: TextProvider) => TEXT_PROVIDERS.find((x) => x.id === p)?.name ?? p;
  const lines = report.results
    .filter((r) => !r.error)
    .map((r) => `- [${name(r.provider)}] "${r.question}": ${r.mentioned ? `mentions the business${r.position ? ` (position ${r.position})` : ""}` : "does NOT mention the business"}${r.competitors.length ? `; recommends: ${r.competitors.slice(0, 5).join(", ")}` : ""}`);
  const excerpts = report.results
    .filter((r) => !r.error && r.answer)
    .slice(0, 6)
    .map((r) => `[${name(r.provider)}] ${r.question}\n${r.answer.slice(0, 600)}`);
  const system = `You are a local SEO and AI-search (GEO) consultant for small businesses. Based on a test of what AI assistants answer when customers ask for this kind of business, give 3 to 5 concrete, honest actions the owner can take so the assistants are more likely to mention the business.
Rules:
- Base each action on what was found: name the specific directories and websites the assistants cited, the competitors that show up, and the exact questions where the business is missing.
- Typical actions: get listed or complete the profile on the directories the AIs cited, ask happy customers for Google reviews, complete the Google Business Profile, put the city and the service in page titles, publish an FAQ page that answers these exact questions, keep the business name, address and phone the same everywhere.
- Never promise results, rankings or that the assistants will recommend the business. Never invent facts about the business.
- If the business is a public adjuster or insurance-related: never promise payouts or results.
- No markdown. ${lang === "en" ? "Write in plain US English." : "Escribe en español natural con acentos correctos, tratando al dueño de tú."}`;
  const user = `Business: ${business.name}${business.website ? ` (${business.website})` : " (no website)"}
${study ? `Area: ${study.market.places.slice(0, 6).join(", ")}\nServices: ${study.services.map((s) => s.name).join("; ")}` : `Profile: ${business.aiProfile.trim().slice(0, 1200) || "(none)"}`}
Score: the business appears in ${report.score ?? 0}% of the answers.
Results:
${lines.join("\n")}
Competitors that appear most: ${report.topCompetitors.map((c) => `${c.name} (${c.count})`).join(", ") || "(none)"}
Websites the assistants cite most: ${report.topDomains.map((d) => `${d.domain} (${d.count})`).join(", ") || "(none)"}

Answer excerpts:
${excerpts.join("\n\n")}`;
  const r = await timeout(ask(business.aiText ?? "", RecsSchema, system, user, 4000), 90000);
  return r.recommendations
    .map((x) => ({ title: x.title.trim().slice(0, 200), detail: x.detail.trim().slice(0, 1000) }))
    .filter((x) => x.title)
    .slice(0, 5);
}

/** Las IAs que pueden contestar con búsqueda en internet (las tres la tienen). */
export const visibilityProviders = (): TextProvider[] => availableText().map((p) => p.id);

/** Hace cada pregunta a cada IA con clave, con búsqueda en internet, y arma el reporte. */
export async function checkVisibility(business: BusinessVis, questions: string[], lang: UiLang): Promise<VisibilityReport> {
  const providers = visibilityProviders();
  if (!providers.length)
    throw bi(
      "Falta la clave de al menos una IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en la configuración del servidor.",
      "At least one AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is missing from the server settings.",
    );
  const qs = cleanQuestions(questions);
  if (!qs.length) throw bi("Escribe al menos una pregunta.", "Write at least one question.");
  const startedAt = new Date().toISOString();
  const m = mentionMatcher(business);

  const raw = await Promise.all(
    qs.flatMap((question) =>
      providers.map(async (provider) => {
        try {
          const r = await searchAnswer(provider, question, { system: NEUTRAL_SYSTEM, timeoutMs: 60000 });
          if (!r.text.trim()) throw bi("La IA no devolvió respuesta.", "The AI sent back an empty answer.");
          return { question, provider, text: r.text, sources: r.sources, error: undefined as string | undefined };
        } catch (e) {
          console.error(`Visibilidad en IA: ${provider} falló`, e);
          return { question, provider, text: "", sources: [] as StudySource[], error: errorText(e, lang) };
        }
      }),
    ),
  );
  const ok = raw.map((r, id) => ({ ...r, id })).filter((r) => !r.error);
  if (!ok.length) throw bi(`Ninguna IA pudo contestar: ${raw[0]?.error ?? ""}`, `None of the AIs could answer: ${raw[0]?.error ?? ""}`);

  let lists = new Map<number, string[]>();
  try {
    lists = await extractBusinesses(business.aiText ?? "", ok);
  } catch (e) {
    console.error("Visibilidad en IA: no se pudieron sacar los competidores", e);
  }

  const results: VisibilityResult[] = raw.map((r, id) => {
    const list = lists.get(id) ?? [];
    const position = positionOf(list, m);
    const answer = r.text.length > ANSWER_MAX ? `${r.text.slice(0, ANSWER_MAX).trimEnd()}…` : r.text;
    return {
      question: r.question,
      provider: r.provider,
      answer,
      mentioned: !r.error && (m.inText(r.text) || m.inSources(r.sources) || position !== null),
      position,
      sources: r.sources.slice(0, SOURCES_MAX),
      competitors: list.filter((n) => !m.isBusiness(n)),
      ...(r.error ? { error: r.error } : {}),
    };
  });
  const { score, byProvider } = computeScores(results);
  const base = {
    questions: qs,
    results,
    score,
    byProvider,
    topCompetitors: rankCompetitors(results),
    // Para contar las páginas citadas se usan todas las fuentes, no solo las 6 que se guardan.
    topDomains: rankDomains(raw, business.website),
    lang,
    startedAt,
  };
  let recommendations: Recommendation[] = [];
  try {
    recommendations = await recommend(business, base, lang);
  } catch (e) {
    console.error("Visibilidad en IA: no se pudieron escribir las recomendaciones", e);
  }
  return { ...base, recommendations, finishedAt: new Date().toISOString() };
}
