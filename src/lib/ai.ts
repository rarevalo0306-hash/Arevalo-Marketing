// Agente de IA: escribe publicaciones adaptadas a cada canal y arma planes semanales.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ChannelId } from "@/lib/channels";

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

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

function rules(business: { name: string; website: string; aiProfile: string }, lang: Lang): string {
  return `You are the social media manager for "${business.name}"${business.website ? ` (${business.website})` : ""}.

What the business told you about itself (the ONLY facts you may state about it):
<business_profile>
${business.aiProfile.trim() || "(no profile yet — keep statements about the business generic)"}
</business_profile>

Rules:
- Never invent facts about the business: no prices, discounts, statistics, years of experience, awards, license numbers, phone numbers, addresses or results unless they appear in the business profile.
- If the business is a public adjuster or insurance-related: never promise or imply a result, a payout, a percentage or "more money"; do not give legal advice; say "free initial evaluation" only if the profile says so; keep claims general and educational.
- No fake urgency, no fear-mongering, no medical or legal claims.
- Use plain words a homeowner understands. Emoji are fine on Facebook, Instagram and TikTok, sparingly.
- Do not use markdown (no **bold**, no # headings): social networks show the symbols literally.
- ${LANG_TEXT[lang]}`;
}

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function ask<T extends z.ZodTypeAny>(schema: T, system: string, user: string, maxTokens = 16000): Promise<z.infer<T>> {
  if (!aiEnabled()) throw new Error("Falta ANTHROPIC_API_KEY en la configuración del servidor.");
  const response = await client().beta.messages.parse({
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

/** Escribe una publicación con versiones para cada canal a partir de una idea. */
export async function writePost(
  business: { name: string; website: string; aiProfile: string },
  idea: string,
  lang: Lang,
): Promise<AiPost> {
  return ask(PostSchema, rules(business, lang), `Write one post about this idea, with a version for each channel:\n\n${idea}`);
}

/** Plan de publicaciones para una semana. */
export async function planWeek(
  business: { name: string; website: string; aiProfile: string },
  opts: { startDate: string; count: number; themes: string; lang: Lang },
): Promise<AiPlan> {
  const user = `Plan ${opts.count} posts for the 7 days starting ${opts.startDate}. Spread them across different days and vary the topics (education, tips, seasonal risks, trust-building, a clear invitation to contact the business).
${opts.themes.trim() ? `The owner wants these themes included: ${opts.themes.trim()}` : ""}
Write the full post for each one, with a version for each channel.`;
  return ask(PlanSchema, rules(business, opts.lang), user, 32000);
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
