// "Copiar instrucciones para la IA de tu web": la base de los textos que el dueño copia y pega en el chat de la IA
// (Claude u otra) que maneja su página web. Todo puro y sin imports del servidor, para que también lo use el navegador
// (el código para Google se arma ahí, con el horario que el dueño edita). Los textos de cada reporte están en prompts.ts.

export type PromptLang = "es" | "en";

/** Lo que se sabe del negocio para darle contexto a la IA. Lo que no se sabe queda vacío: nunca se inventa. */
export type PromptContext = {
  name: string;
  website: string;
  /** Ciudades o zonas donde atiende ("Managua, Masaya"). */
  area: string;
  /** Lo que vende (servicios o productos), los más importantes primero. */
  sells: string[];
  /** Cómo se describe el negocio (el perfil para la IA que escribió el dueño), recortado. Solo si no hay servicios. */
  about: string;
  /** El repositorio de GitHub de la página (de la conexión «Sitio web»), si se conoce. */
  repo: string;
  branch: string;
};

/** Un cambio concreto para la IA (o una tarea para el dueño). */
export type PromptItem = {
  title: string;
  /** "Error", "Urgent"…: se muestra entre corchetes antes del título. */
  tag?: string;
  /** Qué hacer y cómo (una línea por paso). */
  how: string[];
  /** Las direcciones completas donde hay que hacerlo. */
  urls?: string[];
  /** Si hay más direcciones de las que se listan. */
  moreUrls?: number;
  /** Datos de apoyo (preguntas, búsquedas, títulos actuales…). */
  detail?: string[];
};

export type PromptSection = {
  title: string;
  /** Una o dos frases antes de la lista. */
  intro?: string;
  items: PromptItem[];
};

const L = (lang: PromptLang) => (es: string, en: string) => (lang === "en" ? en : es);

/** Lleva una dirección a absoluta (con https:// y el dominio del negocio si viene solo la ruta). */
export function absUrl(url: string, website: string): string {
  const u = url.trim();
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  const base = website.trim() ? (/^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`) : "";
  if (!base) return u;
  try {
    return new URL(u, base.endsWith("/") ? base : `${base}/`).href;
  } catch {
    return u;
  }
}

/** La dirección del sitio con https:// (para mostrar). */
export const siteUrl = (website: string) => {
  const w = website.trim();
  return !w ? "" : /^https?:\/\//i.test(w) ? w : `https://${w}`;
};

/** El contexto del negocio, en líneas. Solo lo que se sabe. */
export function contextLines(ctx: PromptContext, lang: PromptLang): string[] {
  const t = L(lang);
  const out = [`- ${t("Negocio", "Business")}: ${ctx.name}`];
  if (ctx.website.trim()) out.push(`- ${t("Página web", "Website")}: ${siteUrl(ctx.website)}`);
  if (ctx.area.trim()) out.push(`- ${t("Zona donde atiende", "Area served")}: ${ctx.area.trim()}`);
  if (ctx.sells.length) out.push(`- ${t("Lo que vende", "What it sells")}: ${ctx.sells.join(", ")}`);
  else if (ctx.about.trim()) out.push(`- ${t("Sobre el negocio (escrito por el dueño)", "About the business (written by the owner)")}: ${ctx.about.trim()}`);
  if (ctx.repo.trim())
    out.push(
      `- ${t("Código", "Code")}: ${t(
        `el código de la página está en el repositorio de GitHub «${ctx.repo.trim()}» (rama «${ctx.branch.trim() || "main"}») y se publica con Vercel. Haz los cambios ahí.`,
        `the website's code is in the GitHub repository "${ctx.repo.trim()}" (branch "${ctx.branch.trim() || "main"}") and is deployed with Vercel. Make the changes there.`,
      )}`,
    );
  return out;
}

/** Las reglas del final: siempre las mismas. */
export function rulesLines(lang: PromptLang): string[] {
  const t = L(lang);
  return [
    `- ${t("Mantén el diseño, el tono y las direcciones (URLs) actuales, salvo que un cambio de arriba diga otra cosa. Si cambias una dirección, pon una redirección 301 de la vieja a la nueva.", "Keep the current design, tone and URLs unless a change above says otherwise. If you change a URL, add a 301 redirect from the old one to the new one.")}`,
    `- ${t("Escribe los textos en el idioma de cada página, con buena ortografía.", "Write the copy in each page's language, with correct spelling.")}`,
    `- ${t("Si algo no se puede hacer o no lo encuentras, dímelo en vez de adivinar.", "If something can't be done or you can't find it, tell me instead of guessing.")}`,
    `- ${t("Al terminar, dame una lista corta de lo que cambiaste en cada dirección.", "When you're done, give me a short list of what you changed on each URL.")}`,
    `- ${t("No inventes datos: no pongas precios, promesas, cifras, años de experiencia, reseñas ni garantías que no estén ya en la página o en este mensaje.", "Do not invent facts; keep prices, claims, numbers, years in business, reviews and guarantees out unless they are already on the site or provided in this message.")}`,
  ];
}

function itemLines(item: PromptItem, n: number, lang: PromptLang): string[] {
  const t = L(lang);
  const out = [`${n}. ${item.tag ? `[${item.tag}] ` : ""}${item.title}`];
  for (const h of item.how) out.push(`   - ${h}`);
  if (item.detail?.length) for (const d of item.detail) out.push(`   - ${d}`);
  if (item.urls?.length) {
    out.push(`   ${item.urls.length === 1 ? t("Dirección:", "URL:") : t("Direcciones:", "URLs:")}`);
    for (const u of item.urls) out.push(`   - ${u}`);
    if (item.moreUrls && item.moreUrls > 0) out.push(`   - ${t(`…y ${item.moreUrls} más con el mismo problema (búscalas en todo el sitio).`, `…and ${item.moreUrls} more with the same problem (look for them across the site).`)}`);
  }
  return out;
}

/**
 * Arma el texto completo para la IA de la página: quién es el negocio, la tarea, los cambios numerados (con las
 * direcciones completas) y las reglas. Si no hay ningún cambio, devuelve "".
 */
export function renderPrompt(input: {
  ctx: PromptContext;
  lang: PromptLang;
  task: string;
  sections: PromptSection[];
  status?: string[];
  /** Bloques que van antes de las reglas (por ejemplo, el código para pegar). */
  extra?: { title: string; body: string }[];
}): string {
  const { ctx, lang } = input;
  const t = L(lang);
  const sections = input.sections.filter((s) => s.items.length > 0);
  if (!sections.length) return "";
  const out: string[] = [
    t(`Hola. Eres la IA que maneja la página web de ${ctx.name}. ${input.task}`, `Hi. You are the AI that manages the website of ${ctx.name}. ${input.task}`),
    "",
    t("## El negocio", "## The business"),
    ...contextLines(ctx, lang),
  ];
  if (input.status?.length) {
    out.push("", t("## Cómo va hoy (resumen)", "## Where things stand (summary)"));
    for (const s of input.status) out.push(`- ${s}`);
  }
  for (const s of sections) {
    out.push("", `## ${s.title}`);
    if (s.intro) out.push(s.intro);
    out.push("");
    s.items.forEach((item, i) => out.push(...itemLines(item, i + 1, lang)));
  }
  for (const x of input.extra ?? []) out.push("", `## ${x.title}`, x.body);
  out.push("", t("## Reglas", "## Rules"), ...rulesLines(lang));
  return out.join("\n");
}

/**
 * Lista de tareas para el dueño (lo que no puede hacer la IA de la página: registrarse en directorios, su Perfil de
 * Google…). Texto simple con casillas para pegar en notas. Sin tareas devuelve "".
 */
export function renderChecklist(input: { ctx: PromptContext; lang: PromptLang; title: string; intro?: string; items: PromptItem[] }): string {
  const { lang } = input;
  if (!input.items.length) return "";
  const t = L(lang);
  const out = [`${input.title} — ${input.ctx.name}`];
  if (input.intro) out.push(input.intro);
  out.push("");
  for (const item of input.items) {
    out.push(`[ ] ${item.title}`);
    for (const h of item.how) out.push(`    ${h}`);
    if (item.urls?.length) for (const u of item.urls) out.push(`    ${u}`);
    if (item.detail?.length) for (const d of item.detail) out.push(`    ${d}`);
  }
  out.push("", t("Usa siempre el mismo nombre, dirección y teléfono que en tu Perfil de Google y tu página web.", "Always use the same name, address and phone number as on your Google Business Profile and your website."));
  return out.join("\n");
}

/** "Código para Google": pegar el JSON-LD de LocalBusiness en el <head> de la página de inicio. */
export function schemaPrompt(ctx: PromptContext, code: string, lang: PromptLang, status: "present" | "incomplete" | "missing" | "unknown"): string {
  const t = L(lang);
  const home = siteUrl(ctx.website) || t("la página de inicio", "the home page");
  const how =
    status === "present"
      ? [
          t(
            `La página de inicio (${home}) ya tiene un bloque <script type="application/ld+json"> de negocio. Compáralo con el código de abajo y agrégale solo los datos que le falten (horario, ubicación, servicios, redes…).`,
            `The home page (${home}) already has a business <script type="application/ld+json"> block. Compare it with the code below and add only the details it's missing (hours, location, services, social profiles…).`,
          ),
          t(
            "No borres datos que ya estén y sean correctos, y no dejes dos bloques de LocalBusiness: si no hay nada que agregar, no cambies nada y avísame.",
            "Don't remove details that are already there and correct, and don't leave two LocalBusiness blocks: if there's nothing to add, change nothing and tell me.",
          ),
        ]
      : [
          t(
            `Pega este bloque <script type="application/ld+json"> dentro del <head> de la página de inicio (${home}), tal cual.`,
            `Paste this <script type="application/ld+json"> block inside the <head> of the home page (${home}), exactly as is.`,
          ),
          status === "incomplete"
            ? t(
                "La página ya tiene datos de la organización pero no como negocio local. No dejes dos bloques de LocalBusiness; conserva los de WebSite o artículos si existen.",
                "The site already has organization data but not as a local business. Don't leave two LocalBusiness blocks; keep any WebSite or article blocks.",
              )
            : t("Solo una vez: no lo repitas en otras páginas.", "Only once: don't repeat it on other pages."),
        ];
  how.push(
    t(
      "No cambies los datos del código (nombre, dirección, teléfono, horario): vienen del dueño y de su Perfil de Google. Si el sitio usa un framework (Next.js, WordPress…), ponlo en el layout o en el <head> de la página de inicio.",
      "Don't change the data in the code (name, address, phone, hours): it comes from the owner and their Google Business Profile. If the site uses a framework (Next.js, WordPress…), add it in the layout or the home page's <head>.",
    ),
    t(
      "Después, comprueba que la Prueba de resultados enriquecidos de Google (https://search.google.com/test/rich-results) muestre «Empresas locales» sin errores.",
      "Then check that Google's Rich Results Test (https://search.google.com/test/rich-results) shows \"Local businesses\" with no errors.",
    ),
  );
  return renderPrompt({
    ctx,
    lang,
    task: t(
      "Necesito que agregues a la página los datos del negocio en el formato que lee Google (datos estructurados LocalBusiness).",
      "I need you to add the business details to the website in the format Google reads (LocalBusiness structured data).",
    ),
    sections: [{ title: t("Qué hacer", "What to do"), items: [{ title: t("Agregar el código para Google a la página de inicio", "Add the code for Google to the home page"), how }] }],
    extra: [{ title: t("El código", "The code"), body: code }],
  });
}
