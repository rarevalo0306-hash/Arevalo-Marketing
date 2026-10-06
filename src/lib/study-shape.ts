// Estudio del negocio: lo que la IA entiende del negocio, su mercado local, las palabras que busca
// la gente (SEO) y qué anunciar. Se guarda en Business.study y lo usa todo lo que escribe y diseña la IA.
import { z } from "zod";

export const GOALS = [
  ["llamadas", "Más llamadas y mensajes"],
  ["citas", "Más citas o evaluaciones"],
  ["web", "Más visitas a la página web"],
  ["ventas", "Más ventas"],
  ["marca", "Que más gente conozca la marca"],
] as const;
export type Goal = (typeof GOALS)[number][0];

/** Lo que el dueño contesta antes de generar el estudio. */
export const StudyInput = z.object({
  services: z.string().max(2000),
  customers: z.string().max(1000),
  zone: z.string().max(300),
  competitors: z.string().max(600),
  different: z.string().max(1000),
  goal: z.enum(GOALS.map((g) => g[0]) as [Goal, ...Goal[]]),
  lang: z.enum(["es", "en", "both"]),
  /** Las preguntas que hizo la IA en la entrevista y lo que contestó el dueño. */
  answers: z.array(z.object({ question: z.string().max(300), answer: z.string().max(1000) })).max(10).default([]),
});
export type StudyInput = z.infer<typeof StudyInput>;

export const EMPTY_INPUT: StudyInput = { services: "", customers: "", zone: "", competitors: "", different: "", goal: "llamadas", lang: "es", answers: [] };

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

const ES = "in Spanish with correct accents";

export const StudySchema = z.object({
  summary: z.string().describe(`3-5 sentences ${ES}: what the business does, for whom, where, and the main marketing opportunity`),
  suggestedProfile: z
    .string()
    .describe(`A business profile ${ES} for the AI writer, 120-250 words, using ONLY facts the owner gave or that appear on the business's own website: services, area served, languages, contact details, offers. No invented numbers, prices, years or results.`),
  services: z.array(z.object({ name: z.string(), description: z.string().describe(`One sentence ${ES}`) })).describe("The services or products to advertise, most important first (3-8)"),
  audiences: z
    .array(
      z.object({
        name: z.string().describe(`Short persona name ${ES}, e.g. "Dueño de casa con reclamo negado"`),
        description: z.string().describe(`Who they are, 1-2 sentences ${ES}`),
        pains: z.array(z.string()).describe(`2-4 problems or worries, ${ES}`),
        channels: z.string().describe(`Where to reach them (which social networks, Google, etc.), ${ES}`),
      }),
    )
    .describe("2-4 ideal customer profiles"),
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
export type Study = z.infer<typeof StudySchema>;
export type StudySource = { url: string; title: string };
export type SavedStudy = Study & { sources: StudySource[]; researched: boolean };

/** Lee el estudio guardado; si falta o está dañado, null. */
export function readStudy(json: unknown): SavedStudy | null {
  const parsed = StudySchema.safeParse(json);
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

/** Palabras clave más útiles primero: local y comercial, volumen alto, dificultad baja. */
export function topKeywords(study: Study, n = 12): string[] {
  const score = (k: Study["keywords"][number]) =>
    ({ local: 3, comercial: 2, informativa: 1 })[k.intent] * 3 + { alto: 3, medio: 2, bajo: 1 }[k.volume] * 2 + { baja: 3, media: 2, alta: 1 }[k.difficulty];
  return [...study.keywords].sort((a, b) => score(b) - score(a)).slice(0, n).map((k) => k.keyword);
}

/** Lo que la IA debe tener en cuenta del estudio al escribir y crear fotos. Es estrategia, no hechos del negocio. */
export function studyContext(json: unknown): string {
  const s = readStudy(json);
  if (!s) return "";
  const lines = [
    `Ideal customers: ${s.audiences.map((a) => `${a.name} (${a.pains.join("; ")})`).join(" | ")}`,
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
export function campaignIdea(c: Study["campaigns"][number]): string {
  return `${c.title}\nPara: ${c.audience}\nGancho: ${c.hook}\nMensaje: ${c.message}\nFoto: ${c.photo}`;
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
