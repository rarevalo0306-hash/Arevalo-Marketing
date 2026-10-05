// Canal "Sitio web": convierte la publicación en un artículo bilingüe para el sitio
// (Next.js en GitHub + Vercel) y lo agrega a content/articles.json. Vercel lo publica solo.
import sharp from "sharp";
import { z } from "zod";
import { aiEnabled, ask } from "@/lib/ai";
import { BUSINESS_TZ } from "@/lib/time";
import { fetchJson, PublishError, required } from "./http";
import type { Creds, Publisher, PublishInput } from "./types";

export const ARTICLES_PATH = "content/articles.json";
export const PHOTO_KEYS = ["water", "roof", "storm", "fire", "mold", "review", "vandalism", "residential", "commercial"] as const;

const ACCENTS = "Spanish with correct accents and ñ (después, inspección, daño, ¿qué?)";
const copy = (lang: "es" | "en") => {
  const t = (what: string) => (lang === "es" ? `${what}. ${ACCENTS}` : `${what}. English`);
  return z.object({
    slug: z.string().describe("URL slug: lowercase ASCII words separated by hyphens, no accents"),
    seoTitle: z.string().describe(t("Title for search results, under 60 characters")),
    title: z.string().describe(t("Headline shown on the page")),
    description: z.string().describe(t("One-sentence summary for search results, under 155 characters")),
    category: z.string().describe(t("Short category label, 1-3 words")),
    sections: z
      .array(z.object({ title: z.string().describe(t("Short heading")), text: z.string().describe(t("One paragraph of plain text")) }))
      .describe("2 to 4 sections"),
  });
};

const Generated = z.object({
  photo: z.enum(PHOTO_KEYS).describe("Stock photo that best matches the topic"),
  es: copy("es"),
  en: copy("en"),
});
export type GeneratedArticle = z.infer<typeof Generated>;
/** `published` (AAAA-MM-DD) es la fecha que el sitio muestra en el artículo. `image` es la foto del post guardada en el sitio. */
export type SiteArticle = GeneratedArticle & { id: string; published: string; image?: string };

/** Dónde guarda el sitio las fotos de los posts (el sitio solo acepta esta carpeta). */
export const sitePhotoPath = (id: string) => `public/images/marketing/${id}.webp`;

/** Convierte la foto del post a WEBP (máximo 1600 px de ancho) para el sitio. */
export async function photoForSite(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new PublishError(`No se pudo descargar la foto del post (${res.status}).`);
  return sharp(Buffer.from(await res.arrayBuffer())).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
}

const SYSTEM = `You turn a business's social media post into a short article for its bilingual (Spanish and English) website.
Rules:
- Keep every fact, claim, number, phone number and offer exactly as the post states it. Do not add facts, statistics, prices, guarantees or promises that are not in the post.
- Write natural Spanish and natural English versions with the same meaning. Spanish text must use correct accents and ñ (después, inspección, daño); only the slugs are plain ASCII. Plain text only: no markdown, no emoji, no hashtags.
- If the author provided a Spanish title, use it (lightly polished at most) as the Spanish title; translate it for English.
- If the business is a public adjuster or insurance-related: never promise or imply a result or a payout, and do not give legal advice.
- Organize the content into 2 to 4 short sections with clear headings.
- Pick the stock photo key that best fits the topic.`;

/** Pide a la IA de la app (Gemini, ChatGPT o Claude) el artículo estructurado en ambos idiomas. */
export async function generateArticle(input: PublishInput): Promise<GeneratedArticle> {
  const title = input.seoTitle.trim()
    ? `Spanish title from the author: ${input.seoTitle}`
    : "The author gave no title: write a clear Spanish title for search results.";
  const keywords = input.keywords?.length
    ? `\nSEO keywords people search for this business (use the ones that fit the topic naturally in the titles, description and headings; never add facts to fit them): ${input.keywords.join(", ")}`
    : "";
  return ask("", Generated, SYSTEM, `Business: ${input.businessName}\n${title}${keywords}\n\nPost:\n${input.text}`, 16000);
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
export function addArticle(
  existing: SiteArticle[],
  generated: GeneratedArticle,
  id: string,
  published = new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ }),
): { list: SiteArticle[]; article: SiteArticle } {
  const takenEs = new Set(existing.map((a) => a.es.slug));
  const takenEn = new Set(existing.map((a) => a.en.slug));
  const clean = (c: GeneratedArticle["es"]) => ({
    ...c,
    sections: c.sections.filter((s) => s.title.trim() && s.text.trim()).slice(0, 6),
  });
  const article: SiteArticle = {
    id,
    published,
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
    if (!aiEnabled()) throw new PublishError("Falta una clave de IA (GEMINI_API_KEY, OPENAI_API_KEY o ANTHROPIC_API_KEY) en la app para redactar el artículo.");
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

    const generated = await generateArticle(input);
    const { list, article } = addArticle(existing, generated, `post-${Date.now().toString(36)}`);

    // La misma foto del post (la que salió en Facebook e Instagram) va también en el artículo.
    if (input.mediaType === "photo" && input.mediaUrl) {
      try {
        const photo = await photoForSite(input.mediaUrl);
        const photoUrl = `https://api.github.com/repos/${repo}/contents/${sitePhotoPath(article.id)}`;
        await fetchJson(photoUrl, {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ message: `Foto del artículo: ${article.es.title}`, content: photo.toString("base64"), branch }),
        });
        article.image = `/${sitePhotoPath(article.id).replace(/^public\//, "")}`;
      } catch {
        // Si la foto falla, el artículo sale igual con la foto del tema.
      }
    }

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
      url: `${site}/es/recursos/${article.es.slug}`,
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
    if (!aiEnabled()) return `Conectado a ${r.full_name}. Falta una clave de IA en la app para redactar los artículos.`;
    return `Conectado a ${r.full_name} (rama ${branch})`;
  },
};
