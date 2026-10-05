// Agente de IA: escribe publicaciones adaptadas a cada canal y arma planes semanales.
// Usa Google Gemini si hay GEMINI_API_KEY (más barato); si no, Claude con ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ChannelId } from "@/lib/channels";
import { TemplateSpec } from "@/lib/design-shapes";

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

type BusinessAi = { name: string; website: string; aiProfile: string; aiText?: string; brandVoice?: string; hashtags?: string };

function rules(business: BusinessAi, lang: Lang): string {
  return `You are the social media manager for "${business.name}"${business.website ? ` (${business.website})` : ""}.

What the business told you about itself (the ONLY facts you may state about it):
<business_profile>
${business.aiProfile.trim() || "(no profile yet — keep statements about the business generic)"}
</business_profile>
${business.brandVoice?.trim() ? `\nBrand voice (follow it):\n<brand_voice>\n${business.brandVoice.trim()}\n</brand_voice>\n` : ""}${business.hashtags?.trim() ? `\nBrand hashtags (use some of them where hashtags fit): ${business.hashtags.trim()}\n` : ""}
Rules:
- Never invent facts about the business: no prices, discounts, statistics, years of experience, awards, license numbers, phone numbers, addresses or results unless they appear in the business profile.
- If the business is a public adjuster or insurance-related: never promise or imply a result, a payout, a percentage or "more money"; do not give legal advice; say "free initial evaluation" only if the profile says so; keep claims general and educational.
- No fake urgency, no fear-mongering, no medical or legal claims.
- Use plain words a homeowner understands. Emoji are fine on Facebook, Instagram and TikTok, sparingly.
- Do not use markdown (no **bold**, no # headings): social networks show the symbols literally.
- Spanish text must always use correct accents and punctuation (después, inspección, daño, ¿…?, ¡…!), including the image headline.
- ${LANG_TEXT[lang]}`;
}

function parseJson<T extends z.ZodTypeAny>(schema: T, text: string): z.infer<T> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("La IA no devolvió una respuesta válida. Intenta de nuevo.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Error("La IA no devolvió una respuesta completa. Intenta de nuevo.");
  return parsed.data;
}

// Si un modelo está saturado, se prueba el siguiente.
const GEMINI_MODELS = () => [...new Set([process.env.GEMINI_MODEL || "gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"])];

async function askGemini<T extends z.ZodTypeAny>(schema: T, system: string, user: string, maxTokens: number): Promise<z.infer<T>> {
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(schema), maxOutputTokens: maxTokens },
  });
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
  if (!res) throw new Error("No se pudo llamar a Gemini.");
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 503) throw new Error("Gemini está muy ocupado en este momento. Intenta de nuevo en un minuto.");
    if (res.status === 429) throw new Error("Gemini llegó a su límite por ahora. Espera un minuto o activa la facturación en Google AI Studio.");
    if (res.status === 400 && body.includes("API key")) throw new Error("Google rechazó la clave de Gemini (GEMINI_API_KEY).");
    throw new Error(`Gemini respondió ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = JSON.parse(body) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
  const c = data.candidates?.[0];
  if (c?.finishReason === "SAFETY" || c?.finishReason === "PROHIBITED_CONTENT") throw new Error("La IA no quiso escribir sobre ese tema. Prueba con otra idea.");
  return parseJson(schema, c?.content?.parts?.map((p) => p.text ?? "").join("") ?? "");
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
    if (res.status === 401) throw new Error("OpenAI rechazó la clave (OPENAI_API_KEY).");
    if (res.status === 429) throw new Error("ChatGPT llegó a su límite o tu cuenta de OpenAI no tiene saldo (platform.openai.com/settings/organization/billing).");
    throw new Error(`ChatGPT respondió ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = JSON.parse(body) as { choices?: { message?: { content?: string | null; refusal?: string | null } }[] };
  const m = data.choices?.[0]?.message;
  if (m?.refusal) throw new Error("La IA no quiso escribir sobre ese tema. Prueba con otra idea.");
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
  if (response.stop_reason === "refusal") throw new Error("La IA no quiso escribir sobre ese tema. Prueba con otra idea.");
  if (!response.parsed_output) throw new Error("La IA no devolvió una respuesta válida. Intenta de nuevo.");
  return response.parsed_output;
}

/** Pide a la IA elegida (o la primera disponible) una respuesta con la forma de `schema`. */
export async function ask<T extends z.ZodTypeAny>(pref: string, schema: T, system: string, user: string, maxTokens = 16000): Promise<z.infer<T>> {
  const provider = pickText(pref);
  if (provider === "gemini") return askGemini(schema, system, user, maxTokens);
  if (provider === "openai") return askOpenAI(schema, system, user, maxTokens);
  if (provider === "claude") return askClaude(schema, system, user, maxTokens);
  throw new Error("Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en la configuración del servidor.");
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
