// "Copiar instrucciones para la IA de tu web": un texto por sección de SEO para pegar en el chat de la IA (Claude u
// otra) que maneja la página del negocio, con el contexto del negocio, cada cambio con sus direcciones completas y
// cómo hacerlo, y las reglas (no inventar datos). Lo que la IA de la página no puede hacer (directorios, Perfil de
// Google) sale como lista de tareas para el dueño. Todo puro: se prueba en tests/seo-prompts.test.ts.
// La base (contexto, reglas, el código para Google) está en prompt-core.ts, que también usa el navegador.
import { ISSUE_TEXT, type AuditReport, type IssueId, type Severity } from "@/lib/seo/audit";
import { hintText, HINT_EASY, type GapDomain } from "@/lib/seo/backlinks";
import { fixText, issueWhy, severityLabel, type CannibalIssue, type CannibalReport } from "@/lib/seo/cannibal";
import { decayActions, reasonLabel, reasonWhy, type DecayPage, type DecayReport } from "@/lib/seo/decay";
import type { GapRow } from "@/lib/seo/gap";
import type { GbpCheck } from "@/lib/seo/gbp-shared";
import type { OnPagePage, OnPageReport } from "@/lib/seo/onpage";
import { rowAdvice } from "@/lib/seo/plain";
import { absUrl, renderChecklist, renderPrompt, type PromptContext, type PromptItem, type PromptLang, type PromptSection, siteUrl } from "@/lib/seo/prompt-core";
import type { QuestionGroup } from "@/lib/seo/questions";
import type { RankReport } from "@/lib/seo/rank";

export * from "@/lib/seo/prompt-core";

const L = (lang: PromptLang) => (es: string, en: string) => (lang === "en" ? en : es);
const num = (n: number, lang: PromptLang) => new Intl.NumberFormat(lang === "en" ? "en-US" : "es").format(n);

// ---------- Auditoría ----------

/** Cómo arreglar cada problema de la auditoría, dicho para la IA que programa la página (más técnico que ISSUE_TEXT). */
export const AI_FIX: Record<IssueId, { es: string; en: string }> = {
  "page-errors": {
    es: "Estas direcciones dan error (4xx/5xx). Arregla la página, o pon una redirección 301 a la página más parecida que sí funcione, y cambia los enlaces internos que apuntan a ellas.",
    en: "These URLs return an error (4xx/5xx). Fix the page, or add a 301 redirect to the closest working page, and update every internal link that points to them.",
  },
  "broken-links": {
    es: "Estos enlaces llevan a direcciones que dan error. En cada página donde aparecen, cámbialos por la dirección correcta o quítalos.",
    en: "These links point to URLs that return an error. On each page where they appear, change them to the correct URL or remove them.",
  },
  "missing-title": {
    es: "Agrega un <title> único de 50 a 60 caracteres que diga el servicio principal de la página y la ciudad.",
    en: "Add a unique <title> of 50-60 characters that says the page's main service and the city.",
  },
  "no-https": {
    es: "Haz que el sitio abra con https (certificado válido) y que toda visita por http:// vaya a https:// con una redirección 301.",
    en: "Make the site load over https (valid certificate) and send every http:// request to https:// with a 301 redirect.",
  },
  "http-no-redirect": {
    es: "Haz que http:// mande siempre a https:// con una redirección permanente (301).",
    en: "Make http:// always redirect to https:// with a permanent (301) redirect.",
  },
  "no-viewport": {
    es: 'Agrega <meta name="viewport" content="width=device-width, initial-scale=1"> en el <head> de todas las páginas.',
    en: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head> of every page.',
  },
  noindex: {
    es: "Estas páginas tienen «noindex» (meta robots o X-Robots-Tag), así que Google no las muestra. Si deben salir en Google, quítalo. Si esconderlas es a propósito (gracias, legales), déjalas.",
    en: "These pages have \"noindex\" (meta robots or X-Robots-Tag), so Google doesn't show them. If they should appear on Google, remove it. If hiding them is intentional (thank-you, legal pages), leave them.",
  },
  "duplicate-title": {
    es: "Varias páginas tienen el mismo <title>. Dale a cada una uno distinto (50 a 60 caracteres) con su servicio específico y la ciudad.",
    en: "Several pages share the same <title>. Give each one a different title (50-60 characters) with its specific service and the city.",
  },
  "title-too-long": {
    es: "Acorta el <title> a 60 caracteres como máximo, con el servicio y la ciudad al principio.",
    en: "Shorten the <title> to 60 characters max, with the service and the city first.",
  },
  "missing-description": {
    es: 'Agrega un <meta name="description"> único de 120 a 155 caracteres: qué ofrece la página, dónde y por qué elegir al negocio.',
    en: 'Add a unique <meta name="description"> of 120-155 characters: what the page offers, where, and why choose the business.',
  },
  "duplicate-description": {
    es: "Varias páginas tienen la misma meta descripción. Escribe una distinta para cada página, según lo que ofrece.",
    en: "Several pages share the same meta description. Write a different one for each page, based on what it offers.",
  },
  "missing-h1": {
    es: "Agrega un solo <h1> arriba que diga de qué trata la página (servicio + ciudad).",
    en: "Add a single <h1> at the top that says what the page is about (service + city).",
  },
  "images-no-alt": {
    es: 'Agrega un atributo alt corto y descriptivo a cada <img> (qué muestra la foto). Las imágenes decorativas llevan alt="".',
    en: 'Add a short, descriptive alt attribute to every <img> (what the photo shows). Decorative images get alt="".',
  },
  "slow-page": {
    es: "Estas páginas tardaron más de 3 segundos en responder. Comprime y redimensiona las fotos (WebP, tamaño real, carga diferida abajo de la pantalla), quita scripts que no se usen y activa la caché.",
    en: "These pages took more than 3 seconds to respond. Compress and resize images (WebP, real display size, lazy-load below the fold), remove unused scripts and enable caching.",
  },
  "no-sitemap": {
    es: "Crea /sitemap.xml con todas las páginas públicas y ponlo en robots.txt (Sitemap: <dirección del sitemap>).",
    en: "Create /sitemap.xml listing every public page and reference it in robots.txt (Sitemap: <sitemap URL>).",
  },
  "no-structured-data": {
    es: "Agrega datos estructurados LocalBusiness (JSON-LD) a la página de inicio: nombre, dirección, teléfono y horario. El dueño tiene el código listo en la sección «Código para Google» de su app; pídeselo si no te lo dio.",
    en: "Add LocalBusiness structured data (JSON-LD) to the home page: name, address, phone and hours. The owner has the code ready in the \"Code for Google\" section of their app; ask for it if they didn't give it to you.",
  },
  "title-too-short": {
    es: "Alarga el <title> a 30-60 caracteres agregando el servicio y la ciudad.",
    en: "Lengthen the <title> to 30-60 characters by adding the service and the city.",
  },
  "description-length": {
    es: "Reescribe la meta descripción para que tenga de 120 a 155 caracteres.",
    en: "Rewrite the meta description so it's 120-155 characters long.",
  },
  "multiple-h1": {
    es: "Deja un solo <h1> por página y convierte los demás en <h2>.",
    en: "Keep a single <h1> per page and turn the others into <h2>.",
  },
  "thin-content": {
    es: "Estas páginas tienen menos de 250 palabras. Agrega contenido útil: qué incluye el servicio, para quién es, zonas que atiende y preguntas frecuentes, usando solo datos que ya estén en el sitio.",
    en: "These pages have fewer than 250 words. Add useful content: what the service includes, who it's for, areas served and FAQs, using only facts already on the site.",
  },
  "no-og-image": {
    es: "Agrega las etiquetas og:image (y og:title, og:description) para que al compartir salga una foto. Usa una foto que ya esté en el sitio (1200×630).",
    en: "Add og:image (plus og:title and og:description) tags so shared links show a photo. Use a photo already on the site (1200×630).",
  },
  "missing-lang": {
    es: 'Pon el idioma en la etiqueta <html> (por ejemplo, lang="es").',
    en: 'Set the language on the <html> tag (for example, lang="en").',
  },
  "no-robots": {
    es: "Crea /robots.txt que permita leer el sitio y diga dónde está el sitemap.",
    en: "Create /robots.txt that allows crawling and points to the sitemap.",
  },
};

const SEVERITY_TAG: Record<Severity, [string, string]> = { error: ["Error", "Error"], warning: ["Advertencia", "Warning"], notice: ["Sugerencia", "Notice"] };
export const severityTag = (s: Severity, lang: PromptLang) => L(lang)(...SEVERITY_TAG[s]);

/** Los problemas de la auditoría como cambios para la IA (los más graves primero). `max` recorta la lista. */
export function auditItems(report: AuditReport, website: string, lang: PromptLang, max = 50): PromptItem[] {
  const t = L(lang);
  return report.issues.slice(0, max).map((i) => {
    const item: PromptItem = { tag: severityTag(i.severity, lang), title: `${ISSUE_TEXT[i.id][lang].title} (${i.count} ${i.id === "broken-links" ? t(i.count === 1 ? "enlace" : "enlaces", i.count === 1 ? "link" : "links") : t(i.count === 1 ? "página" : "páginas", i.count === 1 ? "page" : "pages")})`, how: [AI_FIX[i.id][lang]] };
    if (i.id === "broken-links" && report.site.brokenLinks.length) {
      const list = report.site.brokenLinks.slice(0, 15);
      item.detail = list.map((b) =>
        t(
          `Roto: ${b.url} (responde ${b.status})${b.from.length ? ` · está en: ${b.from.map((f) => absUrl(f, website)).join(", ")}` : ""}`,
          `Broken: ${b.url} (returns ${b.status})${b.from.length ? ` · found on: ${b.from.map((f) => absUrl(f, website)).join(", ")}` : ""}`,
        ),
      );
      if (i.count > list.length) item.moreUrls = i.count - list.length;
    } else if (i.pages.length) {
      item.urls = i.pages.map((u) => absUrl(u, website));
      if (i.count > i.pages.length) item.moreUrls = i.count - i.pages.length;
    }
    return item;
  });
}

export function auditPrompt(ctx: PromptContext, report: AuditReport, lang: PromptLang): string {
  const t = L(lang);
  return renderPrompt({
    ctx,
    lang,
    task: t(
      `Revisamos la página como lo hace Google (nota: ${report.score} de 100) y encontramos estos problemas. Arréglalos en este orden: primero los errores, después las advertencias y al final las sugerencias.`,
      `We checked the website the way Google does (score: ${report.score} out of 100) and found these problems. Fix them in this order: errors first, then warnings, then notices.`,
    ),
    sections: [{ title: t("Qué arreglar", "What to fix"), items: auditItems(report, ctx.website, lang) }],
  });
}

// ---------- Revisión de tus páginas ----------

/** Las páginas con algo que mejorar, de la que más necesita a la que menos. */
const onPageTodo = (report: OnPageReport) =>
  report.pages
    .filter((p) => p.score !== null && !p.needsRecheck && !p.error && (p.ideas.length > 0 || p.suggestion))
    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101));

export function onPageItem(p: OnPagePage, website: string, lang: PromptLang): PromptItem {
  const t = L(lang);
  const s = p.stats;
  const how: string[] = [];
  if (p.keyword) how.push(t(`Búsqueda principal de esta página: «${p.keyword}». Que esté en el título, el H1, la meta descripción y el primer párrafo, de forma natural.`, `Main search for this page: "${p.keyword}". Use it naturally in the title, the H1, the meta description and the first paragraph.`));
  if (p.suggestion) {
    how.push(t(`Cambia el <title> por: «${p.suggestion.title}»`, `Change the <title> to: "${p.suggestion.title}"`));
    how.push(t(`Cambia la meta descripción por: «${p.suggestion.metaDescription}»`, `Change the meta description to: "${p.suggestion.metaDescription}"`));
    if (p.suggestion.h1) how.push(t(`Cambia el H1 por: «${p.suggestion.h1}»`, `Change the H1 to: "${p.suggestion.h1}"`));
    if (p.suggestion.h2s.length) how.push(t(`Usa estos subtítulos (H2): ${p.suggestion.h2s.map((h) => `«${h}»`).join(", ")}`, `Use these subheadings (H2): ${p.suggestion.h2s.map((h) => `"${h}"`).join(", ")}`));
  }
  for (const idea of p.ideas) {
    const text = lang === "en" ? idea.en : idea.es;
    how.push(idea.detail?.length ? `${text} (${idea.detail.slice(0, 8).join(" · ")})` : text);
  }
  const detail: string[] = [];
  if (s) {
    if (!p.suggestion) {
      detail.push(t(`Título actual: «${s.title || "(vacío)"}»`, `Current title: "${s.title || "(empty)"}"`));
      detail.push(t(`H1 actual: «${s.h1 || "(no tiene)"}»`, `Current H1: "${s.h1 || "(none)"}"`));
      detail.push(t(`Meta descripción actual: «${s.meta || "(no tiene)"}»`, `Current meta description: "${s.meta || "(none)"}"`));
    }
    detail.push(
      s.targetWords
        ? t(`Largo: ${num(s.words, lang)} palabras; las páginas que ganan en Google tienen unas ${num(s.targetWords, lang)}.`, `Length: ${num(s.words, lang)} words; the pages winning on Google have about ${num(s.targetWords, lang)}.`)
        : t(`Largo: ${num(s.words, lang)} palabras.`, `Length: ${num(s.words, lang)} words.`),
    );
  }
  return {
    title: `${p.title.trim() || absUrl(p.url, website)}${p.score !== null ? t(` (nota ${p.score}/100)`, ` (score ${p.score}/100)`) : ""}`,
    how,
    detail,
    urls: [absUrl(p.url, website)],
  };
}

export function onPagePrompt(ctx: PromptContext, report: OnPageReport, lang: PromptLang): string {
  const t = L(lang);
  return renderPrompt({
    ctx,
    lang,
    task: t(
      "Comparamos cada página importante con las que salen primero en Google para su búsqueda. Mejora estas páginas, empezando por la primera (la que más lo necesita).",
      "We compared each important page with the ones ranking first on Google for its search. Improve these pages, starting with the first one (the one that needs it most).",
    ),
    sections: [{ title: t("Página por página", "Page by page"), items: onPageTodo(report).map((p) => onPageItem(p, ctx.website, lang)) }],
  });
}

// ---------- Páginas para actualizar ----------

export function decayItem(p: DecayPage, website: string, lang: PromptLang): PromptItem {
  const t = L(lang);
  const tr = (es: string, en: string) => (lang === "en" ? en : es);
  const detail = [
    t(`Clics desde Google: ${num(p.before.clicks, lang)} → ${num(p.now.clicks, lang)}.`, `Clicks from Google: ${num(p.before.clicks, lang)} → ${num(p.now.clicks, lang)}.`),
  ];
  if (p.lostQueries.length)
    detail.push(
      t(
        `Búsquedas que perdió: ${p.lostQueries.map((q) => `«${q.query}»`).join(", ")}`,
        `Searches it lost: ${p.lostQueries.map((q) => `"${q.query}"`).join(", ")}`,
      ),
    );
  return {
    tag: reasonLabel(p.reason, tr),
    title: reasonWhy(p, tr),
    how: decayActions(p, tr),
    detail,
    urls: [absUrl(p.url, website)],
  };
}

export function decayPrompt(ctx: PromptContext, report: DecayReport, lang: PromptLang): string {
  const t = L(lang);
  // "Menos gente lo busca" no se arregla cambiando la página: no se le pide nada a la IA.
  const pages = report.pages.filter((p) => p.reason !== "demand");
  return renderPrompt({
    ctx,
    lang,
    task: t(
      "Estas páginas traían visitas desde Google y ahora traen menos (datos de Search Console). Actualízalas para recuperarlas, empezando por la primera.",
      "These pages used to bring visits from Google and now bring fewer (Search Console data). Update them to win the visits back, starting with the first one.",
    ),
    sections: [{ title: t("Páginas para actualizar", "Pages to refresh"), items: pages.map((p) => decayItem(p, ctx.website, lang)) }],
  });
}

// ---------- Páginas que compiten entre sí ----------

export function cannibalItem(issue: CannibalIssue, website: string, lang: PromptLang): PromptItem {
  const t = L(lang);
  const tr = (es: string, en: string) => (lang === "en" ? en : es);
  const main = issue.pages.find((p) => p.main) ?? issue.pages[0];
  const others = issue.pages.filter((p) => p !== main);
  const m = absUrl(main.url, website);
  const xs = others.map((p) => absUrl(p.url, website));
  const list = xs.join(", ");
  const q = issue.query;
  const how: string[] = [];
  switch (issue.fix) {
    case "merge":
      how.push(
        t(`Une ${list} dentro de ${m}: pasa lo mejor del contenido (sin repetir) a ${m}.`, `Merge ${list} into ${m}: move the best of the content (without duplicates) into ${m}.`),
        t(`Después pon una redirección 301 de ${list} a ${m} y cambia los enlaces internos que apuntaban a ${others.length === 1 ? "esa página" : "esas páginas"}.`, `Then add a 301 redirect from ${list} to ${m} and update the internal links that pointed to ${others.length === 1 ? "that page" : "those pages"}.`),
      );
      break;
    case "link":
      how.push(
        t(`En ${list}, agrega un enlace a ${m} con el texto «${issue.anchor ?? q}».`, `On ${list}, add a link to ${m} with the anchor text "${issue.anchor ?? q}".`),
        t(`Que el título y el H1 de ${m} digan «${q}», y que los de las otras no.`, `Make sure ${m}'s title and H1 say "${q}", and the others' don't.`),
      );
      break;
    case "zones":
      how.push(t("Son páginas para zonas distintas: está bien. Haz que el título y el H1 de cada una digan su propia ciudad, para que Google muestre la correcta.", "They're pages for different areas: that's fine. Make each page's title and H1 name its own city, so Google shows the right one."));
      break;
    default:
      how.push(
        t(`Deja ${m} como la página para «${q}».`, `Keep ${m} as the page for "${q}".`),
        t(`Cambia el título, el H1 y el enfoque de ${list} hacia otra búsqueda relacionada (no «${q}»), y agrega desde ahí un enlace a ${m} con el texto «${q}».`, `Change the title, H1 and focus of ${list} to a different related search (not "${q}"), and add a link from there to ${m} with the text "${q}".`),
      );
  }
  return {
    tag: severityLabel(issue.severity, tr),
    title: t(`Búsqueda «${q}»: ${issueWhy(issue, tr)}`, `Search "${q}": ${issueWhy(issue, tr)}`),
    how,
    detail: [t(`La principal: ${m}`, `Main page: ${m}`), t(`En palabras simples: ${fixText(issue, tr)}`, `In plain words: ${fixText(issue, tr)}`)],
    urls: [m, ...xs],
  };
}

export function cannibalPrompt(ctx: PromptContext, report: CannibalReport, lang: PromptLang): string {
  const t = L(lang);
  return renderPrompt({
    ctx,
    lang,
    task: t(
      "Varias páginas de la web salen en Google para la misma búsqueda y se quitan visitas entre ellas. Haz que cada búsqueda tenga una sola página principal.",
      "Several pages of the website show up on Google for the same search and take visits from each other. Make each search have a single main page.",
    ),
    sections: [{ title: t("Páginas que compiten entre sí", "Pages competing with each other"), items: report.issues.map((i) => cannibalItem(i, ctx.website, lang)) }],
  });
}

// ---------- Preguntas que hace la gente ----------

/** Las preguntas sin responder, por palabra clave, con la página donde conviene contestarlas (si se sabe). */
export function questionItems(groups: QuestionGroup[], pageFor: Record<string, string>, website: string, lang: PromptLang): PromptItem[] {
  const t = L(lang);
  const out: PromptItem[] = [];
  for (const g of groups) {
    const open = g.questions.filter((q) => !q.answered);
    if (!open.length) continue;
    const page = pageFor[g.keyword.toLowerCase()];
    const how = [
      page
        ? t(`Agrega a esta página una sección de preguntas frecuentes sobre «${g.keyword}».`, `Add a frequently asked questions section about "${g.keyword}" to this page.`)
        : t(`No hay una página para «${g.keyword}»: crea una (o un artículo del blog) con estas preguntas.`, `There's no page for "${g.keyword}": create one (or a blog article) with these questions.`),
      t(
        "Pon cada pregunta tal cual como subtítulo (H2 o H3) y contéstala justo debajo en 2 o 3 frases claras. Usa solo información que ya esté en el sitio; si la respuesta necesita un dato que no tienes (precio, tiempo, garantía), escribe [POR CONFIRMAR] para que el dueño lo complete.",
        "Use each question as-is as a subheading (H2 or H3) and answer it right below in 2 or 3 clear sentences. Use only information already on the site; if the answer needs a fact you don't have (price, time, warranty), write [TO CONFIRM] so the owner fills it in.",
      ),
    ];
    out.push({
      title: t(`Cuando buscan «${g.keyword}» (${open.length} ${open.length === 1 ? "pregunta" : "preguntas"})`, `When people search "${g.keyword}" (${open.length} ${open.length === 1 ? "question" : "questions"})`),
      how,
      detail: open.map((q) => (lang === "en" ? `"${q.question}"` : `«${q.question}»`)),
      urls: page ? [absUrl(page, website)] : undefined,
    });
  }
  return out;
}

export function questionsPrompt(ctx: PromptContext, groups: QuestionGroup[], pageFor: Record<string, string>, lang: PromptLang): string {
  const t = L(lang);
  return renderPrompt({
    ctx,
    lang,
    task: t(
      "Google muestra estas preguntas («La gente también pregunta») cuando buscan lo que vende el negocio, y la web todavía no las contesta. Contéstalas en la página indicada.",
      "Google shows these questions (\"People also ask\") when people search for what the business sells, and the website doesn't answer them yet. Answer them on the page indicated.",
    ),
    sections: [{ title: t("Preguntas para contestar", "Questions to answer"), items: questionItems(groups, pageFor, ctx.website, lang) }],
  });
}

/** Para cada palabra clave (en minúsculas), la página del negocio que Google muestra (de "tus posiciones"). */
export function pagesByKeyword(reports: Pick<RankReport, "rows">[], extra: { keyword: string | null; url: string }[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const x of extra) if (x.keyword && !out[x.keyword.toLowerCase()]) out[x.keyword.toLowerCase()] = x.url;
  for (const r of reports) for (const row of r.rows) if (row.url && !out[row.keyword.toLowerCase()]) out[row.keyword.toLowerCase()] = row.url;
  return out;
}

// ---------- Palabras que tu competencia tiene y tú no ----------

/**
 * Clave para juntar variantes de la misma búsqueda ("portón corredizo", "porton corredizo", "portones corredizos"):
 * sin acentos, sin mayúsculas y cada palabra sin su plural. Así no se pide una página por cada variante (competirían).
 */
export function variantKey(keyword: string): string {
  return keyword
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");
}

export function gapItems(rows: GapRow[], lang: PromptLang, max = 15): PromptItem[] {
  const t = L(lang);
  const q = (k: string) => (lang === "en" ? `"${k}"` : `«${k}»`);
  // Las variantes van con la mejor (la de más oportunidad).
  const groups = new Map<string, { row: GapRow; variants: string[] }>();
  for (const r of [...rows].sort((a, b) => b.opportunity - a.opportunity)) {
    const k = variantKey(r.keyword);
    const g = groups.get(k);
    if (g) g.variants.push(r.keyword);
    else groups.set(k, { row: r, variants: [] });
  }
  return [...groups.values()]
    .slice(0, max)
    .map(({ row: r, variants }) => {
      const also = variants.length ? t(`También la buscan como ${variants.map(q).join(", ")}: usa la misma página, no hagas una por cada una.`, `People also search it as ${variants.map(q).join(", ")}: use the same page, don't make one for each.`) : "";
      const best = r.competitors[0];
      const facts = [
        r.volume !== null ? t(`${num(r.volume, lang)} búsquedas al mes`, `${num(r.volume, lang)} searches a month`) : "",
        r.difficulty !== null ? t(`dificultad ${r.difficulty}/100`, `difficulty ${r.difficulty}/100`) : "",
        best ? t(`${best.domain} sale en el lugar ${best.position}`, `${best.domain} ranks #${best.position}`) : "",
        r.yourPosition !== null ? t(`la web sale en el lugar ${r.yourPosition}`, `the website ranks #${r.yourPosition}`) : "",
      ].filter(Boolean);
      return r.type === "missing"
        ? {
            tag: t("Nueva", "New"),
            title: t(`Crear una página o artículo para «${r.keyword}»`, `Create a page or article for "${r.keyword}"`),
            how: [
              t(
                `Escribe una página (o un artículo del blog) dedicada a «${r.keyword}»: la búsqueda en el título, el H1 y el primer párrafo; explica el servicio del negocio relacionado con eso y termina con cómo contactarlo.`,
                `Write a page (or a blog article) dedicated to "${r.keyword}": the search in the title, the H1 and the first paragraph; explain the business's related service and end with how to contact it.`,
              ),
              t("Enlázala desde la página de inicio o la página del servicio más parecido.", "Link to it from the home page or the most related service page."),
            ],
            detail: [facts.join(" · "), also].filter(Boolean),
          }
        : {
            tag: t("Mejorar", "Improve"),
            title: t(`Subir en «${r.keyword}»`, `Move up for "${r.keyword}"`),
            how: [
              t(
                `Busca la página de la web que trata de «${r.keyword}» y mejórala: la búsqueda en el título y el H1, más contenido útil que el de la competencia y enlaces desde otras páginas.`,
                `Find the website's page about "${r.keyword}" and improve it: the search in the title and H1, more useful content than the competitor's, and links from other pages.`,
              ),
            ],
            detail: [facts.join(" · "), also].filter(Boolean),
          };
    });
}

export function gapPrompt(ctx: PromptContext, rows: GapRow[], lang: PromptLang): string {
  const t = L(lang);
  return renderPrompt({
    ctx,
    lang,
    task: t(
      "Estas búsquedas de Google ya le traen clientes a la competencia y la web no sale (o sale más abajo). Crea o mejora las páginas, empezando por la primera (la mejor oportunidad).",
      "These Google searches already bring customers to the competition and the website doesn't show up (or ranks lower). Create or improve the pages, starting with the first one (the best opportunity).",
    ),
    sections: [{ title: t("Páginas para crear o mejorar", "Pages to create or improve"), items: gapItems(rows, lang) }],
  });
}

// ---------- Tus posiciones en Google ----------

/** Las palabras clave donde casi nadie te encuentra (o la página que sale trata de otra cosa). */
export function rankItems(report: Pick<RankReport, "rows">, website: string, lang: PromptLang, max = 12): PromptItem[] {
  const t = L(lang);
  const out: PromptItem[] = [];
  for (const row of report.rows) {
    if (row.error) continue;
    const a = rowAdvice(row);
    const bad = a.verdict === "none" || a.verdict === "far" || a.verdict === "close" || a.verdict === "map";
    if (!bad && !a.mismatch) continue;
    const where = row.position === null ? t("no sale en los primeros 20", "not in the top 20") : t(`sale en el lugar ${row.position}`, `ranks #${row.position}`);
    if (row.url && !a.mismatch)
      out.push({
        tag: where,
        title: t(`Mejorar la página para «${row.keyword}»`, `Improve the page for "${row.keyword}"`),
        how: [
          t(`Pon «${row.keyword}» en el título, el H1 y el primer párrafo de esta página, de forma natural.`, `Put "${row.keyword}" in this page's title, H1 and first paragraph, naturally.`),
          t("Agrega contenido útil sobre eso (qué incluye, para quién, zonas, preguntas frecuentes) y enlázala desde la página de inicio.", "Add useful content about it (what's included, who it's for, areas, FAQs) and link to it from the home page."),
        ],
        urls: [absUrl(row.url, website)],
      });
    else
      out.push({
        tag: where,
        title: t(`Crear una página dedicada a «${row.keyword}»`, `Create a page dedicated to "${row.keyword}"`),
        how: [
          a.mismatch && row.url
            ? t(`Hoy Google muestra ${absUrl(row.url, website)}, que trata de otra cosa. Crea una página nueva sobre «${row.keyword}».`, `Google currently shows ${absUrl(row.url, website)}, which is about something else. Create a new page about "${row.keyword}".`)
            : t(`Crea una página nueva sobre «${row.keyword}».`, `Create a new page about "${row.keyword}".`),
          t("La búsqueda en el título, el H1 y el primer párrafo; explica el servicio y cómo contactar al negocio. Enlázala desde la página de inicio.", "The search in the title, H1 and first paragraph; explain the service and how to contact the business. Link to it from the home page."),
        ],
      });
    if (out.length >= max) break;
  }
  return out;
}

export function rankPrompt(ctx: PromptContext, report: Pick<RankReport, "rows">, lang: PromptLang): string {
  const t = L(lang);
  return renderPrompt({
    ctx,
    lang,
    task: t(
      "Estas son las búsquedas que el negocio quiere ganar en Google y donde todavía casi nadie lo encuentra. Mejora o crea las páginas.",
      "These are the searches the business wants to win on Google where almost nobody finds it yet. Improve or create the pages.",
    ),
    sections: [{ title: t("Búsquedas para mejorar", "Searches to improve"), items: rankItems(report, ctx.website, lang) }],
  });
}

// ---------- Listas de tareas para el dueño ----------

/** Dónde conseguir enlaces: esto lo hace el dueño (registrarse, escribir), no la IA de la página. */
export function backlinksChecklist(ctx: PromptContext, gap: GapDomain[], lang: PromptLang, max = 15): string {
  const t = L(lang);
  const tr = (es: string, en: string) => (lang === "en" ? en : es);
  const hints = hintText(tr);
  const list = [...gap].sort((a, b) => Number(HINT_EASY[b.hint]) - Number(HINT_EASY[a.hint])).slice(0, max);
  return renderChecklist({
    ctx,
    lang,
    title: t("Dónde conseguir enlaces a tu página", "Where to get links to your website"),
    intro: t(
      `Sitios que ya enlazan a tu competencia y a ti no. Empieza por los fáciles. En cada uno pon tu página: ${siteUrl(ctx.website)}`,
      `Sites that already link to your competitors but not to you. Start with the easy ones. On each one add your website: ${siteUrl(ctx.website)}`,
    ),
    items: list.map((g) => ({ title: `${g.domain} (${hints[g.hint].label})`, how: [hints[g.hint].how], urls: [`https://${g.domain}`] })),
  });
}

/** Directorios, redes y mapas donde un negocio local se puede registrar (parte del dominio, sin la terminación). */
export const LISTING_SITES = new Set([
  "facebook", "instagram", "linkedin", "tiktok", "pinterest", "nextdoor", "waze", "foursquare", "mapquest",
  "yelp", "angi", "angieslist", "bbb", "thumbtack", "homeadvisor", "yellowpages", "superpages", "manta", "houzz", "porch", "bark",
  "chamberofcommerce", "birdeye", "tripadvisor", "trustpilot", "buildzoom", "brownbook", "hotfrog", "cylex", "infobel", "tuugo",
  "find-us-here", "storeboard", "kompass", "europages", "paginasamarillas", "amarillas", "paginas-amarillas", "guiamais", "encuentra24",
  "diredi", "cybo", "starofservice", "findglocal", "infoisinfo", "habitissimo", "cronoshare", "doctoralia", "nicaraguacompanies",
  "empresite", "infoempresas", "guialocal", "guiaempresas", "dondeir",
]);

/** El directorio de una dirección ("es.cybo.com" → "cybo") o null si no es uno donde registrarse. */
function listingOf(domain: string): string | null {
  const labels = domain.toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(".").filter(Boolean);
  return labels.slice(0, -1).find((l) => LISTING_SITES.has(l)) ?? null;
}

/**
 * Los directorios que Google muestra arriba para las búsquedas del negocio (de "tus posiciones"), del que más sale al
 * que menos, más los que se agreguen (`extra`). Un dominio por directorio.
 */
export function listingDomains(reports: Pick<RankReport, "rows">[], extra: string[] = [], max = 12): string[] {
  const hits = new Map<string, { domain: string; n: number }>();
  const add = (domain: string, n: number) => {
    const key = listingOf(domain);
    if (!key) return;
    const d = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    const cur = hits.get(key);
    hits.set(key, { domain: cur?.domain ?? d, n: (cur?.n ?? 0) + n });
  };
  for (const r of reports) for (const row of r.rows) for (const x of row.top) add(x.domain, 1);
  for (const d of extra) add(d, 0);
  return [...hits.values()].sort((a, b) => b.n - a.n).slice(0, max).map((x) => x.domain);
}

/** Directorios que salen arriba en Google para tus búsquedas: conviene estar en ellos. */
export function directoriesChecklist(ctx: PromptContext, domains: string[], lang: PromptLang): string {
  const t = L(lang);
  return renderChecklist({
    ctx,
    lang,
    title: t("Directorios donde te conviene estar", "Directories you should be listed on"),
    intro: t(
      "Estos directorios salen arriba en Google para tus búsquedas. Regístrate (o revisa tu ficha) con tus datos y el enlace a tu página.",
      "These directories rank high on Google for your searches. Sign up (or check your listing) with your details and a link to your website.",
    ),
    items: domains.map((d) => ({ title: d, how: [t("Crea o completa tu ficha: nombre, teléfono, dirección, horario, fotos y el enlace a tu página.", "Create or complete your listing: name, phone, address, hours, photos and the link to your website.")], urls: [`https://${d}`] })),
  });
}

/** Lo que le falta al Perfil de Google: lo hace el dueño en business.google.com. */
export function gbpChecklist(ctx: PromptContext, missing: Pick<GbpCheck, "es" | "en" | "priority">[], unanswered: number, lang: PromptLang): string {
  const t = L(lang);
  const order = { high: 0, medium: 1, low: 2 } as const;
  const items: PromptItem[] = [...missing]
    .sort((a, b) => order[a.priority] - order[b.priority])
    .map((c) => ({ title: lang === "en" ? c.en : c.es, how: [] }));
  if (unanswered > 0)
    items.push({
      title: t(`Contesta tus ${unanswered} reseñas sin respuesta`, `Reply to your ${unanswered} unanswered reviews`),
      how: [t("La app te escribe las respuestas en «Tu Perfil de Google»: revísalas y pégalas en Google.", "The app drafts the replies in \"Your Google Business Profile\": check them and paste them on Google.")],
    });
  return renderChecklist({
    ctx,
    lang,
    title: t("Tareas para tu Perfil de Google", "To-do list for your Google Business Profile"),
    intro: t("Entra a https://business.google.com con la cuenta dueña del perfil y haz esto, de lo más importante a lo menos:", "Go to https://business.google.com with the account that owns the profile and do this, most important first:"),
    items,
  });
}

// ---------- El resumen para la IA (todo junto) ----------

export type GeneralInput = {
  audit?: AuditReport | null;
  onpage?: OnPageReport | null;
  decay?: DecayReport | null;
  cannibal?: CannibalReport | null;
  /** ¿Falta el código para Google en la página de inicio? */
  schemaMissing?: boolean;
  questions?: { groups: QuestionGroup[]; pageFor: Record<string, string> } | null;
  gap?: GapRow[] | null;
  rank?: Pick<RankReport, "rows"> | null;
  /** Frases del resumen en palabras simples (cómo va hoy). */
  status?: string[];
};

/** Cuántos cambios de cada sección entran en el resumen general. */
export const GENERAL_TOP = { audit: 6, onpage: 3, decay: 3, cannibal: 3, questions: 3, gap: 5, rank: 5 } as const;

/** Las secciones del resumen general (las que tienen algo que hacer), en orden de importancia. */
export function generalSections(ctx: PromptContext, input: GeneralInput, lang: PromptLang): PromptSection[] {
  const t = L(lang);
  const out: PromptSection[] = [];
  if (input.audit?.issues.length)
    out.push({
      title: t(`1. Problemas técnicos de la página (auditoría: ${input.audit.score}/100)`, `1. Technical problems on the website (audit: ${input.audit.score}/100)`),
      items: auditItems(input.audit, ctx.website, lang, GENERAL_TOP.audit),
    });
  if (input.schemaMissing)
    out.push({
      title: t("2. Datos del negocio para Google", "2. Business details for Google"),
      items: [{ title: t("Falta el código LocalBusiness (JSON-LD) en la página de inicio", "The LocalBusiness code (JSON-LD) is missing from the home page"), how: [AI_FIX["no-structured-data"][lang]], urls: ctx.website ? [siteUrl(ctx.website)] : undefined }],
    });
  const decay = input.decay?.pages.filter((p) => p.reason !== "demand") ?? [];
  if (decay.length)
    out.push({ title: t("3. Páginas que están perdiendo visitas", "3. Pages losing visits"), items: decay.slice(0, GENERAL_TOP.decay).map((p) => decayItem(p, ctx.website, lang)) });
  const cannibal = input.cannibal?.issues.filter((i) => i.severity !== "baja") ?? [];
  if (cannibal.length)
    out.push({ title: t("4. Páginas que compiten entre sí", "4. Pages competing with each other"), items: cannibal.slice(0, GENERAL_TOP.cannibal).map((i) => cannibalItem(i, ctx.website, lang)) });
  if (input.onpage) {
    const pages = onPageTodo(input.onpage).slice(0, GENERAL_TOP.onpage);
    if (pages.length) out.push({ title: t("5. Páginas para mejorar (comparadas con las que ganan en Google)", "5. Pages to improve (compared with the ones winning on Google)"), items: pages.map((p) => onPageItem(p, ctx.website, lang)) });
  }
  if (input.rank) {
    const items = rankItems(input.rank, ctx.website, lang, GENERAL_TOP.rank);
    if (items.length) out.push({ title: t("6. Búsquedas donde casi nadie te encuentra", "6. Searches where almost nobody finds you"), items });
  }
  if (input.questions) {
    const items = questionItems(input.questions.groups, input.questions.pageFor, ctx.website, lang).slice(0, GENERAL_TOP.questions);
    if (items.length) out.push({ title: t("7. Preguntas de la gente para contestar", "7. People's questions to answer"), items });
  }
  if (input.gap?.length) out.push({ title: t("8. Páginas nuevas para ganarle a la competencia", "8. New pages to beat the competition"), items: gapItems(input.gap, lang, GENERAL_TOP.gap) });
  // Se numeran de nuevo por si faltan algunas.
  return out.map((s, i) => ({ ...s, title: s.title.replace(/^\d+\./, `${i + 1}.`) }));
}

export function generalPrompt(ctx: PromptContext, input: GeneralInput, lang: PromptLang): string {
  const t = L(lang);
  return renderPrompt({
    ctx,
    lang,
    task: t(
      "Te paso el resumen de SEO de la página con lo más importante para arreglar. Hazlo en el orden de las secciones; dentro de cada una, empieza por el primer punto. Si es mucho, haz una sección a la vez y avísame.",
      "Here is the website's SEO summary with the most important things to fix. Work through the sections in order; within each one, start with the first item. If it's a lot, do one section at a time and let me know.",
    ),
    status: input.status,
    sections: generalSections(ctx, input, lang),
  });
}
