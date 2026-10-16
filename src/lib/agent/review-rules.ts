// Las reglas de la revisión editorial que no usan IA: canal, imagen o video, teléfono, web, datos inventados y tema repetido.
// Módulo puro: sin base de datos ni red. Si alguna falla, el agente de revisión no llama a la IA (ahorra el costo).
// Los textos de los problemas van en español y cortos: el dueño los lee y el redactor los recibe como notas.
import { channelDef, channelName, notesFor, type ChannelId, type MediaType } from "@/lib/channels";
import { oneLine } from "./bounded-context";
import { normalizeTopic, type ReviewProblem } from "./plan";
import { Copy } from "./schema";

export type ReviewRulesInput = {
  /** The channels of the piece. */
  channels: string[];
  copy: Copy;
  mediaType: MediaType;
  business: { phone: string; website: string };
  /** What the business confirmed (its facts, knowledge and research): the only source of figures, offers and contacts. */
  knownFacts: string[];
  /** Topics already used in the last 30 days, without this piece's own. */
  recentTopics: string[];
  topic: string;
};

/** The channels that have a text of their own in a `Copy` (the keys of `variants`). */
const VARIANT_CHANNELS: readonly string[] = Object.keys(Copy.shape.variants.shape);
/** A problem's detail is never longer than the review's schema allows. */
const DETAIL_MAX = 300;

const problem = (
  kind: string,
  detail: string,
  sendBackTo: ReviewProblem["sendBackTo"],
): ReviewProblem => ({ kind, detail: detail.slice(0, DETAIL_MAX), sendBackTo });

/** Lower case, no accents, one space between words and "20 %" as "20%": how claims and facts are compared. */
const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+%/g, "%")
    .replace(/\s+/g, " ");

const list = (items: string[], max = 3) =>
  items
    .slice(0, max)
    .map((i) => `«${i}»`)
    .join(", ") + (items.length > max ? "…" : "");

// ---------- Phones ----------

/** A run of digits with phone separators (never across a line), not glued to a word, a price, a date or a link. */
const PHONE = /(?<![\w$€£.,/=#-])\+?\(?\d[\d ().\u00a0-]{5,}\d(?!\w)/g;
/** What looks like a phone but is a date, a year range or a price with thousands separators. */
const NOT_A_PHONE = [
  /^\d{4}-\d{1,2}-\d{1,2}$/,
  /^\d{1,2}[-.]\d{1,2}[-.]\d{2,4}$/,
  /^(?:19|20)\d{2}\s?-\s?(?:19|20)\d{2}$/,
  /^\d{1,3}(?:[.,]\d{3}){2,}$/,
];

type Phone = { shown: string; digits: string };

/** The phone numbers in a text, as written and as digits (7 to 15 of them). */
function phonesIn(text: string): Phone[] {
  const found: Phone[] = [];
  for (const [raw] of text.matchAll(PHONE)) {
    const shown = raw.replace(/\s+/g, " ").trim();
    const digits = shown.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) continue;
    if (NOT_A_PHONE.some((re) => re.test(shown))) continue;
    found.push({ shown, digits });
  }
  return found;
}

/** The text's number is the known one: it holds it (a country code before it) or is its last digits (up to 3 less). */
const samePhone = (known: string, text: string) =>
  text.includes(known) || (known.endsWith(text) && known.length - text.length <= 3);

// ---------- Websites ----------

const TLDS =
  "com|net|org|io|co|us|info|biz|app|dev|ai|me|tv|ni|es|mx|shop|store|online|site|xyz|pro";
// A bare domain needs a known ending written all in lower or all in upper case, so a sentence missing its space ("techo.Es hora")
// is not taken for a site; nor are the words of a link's path or of an email address.
const URLS = [
  /\bhttps?:\/\/([^\s/?#<>"')\]]+)/gi,
  /(?<![@\w./=?#&%-])www\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi,
  new RegExp(
    `(?<![@\\w./=?#&%-])((?:[a-zA-Z0-9-]+\\.)+(?:${TLDS}|${TLDS.toUpperCase()}))(?![\\w-]|\\.[a-zA-Z0-9])`,
    "g",
  ),
];

/** A host as it is compared: lower case, without port, `www.` or the dot that ends a sentence. */
const cleanHost = (host: string): string =>
  host
    .toLowerCase()
    .replace(/:\d*$/, "")
    .replace(/[.,;:!?]+$/, "")
    .replace(/^www\./, "");

/** The hosts a text links to (full links, `www.` and bare domains; an email address is not one). */
function hostsIn(text: string): string[] {
  const hosts = new Set<string>();
  for (const re of URLS)
    for (const m of text.matchAll(re)) hosts.add(cleanHost(m[1]));
  hosts.delete("");
  return [...hosts];
}

/** The host of the business's website, however it was saved ("mio.com", "https://www.mio.com/es"), or null. */
function siteHost(website: string): string | null {
  const m = /^\s*(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^/@\s]*@)?([^/?#\s]+)/i.exec(website);
  const host = m ? cleanHost(m[1]) : "";
  return host || null;
}

/** The same site or one of its subdomains. */
const sameSite = (a: string, b: string) =>
  a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

// ---------- Invented claims ----------

/** A figure with a percent sign, a discount, something free or a guarantee. */
const CLAIM = /\d+(?:[.,]\d+)?\s?%|descuento|gratis|garantiz/gi;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A known fact says it: the same word, or the same figure (a 120% does not say 20%). */
function isKnown(claim: string, facts: string[]): boolean {
  const token = fold(claim);
  const figure = /^\d/.test(token) ? new RegExp(`(?<![\\d.,])${escape(token)}`) : null;
  return facts.some((fact) => {
    const text = fold(fact);
    return figure ? figure.test(text) : text.includes(token);
  });
}

/**
 * The text each channel would publish: its own variant, or for a channel with no text of its own (TikTok...) the piece's base
 * text: the Facebook one, or the first that was written for the piece's channels.
 */
export function channelTexts(copy: Copy, channels: string[]): Record<string, string> {
  const variants = copy.variants as Record<string, string | undefined>;
  const variant = (channel: string) => String(variants[channel] ?? "");
  const own = (channel: string) => VARIANT_CHANNELS.includes(channel);
  const base =
    [variant("facebook"), ...channels.filter(own).map(variant)].find((t) => t.trim()) ?? "";
  return Object.fromEntries(channels.map((c) => [c, own(c) ? variant(c) : base]));
}

/**
 * What the editorial review checks without an AI call. Each kind of problem comes at most once (the channel ones once per
 * channel); the text is checked only for the piece's own channels. An empty list means the rules found nothing.
 * - `canal` (to the writer): a channel's text is empty or too long (the blocking notes of `notesFor`).
 * - `falta-imagen` (to the designer): a channel needs a photo or a video and the piece has none.
 * - `telefono`, `web` (to the writer): a phone number or a site that is not the business's or a known fact's.
 *   An article (`seo`) may link to its sources, so it is not checked for links.
 * - `dato-inventado` (to the writer): a percent, a discount, something free or a guarantee that no known fact says.
 * - `repetido` (to the writer): the topic was already used.
 * A channel with no text of its own (TikTok...) uses the piece's base text, the Facebook one or the first that was written.
 */
export function reviewRules(input: ReviewRulesInput): ReviewProblem[] {
  const { channels, copy, mediaType, business, knownFacts, recentTopics, topic } = input;
  const problems: ReviewProblem[] = [];
  const add = (p: ReviewProblem) => {
    if (!problems.some((q) => q.kind === p.kind && q.detail === p.detail)) problems.push(p);
  };

  const texts = channelTexts(copy, channels);
  const textOf = (channel: string) => texts[channel] ?? "";

  // The channels' own rules (empty, too long, photo or video missing).
  for (const channel of channels) {
    if (!channelDef(channel)) continue;
    const blocking = notesFor(channel as ChannelId, {
      text: textOf(channel),
      subject: copy.title,
      seoTitle: copy.title,
      mediaType,
    }).filter((n) => n.blocking);
    for (const note of blocking)
      add(
        note.id === "needsMedia" || note.id === "needsVideo"
          ? problem("falta-imagen", note.text, "design")
          : problem(
              "canal",
              note.id === "empty" ? `Falta el texto de ${channelName(channel)}.` : note.text,
              "copy",
            ),
      );
  }

  // What would be published: the headline on the image, the video script and the text of each channel.
  const unique = (texts: string[]) => [...new Set(texts.filter((t) => t.trim()))];
  const published = unique([copy.headline, copy.script, ...channels.map(textOf)]);
  const linked = unique([copy.headline, copy.script, ...channels.filter((c) => c !== "seo").map(textOf)]);

  const knownPhones = [business.phone, ...knownFacts].flatMap(phonesIn);
  const wrongPhones = new Map<string, string>();
  for (const phone of published.flatMap(phonesIn))
    if (!knownPhones.some((k) => samePhone(k.digits, phone.digits))) wrongPhones.set(phone.digits, phone.shown);
  if (wrongPhones.size) {
    const mine = business.phone.trim();
    add(
      problem(
        "telefono",
        `El teléfono ${list([...wrongPhones.values()])} no es el del negocio${
          mine ? ` (${oneLine(mine, 40)})` : ", que no tiene uno guardado"
        }. Usa solo el teléfono del negocio.`,
        "copy",
      ),
    );
  }

  const own = siteHost(business.website);
  const knownHosts = [...(own ? [own] : []), ...knownFacts.flatMap(hostsIn)];
  const wrongHosts = [...new Set(linked.flatMap(hostsIn))].filter(
    (host) => !knownHosts.some((k) => sameSite(k, host)),
  );
  if (wrongHosts.length)
    add(
      problem(
        "web",
        `El texto menciona ${list(wrongHosts)}, que no es la web del negocio${
          own ? ` (${own})` : ", que no tiene una guardada"
        }. Usa solo la web del negocio.`,
        "copy",
      ),
    );

  const claims = new Map<string, string>();
  for (const [claim] of published.join("\n").matchAll(CLAIM))
    if (!isKnown(claim, knownFacts)) claims.set(fold(claim), oneLine(claim, 20));
  if (claims.size)
    add(
      problem(
        "dato-inventado",
        `Menciona ${list([...claims.values()], 4)} sin un dato confirmado por el negocio. Quita la cifra, el descuento o la garantía, o usa solo lo que el negocio confirmó.`,
        "copy",
      ),
    );

  const seen = new Set(recentTopics.filter((t) => typeof t === "string").map(normalizeTopic));
  if (seen.has(normalizeTopic(topic)))
    add(
      problem(
        "repetido",
        `El tema «${oneLine(topic, 120)}» ya se usó en los últimos 30 días. Cambia el enfoque o el tema.`,
        "copy",
      ),
    );
  return problems;
}
