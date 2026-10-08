// La identidad de la marca para la IA: qué se le pide (esquemas y prompts), cómo se convierte su respuesta a
// BrandIdentity, y el bloque de texto que siguen todos los textos que escribe la IA (identityPrompt).
// Sin servidor ni base de datos: se prueba solo. La forma guardada está en brand-identity-shape.ts.
import { z } from "zod";
import {
  type BiText,
  type BrandIdentity,
  emptyIdentity,
  ENERGIES,
  type IdentityProposal,
  MAX_MESSAGES,
  readBrandIdentity,
  readProposal,
} from "@/lib/brand-identity-shape";
import { BODY_FONTS, FONTS } from "@/lib/design-shapes";
import type { UiLang } from "@/lib/i18n";

const Bi = z.object({ es: z.string().describe("In Spanish, with correct accents"), en: z.string().describe("The same in natural English") });

/** Lo que se le pide a la IA para llenar la identidad (desde el manual o pensada para el negocio). */
export const IdentitySchema = z.object({
  slogan: Bi.describe("Brand slogan, 2-7 words"),
  tagline: Bi.describe("One-line description of what the business does, under 110 characters"),
  messages: z
    .array(z.object({ text: Bi.describe("A key message, one short sentence"), why: z.string().describe("Why it matters to the customer, one short sentence for the owner") }))
    .describe("3 to 6 key messages the brand repeats"),
  voiceSummary: z.string().describe("How the brand speaks, 1-3 sentences: tone and how it addresses people (tú/usted)"),
  personality: z.array(z.string()).describe("3-5 personality words"),
  voiceDo: z.array(z.string()).describe("3-6 short rules of what the brand does when writing"),
  voiceDont: z.array(z.string()).describe("3-6 short rules of what the brand never does when writing"),
  useWords: z.array(z.string()).describe("3-8 words or short phrases the brand always uses"),
  avoidWords: z.array(z.string()).describe("3-8 words or short phrases the brand never uses"),
  audience: z.string().describe("Who the brand talks to, 1-2 sentences"),
  musicMoods: z.array(z.string()).describe("2-4 mood words for the background music of the brand's videos"),
  musicGenres: z.array(z.string()).describe("1-3 music genres"),
  bpmMin: z.number().describe("Lowest tempo in BPM (60-180)"),
  bpmMax: z.number().describe("Highest tempo in BPM (60-180)"),
  energy: z.enum(ENERGIES).describe("Energy of the music"),
  instruments: z.array(z.string()).describe("2-5 instruments or sounds"),
  musicSearch: z.array(z.string()).describe("3-6 search terms, in English, for royalty-free music libraries (never names of real songs or artists)"),
  photoStyle: z.string().describe("What kind of photos fit the brand, 2-3 sentences: subjects, settings, light, mood, what to avoid"),
  summary: z.string().describe("One or two sentences for the owner: what you found or proposed"),
});
export type AiIdentity = z.infer<typeof IdentitySchema>;

const FONT_IDS = Object.keys(FONTS) as [keyof typeof FONTS, ...(keyof typeof FONTS)[]];
const BODY_IDS = Object.keys(BODY_FONTS) as [keyof typeof BODY_FONTS, ...(keyof typeof BODY_FONTS)[]];

/** Tres direcciones de identidad distintas para escoger. */
export const ProposalsSchema = z.object({
  proposals: z
    .array(
      z.object({
        name: z.string().describe("Name of the direction, 2-4 words"),
        palette: z.array(z.string()).describe("Exactly 3 colors as #RRGGBB: main, secondary, accent. White text must read well on the main color"),
        paletteWhy: z.string().describe("Why these colors fit the business, one sentence"),
        fontHeading: z.enum(FONT_IDS).describe("Heading font id"),
        fontBody: z.enum(BODY_IDS).describe("Body font id"),
        slogan: Bi.describe("Slogan for this direction, 2-7 words"),
        voice: z.string().describe("How the brand speaks in this direction, one or two sentences"),
        music: z.string().describe("Mood of the music for videos, 2-4 words separated by commas"),
        headline: z.string().describe("A sample post headline in this direction, 3-7 words, in the language customers use"),
      }),
    )
    .describe("Exactly 3 clearly different directions"),
  summary: z.string().describe("One sentence for the owner about how the three differ"),
});
export type AiProposals = z.infer<typeof ProposalsSchema>;

/** Lo que sabe la app del negocio, para los prompts. */
export type IdentityContext = {
  name: string;
  website: string;
  aiProfile: string;
  /** Resumen del estudio del negocio (studyContext). */
  study: string;
  /** Texto de la página web, si no hay perfil ni estudio. */
  site?: string;
  color: string;
  color2: string;
  color3: string;
  fontHeading: string;
  fontBody: string;
  brandVoice: string;
  hashtags: string;
  identity: BrandIdentity;
};

const ownerLang = (lang: UiLang) =>
  lang === "en" ? "Write owner-facing texts (why, summary, audience, rules, photo style, voice, names) in English." : "Write owner-facing texts (why, summary, audience, rules, photo style, voice, names) in Spanish with correct accents.";

const RULES = `Rules:
- Only use facts about the business that appear in what you are given; never invent prices, years, awards, guarantees or results.
- Music is for short social videos: describe moods, genres, tempo and instruments for ROYALTY-FREE libraries only; never name real songs, artists or licensed music.
- Spanish text must use correct accents and punctuation.
- Plain words a small-business owner understands; no marketing jargon.`;

function contextText(c: IdentityContext): string {
  const kit = [
    `Colors now: ${[c.color, c.color2, c.color3].filter(Boolean).join(", ") || "(none)"}`,
    `Heading font now: ${c.fontHeading || "(none)"}; body font: ${c.fontBody || "(none)"}`,
    c.brandVoice.trim() ? `Brand voice now: ${c.brandVoice.trim().slice(0, 800)}` : "",
    c.hashtags.trim() ? `Hashtags: ${c.hashtags.trim().slice(0, 200)}` : "",
    identityPrompt({ brandIdentity: c.identity }),
  ].filter(Boolean);
  return `Business: "${c.name}"${c.website ? ` (${c.website})` : ""}
What the business told about itself:
<business_profile>
${c.aiProfile.trim().slice(0, 3000) || "(empty)"}
</business_profile>
${c.study ? `Marketing study of the business:\n<marketing_study>\n${c.study.slice(0, 3000)}\n</marketing_study>\n` : ""}${c.site ? `Text of its website:\n<website>\n${c.site.slice(0, 6000)}\n</website>\n` : ""}What the brand already has:
${kit.join("\n")}`;
}

/** Prompt para las 3 direcciones de identidad. */
export function proposalsPrompt(c: IdentityContext, lang: UiLang): { system: string; user: string } {
  return {
    system: `You are a senior brand strategist and designer. Propose three clearly different brand identity directions for this small business (for example one classic and trustworthy, one modern and bold, one warm and close), each one ready to use on social media posts.
Heading font ids: ${Object.entries(FONTS).map(([id, f]) => `${id} (${f.name})`).join(", ")}. Body font ids: ${Object.entries(BODY_FONTS).map(([id, f]) => `${id} (${f.name})`).join(", ")}.
${RULES}
- If the brand already has colors, at least one direction keeps its main color.
- ${ownerLang(lang)}`,
    user: `${contextText(c)}\n\nPropose the three directions.`,
  };
}

/** Prompt para llenar la identidad: desde el manual (`book`) o pensada para el negocio. */
export function identityPromptFor(c: IdentityContext, lang: UiLang, mode: "book" | "fill"): { system: string; user: string } {
  return {
    system:
      mode === "book"
        ? `You are a brand strategist. Read the brand guidelines document of "${c.name}" and extract its identity exactly as written: slogan, tagline, key messages, voice and tone (do / don't), words it uses and avoids, audience, music guidance and photo style. If the document doesn't cover something, leave that field empty (empty text or empty list; 0 for tempo) instead of inventing it.
${RULES}
- ${ownerLang(lang)}`
        : `You are a senior brand strategist. Complete the brand identity of this small business so every post, caption and video sounds like the same brand. Build on what the brand already has; keep it consistent with it.
${RULES}
- ${ownerLang(lang)}`,
    user: mode === "book" ? `${contextText(c)}\n\nExtract the brand identity from the attached document.` : `${contextText(c)}\n\nWrite the complete brand identity.`,
  };
}

/** Convierte la respuesta de la IA a la forma guardada (limpia, con límites). */
export function fromAiIdentity(a: Partial<AiIdentity>, source: BrandIdentity["source"]): BrandIdentity {
  const lo = Number(a.bpmMin) || 0;
  const hi = Number(a.bpmMax) || 0;
  return readBrandIdentity({
    ...emptyIdentity(),
    slogan: a.slogan,
    tagline: a.tagline,
    messages: (a.messages ?? []).slice(0, MAX_MESSAGES),
    voice: { summary: a.voiceSummary, personality: a.personality, do: a.voiceDo, dont: a.voiceDont, useWords: a.useWords, avoidWords: a.avoidWords },
    audience: a.audience,
    music: { moods: a.musicMoods, genres: a.musicGenres, bpmMin: lo || null, bpmMax: hi || null, energy: a.energy, instruments: a.instruments, searchTerms: a.musicSearch },
    photoStyle: a.photoStyle,
    source,
  });
}

/** Las propuestas de la IA, limpias y con id (p1, p2, p3). Las que no traen colores válidos se descartan. */
export function fromAiProposals(a: AiProposals, stamp = Date.now().toString(36)): IdentityProposal[] {
  return a.proposals
    .map((p, i) => readProposal({ ...p, id: `${stamp}-${i + 1}` }, i))
    .filter((p): p is IdentityProposal => Boolean(p))
    .slice(0, 3);
}

const biLine = (t: BiText) => (t.es && t.en && t.es !== t.en ? `${t.es} / ${t.en}` : t.es || t.en);

/**
 * Bloque corto para los prompts que escriben textos (posts, artículos, respuestas a reseñas): eslogan, mensajes
 * clave, voz (sí / no) y palabras que se usan y que no. Vacío si la marca todavía no tiene identidad.
 */
export function identityPrompt(b: { brandIdentity?: unknown }): string {
  const id = readBrandIdentity(b.brandIdentity);
  const v = id.voice;
  const lines = [
    biLine(id.slogan) && `Slogan (use it only where it fits naturally, never in every post): ${biLine(id.slogan)}`,
    id.messages.length > 0 && `Key messages (weave in one when it fits):\n${id.messages.map((m) => `- ${biLine(m.text)}`).join("\n")}`,
    v.summary && `Voice: ${v.summary}`,
    v.personality.length > 0 && `Personality: ${v.personality.join(", ")}`,
    v.do.length > 0 && `Do: ${v.do.join("; ")}`,
    v.dont.length > 0 && `Don't: ${v.dont.join("; ")}`,
    v.useWords.length > 0 && `Words to use: ${v.useWords.join(", ")}`,
    v.avoidWords.length > 0 && `Never use these words: ${v.avoidWords.join(", ")}`,
  ].filter((x): x is string => Boolean(x));
  if (!lines.length) return "";
  return `\nBrand identity (follow it; it never overrides the rules or the facts in the business profile):\n<brand_identity>\n${lines.join("\n").slice(0, 2000)}\n</brand_identity>\n`;
}

/**
 * El eslogan de la marca para dibujarlo en los diseños (design.tsx puede usarlo): en el idioma pedido, o el otro
 * si falta. Vacío si no hay.
 */
export function brandSlogan(b: { brandIdentity?: unknown }, lang: "es" | "en" = "es"): string {
  const s = readBrandIdentity(b.brandIdentity).slogan;
  return (lang === "en" ? s.en || s.es : s.es || s.en).trim();
}
