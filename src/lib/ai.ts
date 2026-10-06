// Agente de IA: escribe publicaciones adaptadas a cada canal y arma planes semanales.
// Usa Google Gemini si hay GEMINI_API_KEY (más barato); si no, Claude con ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ChannelId } from "@/lib/channels";
import { FONTS, TemplateSpec } from "@/lib/design-shapes";
import { bi, errorText, type UiLang } from "@/lib/i18n";
import { GOALS, htmlToText, type Interview, InterviewSchema, type SavedStudy, type StudyInput, StudySchema, type StudySource, studyContext } from "@/lib/study-shape";

export const TEXT_PROVIDERS = [
  { id: "gemini", name: "Google Gemini", env: "GEMINI_API_KEY" },
  { id: "claude", name: "Claude (Anthropic)", env: "ANTHROPIC_API_KEY" },
  { id: "openai", name: "ChatGPT (OpenAI)", env: "OPENAI_API_KEY" },
] as const;
export type TextProvider = (typeof TEXT_PROVIDERS)[number]["id"];

/** Las IAs que tienen clave en el servidor. */
export const availableText = () => TEXT_PROVIDERS.filter((p) => Boolean(process.env[p.env]));
export const aiEnabled = () => availableText().length > 0;

/** La que eligió el negocio, o la primera disponible. */
export function pickText(pref: string): TextProvider | null {
  const list = availableText();
  return (list.find((p) => p.id === pref) ?? list[0])?.id ?? null;
}

export type Lang = "es" | "en" | "both";
const LANG_TEXT: Record<Lang, string> = {
  es: "Write everything in Spanish.",
  en: "Write everything in English.",
  both: "Write each text bilingually: Spanish first, then the English version below it (except SMS and the email subject, which use Spanish only).",
};

const PostSchema = z.object({
  facebook: z.string().describe("Facebook post: 2-5 short paragraphs, clear call to action, 0-3 hashtags at the end"),
  instagram: z.string().describe("Instagram caption: strong first line, short lines, call to action, 5-10 relevant hashtags at the end"),
  tiktok: z.string().describe("TikTok caption: one or two short sentences plus 3-5 hashtags"),
  google: z.string().describe("Google Business Profile update: plain, local, under 1400 characters, no hashtags"),
  sms: z.string().describe("Text message: under 130 characters, no hashtags, no emoji, no links unless the business profile provides one"),
  emailSubject: z.string().describe("Email subject line under 60 characters"),
  email: z.string().describe("Email body: friendly, 2-4 short paragraphs, plain text"),
  seoTitle: z.string().describe("Website article title under 60 characters, in Spanish"),
  imageSteps: z.array(z.string()).describe("If the post is a how-to, up to 3 very short steps (max 6 words each) for a list image, in the post's main language; otherwise an empty list"),
  imageHeadline: z.string().describe("Headline printed on the post image: 3 to 7 words, in the post's main language (Spanish if bilingual), no hashtags, no emoji, no phone numbers"),
  imageIdea: z.string().describe("In English: a one-sentence description of a photo that would fit this post (no text in the image, no logos, no real people's faces)"),
});
export type AiPost = z.infer<typeof PostSchema>;

const PlanSchema = z.object({
  posts: z.array(
    z.object({
      day: z.number().int().min(0).max(6).describe("Day offset from the start date (0 = first day)"),
      time: z.string().describe("Local time to publish, HH:MM 24h, during business-friendly hours"),
      topic: z.string().describe("Short topic label in Spanish"),
      post: PostSchema,
    }),
  ),
});
export type AiPlan = z.infer<typeof PlanSchema>;

type BusinessAi = { name: string; website: string; aiProfile: string; aiText?: string; brandVoice?: string; hashtags?: string; study?: unknown };

function rules(business: BusinessAi, lang: Lang): string {
  const study = studyContext(business.study);
  return `You are the social media manager for "${business.name}"${business.website ? ` (${business.website})` : ""}.

What the business told you about itself (the ONLY facts you may state about it):
<business_profile>
${business.aiProfile.trim() || "(no profile yet — keep statements about the business generic)"}
</business_profile>
${study ? `\nMarketing study of this business (strategy: who to talk to, which words people search, which areas and what the photos look like; use it to choose angles, keywords and image ideas, but it is NOT a source of facts about the business):\n<marketing_study>\n${study}\n</marketing_study>\n` : ""}${business.brandVoice?.trim() ? `\nBrand voice (follow it):\n<brand_voice>\n${business.brandVoice.trim()}\n</brand_voice>\n` : ""}${business.hashtags?.trim() ? `\nBrand hashtags (use some of them where hashtags fit): ${business.hashtags.trim()}\n` : ""}
Rules:
- Never invent facts about the business: no prices, discounts, statistics, years of experience, awards, license numbers, phone numbers, addresses or results unless they appear in the business profile.
- If the business is a public adjuster or insurance-related: never promise or imply a result, a payout, a percentage or "more money"; do not give legal advice; say "free initial evaluation" only if the profile says so; keep claims general and educational.
- No fake urgency, no fear-mongering, no medical or legal claims.
- Use plain words a homeowner understands. Emoji are fine on Facebook, Instagram and TikTok, sparingly.
- Do not use markdown (no **bold**, no # headings): social networks show the symbols literally.
- Spanish text must always use correct accents and punctuation (después, inspección, daño, ¿…?, ¡…!), including the image headline.
- ${LANG_TEXT[lang]}`;
}

const refused = () => bi("La IA no quiso escribir sobre ese tema. Prueba con otra idea.", "The AI wouldn't write about that topic. Try a different idea.");
const invalidReply = () => bi("La IA no devolvió una respuesta válida. Intenta de nuevo.", "The AI didn't send back a valid answer. Please try again.");

/** Para el estudio y la entrevista en inglés: el texto para el dueño sale en inglés aunque el esquema diga español. */
const OWNER_ENGLISH =
  "- LANGUAGE OVERRIDE: Write every owner-facing text (questions, options, reasons, summary, profile, descriptions, ideas, notes) in English, even where a field description says Spanish; SEO keywords stay in the language customers search in. Keep fixed option values (enums) exactly as listed.";

function parseJson<T extends z.ZodTypeAny>(schema: T, text: string): z.infer<T> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw invalidReply();
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw bi("La IA no devolvió una respuesta completa. Intenta de nuevo.", "The AI's answer came back incomplete. Please try again.");
  return parsed.data;
}

// Si un modelo está saturado, se prueba el siguiente.
const GEMINI_MODELS = () => [...new Set([process.env.GEMINI_MODEL || "gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"])];

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
};

/** Llama a Gemini probando varios modelos si uno está saturado, y traduce los errores para el dueño. */
async function geminiFetch(payload: string): Promise<GeminiResponse> {
  let res: Response | null = null;
  // Dos vueltas por los modelos: si todos están saturados, se espera unos segundos y se reintenta.
  const attempts = [...GEMINI_MODELS(), ...GEMINI_MODELS()];
  for (const [i, model] of attempts.entries()) {
    if (i === GEMINI_MODELS().length) await new Promise((r) => setTimeout(r, 4000));
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
      body: payload,
    });
    if (res.status !== 503 && res.status !== 500 && res.status !== 404) break;
  }
  if (!res) throw bi("No se pudo llamar a Gemini.", "Couldn't reach Gemini.");
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 503) throw bi("Gemini está muy ocupado en este momento. Intenta de nuevo en un minuto.", "Gemini is very busy right now. Try again in a minute.");
    if (res.status === 429) throw bi("Gemini llegó a su límite por ahora. Espera un minuto o activa la facturación en Google AI Studio.", "Gemini has hit its limit for now. Wait a minute or turn on billing in Google AI Studio.");
    if (res.status === 400 && body.includes("API key")) throw bi("Google rechazó la clave de Gemini (GEMINI_API_KEY).", "Google rejected the Gemini key (GEMINI_API_KEY).");
    throw bi(`Gemini respondió ${res.status}: ${body.slice(0, 300)}`, `Gemini responded ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = JSON.parse(body) as GeminiResponse;
  const c = data.candidates?.[0];
  if (c?.finishReason === "SAFETY" || c?.finishReason === "PROHIBITED_CONTENT") throw refused();
  return data;
}

const geminiText = (data: GeminiResponse) => data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

async function askGemini<T extends z.ZodTypeAny>(schema: T, system: string, user: string, maxTokens: number, files: GeminiPart[] = []): Promise<z.infer<T>> {
  const data = await geminiFetch(
    JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [...files, { text: user }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(schema), maxOutputTokens: maxTokens },
    }),
  );
  return parseJson(schema, geminiText(data));
}

function plainSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const out = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete out.$schema;
  return out;
}

async function askOpenAI<T extends z.ZodTypeAny>(schema: T, system: string, user: string, maxTokens: number): Promise<z.infer<T>> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      max_completion_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: plainSchema(schema) } },
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw bi("OpenAI rechazó la clave (OPENAI_API_KEY).", "OpenAI rejected the key (OPENAI_API_KEY).");
    if (res.status === 429)
      throw bi(
        "ChatGPT llegó a su límite o tu cuenta de OpenAI no tiene saldo (platform.openai.com/settings/organization/billing).",
        "ChatGPT hit its limit or your OpenAI account is out of credit (platform.openai.com/settings/organization/billing).",
      );
    throw bi(`ChatGPT respondió ${res.status}: ${body.slice(0, 300)}`, `ChatGPT responded ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = JSON.parse(body) as { choices?: { message?: { content?: string | null; refusal?: string | null } }[] };
  const m = data.choices?.[0]?.message;
  if (m?.refusal) throw refused();
  return parseJson(schema, m?.content ?? "");
}

async function askClaude<T extends z.ZodTypeAny>(schema: T, system: string, user: string, maxTokens: number): Promise<z.infer<T>> {
  const response = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: maxTokens,
    // Si Claude Opus 5.5 declina por error, la API reintenta sola con otro modelo.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") throw refused();
  if (!response.parsed_output) throw invalidReply();
  return response.parsed_output;
}

/** Pide a la IA elegida (o la primera disponible) una respuesta con la forma de `schema`. */
export async function ask<T extends z.ZodTypeAny>(pref: string, schema: T, system: string, user: string, maxTokens = 16000): Promise<z.infer<T>> {
  const provider = pickText(pref);
  if (provider === "gemini") return askGemini(schema, system, user, maxTokens);
  if (provider === "openai") return askOpenAI(schema, system, user, maxTokens);
  if (provider === "claude") return askClaude(schema, system, user, maxTokens);
  throw bi(
    "Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en la configuración del servidor.",
    "The AI key is missing from the server settings (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY).",
  );
}

/** Escribe una publicación con versiones para cada canal a partir de una idea. */
export async function writePost(
  business: BusinessAi,
  idea: string,
  lang: Lang,
): Promise<AiPost> {
  return ask(business.aiText ?? "", PostSchema, rules(business, lang), `Write one post about this idea, with a version for each channel:\n\n${idea}`);
}

/** Plan de publicaciones para una semana. */
export async function planWeek(
  business: BusinessAi,
  opts: { startDate: string; count: number; themes: string; lang: Lang },
): Promise<AiPlan> {
  const user = `Plan ${opts.count} posts for the 7 days starting ${opts.startDate}. Spread them across different days and vary the topics (education, tips, seasonal risks, trust-building, a clear invitation to contact the business).
${opts.themes.trim() ? `The owner wants these themes included: ${opts.themes.trim()}` : ""}
Write the full post for each one, with a version for each channel.`;
  return ask(business.aiText ?? "", PlanSchema, rules(business, opts.lang), user, 32000);
}

const StormSchema = z.object({
  posts: z.array(
    z.object({
      phase: z.enum(["seguridad", "oferta"]).describe("seguridad = safety and help only, no offer of services; oferta = invites people to contact the business"),
      hoursAfter: z.number().int().min(1).max(336).describe("Hours after the event to publish"),
      topic: z.string().describe("Short topic label in Spanish"),
      post: PostSchema,
    }),
  ),
});
export type AiStormPlan = z.infer<typeof StormSchema>;

/** Campaña de tormenta: primero ayuda (sin vender) y, pasadas 48 horas, la invitación a contactar. */
export async function stormPlan(business: BusinessAi, opts: { event: string; zone: string; lang: Lang }): Promise<AiStormPlan> {
  const user = `A ${opts.event} just hit ${opts.zone.trim() || "the area the business serves"}. Write a 6-post campaign for the days after it.
- Posts 1-3, phase "seguridad", within the first 48 hours (hoursAfter 2 to 40): safety first, how to protect the home from more damage, how to document the damage with photos and videos, keep receipts, do not throw away damaged items before documenting, report the claim to the insurer. Do NOT offer the business's services, do not ask people to call or hire the business in these posts; only helpful information and the business name.
- Posts 4-6, phase "oferta", from hoursAfter 50 to 240: a direct, confident invitation to contact the business for help with the claim (for example: the insurer has its own adjuster, who works for you?; do not accept the first offer without understanding your policy; a denied or underpaid claim can be reviewed). Strong and urgent in tone, but never promise results, money or percentages, and never say people will lose their claim.
- Mention the area by name when it fits.`;
  return ask(business.aiText ?? "", StormSchema, rules(business, opts.lang), user, 20000);
}

/** Convierte la respuesta de la IA en texto base + variantes por canal + asunto y título. */
export function toPostFields(p: AiPost): { text: string; subject: string; seoTitle: string; variants: Partial<Record<ChannelId, string>> } {
  return {
    text: p.facebook,
    subject: p.emailSubject,
    seoTitle: p.seoTitle,
    variants: {
      facebook: p.facebook,
      instagram: p.instagram,
      tiktok: p.tiktok,
      google: p.google,
      sms: p.sms,
      email: p.email,
      seo: p.facebook,
    },
  };
}

const TemplatesSchema = z.object({ templates: z.array(TemplateSpec).describe("Between 4 and 6 different templates") });

/** La IA diseña plantillas para la marca: variadas, legibles y con los colores y el estilo del negocio. */
export async function designTemplates(business: BusinessAi & { color: string; color2: string; color3: string; fontHeading: string }): Promise<TemplateSpec[]> {
  const system = `You are a senior graphic designer creating reusable social media post templates for the brand "${business.name}".
Brand colors: color1 ${business.color}, color2 ${business.color2 || "(same as color1)"}, color3 ${business.color3 || "(same as color2)"}. Heading font: ${business.fontHeading}.
About the business: ${business.aiProfile.trim().slice(0, 1500) || "(no profile)"}
${business.brandVoice?.trim() ? `Brand voice: ${business.brandVoice.trim().slice(0, 800)}` : ""}
Rules:
- Make 4 to 6 clearly different templates that fit this brand and still look like one family.
- Include at least one "color-solido" (for questions or quick facts, no photo) and one "lista" (for step-by-step tips). The rest use a photo.
- Keep text readable: on "foto-completa" use overlay "suave" or "fuerte"; never put a white background behind white text.
- Prefer a professional, trustworthy look for service businesses; avoid uppercase on long headlines.
- Give each template a short Spanish name that says what it is for (for example "Consejo", "Pregunta", "Pasos", "Aviso").`;
  const r = await ask(business.aiText ?? "", TemplatesSchema, system, "Design the templates.", 8000);
  return r.templates.slice(0, 6);
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const BrandKitSchema = z.object({
  color: z.string().describe("Main brand color as #RRGGBB"),
  color2: z.string().describe("Secondary brand color as #RRGGBB"),
  color3: z.string().describe("Accent color as #RRGGBB"),
  fontHeading: z.enum(Object.keys(FONTS) as [string, ...string[]]).describe("Of the available heading fonts, the one closest to the brand's heading typeface"),
  fontBody: z.string().describe("Name of the brand's body typeface, or a good match"),
  brandVoice: z.string().describe("How the brand speaks, in Spanish, 3-6 sentences: tone, how it addresses people (tú/usted), phrases it uses and things it never says"),
  hashtags: z.string().describe("3-6 brand hashtags separated by spaces"),
  summary: z.string().describe("One or two sentences in Spanish for the owner: what you found or proposed"),
});
export type BrandKitSuggestion = z.infer<typeof BrandKitSchema>;

function cleanKit(k: BrandKitSuggestion): BrandKitSuggestion {
  const hex = (v: string, fb: string) => (HEX.test(v.trim()) ? v.trim().toLowerCase() : fb);
  const color = hex(k.color, "#1d4ed8");
  return { ...k, color, color2: hex(k.color2, color), color3: hex(k.color3, hex(k.color2, color)), fontBody: k.fontBody.slice(0, 60), brandVoice: k.brandVoice.slice(0, 2000), hashtags: k.hashtags.slice(0, 300) };
}

/** Lee el manual de marca (PDF o imagen) y saca colores, letras, voz y hashtags. Solo con Gemini, que lee PDF. */
export async function readBrandBook(business: BusinessAi, file: { mimeType: string; data: Buffer }): Promise<BrandKitSuggestion> {
  if (!process.env.GEMINI_API_KEY) throw bi("Para leer el manual de marca hace falta la clave de Gemini (GEMINI_API_KEY).", "Reading the brand guide needs the Gemini key (GEMINI_API_KEY).");
  const system = `You are a brand designer. Read the brand guidelines document of "${business.name}" and extract its identity exactly as written: the main, secondary and accent colors (HEX), the heading and body typefaces, the voice and tone, and hashtags if any. If something is missing, propose a value that fits the rest of the guide and say so in the summary. Spanish text must use correct accents.`;
  const kit = await askGemini(BrandKitSchema, system, "Extract the brand identity from this document.", 4000, [{ inlineData: { mimeType: file.mimeType, data: file.data.toString("base64") } }]);
  return cleanKit(kit);
}

/** Propone una identidad de marca completa a partir de lo que el negocio contó de sí mismo. */
export async function suggestBrandKit(business: BusinessAi): Promise<BrandKitSuggestion> {
  const system = `You are a senior brand designer creating a brand identity for "${business.name}"${business.website ? ` (${business.website})` : ""}.
About the business: ${business.aiProfile.trim().slice(0, 2000) || "(no profile)"}
Rules:
- Colors must look professional and trustworthy for this kind of business, with strong contrast for white text on the main color.
- The voice must fit the business and its customers; for public adjusters or insurance: never promise results or money.
- Spanish text must use correct accents.`;
  return cleanKit(await ask(business.aiText ?? "", BrandKitSchema, system, "Create the brand identity.", 4000));
}

// ---------- Estudio del negocio ----------

/** Qué IA puede investigar en internet: Claude (búsqueda web) o Gemini (Google Search). */
export function researchProvider(pref: string): "claude" | "gemini" | null {
  const list = availableText().map((p) => p.id).filter((id): id is "claude" | "gemini" => id === "claude" || id === "gemini");
  return list.find((id) => id === pref) ?? list[0] ?? null;
}

type Research = { notes: string; sources: StudySource[] };

async function researchClaude(system: string, user: string): Promise<Research> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const content: Anthropic.Beta.BetaContentBlock[] = [];
  // La búsqueda corre en los servidores de Anthropic; si hace muchas búsquedas, la respuesta llega en pausa y se continúa.
  for (let i = 0; i < 4; i++) {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: user }];
    if (content.length) messages.push({ role: "assistant", content });
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      messages,
    });
    if (response.stop_reason === "refusal") throw bi("La IA no quiso investigar ese tema.", "The AI wouldn't research that topic.");
    content.push(...response.content);
    if (response.stop_reason !== "pause_turn") break;
  }
  const sources: StudySource[] = [];
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === "web_search_result") sources.push({ url: r.url, title: r.title });
    }
  }
  const notes = content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { notes, sources };
}

async function researchGemini(system: string, user: string): Promise<Research> {
  const data = await geminiFetch(
    JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 16000 },
    }),
  );
  const sources = (data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
    .map((c) => ({ url: c.web?.uri ?? "", title: c.web?.title ?? "" }))
    .filter((s) => /^https?:\/\//.test(s.url));
  return { notes: geminiText(data), sources };
}

/** Las respuestas de la entrevista como texto para la IA. */
const answersText = (input: StudyInput) => input.answers.filter((a) => a.answer.trim()).map((a) => `- ${a.question} ${a.answer}`).join("\n");

/** Investiga el mercado local en internet: competidores, cómo busca la gente, temporadas. */
async function researchMarket(business: BusinessAi, input: StudyInput, provider: "claude" | "gemini"): Promise<Research> {
  const system = `You are a local marketing and SEO researcher. Search the web and write research notes in English (keep search phrases in the language people use). Be factual and cite what you found; say "not found" instead of guessing.`;
  const user = `Research the local market for this business:
Business: ${business.name}${business.website ? ` (${business.website})` : ""}
What it sells: ${input.services || business.aiProfile.slice(0, 1500)}
Area served: ${input.zone || "(not given)"}
Customers: ${input.customers || "(not given)"}
Competitors the owner named: ${input.competitors || "(none)"}
${answersText(input) ? `More details from the owner:\n${answersText(input)}\n` : ""}
Find and report:
1. Main local competitors in that area (names, what they emphasize).
2. The exact phrases people in that area search on Google for these services, in the languages spoken there, including "near me" and city versions; which look competitive.
3. Seasonality and local events or risks that change demand.
4. Facts about the area useful for marketing (main cities or neighborhoods, who lives or does business there).
5. What this business's own website says about it, if it has one.`;
  const r = provider === "claude" ? await researchClaude(system, user) : await researchGemini(system, user);
  if (!r.notes.trim()) throw bi("la búsqueda no devolvió resultados", "the search returned no results");
  const seen = new Set<string>();
  const sources = r.sources.filter((s) => !seen.has(s.url) && seen.add(s.url)).slice(0, 15);
  return { notes: r.notes.slice(0, 20000), sources };
}

/** Lee el texto de la página web del negocio (si falla, sigue sin él). */
async function websiteText(url: string): Promise<string> {
  if (!/^https?:\/\//.test(url)) return "";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0 (compatible; ArevaloMarketing/1.0)" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return "";
    return htmlToText(await res.text());
  } catch {
    return "";
  }
}

/** Antes del estudio, la IA lee lo básico y prepara preguntas a la medida del negocio, con respuestas para tocar. */
export async function interviewQuestions(business: BusinessAi, input: StudyInput, lang: UiLang = "es"): Promise<Interview> {
  const site = await websiteText(business.website);
  const system = `You are a friendly local marketing consultant interviewing a small business owner before writing their marketing strategy.
Ask only what you need to understand what to advertise, to whom and where: the specific products or services and which sell best, the cities or neighborhoods, the type of customer, how customers contact them, what they offer that others don't (warranty, speed, financing, free quote, experience), price level, busy seasons.
Rules:
- Do not ask what the owner already answered or what the website already says.
- Make the options specific to this kind of business and this area (real city names, real product types), so the owner can answer by tapping.
${lang === "en" ? `- Short, plain English. No markdown.\n${OWNER_ENGLISH}` : "- Short, plain Spanish with correct accents, using tú. No markdown."}`;
  const user = `Business: ${business.name}${business.website ? ` (${business.website})` : ""}
What it sells: ${input.services || "(not answered)"}
Area: ${input.zone || "(not answered)"}
Ideal customers: ${input.customers || "(not answered)"}
Current profile: ${business.aiProfile.trim().slice(0, 1500) || "(empty)"}
Website text: ${site.slice(0, 4000) || "(not available)"}

Write 4 to 6 questions.`;
  const r = await ask(business.aiText ?? "", InterviewSchema, system, user, 4000);
  return { questions: r.questions.slice(0, 6).map((q) => ({ ...q, options: q.options.slice(0, 8) })) };
}

/** Estudio del negocio: perfil, público, mercado local, palabras clave SEO, anuncios e ideas de campaña. */
export async function studyBusiness(
  business: BusinessAi,
  input: StudyInput,
  opts: { research: boolean; lang?: UiLang },
): Promise<{ study: SavedStudy; researchError: string | null }> {
  const uiLang = opts.lang ?? "es";
  const provider = opts.research ? researchProvider(business.aiText ?? "") : null;
  let researchError: string | null = null;
  const [site, research] = await Promise.all([
    websiteText(business.website),
    provider
      ? researchMarket(business, input, provider).catch((e: unknown) => {
          // Si la investigación falla, el estudio se hace igual con lo que sabe la IA, y se le avisa al dueño por qué.
          console.error("Investigación del estudio falló:", e);
          researchError = errorText(e, uiLang);
          return null;
        })
      : Promise.resolve(null),
  ]);
  const goal = GOALS.find((g) => g[0] === input.goal)?.[1] ?? input.goal;
  const langs = { es: "Spanish", en: "English", both: "Spanish and English" }[input.lang];
  const system = `You are a senior local marketing strategist and SEO specialist. You study a small business and write the strategy its AI marketing assistant will follow to write posts and create photos and videos.
Rules:
- Facts about the business (services, area, contact details, offers, credentials) come ONLY from the owner's answers, the current profile and the business's own website. Never invent prices, years of experience, reviews, licenses or results.
- Market facts (competitors, seasons, search phrases) come from the research notes when there are any; otherwise use your general knowledge and keep it general.
- Search volumes and difficulty are your estimates: be realistic for a local business.
- If the business is a public adjuster or insurance-related: never promise or imply a payout, a percentage or "more money", and do not give legal advice.
${uiLang === "en" ? `- Customers speak ${langs}: keywords must be in the language customers search in.\n${OWNER_ENGLISH}` : `- Customers speak ${langs}: keywords and ideas must be in the language customers search in.`}
- Spanish text must use correct accents and punctuation. No markdown.`;
  const user = `Business: ${business.name}${business.website ? ` (${business.website})` : ""}
Main goal: ${goal}

Owner's answers:
- What it sells: ${input.services || "(not answered)"}
- Ideal customers: ${input.customers || "(not answered)"}
- Area served: ${input.zone || "(not answered)"}
- Competitors: ${input.competitors || "(not answered)"}
- What makes it different: ${input.different || "(not answered)"}
${answersText(input) ? `\nInterview (questions you asked the owner and their answers; treat the answers as facts about the business):\n${answersText(input)}\n` : ""}
Current profile:
<profile>
${business.aiProfile.trim() || "(empty)"}
</profile>

The business's website text:
<website>
${site || "(not available)"}
</website>

Research notes:
<research>
${research?.notes || "(no web research)"}
</research>

Write the full marketing study.`;
  const study = await ask(business.aiText ?? "", StudySchema, system, user, 20000);
  return { study: { ...study, sources: research?.sources ?? [], researched: Boolean(research?.notes) }, researchError };
}

// ---------- Visibilidad en IA ----------

export type SearchAnswer = { text: string; sources: StudySource[] };

/** Corta una promesa que tarda demasiado (la petición puede seguir de fondo, pero ya no se espera). */
function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(bi(`${name} tardó demasiado en contestar (más de ${Math.round(ms / 1000)} s).`, `${name} took too long to answer (over ${Math.round(ms / 1000)} s).`)),
      ms,
    );
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const httpSources = (list: StudySource[]) => {
  const seen = new Set<string>();
  return list.filter((s) => /^https?:\/\//.test(s.url) && !seen.has(s.url) && seen.add(s.url));
};

async function searchGemini(system: string, question: string): Promise<SearchAnswer> {
  const data = await geminiFetch(
    JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: question }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 4000 },
    }),
  );
  const sources = (data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).map((c) => ({ url: c.web?.uri ?? "", title: c.web?.title ?? "" }));
  return { text: geminiText(data), sources: httpSources(sources) };
}

async function searchClaude(system: string, question: string, signal: AbortSignal): Promise<SearchAnswer> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });
  const content: Anthropic.Beta.BetaContentBlock[] = [];
  for (let i = 0; i < 3; i++) {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: question }];
    if (content.length) messages.push({ role: "assistant", content });
    const response = await client.beta.messages.create(
      {
        model: "claude-opus-5-5",
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
        messages,
      },
      { signal },
    );
    if (response.stop_reason === "refusal") throw refused();
    content.push(...response.content);
    if (response.stop_reason !== "pause_turn") break;
  }
  // Primero las páginas que Claude citó en la respuesta, después el resto de lo que encontró.
  const cited: StudySource[] = [];
  const found: StudySource[] = [];
  for (const block of content) {
    if (block.type === "text") {
      for (const c of block.citations ?? []) if (c.type === "web_search_result_location") cited.push({ url: c.url, title: c.title ?? "" });
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === "web_search_result") found.push({ url: r.url, title: r.title });
    }
  }
  const text = content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { text, sources: httpSources([...cited, ...found]) };
}

type OpenAIResponse = {
  output_text?: string;
  error?: { message?: string } | null;
  output?: {
    type?: string;
    action?: { sources?: { url?: string; title?: string }[] };
    content?: { type?: string; text?: string; refusal?: string; annotations?: { type?: string; url?: string; title?: string }[] }[];
  }[];
};

/** ChatGPT con búsqueda web (Responses API, herramienta "web_search"). */
async function searchOpenAI(system: string, question: string, signal: AbortSignal): Promise<SearchAnswer> {
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: system,
      input: question,
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      include: ["web_search_call.action.sources"],
      max_output_tokens: 8000,
      // Los modelos que razonan (gpt-5, o3…) aceptan el esfuerzo; "minimal" no funciona con la búsqueda web.
      ...(/^(gpt-5|o\d)/.test(model) ? { reasoning: { effort: "low" } } : {}),
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw bi("OpenAI rechazó la clave (OPENAI_API_KEY).", "OpenAI rejected the key (OPENAI_API_KEY).");
    if (res.status === 429)
      throw bi(
        "ChatGPT llegó a su límite o tu cuenta de OpenAI no tiene saldo (platform.openai.com/settings/organization/billing).",
        "ChatGPT hit its limit or your OpenAI account is out of credit (platform.openai.com/settings/organization/billing).",
      );
    throw bi(`ChatGPT respondió ${res.status}: ${body.slice(0, 300)}`, `ChatGPT responded ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = JSON.parse(body) as OpenAIResponse;
  const cited: StudySource[] = [];
  const found: StudySource[] = [];
  let text = "";
  let refusal = "";
  for (const item of data.output ?? []) {
    if (item.type === "web_search_call") for (const s of item.action?.sources ?? []) found.push({ url: s.url ?? "", title: s.title ?? "" });
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text") {
        text += c.text ?? "";
        for (const a of c.annotations ?? []) if (a.type === "url_citation") cited.push({ url: a.url ?? "", title: a.title ?? "" });
      } else if (c.type === "refusal") refusal = c.refusal ?? "";
    }
  }
  if (!text && data.output_text) text = data.output_text;
  if (!text && refusal) throw refused();
  return { text, sources: httpSources([...cited, ...found]) };
}

/**
 * Hace una pregunta a una IA como lo haría un cliente, con búsqueda en internet, y devuelve la respuesta
 * y las páginas que usó. Si tarda más de `timeoutMs`, falla con un error claro.
 */
export async function searchAnswer(provider: TextProvider, question: string, opts: { system: string; timeoutMs?: number }): Promise<SearchAnswer> {
  const ms = opts.timeoutMs ?? 60000;
  const name = TEXT_PROVIDERS.find((p) => p.id === provider)?.name ?? provider;
  const env = TEXT_PROVIDERS.find((p) => p.id === provider)?.env;
  if (!env || !process.env[env]) throw bi(`Falta la clave de ${name} (${env}).`, `The ${name} key (${env}) is missing.`);
  const ctrl = new AbortController();
  const run =
    provider === "gemini" ? searchGemini(opts.system, question) : provider === "claude" ? searchClaude(opts.system, question, ctrl.signal) : searchOpenAI(opts.system, question, ctrl.signal);
  try {
    return await withTimeout(run, ms, name);
  } finally {
    ctrl.abort();
  }
}
