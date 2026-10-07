// "✦ Más ideas con IA": la IA propone 10 ideas más a partir de los mismos datos de SEO (las mejores oportunidades),
// del perfil y del estudio del negocio, sin repetir lo que ya se publicó.
import { z } from "zod";
import { ask } from "@/lib/ai";
import type { ContentIdea } from "@/lib/content-ideas";
import type { UiLang } from "@/lib/i18n";
import { studyContext } from "@/lib/study-shape";

const IdeasSchema = z.object({
  ideas: z
    .array(
      z.object({
        topic: z.string().describe("Short button label, 3 to 8 words, in the owner's language"),
        idea: z.string().describe("One or two sentences for the post writer: what the post is about, the angle, and the search words to use naturally; in the owner's language"),
        why: z.string().describe("One short line for the owner: why this brings customers (cite the data you used, e.g. searches per month, position, a question people ask), in the owner's language, no jargon"),
        keyword: z.string().describe("The main search words the post targets, or an empty string"),
      }),
    )
    .describe("Exactly 10 different post ideas"),
});

type IdeasBusiness = { name: string; website: string; aiProfile: string; aiText?: string; study?: unknown };

export function moreIdeasPrompt(b: IdeasBusiness, data: { top: ContentIdea[]; recent: string[]; lang: UiLang }): { system: string; user: string } {
  const study = studyContext(b.study);
  const owner = data.lang === "en" ? "English" : "Spanish (with correct accents)";
  const system = `You are the marketing strategist for "${b.name}"${b.website ? ` (${b.website})` : ""}. You choose WHAT to post on social media and Google so the business gets more customers, using its SEO data.

What the business told you about itself (the ONLY facts about it):
<business_profile>
${b.aiProfile.trim() || "(no profile yet)"}
</business_profile>
${study ? `\nMarketing study (strategy, not facts):\n<marketing_study>\n${study}\n</marketing_study>\n` : ""}
Rules:
- Base the ideas on the SEO opportunities given (searches where the business doesn't show up, questions people ask, what competitors rank for, pages losing visits). Prefer the ones with more searches and closer to getting customers.
- Every idea must be different from the others and from the recent posts (different topic AND different angle).
- Mix formats: a tip, a common question answered, a myth vs. truth, a short checklist, a before/after, a local angle, a behind-the-scenes, a customer doubt.
- Never invent facts, prices, discounts, results or statistics about the business.
- Write topic, idea and why in ${owner}. Plain words a non-technical owner understands.`;
  const top = data.top
    .slice(0, 25)
    .map((x) => `- ${x.keyword ? `"${x.keyword}"` : x.topic} — ${x.why}`)
    .join("\n");
  const user = `SEO opportunities (best first):
${top || "(no SEO data yet: use the profile and the study)"}

Recent posts (do NOT repeat these topics or openings):
${data.recent.length ? data.recent.map((r) => `- ${r}`).join("\n") : "(none)"}

Give 10 new post ideas.`;
  return { system, user };
}

/** 10 ideas nuevas de la IA, con la misma forma que las del SEO. */
export async function aiMoreIdeas(b: IdeasBusiness, data: { top: ContentIdea[]; recent: string[]; lang: UiLang }): Promise<ContentIdea[]> {
  const { system, user } = moreIdeasPrompt(b, data);
  const r = await ask(b.aiText ?? "", IdeasSchema, system, user, 6000);
  return r.ideas
    .filter((x) => x.topic.trim() && x.idea.trim())
    .slice(0, 10)
    .map((x, i) => ({
      id: `ai-${i}-${x.topic.trim().toLowerCase().slice(0, 40)}`,
      topic: x.topic.trim().slice(0, 72),
      idea: x.idea.trim().slice(0, 600),
      why: x.why.trim().slice(0, 160),
      source: "ai" as const,
      ...(x.keyword.trim() ? { keyword: x.keyword.trim().slice(0, 80) } : {}),
      score: 0,
    }));
}
