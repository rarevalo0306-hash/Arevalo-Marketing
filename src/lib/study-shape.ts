// Estudio del negocio: lo que la IA entiende del negocio, su mercado local, las palabras que busca
// la gente (SEO) y qué anunciar. Se guarda en Business.study y lo usa todo lo que escribe y diseña la IA.
import { z } from "zod";
import type { UiLang } from "@/lib/i18n";

// [id, español, inglés]
export const GOALS = [
  ["llamadas", "Más llamadas y mensajes", "More calls and messages"],
  ["citas", "Más citas o evaluaciones", "More appointments or estimates"],
  ["web", "Más visitas a la página web", "More website visits"],
  ["ventas", "Más ventas", "More sales"],
  ["marca", "Que más gente conozca la marca", "More people knowing the brand"],
] as const;
export type Goal = (typeof GOALS)[number][0];

export const PRIORITIES = ["alta", "media", "baja"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Un tipo de cliente que eligió el dueño. `priority` es su lugar en la lista: 1 = el más importante. */
export const IdealCustomer = z.object({
  name: z.string().max(120),
  why: z.string().max(300).default(""),
  priority: z.number().int().min(1).max(12),
});
export type IdealCustomer = z.infer<typeof IdealCustomer>;
/** Un tipo de cliente que la IA sugirió y el dueño todavía no eligió. */
export const CustomerOption = z.object({ name: z.string().max(120), why: z.string().max(300).default("") });
export type CustomerOption = z.infer<typeof CustomerOption>;

/** Lo que el dueño contesta antes de generar el estudio. */
export const StudyInput = z.object({
  services: z.string().max(2000),
  /** Texto con los clientes elegidos, en orden (se guarda también para estudios viejos y para la IA). */
  customers: z.string().max(1000),
  /** Clientes ideales elegidos, del más importante al menos importante. Los estudios viejos no lo tienen. */
  idealCustomers: z.array(IdealCustomer).max(12).default([]),
  /** Otros tipos de cliente que sugirió la IA (para volver a elegirlos). */
  customerOptions: z.array(CustomerOption).max(12).default([]),
  zone: z.string().max(300),
  competitors: z.string().max(600),
  different: z.string().max(1000),
  goal: z.enum(GOALS.map((g) => g[0]) as [Goal, ...Goal[]]),
  lang: z.enum(["es", "en", "both"]),
  /** Las preguntas que hizo la IA en la entrevista y lo que contestó el dueño. */
  answers: z.array(z.object({ question: z.string().max(300), answer: z.string().max(1000) })).max(10).default([]),
});
export type StudyInput = z.infer<typeof StudyInput>;

export const EMPTY_INPUT: StudyInput = { services: "", customers: "", idealCustomers: [], customerOptions: [], zone: "", competitors: "", different: "", goal: "llamadas", lang: "es", answers: [] };

/** Los clientes ideales en orden. Los estudios viejos solo tenían un texto ("Dueños de casa, negocios"): se parte en una lista. */
export function idealCustomersOf(input: Pick<StudyInput, "customers"> & { idealCustomers?: IdealCustomer[] }): IdealCustomer[] {
  if (input.idealCustomers?.length) return [...input.idealCustomers].sort((a, b) => a.priority - b.priority);
  return input.customers
    .split(/\s*(?:[,;\n]|\s+y\s+|\s+and\s+)\s*/i)
    .map((n) => n.trim().replace(/\.$/, ""))
    .filter((n) => n.length > 1)
    .slice(0, 12)
    .map((name, i) => ({ name: name.slice(0, 120), why: "", priority: i + 1 }));
}

/** Prioridad en palabras según el lugar en la lista: los 2 primeros alta, los 2 siguientes media, el resto baja. */
export const priorityOf = (place: number): Priority => (place <= 2 ? "alta" : place <= 4 ? "media" : "baja");

/** Los clientes ideales como texto para la IA: "1. Dueños de casa (alta prioridad): por qué". */
export function customersText(input: Pick<StudyInput, "customers"> & { idealCustomers?: IdealCustomer[] }): string {
  const list = idealCustomersOf(input);
  if (!list.length) return input.customers.trim();
  return list.map((c, i) => `${i + 1}. ${c.name} (${priorityOf(i + 1)} priority)${c.why ? `: ${c.why}` : ""}`).join("\n");
}

/** Preguntas que la IA le hace al dueño, a la medida de su negocio, antes de hacer el estudio. */
export const InterviewSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().describe("A short, friendly question in Spanish with correct accents, addressed with tú"),
        why: z.string().describe("Very short reason in Spanish (max 12 words) why this helps the marketing"),
        options: z.array(z.string()).describe("3 to 7 likely answers in Spanish, 1-4 words each, specific to this business and area"),
        multiple: z.boolean().describe("true if the owner can pick several options"),
      }),
    )
    .describe("4 to 6 questions"),
});
export type Interview = z.infer<typeof InterviewSchema>;

/** Lo que la IA saca de la página web (y del perfil guardado) para llenar el paso 1 del estudio. */
export const WebProfileSchema = z.object({
  found: z.boolean().describe("true if the website or profile text had real information about this business"),
  services: z
    .string()
    .describe("What the business sells or the services it offers, in Spanish with correct accents, 1-4 plain sentences, ONLY from the website or profile. Empty string if unknown"),
  zone: z
    .string()
    .describe("Where it works: cities, counties, state or country it serves, as the website or profile says (e.g. 'Miami-Dade, Broward y Palm Beach, Florida'). Empty string if not stated"),
  customers: z
    .array(
      z.object({
        name: z.string().describe("Customer type in Spanish, 2-5 words, plural, e.g. 'Dueños de casa', 'Administradoras de propiedades'"),
        why: z.string().describe("In Spanish, max 14 words: why this customer needs the business"),
        priority: z.enum(PRIORITIES).describe("How important this customer seems for the business, based on the website"),
      }),
    )
    .describe("5 or 6 different types of customers that would hire or buy from this business, most important first"),
  lang: z.enum(["es", "en", "both"]).describe("The language(s) its customers speak, from the website languages and the area"),
  goal: z.enum(GOALS.map((g) => g[0]) as [Goal, ...Goal[]]).describe("The most likely marketing goal: llamadas (calls and messages), citas (appointments or estimates), web (website visits), ventas (sales) or marca (brand awareness)"),
  different: z.string().describe("In Spanish, one line: what makes it different according to the website (license, warranty, free estimate, languages, years). Empty string if nothing"),
  profile: z
    .string()
    .describe(`A business profile in Spanish with correct accents for the AI writer, 100-220 words, using ONLY facts from the website or the current profile: services, area served, languages, contact details, how it works. No invented numbers, prices, years or results.`),
});
export type WebProfile = z.infer<typeof WebProfileSchema>;

/** De la sugerencia de la IA a lo que llena el paso 1 (los 3 primeros clientes quedan elegidos; el resto, como opciones). */
export function inputFromWebProfile(p: WebProfile, prev: StudyInput): StudyInput {
  const seen = new Set<string>();
  const list = p.customers
    .map((c) => ({ name: c.name.trim().slice(0, 120), why: c.why.trim().slice(0, 300), priority: c.priority }))
    .filter((c) => c.name && !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase()))
    .sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority))
    .slice(0, 8);
  const chosenNow = idealCustomersOf(prev);
  const chosen = chosenNow.length ? chosenNow : list.slice(0, 3).map((c, i) => ({ name: c.name, why: c.why, priority: i + 1 }));
  const taken = new Set(chosen.map((c) => c.name.toLowerCase()));
  const options = [...prev.customerOptions, ...list.map(({ name, why }) => ({ name, why }))].filter((c) => !taken.has(c.name.toLowerCase()) && taken.add(c.name.toLowerCase()));
  return {
    ...prev,
    services: (p.services.trim() || prev.services).slice(0, 2000),
    zone: (p.zone.trim() || prev.zone).slice(0, 300),
    different: (prev.different.trim() || p.different.trim()).slice(0, 1000),
    lang: p.lang,
    goal: p.goal,
    idealCustomers: chosen,
    customerOptions: options.slice(0, 12),
    customers: chosen.map((c) => c.name).join(", ").slice(0, 1000),
  };
}

const ES = "in Spanish with correct accents";

const audienceFields = {
  name: z.string().describe(`Short persona name ${ES}, e.g. "Dueño de casa con reclamo negado"`),
  description: z.string().describe(`Who they are, 1-2 sentences ${ES}`),
  pains: z.array(z.string()).describe(`2-4 problems or worries, ${ES}`),
  channels: z.string().describe(`Where to reach them (which social networks, Google, etc.), ${ES}`),
};

export const StudySchema = z.object({
  summary: z.string().describe(`3-5 sentences ${ES}: what the business does, for whom, where, and the main marketing opportunity`),
  suggestedProfile: z
    .string()
    .describe(`A business profile ${ES} for the AI writer, 120-250 words, using ONLY facts the owner gave or that appear on the business's own website: services, area served, languages, contact details, offers. No invented numbers, prices, years or results.`),
  services: z.array(z.object({ name: z.string(), description: z.string().describe(`One sentence ${ES}`) })).describe("The services or products to advertise, most important first (3-8)"),
  audiences: z
    .array(
      z.object({
        ...audienceFields,
        priority: z.enum(PRIORITIES).describe("How important this customer is for the business: alta, media or baja. Follow the owner's order"),
      }),
    )
    .describe("4-6 ideal customer profiles, most important first. Include every customer type the owner chose, in the owner's order, then add others that fit"),
  differentiators: z.array(z.string()).describe(`3-5 reasons to choose this business, ${ES}, only from what the owner said or the website shows`),
  objections: z.array(z.object({ objection: z.string(), answer: z.string() })).describe(`3-5 common doubts customers have and an honest way to answer them, ${ES}`),
  market: z.object({
    area: z.string().describe(`The local market in 2-3 sentences ${ES}`),
    places: z.array(z.string()).describe("Cities, neighborhoods or ZIP areas to target, most important first (3-10)"),
    seasonality: z.array(z.string()).describe(`When demand rises or falls during the year, ${ES} (2-5 items, e.g. "Junio a noviembre: temporada de huracanes")`),
    competitors: z.array(z.object({ name: z.string(), note: z.string().describe(`What they do well or how to stand apart, ${ES}`) })).describe("Up to 5 competitors found in the research or named by the owner; empty if none"),
    opportunities: z.array(z.string()).describe(`3-5 concrete marketing opportunities in this market, ${ES}`),
  }),
  keywords: z
    .array(
      z.object({
        keyword: z.string().describe("What people actually type in Google, in the language they search in (Spanish or English); include local versions with the city"),
        lang: z.enum(["es", "en"]),
        intent: z.enum(["local", "comercial", "informativa"]).describe("local = looking for a business nearby; comercial = ready to hire or buy; informativa = wants to learn"),
        volume: z.enum(["alto", "medio", "bajo"]).describe("Estimated monthly search volume in this area, relative to the others"),
        difficulty: z.enum(["alta", "media", "baja"]).describe("Estimated competition to rank for it"),
        idea: z.string().describe(`A post or article title ${ES} that targets this keyword`),
      }),
    )
    .describe("15-25 SEO keywords, a mix of local, commercial and informational; prioritize low difficulty and local intent"),
  ads: z.object({
    metaAudience: z.string().describe(`Facebook/Instagram ad audience ${ES}: ages, radius around the area, interests and behaviors`),
    googleKeywords: z.array(z.string()).describe("8-15 Google Ads keywords with commercial or local intent"),
    negativeKeywords: z.array(z.string()).describe("5-10 negative keywords to avoid wasted clicks (e.g. jobs, free, DIY)"),
    budgetTip: z.string().describe(`How to start with a small budget and what to measure, ${ES}, 2-3 sentences, no promised results`),
  }),
  pillars: z
    .array(z.object({ name: z.string(), description: z.string().describe(`What posts in this pillar talk about, ${ES}`), share: z.number().describe("Percent of posts, all pillars add up to 100") }))
    .describe("3-5 content pillars"),
  campaigns: z
    .array(
      z.object({
        title: z.string().describe(`Short campaign or post title ${ES}`),
        audience: z.string().describe("Which of the audiences above"),
        hook: z.string().describe(`First line that stops the scroll, ${ES}`),
        message: z.string().describe(`The main message in 1-2 sentences ${ES}, with a call to action`),
        photo: z.string().describe("In English: a photo that fits (no text in the image, no logos, no real people's faces)"),
        video: z.string().describe(`A 10-20 second vertical video idea ${ES}: what is seen and said`),
      }),
    )
    .describe("6-10 ready-to-use campaign and post ideas, varied across audiences, pillars and seasons"),
  visualStyle: z.string().describe("In English, 2-3 sentences: the look of photos and videos for this brand (settings, subjects, light, mood) for an image generator"),
  avoid: z.array(z.string()).describe(`Things the marketing must never say or promise for this business, ${ES} (3-6)`),
  caveats: z.string().describe(`One or two sentences ${ES}: what is an estimate (search volumes and difficulty are AI estimates, not Google data) and what to verify`),
});
/** Para leer lo guardado: los estudios viejos no tienen la prioridad de cada cliente. */
const StudyReadSchema = StudySchema.extend({
  audiences: z.array(z.object({ ...audienceFields, priority: z.enum(PRIORITIES).optional() })),
});
export type Study = z.infer<typeof StudyReadSchema>;
export type StudySource = { url: string; title: string };
export type SavedStudy = Study & { sources: StudySource[]; researched: boolean };

/** Lee el estudio guardado; si falta o está dañado, null. */
export function readStudy(json: unknown): SavedStudy | null {
  const parsed = StudyReadSchema.safeParse(json);
  if (!parsed.success) return null;
  const extra = (json ?? {}) as { sources?: unknown; researched?: unknown };
  const sources = Array.isArray(extra.sources)
    ? extra.sources.filter((s): s is StudySource => typeof s?.url === "string" && /^https?:\/\//.test(s.url)).map((s) => ({ url: s.url, title: String(s.title ?? "") }))
    : [];
  return { ...parsed.data, sources, researched: extra.researched === true };
}

export function readInput(json: unknown): StudyInput | null {
  const parsed = StudyInput.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Qué tan buena es una palabra clave para un negocio local: local y comercial, volumen alto, dificultad baja. */
export const keywordScore = (k: Study["keywords"][number]) =>
  ({ local: 3, comercial: 2, informativa: 1 })[k.intent] * 3 + { alto: 3, medio: 2, bajo: 1 }[k.volume] * 2 + { baja: 3, media: 2, alta: 1 }[k.difficulty];

/** Palabras clave más útiles primero: local y comercial, volumen alto, dificultad baja. */
export function topKeywords(study: Study, n = 12): string[] {
  return [...study.keywords].sort((a, b) => keywordScore(b) - keywordScore(a)).slice(0, n).map((k) => k.keyword);
}

/** Los clientes del estudio, de la prioridad más alta a la más baja (los estudios viejos quedan en su orden). */
export function audiencesByPriority(study: Study): Study["audiences"] {
  const rank = (p?: Priority) => (p ? PRIORITIES.indexOf(p) : 1);
  return study.audiences.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a.priority) - rank(y.a.priority) || x.i - y.i).map((x) => x.a);
}

/** Postgres no guarda el carácter nulo (\u0000) en JSON: se quita para que el estudio siempre se pueda guardar. */
export function jsonSafe<T>(value: T): T {
  const clean = (v: unknown): unknown =>
    typeof v === "string"
      ? v.replaceAll("\u0000", "")
      : Array.isArray(v)
        ? v.map(clean)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]))
          : v;
  return clean(JSON.parse(JSON.stringify(value))) as T;
}

/**
 * Al borrar el estudio se guarda una copia para poder recuperarlo (Business.study = { deleted: {...} }).
 * Esa forma no pasa readStudy, así que para todo lo demás el negocio queda sin estudio.
 */
export type DeletedStudy = { at: string; study: SavedStudy; studyInput: unknown; studyAt: string | null };
export function readDeleted(json: unknown): DeletedStudy | null {
  const d = (json as { deleted?: { at?: unknown; study?: unknown; studyInput?: unknown; studyAt?: unknown } } | null)?.deleted;
  if (!d) return null;
  const study = readStudy(d.study);
  if (!study) return null;
  return { at: String(d.at ?? ""), study, studyInput: d.studyInput ?? null, studyAt: typeof d.studyAt === "string" ? d.studyAt : null };
}

/** Lo que la IA debe tener en cuenta del estudio al escribir y crear fotos. Es estrategia, no hechos del negocio. */
export function studyContext(json: unknown): string {
  const s = readStudy(json);
  if (!s) return "";
  const lines = [
    `Ideal customers, most important first: ${audiencesByPriority(s).map((a) => `${a.name}${a.priority ? ` [${a.priority} priority]` : ""} (${a.pains.join("; ")})`).join(" | ")}`,
    `Areas to mention when it fits: ${s.market.places.slice(0, 8).join(", ")}`,
    `Seasonality: ${s.market.seasonality.join(" | ")}`,
    `Content pillars: ${s.pillars.map((p) => `${p.name} (${p.share}%): ${p.description}`).join(" | ")}`,
    `SEO keywords to use naturally where they fit: ${topKeywords(s).join(", ")}`,
    `Visual style for photos and videos: ${s.visualStyle}`,
    `Never say or promise: ${s.avoid.join("; ")}`,
  ];
  return lines.join("\n").slice(0, 3000);
}

/** Ideas de publicaciones del estudio para el Inicio. */
export function studyIdeas(json: unknown, n = 5): string[] {
  const s = readStudy(json);
  return s ? s.campaigns.slice(0, n).map((c) => c.title) : [];
}

/** Texto que se manda al compositor para crear una publicación a partir de una idea de campaña. */
export function campaignIdea(c: Study["campaigns"][number], lang: UiLang = "es"): string {
  return lang === "en"
    ? `${c.title}\nFor: ${c.audience}\nHook: ${c.hook}\nMessage: ${c.message}\nPhoto: ${c.photo}`
    : `${c.title}\nPara: ${c.audience}\nGancho: ${c.hook}\nMensaje: ${c.message}\nFoto: ${c.photo}`;
}

/** Saca el texto visible de una página web (sin scripts, estilos ni etiquetas). */
export function htmlToText(html: string, max = 8000): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const description = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? "";
  const body = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|section|article|br|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const decode = (t: string) =>
    t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const text = decode([title, description, body].join("\n"))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return text.slice(0, max);
}
