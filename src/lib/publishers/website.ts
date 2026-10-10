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

// ---------- Artículos del escritor (SEO → «Escribir un artículo para Google» → «Publicar en mi web») ----------
// El artículo ya viene escrito y revisado por el dueño: aquí no se redacta nada, solo se traduce fielmente al otro
// idioma y se sube al sitio con la misma lógica de GitHub de arriba (gh, uniqueSlug, foto en public/images/marketing).

export type PhotoKey = (typeof PHOTO_KEYS)[number];
/** Lo que el sitio sabe mostrar de cada sección: un párrafo, una lista opcional y un párrafo final opcional. */
export type SiteSection = { title: string; text: string; items?: string[]; after?: string };
/** Un idioma del artículo, tal como lo lee el sitio (lib/preview-articles.ts del sitio). `faq` sale al final del artículo. */
export type SiteCopy = { slug: string; seoTitle: string; title: string; description: string; category: string; sections: SiteSection[]; faq?: [string, string][] };
/** Un artículo del escritor ya listo para el sitio (los dos idiomas). `id` es fijo por artículo: no se publica dos veces. */
export type SiteArticleInput = { id: string; photo: PhotoKey; es: SiteCopy; en: SiteCopy };
/** Así queda en content/articles.json (`updated` es la fecha de «Actualizado» que muestra el sitio). */
export type SiteEntry = Omit<SiteArticle, "es" | "en"> & { es: SiteCopy; en: SiteCopy; updated?: string };

/** La dirección del artículo en el sitio: /resources/<slug> en inglés y /es/recursos/<slug> en español (como publish()). */
export function siteArticleUrl(siteUrl: string, lang: "es" | "en", slug: string): string {
  const site = siteUrl.trim().replace(/\/+$/, "");
  return `${site}${lang === "en" ? "/resources" : "/es/recursos"}/${slug}`;
}

const cleanSiteCopy = (c: SiteCopy): SiteCopy => {
  const sections = c.sections
    .map((s) => ({
      title: s.title.trim(),
      text: s.text.trim(),
      ...(s.items?.some((i) => i.trim()) ? { items: s.items.map((i) => i.trim()).filter(Boolean) } : {}),
      ...(s.after?.trim() ? { after: s.after.trim() } : {}),
    }))
    .filter((s) => s.title && s.text);
  const faq = (c.faq ?? []).map(([q, a]) => [q.trim(), a.trim()] as [string, string]).filter(([q, a]) => q && a);
  return {
    slug: slugify(c.slug),
    seoTitle: c.seoTitle.trim(),
    title: c.title.trim(),
    description: c.description.trim(),
    category: c.category.trim(),
    sections,
    ...(faq.length ? { faq } : {}),
  };
};

/**
 * Pone el artículo en la lista del sitio. Función pura (se prueba sola).
 * - Nuevo: va primero, con slugs únicos. Si ya hay uno con el mismo id, no se agrega otra vez (`already`).
 * - Actualizar: reemplaza el que tiene el mismo id, conserva sus slugs (las direcciones no cambian), su fecha de
 *   publicación y su foto (salvo que llegue otra), y anota la fecha de «Actualizado». Si ya no está, falla.
 */
export function placeSiteArticle(
  existing: SiteEntry[],
  input: SiteArticleInput,
  opts: { mode: "new" | "update"; today?: string; image?: string },
): { list: SiteEntry[]; article: SiteEntry; already: boolean } {
  const today = opts.today ?? new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });
  const es = cleanSiteCopy(input.es);
  const en = cleanSiteCopy(input.en);
  if (!es.sections.length || !en.sections.length || !es.title || !en.title) throw new PublishError("El artículo para el sitio quedó vacío.");
  const photo = PHOTO_KEYS.includes(input.photo) ? input.photo : "review";
  const index = existing.findIndex((a) => a.id === input.id);
  if (opts.mode === "new") {
    if (index >= 0) return { list: existing, article: existing[index], already: true };
    const article: SiteEntry = {
      id: input.id,
      published: today,
      photo,
      ...(opts.image ? { image: opts.image } : {}),
      es: { ...es, slug: uniqueSlug(es.slug, new Set(existing.map((a) => a.es.slug))) },
      en: { ...en, slug: uniqueSlug(en.slug, new Set(existing.map((a) => a.en.slug))) },
    };
    return { list: [article, ...existing], article, already: false };
  }
  if (index < 0) throw new PublishError("Ese artículo ya no está en tu sitio.");
  const old = existing[index];
  const image = opts.image ?? old.image;
  const article: SiteEntry = {
    ...old,
    photo,
    ...(image ? { image } : {}),
    ...(today !== old.published ? { updated: today } : {}),
    es: { ...es, slug: old.es.slug },
    en: { ...en, slug: old.en.slug },
  };
  const list = [...existing];
  list[index] = article;
  return { list, article, already: false };
}

/** Lee content/articles.json del sitio (gratis: solo GitHub). */
export async function readSiteArticles(creds: Creds): Promise<{ list: SiteEntry[]; sha: string }> {
  required(creds, ["repo", "githubToken", "siteUrl"]);
  const { headers, repo, branch } = gh(creds);
  let file: GhFile;
  try {
    file = await fetchJson<GhFile>(`https://api.github.com/repos/${repo}/contents/${ARTICLES_PATH}?ref=${encodeURIComponent(branch)}`, { headers });
  } catch (e) {
    if (String((e as Error).message).startsWith("404"))
      throw new PublishError(`404: Tu sitio todavía no está preparado: falta ${ARTICLES_PATH} en ${repo} (${branch}).`);
    throw e;
  }
  const raw = JSON.parse(Buffer.from(file.content ?? "", "base64").toString("utf8") || "[]") as unknown;
  return { list: Array.isArray(raw) ? (raw as SiteEntry[]) : [], sha: file.sha };
}

/** Sube (o reemplaza) la foto del artículo en public/images/marketing/<id>.webp. Devuelve la ruta que lee el sitio. */
async function putSitePhoto(creds: Creds, id: string, photoUrl: string, title: string): Promise<string> {
  const { headers, repo, branch } = gh(creds);
  const photo = await photoForSite(photoUrl);
  const url = `https://api.github.com/repos/${repo}/contents/${sitePhotoPath(id)}`;
  // Si ya hay una foto con ese nombre (al actualizar), GitHub pide su sha para reemplazarla.
  let sha: string | undefined;
  try {
    sha = (await fetchJson<{ sha?: string }>(`${url}?ref=${encodeURIComponent(branch)}`, { headers })).sha;
  } catch {
    sha = undefined;
  }
  await fetchJson(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ message: `Foto del artículo: ${title}`, content: photo.toString("base64"), branch, ...(sha ? { sha } : {}) }),
  });
  return `/${sitePhotoPath(id).replace(/^public\//, "")}`;
}

/**
 * Publica (o actualiza) un artículo del escritor en el sitio: sube la foto (si hay) y agrega el artículo a
 * content/articles.json en un solo commit. No llama a la IA. Si el artículo ya estaba (mismo id), no lo duplica.
 */
export async function publishSiteArticle(
  input: SiteArticleInput,
  creds: Creds,
  opts: { mode: "new" | "update"; photoUrl?: string; today?: string } = { mode: "new" },
): Promise<{ article: SiteEntry; url: string; urlEn: string; already: boolean; photoFailed: boolean }> {
  required(creds, ["repo", "githubToken", "siteUrl"]);
  const { headers, repo, branch } = gh(creds);
  const { list: existing, sha } = await readSiteArticles(creds);
  const site = creds.siteUrl;
  const found = existing.find((a) => a.id === input.id);
  if (opts.mode === "new" && found)
    return { article: found, url: siteArticleUrl(site, "es", found.es.slug), urlEn: siteArticleUrl(site, "en", found.en.slug), already: true, photoFailed: false };
  if (opts.mode === "update" && !found) throw new PublishError("Ese artículo ya no está en tu sitio.");

  let image: string | undefined;
  let photoFailed = false;
  if (opts.photoUrl) {
    try {
      image = await putSitePhoto(creds, input.id, opts.photoUrl, input.es.title);
    } catch {
      // Si la foto falla, el artículo sale igual con la foto del tema (como publish()).
      photoFailed = true;
    }
  }
  const { list, article } = placeSiteArticle(existing, input, { mode: opts.mode, today: opts.today, image });
  await fetchJson(`https://api.github.com/repos/${repo}/contents/${ARTICLES_PATH}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `${opts.mode === "update" ? "Artículo actualizado" : "Nuevo artículo"}: ${article.es.title}`,
      content: Buffer.from(JSON.stringify(list, null, 2) + "\n").toString("base64"),
      sha,
      branch,
    }),
  });
  return { article, url: siteArticleUrl(site, "es", article.es.slug), urlEn: siteArticleUrl(site, "en", article.en.slug), already: false, photoFailed };
}

const SITE_SYSTEM = `You prepare a finished article for a business's bilingual (Spanish and English) website. The article was already written and approved by the owner.
Rules:
- Translate faithfully into the other language. Keep every fact, claim, number, phone number, place and offer exactly as written. Do not add, remove or soften anything. Do not add facts, statistics, prices, guarantees or promises.
- Keep exactly the same structure: the same number of sections in the same order; for each section the same number of list items in the same order; an "after" paragraph only where the original has one; the same number of FAQ entries.
- Natural, fluent language, not word-by-word. Spanish text must use correct accents and ñ (después, inspección, daño); only slugs are plain ASCII. Plain text only: no markdown, no emoji, no hashtags.
- If the business is a public adjuster or insurance-related: never promise or imply a result or a payout, and do not give legal advice.
- Pick the stock photo key that best fits the topic.`;

const siteText = (lang: "es" | "en", what: string) => (lang === "es" ? `${what}. ${ACCENTS}` : `${what}. English`);
const siteTranslation = (to: "es" | "en") =>
  z.object({
    photo: z.enum(PHOTO_KEYS).describe("Stock photo that best matches the topic"),
    category: z.object({ es: z.string().describe(siteText("es", "Short category label, 1-3 words")), en: z.string().describe(siteText("en", "Short category label, 1-3 words")) }),
    imageIdea: z
      .string()
      .describe(
        "English description of ONE realistic photograph for the top of the article: what it shows, matching the topic and the business's own place and kind of work. No text, letters, signs, logos or brand names; no recognizable people. One or two sentences.",
      ),
    translated: z.object({
      slug: z.string().describe("URL slug of the translated title: lowercase ASCII words separated by hyphens, no accents"),
      seoTitle: z.string().describe(siteText(to, "The search-results title, translated")),
      title: z.string().describe(siteText(to, "The headline, translated")),
      description: z.string().describe(siteText(to, "The summary, translated")),
      sections: z
        .array(
          z.object({
            title: z.string().describe(siteText(to, "Section heading, translated")),
            text: z.string().describe(siteText(to, "Section paragraph, translated")),
            items: z.array(z.string()).describe(siteText(to, "The section's list items, translated, same count and order (empty if the original has none)")),
            after: z.string().describe(siteText(to, "The closing paragraph, translated (empty if the original has none)")),
          }),
        )
        .describe("Exactly the same sections as the original, in the same order"),
      faq: z.array(z.object({ question: z.string(), answer: z.string() })).describe("The same FAQ entries, translated (empty if none)"),
    }),
  });
export type SiteTranslation = z.infer<ReturnType<typeof siteTranslation>>;

/** La IA de la app traduce el artículo al otro idioma (sin cambiar nada), elige la foto del tema y describe una foto. */
export async function translateForSite(input: { pref: string; businessName: string; about: string; place: string; from: "es" | "en"; copy: Omit<SiteCopy, "category"> }): Promise<SiteTranslation> {
  const to = input.from === "es" ? "en" : "es";
  const original = {
    seoTitle: input.copy.seoTitle,
    title: input.copy.title,
    description: input.copy.description,
    sections: input.copy.sections.map((s) => ({ title: s.title, text: s.text, items: s.items ?? [], after: s.after ?? "" })),
    faq: (input.copy.faq ?? []).map(([question, answer]) => ({ question, answer })),
  };
  const user = `Business: ${input.businessName}${input.about ? `\nWhat it does: ${input.about}` : ""}${input.place ? `\nPlace: ${input.place}` : ""}
Original language: ${input.from === "es" ? "Spanish" : "English"}. Translate into ${to === "es" ? "Spanish" : "English"}.
Original article (JSON):
${JSON.stringify(original)}`;
  return ask(input.pref, siteTranslation(to), SITE_SYSTEM, user, 16000);
}

/** El slug libre más parecido (agrega -2, -3… si ya existe). */
export const freeSiteSlug = (slug: string, taken: Set<string>) => uniqueSlug(slug, taken);
