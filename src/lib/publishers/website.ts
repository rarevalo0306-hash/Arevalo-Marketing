// Canal "Sitio web": convierte la publicación en un artículo bilingüe para el sitio
// (Next.js en GitHub + Vercel) y lo agrega a content/articles.json. Vercel lo publica solo.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { fetchJson, PublishError, required } from "./http";
import type { Creds, Publisher, PublishInput } from "./types";

export const ARTICLES_PATH = "content/articles.json";
export const PHOTO_KEYS = ["water", "roof", "storm", "fire", "mold", "review", "vandalism", "residential", "commercial"] as const;

const Copy = z.object({
  slug: z.string().describe("URL slug in this language: lowercase ASCII words separated by hyphens, no accents"),
  seoTitle: z.string().describe("Title for search results, under 60 characters"),
  title: z.string().describe("Headline shown on the page"),
  description: z.string().describe("One-sentence summary for search results, under 155 characters"),
  category: z.string().describe("Short category label, 1-3 words"),
  sections: z
    .array(z.object({ title: z.string(), text: z.string() }))
    .describe("2 to 4 sections, each with a short heading and one paragraph of plain text"),
});

const Generated = z.object({
  photo: z.enum(PHOTO_KEYS).describe("Stock photo that best matches the topic"),
  es: Copy,
  en: Copy,
});
export type GeneratedArticle = z.infer<typeof Generated>;
export type SiteArticle = GeneratedArticle & { id: string };

const SYSTEM = `You turn a business's social media post into a short article for its bilingual (Spanish and English) website.
Rules:
- Keep every fact, claim, number, phone number and offer exactly as the post states it. Do not add facts, statistics, prices, guarantees or promises that are not in the post.
- Write natural Spanish and natural English versions with the same meaning. Plain text only: no markdown, no emoji, no hashtags.
- The Spanish title the author provided must be used (lightly polished at most) as the Spanish title; translate it for English.
- Organize the content into 2 to 4 short sections with clear headings.
- Pick the stock photo key that best fits the topic.`;

/** Pide a Claude el artículo estructurado en ambos idiomas. */
export async function generateArticle(input: PublishInput, apiKey: string): Promise<GeneratedArticle> {
  const client = new Anthropic({ apiKey });
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    // Si Claude Opus 5.5 declina por error, la API reintenta sola con otro modelo.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Generated) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Business: ${input.businessName}\nSpanish title from the author: ${input.seoTitle}\n\nPost:\n${input.text}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new PublishError("Claude no pudo convertir este texto en artículo.");
  if (!response.parsed_output) throw new PublishError("No se pudo generar el artículo. Intenta de nuevo.");
  return response.parsed_output;
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "articulo";
}

function uniqueSlug(slug: string, taken: Set<string>): string {
  let s = slugify(slug);
  for (let i = 2; taken.has(s); i++) s = `${slugify(slug)}-${i}`;
  return s;
}

/** Agrega el artículo al principio de la lista, con id y slugs únicos. Función pura (se prueba sola). */
export function addArticle(existing: SiteArticle[], generated: GeneratedArticle, id: string): { list: SiteArticle[]; article: SiteArticle } {
  const takenEs = new Set(existing.map((a) => a.es.slug));
  const takenEn = new Set(existing.map((a) => a.en.slug));
  const clean = (c: GeneratedArticle["es"]) => ({
    ...c,
    sections: c.sections.filter((s) => s.title.trim() && s.text.trim()).slice(0, 6),
  });
  const article: SiteArticle = {
    id,
    photo: PHOTO_KEYS.includes(generated.photo) ? generated.photo : "review",
    es: { ...clean(generated.es), slug: uniqueSlug(generated.es.slug, takenEs) },
    en: { ...clean(generated.en), slug: uniqueSlug(generated.en.slug, takenEn) },
  };
  if (!article.es.sections.length || !article.en.sections.length) throw new PublishError("El artículo generado quedó vacío.");
  return { list: [article, ...existing], article };
}

type GhFile = { content: string; sha: string };

function gh(creds: Creds) {
  const headers = {
    Authorization: `Bearer ${creds.githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const repo = creds.repo.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  const branch = creds.branch?.trim() || "main";
  return { headers, repo, branch };
}

export const website: Publisher = {
  async publish(input, creds) {
    required(creds, ["repo", "githubToken", "siteUrl"]);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new PublishError("Falta ANTHROPIC_API_KEY en la configuración del servidor de la app.");
    const { headers, repo, branch } = gh(creds);
    const url = `https://api.github.com/repos/${repo}/contents/${ARTICLES_PATH}`;

    let file: GhFile;
    try {
      file = await fetchJson<GhFile>(`${url}?ref=${encodeURIComponent(branch)}`, { headers });
    } catch (e) {
      if (String((e as Error).message).startsWith("404"))
        throw new PublishError(`Tu sitio todavía no está preparado: falta ${ARTICLES_PATH} en ${repo} (${branch}).`);
      throw e;
    }
    const existing = JSON.parse(Buffer.from(file.content, "base64").toString("utf8")) as SiteArticle[];

    const generated = await generateArticle(input, apiKey);
    const { list, article } = addArticle(existing, generated, `post-${Date.now().toString(36)}`);

    await fetchJson(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Nuevo artículo: ${article.es.title}`,
        content: Buffer.from(JSON.stringify(list, null, 2) + "\n").toString("base64"),
        sha: file.sha,
        branch,
      }),
    });

    const site = creds.siteUrl.trim().replace(/\/+$/, "");
    return {
      url: `${site}/es/preview/recursos/${article.es.slug}`,
      detail: `Artículo "${article.es.title}" enviado a tu sitio en español e inglés. Vercel lo publica en unos minutos.`,
    };
  },
  async test(creds) {
    required(creds, ["repo", "githubToken", "siteUrl"]);
    const { headers, repo, branch } = gh(creds);
    const r = await fetchJson<{ full_name: string; permissions?: { push?: boolean } }>(`https://api.github.com/repos/${repo}`, { headers });
    if (r.permissions && !r.permissions.push) throw new PublishError(`El token puede leer ${r.full_name} pero no escribir en él.`);
    try {
      await fetchJson(`https://api.github.com/repos/${repo}/contents/${ARTICLES_PATH}?ref=${encodeURIComponent(branch)}`, { headers });
    } catch {
      return `Conectado a ${r.full_name}, pero falta ${ARTICLES_PATH} en la rama ${branch}: el sitio todavía no está preparado para recibir artículos.`;
    }
    if (!process.env.ANTHROPIC_API_KEY) return `Conectado a ${r.full_name}. Falta ANTHROPIC_API_KEY en la app para redactar los artículos.`;
    return `Conectado a ${r.full_name} (rama ${branch})`;
  },
};
