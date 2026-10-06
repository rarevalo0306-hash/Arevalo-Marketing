// "Pedir enlace": para un sitio de "Dónde conseguir enlaces" (la lista de Enlaces hacia tu página), prepara qué hacer
// para conseguir el enlace, como el Link Building Tool de Semrush pero sin enviar nada:
// - directorios, gobierno/universidades, asociaciones y proveedores → pasos simples (dónde registrarse y qué datos tener a mano);
// - noticias, blogs, foros y otros → un correo corto escrito por la IA que ya usa la app (asunto + mensaje);
// - redes sociales → pasos para crear o completar el perfil.
// Busca un correo de contacto en la página del sitio (portada y una página de contacto, máximo 3 visitas de 5 s, solo GET)
// y nunca inventa correos. No usa DataForSEO: solo cuesta lo poco que cobra la IA por el correo.
import { z } from "zod";
import { ask } from "@/lib/ai";
import { bi } from "@/lib/i18n";
import { decodeEntities, fetchPublicHtml } from "@/lib/seo/audit";
import type { GapDomain, LinkHint } from "@/lib/seo/backlinks";
import { normalizeDomain, sameSite, type BiText } from "@/lib/seo/competitors";
import { readZones, zoneLabel } from "@/lib/seo/dataforseo";
import { readMapPlace } from "@/lib/seo/maprank";
import { readStudy } from "@/lib/study-shape";

// ---------- Tipos ----------

/** email = escribirles un correo; signup = registrarse o pedir que te pongan en su lista; profile = crear o completar un perfil. */
export type OutreachType = "email" | "signup" | "profile";

export type OutreachDraft = {
  domain: string;
  hint: LinkHint;
  type: OutreachType;
  /** Idioma del correo (el del sitio si se pudo ver; si no, el del negocio). */
  lang: "es" | "en";
  subject?: string;
  body?: string;
  /** Pasos en los dos idiomas (se muestran en el idioma de la pantalla). */
  steps: BiText[];
  /** Correo encontrado en la página del sitio (nunca adivinado). */
  contactEmail?: string;
  /** Página de contacto encontrada. */
  contactUrl?: string;
  /** Dónde registrarse: el enlace "Registrar empresa" que tenga la portada o, si no, la portada. */
  signupUrl?: string;
  createdAt: string;
};

export type OutreachStore = { version: 1; drafts: Record<string, OutreachDraft> };

export const OUTREACH_KIND = "outreach";
/** Cuántos borradores se guardan como máximo (los más viejos se borran). */
export const OUTREACH_MAX_DRAFTS = 60;
/** Cuántos prepara "Preparar los 5 primeros". */
export const OUTREACH_TOP = 5;
/** Visitas máximas a la página del sitio para buscar el contacto, y tiempo máximo de cada una. */
export const CONTACT_MAX_FETCHES = 3;
export const CONTACT_TIMEOUT_MS = 5_000;
export const CONTACT_PATHS = ["/contacto", "/contact", "/contactenos"] as const;

const EMAIL_HINTS: LinkHint[] = ["news", "blog", "forum", "other"];
const SIGNUP_HINTS: LinkHint[] = ["directory", "public", "association", "supplier"];

/** Qué hay que hacer según el tipo de sitio. */
export function outreachType(hint: LinkHint): OutreachType {
  if (hint === "social") return "profile";
  if (SIGNUP_HINTS.includes(hint)) return "signup";
  return "email";
}

export const needsEmail = (hint: LinkHint) => EMAIL_HINTS.includes(hint);

// ---------- Contacto (HTML → correos y páginas; sin red, se prueba en tests) ----------

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}$/;
const TEXT_EMAIL_RE = /(?<![a-z0-9._%+-])[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?![a-z0-9-])/gi;
const FAKE_EMAIL = /\.(png|jpe?g|gif|webp|svg|avif|css|js|ico)$|@(example|domain|dominio|email|correo|yourdomain|tudominio|tuempresa|empresa)\.|sentry|wixpress/i;
const NO_REPLY = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce)/i;

const CONTACT_LINK = /contact|contacto|cont[aá]ctenos|cont[aá]ctanos|escr[ií]benos|escribenos/i;
const SIGNUP_LINK =
  /registr|sign ?up|crear (una )?cuenta|agrega(r)? (tu |su )?(empresa|negocio)|a[nñ]ad(e|ir) (tu |su )?(empresa|negocio)|add (your )?(business|company|listing)|list your business|publica(r)? (tu |su )?(empresa|negocio|anuncio)|an[uú]nciate|afiliaci|hazte (socio|miembro)|membres[ií]a|membership|join us|[uú]nete|proveedores|suppliers/i;

/** Un correo limpio y válido, o null. Acepta "mailto:Info%40Sitio.com?subject=x". */
export function cleanEmail(raw: string): string | null {
  let s = decodeEntities(String(raw ?? "")).trim();
  s = s.replace(/^mailto:/i, "").split("?")[0] ?? "";
  try {
    s = decodeURIComponent(s);
  } catch {
    // Se deja como está.
  }
  s = s.trim().toLowerCase().replace(/^[<("']+|[>)"'.,;:]+$/g, "");
  if (!EMAIL_RE.test(s) || FAKE_EMAIL.test(s) || NO_REPLY.test(s)) return null;
  return s;
}

const stripTags = (html: string) =>
  decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ");

const attr = (tag: string, name: string): string => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return decodeEntities(m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
};

export type ContactScan = {
  /** Correos escritos en la página (enlaces mailto: y texto visible), sin repetir. Nunca se adivinan. */
  emails: string[];
  contactUrl?: string;
  signupUrl?: string;
  /** Idioma de la página según <html lang>, si lo dice. */
  lang?: "es" | "en";
  title?: string;
  description?: string;
};

/**
 * Lee una página y saca los correos (mailto: y escritos tal cual), el enlace a su página de contacto y el de registrarse.
 * No arma correos a partir de textos como "info [arroba] sitio [punto] com", ni de imágenes o scripts.
 */
export function scanContactHtml(html: string, pageUrl: string): ContactScan {
  const base = (() => {
    try {
      return new URL(pageUrl);
    } catch {
      return null;
    }
  })();
  const host = base ? normalizeDomain(base.hostname) : null;
  const emails: string[] = [];
  const add = (e: string | null) => {
    if (e && !emails.includes(e)) emails.push(e);
  };
  let contactUrl: string | undefined;
  let signupUrl: string | undefined;
  const sameSiteUrl = (href: string): string | undefined => {
    if (!base || !href || /^(javascript|tel|whatsapp|sms):/i.test(href) || href.startsWith("#")) return undefined;
    try {
      const u = new URL(href, base);
      if (!/^https?:$/.test(u.protocol)) return undefined;
      const d = normalizeDomain(u.hostname);
      if (!d || !host || !sameSite(d, host)) return undefined;
      u.hash = "";
      return u.href;
    } catch {
      return undefined;
    }
  };

  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = m[0].slice(0, m[0].indexOf(">") + 1);
    const href = attr(tag, "href");
    if (/^mailto:/i.test(href)) {
      for (const part of href.replace(/^mailto:/i, "").split("?")[0].split(/[,;]/)) add(cleanEmail(part));
      continue;
    }
    const text = stripTags(m[1] ?? "").trim();
    const label = `${text} ${attr(tag, "title")} ${attr(tag, "aria-label")}`;
    let path = "";
    try {
      path = base ? new URL(href, base).pathname : href;
    } catch {
      path = href;
    }
    if (!contactUrl && (CONTACT_LINK.test(label) || CONTACT_LINK.test(path))) contactUrl = sameSiteUrl(href);
    if (!signupUrl && (SIGNUP_LINK.test(label) || SIGNUP_LINK.test(path.replace(/[-_/]+/g, " ")))) signupUrl = sameSiteUrl(href);
  }
  // Correos escritos tal cual en el texto visible ("info@sitio.com" o "info&#64;sitio.com").
  for (const m of stripTags(html).matchAll(TEXT_EMAIL_RE)) add(cleanEmail(m[0]));

  const langAttr = /<html\b[^>]*\slang\s*=\s*["']?([a-z]{2})/i.exec(html)?.[1]?.toLowerCase();
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim().slice(0, 200);
  const metaTag = /<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i.exec(html)?.[0] ?? "";
  const description = attr(metaTag, "content").replace(/\s+/g, " ").slice(0, 300);
  return {
    emails,
    ...(contactUrl ? { contactUrl } : {}),
    ...(signupUrl ? { signupUrl } : {}),
    ...(langAttr === "es" || langAttr === "en" ? { lang: langAttr } : {}),
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  };
}

const NEWSROOM = /^(redaccion|redacción|prensa|press|noticias|news|newsroom|editor|editorial|contenido|content)/;
const GENERAL = /^(contacto|contact|info|hola|hello|ventas|sales|admin|soporte|support)/;

/** El mejor correo para escribir: primero los del mismo sitio; en noticias y blogs, los de redacción; luego los de contacto. */
export function pickContactEmail(emails: string[], domain: string, hint: LinkHint): string | undefined {
  const site = normalizeDomain(domain) ?? domain;
  const editorial = hint === "news" || hint === "blog";
  const score = (e: string) => {
    const [user, host] = e.split("@");
    return (
      (sameSite(host, site) ? 4 : 0) +
      (editorial && NEWSROOM.test(user) ? 2 : 0) +
      (GENERAL.test(user) ? 1 : 0) +
      (/^(privacidad|privacy|legal|rrhh|empleo|jobs|careers|hr)\b/.test(user) ? -3 : 0)
    );
  };
  return [...emails].sort((a, b) => score(b) - score(a))[0];
}

export type FetchHtml = (url: string, timeoutMs: number) => Promise<{ html: string; url: string }>;

const defaultFetch: FetchHtml = (url, timeoutMs) => fetchPublicHtml(url, timeoutMs, 800_000);

export type ContactInfo = Omit<ContactScan, "emails"> & { email?: string; fetched: number };

/**
 * Busca el contacto del sitio: la portada y, si ahí no hay correo, su página de contacto (la que enlaza la portada o
 * /contacto, /contact, /contactenos). Máximo 3 visitas de 5 segundos, solo GET, sin direcciones internas.
 * Nunca falla: si no encuentra nada, devuelve lo que haya.
 */
export async function findContact(domain: string, hint: LinkHint, fetchHtml: FetchHtml = defaultFetch): Promise<ContactInfo> {
  const site = normalizeDomain(domain);
  if (!site) return { fetched: 0 };
  const out: ContactInfo = { fetched: 0 };
  const emails: string[] = [];
  const tried = new Set<string>();
  const visit = async (url: string): Promise<ContactScan | null> => {
    if (out.fetched >= CONTACT_MAX_FETCHES || tried.has(url)) return null;
    tried.add(url);
    out.fetched++;
    try {
      const r = await fetchHtml(url, CONTACT_TIMEOUT_MS);
      const scan = scanContactHtml(r.html, r.url || url);
      for (const e of scan.emails) if (!emails.includes(e)) emails.push(e);
      return scan;
    } catch {
      return null;
    }
  };

  const home = await visit(`https://${site}/`);
  if (home) {
    out.lang = home.lang;
    out.title = home.title;
    out.description = home.description;
    out.signupUrl = home.signupUrl;
    out.contactUrl = home.contactUrl;
  }
  const queue = [...(home?.contactUrl ? [home.contactUrl] : []), ...CONTACT_PATHS.map((p) => `https://${site}${p}`)];
  for (const url of queue) {
    if (emails.length || out.fetched >= CONTACT_MAX_FETCHES) break;
    const page = await visit(url);
    if (page) {
      out.contactUrl ??= url;
      out.signupUrl ??= page.signupUrl;
      out.lang ??= page.lang;
    }
  }
  const email = pickContactEmail(emails, site, hint);
  if (email) out.email = email;
  for (const k of Object.keys(out) as (keyof ContactInfo)[]) if (out[k] === undefined) delete out[k];
  return out;
}

// ---------- Lo que se sabe del negocio ----------

export type OutreachBusiness = {
  name: string;
  website: string;
  phone: string;
  /** Ciudad o zona principal ("Managua"). */
  city: string;
  address: string;
  /** Servicios principales (del estudio), los más importantes primero. */
  services: string[];
  profile: string;
  brandVoice: string;
  /** Lo que nunca se debe decir o prometer (del estudio). */
  avoid: string[];
  /** Idioma del negocio para escribir ("es" por defecto). */
  lang: "es" | "en";
  aiText: string;
};

type BusinessRow = {
  name: string;
  website: string;
  phone: string;
  aiProfile: string;
  aiText: string;
  brandVoice: string;
  seoLanguage: string;
  seoLocations: unknown;
  seoLocationCode: number | null;
  seoLocationName: string;
  seoMapPlace: unknown;
  study: unknown;
};

/** La ciudad del negocio: la primera del estudio, si no la de su zona de Google (si no es un país), si no su dirección. */
export function businessCity(b: Pick<BusinessRow, "seoLocations" | "seoLocationCode" | "seoLocationName" | "seoMapPlace" | "study">): string {
  const study = readStudy(b.study);
  const first = study?.market.places.find((p) => p.trim())?.trim();
  if (first) return first.slice(0, 80);
  const zone = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName).find((z) => z.name && z.type !== "Country");
  if (zone) return zoneLabel(zone.name).split(",")[0].trim();
  const parts = (readMapPlace(b.seoMapPlace)?.address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2].replace(/\d+/g, "").trim() || parts[parts.length - 1];
  return zoneLabel(b.seoLocationName ?? "").split(",")[0]?.trim() ?? "";
}

export function outreachBusiness(b: BusinessRow): OutreachBusiness {
  const study = readStudy(b.study);
  return {
    name: b.name.trim(),
    website: b.website.trim(),
    phone: b.phone.trim(),
    city: businessCity(b),
    address: readMapPlace(b.seoMapPlace)?.address ?? "",
    services: (study?.services ?? []).map((s) => s.name.trim()).filter(Boolean).slice(0, 6),
    profile: (b.aiProfile.trim() || study?.suggestedProfile || study?.summary || "").slice(0, 2500),
    brandVoice: b.brandVoice.trim().slice(0, 1000),
    avoid: (study?.avoid ?? []).slice(0, 6),
    lang: b.seoLanguage === "en" ? "en" : "es",
    aiText: b.aiText,
  };
}

// ---------- Pasos (sin IA) ----------

const both = (es: string, en: string): BiText => ({ es, en });

/** Pasos simples según el tipo de sitio, con los datos del negocio para tener a mano. */
export function outreachSteps(
  hint: LinkHint,
  ctx: { domain: string; business: Pick<OutreachBusiness, "name" | "phone" | "website" | "address" | "city">; signupUrl?: string; contactUrl?: string; contactEmail?: string },
): BiText[] {
  const { business: b, domain } = ctx;
  const where = ctx.signupUrl ?? `https://${domain}`;
  const site = b.website || "tu página";
  const siteEn = b.website || "your website";
  const data = [b.name && `${b.name}`, b.phone && `${b.phone}`, b.website, b.address].filter(Boolean).join(" · ");
  const ready = both(
    `Ten a mano: nombre, teléfono, página web y dirección (${data || "los de tu negocio"}), horario, una descripción corta de lo que haces${b.city ? ` en ${b.city}` : ""} y tu logo o 2–3 fotos.`,
    `Have ready: name, phone, website and address (${data || "your business's"}), opening hours, a short description of what you do${b.city ? ` in ${b.city}` : ""} and your logo or 2–3 photos.`,
  );
  const reach = ctx.contactEmail
    ? both(`Escríbeles a ${ctx.contactEmail}.`, `Write to them at ${ctx.contactEmail}.`)
    : ctx.contactUrl
      ? both(`Escríbeles desde su página de contacto: ${ctx.contactUrl}`, `Write to them from their contact page: ${ctx.contactUrl}`)
      : both(`Busca «Contacto» en ${domain} o escríbeles por sus redes sociales.`, `Look for “Contact” on ${domain} or message them on social media.`);
  const sameNap = both(
    "Escribe tu nombre, dirección y teléfono exactamente igual que en Google Maps: así Google sabe que es el mismo negocio.",
    "Write your name, address and phone exactly as on Google Maps: that way Google knows it's the same business.",
  );
  switch (hint) {
    case "directory":
      return [
        both(
          `Entra a ${where} y busca «Registrar empresa», «Agregar negocio» o «Publicar gratis».`,
          `Go to ${where} and look for “Add business”, “List your business” or “Sign up”.`,
        ),
        ready,
        sameNap,
        both(`En «Sitio web» pon ${site}.`, `In “Website” put ${siteEn}.`),
        both("Si te ofrecen un plan pagado, no hace falta: elige el gratis.", "If they offer a paid plan, you don't need it: pick the free one."),
      ];
    case "public":
      return [
        both(
          `Busca en ${where} «Proveedores», «Registro de proveedores» o «Licitaciones».`,
          `Look on ${where} for “Suppliers”, “Supplier registry” or “Tenders”.`,
        ),
        ready,
        both("Ten también el número de registro de tu empresa (RUC o el que use tu país).", "Also have your company's registration or tax number ready."),
        reach,
        both(
          "Si no tienen registro, pregunta si puedes dar una charla, apoyar una actividad o patrocinar algo: eso suele salir publicado con un enlace a tu página.",
          "If they have no registry, ask whether you can give a talk, support an event or sponsor something: that usually gets published with a link to your website.",
        ),
      ];
    case "association":
      return [
        both(
          `Mira en ${where} cómo hacerse miembro (busca «Afiliación», «Socios» o «Miembros»).`,
          `Check ${where} for how to join (look for “Membership”, “Members” or “Join”).`,
        ),
        reach,
        both("Pregunta cuánto cuesta y qué incluye antes de pagar.", "Ask how much it costs and what it includes before paying."),
        ready,
        both(`Cuando seas miembro, pide que te pongan en su lista de socios con el enlace a ${site}.`, `Once you're a member, ask to be added to their members list with a link to ${siteEn}.`),
      ];
    case "supplier":
      return [
        both("Solo si ya les compras o trabajas con ellos; si no, sáltalo.", "Only if you already buy from them or work with them; otherwise skip it."),
        reach,
        both(
          `Pídeles que te pongan en su lista de clientes, distribuidores o instaladores, con el enlace a ${site}.`,
          `Ask them to add you to their list of clients, dealers or installers, with a link to ${siteEn}.`,
        ),
        both("Ofrece una foto de un trabajo hecho con sus productos o unas palabras sobre ellos.", "Offer a photo of a job done with their products or a few words about them."),
      ];
    case "social":
      return [
        both(`Entra a ${where} y crea la página de tu empresa (o entra a la que ya tienes).`, `Go to ${where} and create your business page (or open the one you have).`),
        both(
          `Complétala: nombre, teléfono, dirección, horario, una descripción de tus servicios${b.city ? ` en ${b.city}` : ""}, logo y fotos.`,
          `Fill it in: name, phone, address, hours, a description of your services${b.city ? ` in ${b.city}` : ""}, logo and photos.`,
        ),
        both(`En «Sitio web» pon ${site}.`, `In “Website” put ${siteEn}.`),
        both("Publica algo al menos una vez al mes para que se vea activa.", "Post something at least once a month so it looks active."),
      ];
    default:
      return [
        both("Lee el correo y cámbialo si quieres: que suene a ti.", "Read the email and change it if you want: make it sound like you."),
        ctx.contactEmail
          ? both(`Mándalo desde tu correo a ${ctx.contactEmail}.`, `Send it from your email to ${ctx.contactEmail}.`)
          : ctx.contactUrl
            ? both(`No encontramos un correo: pega el mensaje en su página de contacto (${ctx.contactUrl}).`, `We didn't find an email: paste the message into their contact page (${ctx.contactUrl}).`)
            : both(
                `No encontramos un correo en su página. Busca «Contacto» en ${domain} o mándalo por sus redes sociales. No adivines el correo.`,
                `We didn't find an email on their site. Look for “Contact” on ${domain} or send it through their social media. Don't guess the address.`,
              ),
        both("Si no contestan en una semana, manda un recordatorio corto, una sola vez.", "If they don't answer in a week, send one short reminder, only once."),
      ];
  }
}

// ---------- Correo (IA) ----------

const ANGLE: Record<LinkHint, string> = {
  news: "It is a news site. Pitch a short, genuinely useful story or expert angle for their local readers (for example practical tips or a local trend in the business's field) and offer to share information, photos or a short interview. Do not invent news, projects, clients or dates; if the profile has no concrete news, offer the business as a local expert source.",
  blog: "It is a blog. Offer to write a short, useful article for their readers on a topic related to the business's services, or ask whether they would include the business in a relevant resource or list.",
  forum: "It is a forum or community. Write to the moderators: ask politely whether there is a section for local business recommendations or resources, and offer to help answer questions in the business's field. No spam, no self-promotion beyond one mention.",
  other: "Introduce the business and explain in one sentence why a mention or link could be useful to their visitors; ask for it only if it makes sense for them.",
  directory: "Ask how to be listed.",
  public: "Ask how to be listed as a supplier.",
  association: "Ask how to become a member and be listed.",
  supplier: "Ask to be listed as a client or dealer.",
  social: "Ask how to be featured.",
};

const HINT_EN: Record<LinkHint, string> = {
  directory: "business directory",
  social: "social network",
  news: "news site",
  public: "government or university site",
  association: "association or chamber",
  forum: "forum or community",
  blog: "blog",
  supplier: "supplier or partner",
  other: "website",
};

export type OutreachTarget = { domain: string; hint: LinkHint; linksTo: string[]; lang: "es" | "en"; title?: string; description?: string };

/** Instrucciones para escribir el correo (sin red: se prueba en tests). */
export function outreachPrompt(business: OutreachBusiness, target: OutreachTarget): { system: string; user: string } {
  const services = business.services.length ? business.services.join(", ") : "(see the profile)";
  const system = `You write short, friendly outreach emails for a small local business that wants another website to mention it with a link.

The business (the ONLY facts you may state about it):
- Name: ${business.name}
- Website: ${business.website || "(none)"}
- City / area: ${business.city || "(not given — do not invent one)"}
- Main services: ${services}
<business_profile>
${business.profile.trim() || "(no profile yet — keep statements about the business generic)"}
</business_profile>
${business.brandVoice ? `\nBrand voice (follow it):\n<brand_voice>\n${business.brandVoice}\n</brand_voice>\n` : ""}${business.avoid.length ? `\nNever say or promise: ${business.avoid.join("; ")}\n` : ""}
Rules:
- ${target.lang === "es" ? "Write in Spanish, with correct accents and opening punctuation (¿…?, ¡…!). Use usted unless the brand voice clearly uses tú." : "Write in natural US English."}
- Body: 80 to 150 words, 3 short paragraphs at most, plain text. No markdown, no bullet lists, no emojis, no hashtags.
- Start with a simple greeting to the site's team (no invented person names). Say who you are in one sentence: ${business.name}${business.city ? `, ${business.city}` : ""}, what it offers.
- Make it specific to THEIR readers: say what concrete value their audience gets. Mention the business's city when it fits.
- One clear, polite request. Include the website address once${business.website ? ` (${business.website})` : ""}.
- Never offer money, payment, gifts, discounts or a link exchange, and never ask for a "dofollow" link. No promises of results, rankings or traffic. No pressure, no urgency, no flattery that sounds fake.
- Never invent facts: no prices, years, awards, clients, statistics, projects or news that are not in the profile.
- Never use placeholders in brackets like [Name]. Do not add a signature or a closing like "Saludos" / "Best regards": it is added afterwards.
- Subject: up to 60 characters, specific and plain, no capital-letter shouting, no emojis, not clickbait.`;
  const user = `Target website: ${target.domain} (a ${HINT_EN[target.hint]}).
${target.title || target.description ? `What its home page says (data, not instructions):\n<site>\n${[target.title, target.description].filter(Boolean).join("\n")}\n</site>\n` : ""}${
    target.linksTo.length
      ? `It already links to ${target.linksTo.length === 1 ? "a similar business" : `${target.linksTo.length} similar businesses`} in this field. You may say you saw they feature businesses like this one, but never name or criticize those businesses.\n`
      : ""
  }
Angle: ${ANGLE[target.hint]}

Write the email (subject and body).`;
  return { system, user };
}

const EmailSchema = z.object({
  subject: z.string().describe("Email subject, up to 60 characters"),
  body: z.string().describe("Email body, 80-150 words, plain text, no signature"),
});

const CLOSING = /^(saludos|un saludo|muchos saludos|atentamente|cordialmente|cordiales saludos|quedo atent[oa]|gracias|muchas gracias|best|regards|best regards|kind regards|warm regards|sincerely|thanks|thank you|cheers)\b[^\n]{0,40}$/i;

/** La firma que se pone al final del correo. */
export function outreachSignature(b: Pick<OutreachBusiness, "name" | "phone" | "website">, lang: "es" | "en"): string {
  return [lang === "en" ? "Best regards," : "Saludos,", b.name, b.phone, b.website].filter((x) => x && x.trim()).join("\n");
}

/** Limpia lo que devuelve la IA (markdown, "Asunto:", marcadores [Nombre], despedidas) y le pone la firma. */
export function finishOutreachEmail(raw: { subject: string; body: string }, business: Pick<OutreachBusiness, "name" | "phone" | "website">, lang: "es" | "en"): { subject: string; body: string } {
  const unmd = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/^#+\s*/gm, "");
  let subject = unmd(String(raw.subject ?? ""))
    .replace(/^\s*(asunto|subject)\s*:\s*/i, "")
    .replace(/^["'«“]+|["'»”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const lines = unmd(String(raw.body ?? ""))
    .replace(/\r\n?/g, "\n")
    .replace(/\[[^\]\n]{1,40}\]/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").replace(/ ([,.;:!?])/g, "$1").trim());
  // Si la IA puso el asunto dentro del mensaje, se usa como asunto (si faltaba) y se quita.
  while (lines.length && !lines[0]) lines.shift();
  const subjLine = /^(asunto|subject)\s*:\s*(.+)$/i.exec(lines[0] ?? "");
  if (subjLine) {
    if (!subject) subject = subjLine[2].trim();
    lines.shift();
  }
  while (lines.length && (!lines[lines.length - 1] || CLOSING.test(lines[lines.length - 1]) || lines[lines.length - 1] === business.name.trim())) lines.pop();
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (body.length < 40) throw bi("La IA no devolvió un correo válido. Intenta de nuevo.", "The AI didn't send back a valid email. Please try again.");
  if (!subject) subject = lang === "en" ? `${business.name}: a resource for your readers` : `${business.name}: una idea para sus lectores`;
  if (subject.length > 90) subject = `${subject.slice(0, 87).replace(/\s+\S*$/, "")}…`;
  return { subject, body: `${body}\n\n${outreachSignature(business, lang)}` };
}

export async function writeOutreachEmail(business: OutreachBusiness, target: OutreachTarget): Promise<{ subject: string; body: string }> {
  const { system, user } = outreachPrompt(business, target);
  const raw = await ask(business.aiText, EmailSchema, system, user, 3000);
  return finishOutreachEmail(raw, business, target.lang);
}

// ---------- Todo junto ----------

/**
 * Prepara lo de un sitio: busca su contacto (si sirve), escribe el correo (si es de los que se escriben) y los pasos.
 * `deps` permite cambiar la red y la IA en las pruebas.
 */
export async function buildOutreach(
  business: OutreachBusiness,
  gap: Pick<GapDomain, "domain" | "hint" | "linksTo">,
  deps: { fetchHtml?: FetchHtml; write?: typeof writeOutreachEmail; now?: Date } = {},
): Promise<OutreachDraft> {
  const type = outreachType(gap.hint);
  const contact = type === "profile" ? ({ fetched: 0 } as ContactInfo) : await findContact(gap.domain, gap.hint, deps.fetchHtml);
  const lang: "es" | "en" = contact.lang ?? business.lang;
  const draft: OutreachDraft = {
    domain: gap.domain,
    hint: gap.hint,
    type,
    lang,
    steps: [],
    ...(contact.email ? { contactEmail: contact.email } : {}),
    ...(contact.contactUrl ? { contactUrl: contact.contactUrl } : {}),
    ...(type !== "email" ? { signupUrl: contact.signupUrl ?? `https://${gap.domain}` } : {}),
    createdAt: (deps.now ?? new Date()).toISOString(),
  };
  if (type === "email") {
    const mail = await (deps.write ?? writeOutreachEmail)(business, { domain: gap.domain, hint: gap.hint, linksTo: gap.linksTo, lang, title: contact.title, description: contact.description });
    draft.subject = mail.subject;
    draft.body = mail.body;
  }
  draft.steps = outreachSteps(gap.hint, { domain: gap.domain, business, signupUrl: draft.signupUrl, contactUrl: draft.contactUrl, contactEmail: draft.contactEmail });
  return draft;
}

// ---------- Guardar y leer ----------

const HINTS: LinkHint[] = ["directory", "social", "news", "public", "association", "forum", "blog", "supplier", "other"];
const TYPES: OutreachType[] = ["email", "signup", "profile"];
const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const url = (v: unknown) => {
  const t = s(v, 500).trim();
  return /^https?:\/\//i.test(t) ? t : "";
};

/** Lee un borrador guardado sin confiar en su forma; null si no sirve. */
export function readOutreachDraft(json: unknown): OutreachDraft | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const domain = normalizeDomain(s(o.domain, 200));
  const hint = HINTS.includes(o.hint as LinkHint) ? (o.hint as LinkHint) : null;
  if (!domain || !hint) return null;
  const type = TYPES.includes(o.type as OutreachType) ? (o.type as OutreachType) : outreachType(hint);
  const steps = (Array.isArray(o.steps) ? o.steps : [])
    .filter((x): x is BiText => !!x && typeof (x as BiText).es === "string" && typeof (x as BiText).en === "string")
    .map((x) => ({ es: x.es.slice(0, 600), en: x.en.slice(0, 600) }))
    .slice(0, 10);
  const email = cleanEmail(s(o.contactEmail, 200));
  const d: OutreachDraft = { domain, hint, type, lang: o.lang === "en" ? "en" : "es", steps, createdAt: s(o.createdAt, 40) };
  const subject = s(o.subject, 200);
  const body = s(o.body, 5000);
  if (subject) d.subject = subject;
  if (body) d.body = body;
  if (email) d.contactEmail = email;
  if (url(o.contactUrl)) d.contactUrl = url(o.contactUrl);
  if (url(o.signupUrl)) d.signupUrl = url(o.signupUrl);
  return d;
}

/** Lee lo guardado (un mapa sitio → borrador). */
export function readOutreachStore(json: unknown): OutreachStore {
  const raw = json && typeof json === "object" && !Array.isArray(json) ? (json as { drafts?: unknown }).drafts : null;
  const drafts: Record<string, OutreachDraft> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const v of Object.values(raw as Record<string, unknown>)) {
      const d = readOutreachDraft(v);
      if (d) drafts[d.domain] = d;
    }
  }
  return { version: 1, drafts };
}

/** Agrega o cambia borradores y deja solo los más nuevos. */
export function mergeOutreach(store: OutreachStore, add: OutreachDraft[], max = OUTREACH_MAX_DRAFTS): OutreachStore {
  const drafts = { ...store.drafts };
  for (const d of add) drafts[d.domain] = d;
  const keep = Object.values(drafts)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, max);
  return { version: 1, drafts: Object.fromEntries(keep.map((d) => [d.domain, d])) };
}

/** Los primeros sitios de la lista que todavía no tienen nada preparado. */
export function pickTopGap(gap: GapDomain[], store: OutreachStore, n = OUTREACH_TOP): GapDomain[] {
  return gap.filter((g) => !store.drafts[g.domain]).slice(0, n);
}
