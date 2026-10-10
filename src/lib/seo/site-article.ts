// «Publicar en mi web» del escritor de artículos: lo puro (se prueba en tests/seo-site-article.test.ts).
// - El artículo del escritor (Markdown, un idioma) → las secciones que sabe mostrar el sitio (título, párrafo, lista,
//   párrafo final y preguntas frecuentes), sin perder texto.
// - Las fotos de la biblioteca ordenadas por lo bien que van con el tema.
// - Lo que cuesta publicar (solo la foto con IA, si hace falta) y lo que queda guardado en el reporte del artículo.
import { canUse } from "@/lib/library-shape";
import { MIN_RELEVANCE, scoreItem, type MatchItem, type MatchQuery } from "@/lib/library-match";
import { libraryPhotoUrl } from "@/lib/photo-enhance-shape";
import type { PhotoKey, SiteCopy, SiteSection } from "@/lib/publishers/website";
import { PHOTO_KEYS, siteArticleUrl } from "@/lib/publishers/website";
import { parseMarkdown, slugify, type ArticleReport, type MdBlock, type WriterLang } from "@/lib/seo/writer";

export { siteArticleUrl };

export type Bi = { es: string; en: string };

// ---------- Markdown → secciones del sitio ----------

const SAFE_HTTP = /^https?:\/\//i;

/** Una línea de Markdown en texto plano: sin negritas ni cursivas; los enlaces web dejan su dirección entre paréntesis. */
export function plainInline(text: string): string {
  return text
    .replace(/\[([^\]\n]{1,300})\]\(\s*([^)\s]{1,2000})(?:\s+"[^"]*")?\s*\)/g, (_m, label: string, url: string) => {
      const l = label.trim();
      if (!SAFE_HTTP.test(url)) return l;
      const bare = url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
      return l.toLowerCase().includes(bare.toLowerCase()) ? l : `${l} (${bare})`;
    })
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1")
    .replace(/__(?=\S)([\s\S]*?\S)__/g, "$1")
    .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Termina en punto (o en el signo que ya traía) para unir puntos de una lista en un párrafo. */
const sentence = (s: string) => (/[.!?…:;)»"]$/.test(s) ? s : `${s}.`);
const joinItems = (items: string[]) => items.map(sentence).join(" ");

const FAQ_HEADING = /\b(preguntas frecuentes|preguntas comunes|faq|faqs|frequently asked|common questions)\b/i;
const isQuestion = (s: string) => /\?\s*$/.test(s) && s.length <= 220;

type Draft = { title: string; paras: string[]; items: string[] | null; after: string[] };

/** Arma una sección del sitio con lo que hay debajo de un subtítulo: párrafo, una lista y lo que venga después. */
function toSection(title: string, blocks: MdBlock[]): SiteSection | null {
  const d: Draft = { title, paras: [], items: null, after: [] };
  for (const b of blocks) {
    if (b.type === "hr" || b.type === "heading") continue;
    if (b.type === "paragraph") {
      const p = plainInline(b.text);
      if (!p) continue;
      (d.items ? d.after : d.paras).push(p);
      continue;
    }
    const items = b.items.map(plainInline).filter(Boolean);
    if (!items.length) continue;
    // El sitio muestra una sola lista por sección: la primera va como lista, las demás como texto después.
    if (!d.items && d.paras.length) d.items = items;
    else if (!d.items) d.paras.push(joinItems(items));
    else d.after.push(joinItems(items));
  }
  const text = d.paras.join(" ");
  if (!title.trim() || !text) return null;
  return { title, text, ...(d.items?.length ? { items: [...new Set(d.items)] } : {}), ...(d.after.length ? { after: d.after.join(" ") } : {}) };
}

/** Preguntas frecuentes debajo de un subtítulo de preguntas: «### ¿Pregunta?» o un párrafo que es solo la pregunta. */
function toFaq(blocks: MdBlock[]): { faq: [string, string][]; intro: MdBlock[] } | null {
  const faq: [string, string][] = [];
  const intro: MdBlock[] = [];
  let q: string | null = null;
  let answer: string[] = [];
  const close = () => {
    if (q && answer.length) faq.push([q, answer.join(" ")]);
    else if (q) intro.push({ type: "paragraph", text: q });
    q = null;
    answer = [];
  };
  for (const b of blocks) {
    if (b.type === "hr") continue;
    const head = b.type === "heading" ? plainInline(b.text) : b.type === "paragraph" && isQuestion(plainInline(b.text)) ? plainInline(b.text) : null;
    if (head !== null && (b.type === "heading" || isQuestion(head))) {
      close();
      q = head;
      continue;
    }
    if (q === null) {
      intro.push(b);
      continue;
    }
    if (b.type === "paragraph") answer.push(plainInline(b.text));
    else if (b.type === "list") answer.push(joinItems(b.items.map(plainInline).filter(Boolean)));
  }
  close();
  return faq.length ? { faq, intro } : null;
}

/**
 * El artículo del escritor (Markdown sin el H1) → secciones del sitio y preguntas frecuentes, sin perder texto:
 * - cada «##» es una sección; cada «###» también (el sitio no tiene subtítulos dentro de una sección);
 * - el texto antes del primer subtítulo va en una sección «Introducción»;
 * - la primera lista de una sección se muestra como lista; si no hay párrafo antes, o hay más listas, van como texto;
 * - bajo «Preguntas frecuentes» las preguntas («###» o un párrafo que termina en «?») van a `faq`.
 */
export function markdownToSections(md: string, lang: WriterLang): { sections: SiteSection[]; faq: [string, string][] } {
  const blocks = parseMarkdown(md).filter((b) => !(b.type === "heading" && b.level === 1));
  const sections: SiteSection[] = [];
  const faq: [string, string][] = [];
  // Grupos: [subtítulo «##», bloques hasta el siguiente «##»].
  const groups: { title: string; blocks: MdBlock[] }[] = [];
  let current: { title: string; blocks: MdBlock[] } = { title: "", blocks: [] };
  for (const b of blocks) {
    if (b.type === "heading" && b.level <= 2) {
      groups.push(current);
      current = { title: plainInline(b.text), blocks: [] };
    } else current.blocks.push(b);
  }
  groups.push(current);

  const push = (s: SiteSection | null) => {
    if (!s) return;
    // El sitio usa el título como llave: no puede repetirse.
    let title = s.title;
    for (let i = 2; sections.some((x) => x.title === title); i++) title = `${s.title} (${i})`;
    sections.push({ ...s, title });
  };

  for (const g of groups) {
    if (!g.blocks.length) continue;
    const title = g.title || (lang === "en" ? "Introduction" : "Introducción");
    if (g.title && FAQ_HEADING.test(g.title)) {
      const parsed = toFaq(g.blocks);
      if (parsed) {
        faq.push(...parsed.faq);
        push(toSection(title, parsed.intro));
        continue;
      }
    }
    // Las «###» parten la sección en varias.
    const parts: { title: string; blocks: MdBlock[] }[] = [{ title, blocks: [] }];
    for (const b of g.blocks) {
      if (b.type === "heading") parts.push({ title: plainInline(b.text), blocks: [] });
      else parts[parts.length - 1].blocks.push(b);
    }
    const [head, ...subs] = parts;
    const own = toSection(head.title, head.blocks);
    push(own);
    subs.forEach((p, i) => {
      // Si el «##» no tenía texto propio, su título se une al del primer «###» para no perderlo.
      const t = i === 0 && !own && g.title ? `${g.title}: ${p.title}` : p.title;
      push(toSection(t, p.blocks));
    });
  }
  return { sections, faq };
}

/** Todo el texto de un idioma (para comparar que la otra versión no perdió nada). */
export function copyWords(c: Pick<SiteCopy, "sections" | "faq">): number {
  const all = [...c.sections.flatMap((s) => [s.title, s.text, ...(s.items ?? []), s.after ?? ""]), ...(c.faq ?? []).flat()].join(" ");
  return all.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** ¿La traducción tiene la misma forma que el original? (mismas secciones, listas, párrafos finales y preguntas) */
export function sameShape(a: Pick<SiteCopy, "sections" | "faq">, b: Pick<SiteCopy, "sections" | "faq">): boolean {
  if (a.sections.length !== b.sections.length || (a.faq?.length ?? 0) !== (b.faq?.length ?? 0)) return false;
  return a.sections.every((s, i) => {
    const t = b.sections[i];
    return !!t.title.trim() && !!t.text.trim() && (s.items?.length ?? 0) === (t.items?.length ?? 0) && !!s.after?.trim() === !!t.after?.trim();
  });
}

/** La versión del sitio en el idioma del artículo, sacada del borrador del escritor. */
export function sourceCopy(report: Pick<ArticleReport, "draft" | "language">): Omit<SiteCopy, "category"> {
  const { sections, faq } = markdownToSections(report.draft.markdown, report.language);
  return {
    slug: slugify(report.draft.slug || report.draft.title),
    seoTitle: report.draft.title.trim(),
    title: (report.draft.h1 || report.draft.title).trim(),
    description: report.draft.metaDescription.trim(),
    sections,
    ...(faq.length ? { faq } : {}),
  };
}

/** El id del artículo en el sitio: fijo por artículo del escritor, así nunca se agrega dos veces. */
export const siteArticleId = (reportId: string) => `article-${reportId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;

// ---------- Fotos de la biblioteca ----------

/** Desde estos puntos de parecido la foto va clarísimo con el tema y no hace falta preguntarle a la IA. */
export const STRONG_RELEVANCE = 8;
/** Diferencia de puntos para que la primera gane sola (si no, la IA desempata). */
export const CLEAR_MARGIN = 1.5;

export type PhotoItem = MatchItem & { enhancedUrl?: string; useEnhanced?: boolean; thumbUrl?: string };
export type RankedPhoto = { item: PhotoItem; relevance: number; score: number };

/**
 * Las fotos de la biblioteca que van con el artículo, de la mejor a la peor. Solo fotos que se pueden usar y que se
 * parecen al tema (MIN_RELEVANCE). Para la web se prefieren las horizontales.
 */
export function rankArticlePhotos(items: PhotoItem[], q: MatchQuery, now = new Date(), max = 6): RankedPhoto[] {
  return items
    .filter((i) => i.kind === "photo" && canUse(i))
    .map((item) => scoreItem(item, { ...q, shape: q.shape ?? "horizontal" }, now) as RankedPhoto)
    .filter((s) => s.relevance >= MIN_RELEVANCE)
    .sort((a, b) => b.score - a.score || b.relevance - a.relevance || a.item.usedCount - b.item.usedCount)
    .slice(0, max);
}

/** ¿Hace falta que la IA mire las descripciones? Solo si la mejor no es clara (poco parecido o empate con la segunda). */
export function needsAiPick(ranked: RankedPhoto[]): boolean {
  if (!ranked.length) return false;
  const [a, b] = ranked;
  if (a.relevance < STRONG_RELEVANCE) return true;
  return !!b && a.score - b.score < CLEAR_MARGIN;
}

/** Una foto para elegir en la vista previa. */
export type PhotoOption = { id: string; url: string; thumb: string; label: string };

export function photoOption(item: PhotoItem, lang: "es" | "en" = "es"): PhotoOption {
  const d = item.description as { es?: unknown; en?: unknown } | null;
  const label = (lang === "en" ? d?.en ?? d?.es : d?.es ?? d?.en) as string | undefined;
  const url = libraryPhotoUrl({ url: item.url, enhancedUrl: item.enhancedUrl, useEnhanced: item.useEnhanced });
  return { id: item.id, url, thumb: item.thumbUrl || url, label: typeof label === "string" ? label.slice(0, 160) : "" };
}

/** Las fotos que se muestran para cambiar: primero las que van con el tema, luego otras que se pueden usar. */
export function photoOptions(items: PhotoItem[], ranked: RankedPhoto[], max = 8): PhotoItem[] {
  const out = ranked.map((r) => r.item);
  for (const i of items) {
    if (out.length >= max) break;
    if (i.kind === "photo" && canUse(i) && !out.some((o) => o.id === i.id)) out.push(i);
  }
  return out.slice(0, max);
}

// ---------- Lo guardado en el reporte del artículo ----------

/** La foto elegida: de la biblioteca, una que la IA va a crear al autorizar, una ya creada, o solo la foto del tema. */
export type SitePhoto =
  | { kind: "library"; itemId: string; url: string; thumb: string; label: string }
  | { kind: "generate"; idea: string }
  | { kind: "generated"; url: string; idea: string; costCents: number }
  /** Al actualizar: la foto que ya está en la web se queda (no se sube nada). */
  | { kind: "current"; url: string }
  | { kind: "stock" };

export type SitePrepared = {
  at: string;
  /** La versión del borrador con la que se preparó (createdAt o improvedAt): si cambió, hay que preparar otra vez. */
  draftAt: string;
  mode: "new" | "update";
  photoKey: PhotoKey;
  es: SiteCopy;
  en: SiteCopy;
  urlEs: string;
  urlEn: string;
  photo: SitePhoto;
  /** La foto que la IA crearía para este artículo (en inglés, sin letras ni logos). */
  imageIdea: string;
  /** Para cambiar de foto: las de la biblioteca que van con el tema primero. */
  options: PhotoOption[];
  /** Por qué se eligió la foto (una línea). */
  photoWhy: Bi;
  /** Lo que ya costaron las fotos creadas con IA para este artículo (centavos). */
  spentCents: number;
};

export type SitePublished = {
  at: string;
  /** La fecha que muestra el sitio (AAAA-MM-DD). */
  date: string;
  updatedDate?: string;
  id: string;
  url: string;
  urlEn: string;
  slugEs: string;
  slugEn: string;
  draftAt: string;
  image?: string;
  costCents: number;
};

export type ArticleSite = { prepared?: SitePrepared; published?: SitePublished };

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const s = (v: unknown, max = 20000) => (typeof v === "string" ? v.slice(0, max) : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function readCopy(v: unknown): SiteCopy | null {
  const c = o(v);
  const sections = (Array.isArray(c.sections) ? c.sections : [])
    .map(o)
    .map((x) => ({
      title: s(x.title, 300),
      text: s(x.text),
      ...(Array.isArray(x.items) && x.items.length ? { items: x.items.filter((i): i is string => typeof i === "string").map((i) => i.slice(0, 2000)) } : {}),
      ...(s(x.after) ? { after: s(x.after) } : {}),
    }))
    .filter((x) => x.title && x.text);
  const faq = (Array.isArray(c.faq) ? c.faq : [])
    .filter((q): q is [string, string] => Array.isArray(q) && typeof q[0] === "string" && typeof q[1] === "string")
    .map(([q, a]) => [q.slice(0, 500), a.slice(0, 5000)] as [string, string]);
  const copy = { slug: s(c.slug, 120), seoTitle: s(c.seoTitle, 300), title: s(c.title, 300), description: s(c.description, 600), category: s(c.category, 80), sections, ...(faq.length ? { faq } : {}) };
  return copy.title && copy.slug && sections.length ? copy : null;
}

function readPhoto(v: unknown): SitePhoto {
  const p = o(v);
  if (p.kind === "library" && s(p.itemId) && /^https?:\/\//.test(s(p.url))) return { kind: "library", itemId: s(p.itemId, 60), url: s(p.url, 2000), thumb: s(p.thumb, 2000) || s(p.url, 2000), label: s(p.label, 200) };
  if (p.kind === "generated" && /^https?:\/\//.test(s(p.url))) return { kind: "generated", url: s(p.url, 2000), idea: s(p.idea, 1000), costCents: n(p.costCents) };
  if (p.kind === "generate") return { kind: "generate", idea: s(p.idea, 1000) };
  if (p.kind === "current" && /^https?:\/\//.test(s(p.url))) return { kind: "current", url: s(p.url, 2000) };
  return { kind: "stock" };
}

const bi = (v: unknown): Bi => ({ es: s(o(v).es, 400), en: s(o(v).en, 400) || s(o(v).es, 400) });

/** Lee lo guardado en `site` del reporte del artículo sin confiar en su forma. */
export function readArticleSite(v: unknown): ArticleSite {
  const x = o(v);
  const out: ArticleSite = {};
  const p = o(x.prepared);
  const es = readCopy(p.es);
  const en = readCopy(p.en);
  if (es && en && s(p.at)) {
    out.prepared = {
      at: s(p.at, 40),
      draftAt: s(p.draftAt, 40),
      mode: p.mode === "update" ? "update" : "new",
      photoKey: PHOTO_KEYS.includes(p.photoKey as PhotoKey) ? (p.photoKey as PhotoKey) : "review",
      es,
      en,
      urlEs: s(p.urlEs, 600),
      urlEn: s(p.urlEn, 600),
      photo: readPhoto(p.photo),
      imageIdea: s(p.imageIdea, 1000),
      options: (Array.isArray(p.options) ? p.options : [])
        .map(o)
        .filter((x) => s(x.id) && /^https?:\/\//.test(s(x.url)))
        .slice(0, 12)
        .map((x) => ({ id: s(x.id, 60), url: s(x.url, 2000), thumb: s(x.thumb, 2000) || s(x.url, 2000), label: s(x.label, 200) })),
      photoWhy: bi(p.photoWhy),
      spentCents: n(p.spentCents),
    };
  }
  const pub = o(x.published);
  if (s(pub.url) && s(pub.at)) {
    out.published = {
      at: s(pub.at, 40),
      date: s(pub.date, 10),
      ...(s(pub.updatedDate) ? { updatedDate: s(pub.updatedDate, 10) } : {}),
      id: s(pub.id, 120),
      url: s(pub.url, 600),
      urlEn: s(pub.urlEn, 600),
      slugEs: s(pub.slugEs, 120),
      slugEn: s(pub.slugEn, 120),
      draftAt: s(pub.draftAt, 40),
      ...(s(pub.image) ? { image: s(pub.image, 300) } : {}),
      costCents: n(pub.costCents),
    };
  }
  return out;
}

/** La versión del borrador (cambia con «Mejorar con IA»). */
export const draftVersion = (r: Pick<ArticleReport, "createdAt" | "improvedAt">) => r.improvedAt ?? r.createdAt;

// ---------- Costo ----------

/** Traducir el artículo con la IA de texto cuesta alrededor de 1 centavo; se anota con la publicación. */
export const SITE_TEXT_CENTS = 1;

/** Lo que falta gastar al autorizar (centavos de dólar): solo la foto que la IA va a crear, si toca. Publicar es gratis. */
export function approveCostCents(photo: SitePhoto, imageCents: number): number {
  return photo.kind === "generate" ? Math.max(0, Math.round(imageCents)) : 0;
}

/** «US$0.04». */
export const usd = (cents: number) => `US$${(Math.max(0, cents) / 100).toFixed(2)}`;

/** El texto del botón: «Autorizar y publicar · US$0.04» (o «· sin costo»). */
export function approveLabel(cents: number, update: boolean): Bi {
  const verb = update ? { es: "Autorizar y actualizar", en: "Approve and update" } : { es: "Autorizar y publicar", en: "Approve and publish" };
  return cents > 0 ? { es: `${verb.es} · ${usd(cents)}`, en: `${verb.en} · ${usd(cents)}` } : { es: `${verb.es} · sin costo`, en: `${verb.en} · no cost` };
}

// ---------- Errores en palabras simples ----------

/** Los errores de GitHub o de la conexión, en palabras que entiende el dueño. */
export function siteErrorText(message: string): Bi {
  const m = message.trim();
  const missing = /Faltan datos de la conexión: (.+)$/.exec(m);
  if (missing) {
    const keys = missing[1].split(/,\s*/);
    const name = (k: string): Bi =>
      k === "githubToken" ? { es: "la llave de GitHub", en: "the GitHub key" } : k === "repo" ? { es: "el repositorio", en: "the repository" } : k === "siteUrl" ? { es: "la dirección de tu web", en: "your website address" } : { es: k, en: k };
    const list = keys.map(name);
    return {
      es: `A la conexión de tu web le falta ${list.map((x) => x.es).join(" y ")}. Complétala en Conexiones → Sitio web.`,
      en: `Your website connection is missing ${list.map((x) => x.en).join(" and ")}. Complete it in Connections → Website.`,
    };
  }
  if (/^401\b/.test(m))
    return {
      es: "Tu web no aceptó la llave de GitHub (puede haber vencido). Vuelve a conectarla en Conexiones → Sitio web.",
      en: "Your website didn't accept the GitHub key (it may have expired). Reconnect it in Connections → Website.",
    };
  if (/^403\b/.test(m))
    return {
      es: "La llave de GitHub no tiene permiso para escribir en tu web. Dale permiso de escritura y vuelve a conectarla.",
      en: "The GitHub key isn't allowed to write to your website. Give it write access and reconnect it.",
    };
  if (/^404\b/.test(m))
    return /no está preparado/.test(m)
      ? { es: "Tu web todavía no está preparada para recibir artículos (falta content/articles.json).", en: "Your website isn't ready to receive articles yet (content/articles.json is missing)." }
      : { es: "No encontramos tu web en GitHub (el repositorio o la rama). Revisa la conexión en Conexiones → Sitio web.", en: "We couldn't find your website on GitHub (the repository or branch). Check the connection in Connections → Website." };
  if (/^(409|422)\b/.test(m))
    return { es: "Tu web cambió mientras publicábamos. Intenta otra vez en un momento.", en: "Your website changed while we were publishing. Try again in a moment." };
  if (/ya no está en tu sitio/.test(m))
    return {
      es: "Ese artículo ya no está en tu web (alguien lo quitó), así que no lo actualizamos.",
      en: "That article is no longer on your website (someone removed it), so we didn't update it.",
    };
  return { es: `No se pudo hablar con tu web: ${m.slice(0, 200)}`, en: `Couldn't reach your website: ${m.slice(0, 200)}` };
}
