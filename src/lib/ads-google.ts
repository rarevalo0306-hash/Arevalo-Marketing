// Plan de Google Ads para copiar (la app NO gasta en Google: la API de Google Ads necesita un "developer token"
// aprobado por Google). Con las palabras que sigue el negocio (Business.seoKeywords) y los datos de DataForSEO ya
// guardados (SeoReport keywords y rank), arma una campaña de búsqueda: grupos de anuncios, palabras negativas,
// títulos (≤30 letras, 15 por grupo) y descripciones (≤90, 4 por grupo), un presupuesto sugerido y un CSV para
// Google Ads Editor. Todo puro (sin servidor) salvo improveGooglePlan, que le pide los textos a la IA.
import { z } from "zod";
import type { BiText } from "@/lib/ads-shape";
import type { KwRow } from "@/lib/seo/keywords";

export const HEADLINE_MAX = 30;
export const DESCRIPTION_MAX = 90;
export const HEADLINES_PER_GROUP = 15;
export const DESCRIPTIONS_PER_GROUP = 4;
const MAX_GROUPS = 5;
const MAX_KEYWORDS_PER_GROUP = 15;

export type GoogleKeyword = { text: string; match: "phrase" | "exact"; volume: number | null; cpc: number | null };
export type GoogleAdGroup = { name: string; keywords: GoogleKeyword[]; headlines: string[]; descriptions: string[] };
export type GooglePlan = {
  campaignName: string;
  finalUrl: string;
  location: string;
  language: "es" | "en";
  dailyBudgetCents: number;
  /** Clics por día esperados con ese presupuesto (aprox.). */
  clicksPerDay: number;
  avgCpc: number | null;
  groups: GoogleAdGroup[];
  negatives: string[];
  source: "rules" | "ai";
  createdAt: string;
};

export type PlanInput = {
  business: { name: string; website: string; phone: string };
  tracked: string[];
  /** Filas medidas del último reporte de palabras (volumen y CPC), si hay. */
  rows: KwRow[];
  /** Ideas del último reporte (para llenar grupos). */
  ideas: KwRow[];
  /** «Búsquedas relacionadas» de Google del último reporte de posiciones (rank), si hay. */
  related?: string[];
  /** Nombres de las zonas (para quitar "managua" al agrupar y para los títulos). */
  places: string[];
  language: "es" | "en";
  now?: Date;
};

const STOP = new Set(
  "de del la las el los en para por con y a o un una al the of for in on and to near me cerca mi my best mejor mejores precio precios price prices barato baratos cheap".split(" "),
);

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Palabra que da el tema a una búsqueda ("cortinas metálicas managua" → "cortinas"). */
export function themeOf(keyword: string, places: string[]): string {
  const placeWords = new Set(places.flatMap((p) => norm(p).split(" ")));
  const words = norm(keyword).split(" ").filter((w) => w.length > 2 && !STOP.has(w) && !placeWords.has(w));
  return words[0] ?? norm(keyword).split(" ")[0] ?? "";
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Corta en una palabra completa sin pasar del máximo ("" si ni la primera palabra cabe). */
export function fitText(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return at > 0 ? cut.slice(0, at).replace(/[,.;:\-–]+$/, "").trim() : "";
}

/** Deja solo textos que caben, sin repetir (sin importar mayúsculas), hasta `n`. */
export function fitList(list: string[], max: number, n: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = fitText(raw, max);
    const k = norm(t);
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

const shortPlace = (places: string[]) => (places[0] ?? "").split(",")[0]?.trim() ?? "";

function ruleHeadlines(g: { theme: string; keywords: string[] }, b: PlanInput["business"], place: string, lang: "es" | "en"): string[] {
  const es = lang === "es";
  const th = cap(g.theme);
  return [
    ...g.keywords.map(cap),
    b.name,
    place && (es ? `${th} en ${place}` : `${th} in ${place}`),
    es ? `Expertos en ${g.theme}` : `${th} experts`,
    b.phone && (es ? `Llame: ${b.phone}` : `Call: ${b.phone}`),
    es ? "Pida su cotización" : "Request a quote",
    es ? "Llámenos hoy" : "Call us today",
    place && (es ? `Atendemos en ${place}` : `Serving ${place}`),
    es ? "Visite nuestro sitio web" : "Visit our website",
    es ? "Atención personalizada" : "Personal service",
    es ? "Respuesta rápida" : "Quick response",
    es ? `${th} a su medida` : `Custom ${g.theme}`,
    es ? "Escríbanos hoy" : "Message us today",
    es ? "Servicio profesional" : "Professional service",
    es ? "Conozca nuestro trabajo" : "See our work",
    b.name && (es ? `${b.name} ${place}` : `${b.name} ${place}`),
  ].filter((x): x is string => Boolean(x));
}

function ruleDescriptions(g: { theme: string; keywords: string[] }, b: PlanInput["business"], place: string, lang: "es" | "en"): string[] {
  const es = lang === "es";
  const kw = g.keywords[0] ?? g.theme;
  return [
    es ? `${cap(kw)} con ${b.name}. Pida su cotización hoy mismo.` : `${cap(kw)} with ${b.name}. Request your quote today.`,
    place && (es ? `Atendemos ${g.theme} en ${place} y alrededores. Llame o escríbanos.` : `We handle ${g.theme} in ${place} and nearby. Call or message us.`),
    es ? `Todo sobre ${g.theme} con un equipo con experiencia. Consulte sin compromiso.` : `Everything about ${g.theme} with an experienced team. Ask us anytime.`,
    b.phone ? (es ? `Llame al ${b.phone} y reciba atención rápida y profesional.` : `Call ${b.phone} for fast, professional service.`) : es ? "Visite nuestro sitio web y conozca nuestros trabajos." : "Visit our website and see our work.",
    es ? `Conozca ${b.name}: trabajos reales y clientes satisfechos.` : `Meet ${b.name}: real work and happy customers.`,
  ].filter((x): x is string => Boolean(x));
}

/** Palabras negativas que casi nunca traen clientes para un negocio de servicios local. */
export function defaultNegatives(lang: "es" | "en"): string[] {
  return lang === "es"
    ? ["gratis", "empleo", "trabajo", "vacantes", "curso", "tutorial", "como hacer", "pdf", "usado", "segunda mano", "juguete", "dibujo", "png"]
    : ["free", "jobs", "job", "hiring", "course", "tutorial", "how to", "diy", "pdf", "used", "second hand", "toy", "drawing", "png"];
}

/** Presupuesto sugerido: ~5 clics al día al costo por clic promedio (mínimo $5 y máximo $50 al día). */
export function suggestBudget(cpcs: (number | null)[]): { dailyBudgetCents: number; clicksPerDay: number; avgCpc: number | null } {
  const known = cpcs.filter((c): c is number => typeof c === "number" && c > 0);
  const avg = known.length ? known.reduce((s, c) => s + c, 0) / known.length : null;
  const target = 5;
  const daily = avg === null ? 1000 : Math.min(5000, Math.max(500, Math.round(avg * target * 100)));
  return { dailyBudgetCents: daily, clicksPerDay: avg ? Math.max(1, Math.floor(daily / 100 / avg)) : 0, avgCpc: avg === null ? null : Math.round(avg * 100) / 100 };
}

/** Arma el plan con reglas (sin IA): grupos por tema, palabras exactas y de frase, textos y presupuesto. */
export function buildGooglePlan(x: PlanInput): GooglePlan {
  const lookup = new Map<string, KwRow>();
  for (const r of [...x.ideas, ...x.rows]) lookup.set(norm(r.keyword), r);
  const groups = new Map<string, GoogleKeyword[]>();
  const add = (text: string, match: GoogleKeyword["match"]) => {
    const th = themeOf(text, x.places);
    if (!th) return;
    const list = groups.get(th) ?? [];
    if (list.some((k) => norm(k.text) === norm(text)) || list.length >= MAX_KEYWORDS_PER_GROUP) return;
    const row = lookup.get(norm(text));
    list.push({ text: text.trim().toLowerCase(), match, volume: row?.volume ?? null, cpc: row?.cpc ?? null });
    groups.set(th, list);
  };
  // Las ideas que chocan con una palabra negativa ("usadas", "gratis"…) no entran: se pagaría por clics que no sirven.
  const negatives = defaultNegatives(x.language).map((n) => norm(n)).map((n) => (n.length > 4 ? n.slice(0, -1) : n));
  const clashes = (text: string) => {
    const t = ` ${norm(text)}`;
    return negatives.some((n) => t.includes(` ${n}`));
  };
  for (const k of x.tracked) add(k, "phrase");
  // Las ideas con búsquedas que caen en un tema ya elegido llenan el grupo (como exactas, más controladas).
  for (const r of [...x.ideas].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)))
    if (groups.has(themeOf(r.keyword, x.places)) && (r.volume ?? 0) > 0 && !clashes(r.keyword)) add(r.keyword, "exact");
  // Búsquedas relacionadas que Google mostró (reporte de posiciones) y que caen en un tema ya elegido.
  for (const r of x.related ?? []) if (groups.has(themeOf(r, x.places)) && !clashes(r)) add(r, "phrase");
  const place = shortPlace(x.places);
  const ordered = [...groups.entries()]
    .map(([theme, kws]) => ({ theme, kws, volume: kws.reduce((s, k) => s + (k.volume ?? 0), 0) }))
    .sort((a, b) => b.volume - a.volume || b.kws.length - a.kws.length)
    .slice(0, MAX_GROUPS);
  const plan: GooglePlan = {
    campaignName: `${x.business.name} · ${x.language === "es" ? "Búsqueda" : "Search"}`.slice(0, 120),
    finalUrl: x.business.website,
    location: place,
    language: x.language,
    ...suggestBudget(ordered.flatMap((g) => g.kws.map((k) => k.cpc))),
    groups: ordered.map((g) => {
      const base = { theme: g.theme, keywords: g.kws.map((k) => k.text) };
      return {
        name: cap(g.theme),
        keywords: g.kws,
        headlines: fitList(ruleHeadlines(base, x.business, place, x.language), HEADLINE_MAX, HEADLINES_PER_GROUP),
        descriptions: fitList(ruleDescriptions(base, x.business, place, x.language), DESCRIPTION_MAX, DESCRIPTIONS_PER_GROUP),
      };
    }),
    negatives: defaultNegatives(x.language),
    source: "rules",
    createdAt: (x.now ?? new Date()).toISOString(),
  };
  return plan;
}

// ---------- Textos mejorados por la IA ----------

export const GoogleTextsSchema = z.object({
  groups: z.array(
    z.object({
      name: z.string(),
      headlines: z.array(z.string()).describe(`15 headlines, each at most ${HEADLINE_MAX} characters, most with a keyword`),
      descriptions: z.array(z.string()).describe(`4 descriptions, each at most ${DESCRIPTION_MAX} characters`),
    }),
  ),
  negatives: z.array(z.string()).describe("Negative keywords (searches that never bring customers)"),
});
export type GoogleTexts = z.infer<typeof GoogleTextsSchema>;

/** Mezcla los textos de la IA con el plan: corta lo que no cabe y completa con los de las reglas. */
export function mergeGoogleTexts(plan: GooglePlan, ai: GoogleTexts, now = new Date()): GooglePlan {
  return {
    ...plan,
    source: "ai",
    createdAt: now.toISOString(),
    groups: plan.groups.map((g, i) => {
      const a = ai.groups.find((x) => norm(x.name) === norm(g.name)) ?? ai.groups[i];
      return {
        ...g,
        // Lo que pasa del límite se descarta (no se corta a la mitad: un título cortado se ve mal).
        headlines: fitList([...(a?.headlines ?? []).filter((h) => h.trim().length <= HEADLINE_MAX), ...g.headlines], HEADLINE_MAX, HEADLINES_PER_GROUP),
        descriptions: fitList([...(a?.descriptions ?? []).filter((d) => d.trim().length <= DESCRIPTION_MAX), ...g.descriptions], DESCRIPTION_MAX, DESCRIPTIONS_PER_GROUP),
      };
    }),
    negatives: [...new Set([...plan.negatives, ...ai.negatives.map((n) => n.trim().toLowerCase()).filter((n) => n && n.length <= 80)])].slice(0, 40),
  };
}

export function googleTextsPrompt(plan: GooglePlan, profile: string, identity: string): { system: string; user: string } {
  return {
    system: `You write Google Ads responsive search ads for a small local business. Strict limits: each headline at most ${HEADLINE_MAX} characters, each description at most ${DESCRIPTION_MAX} characters (count spaces). Use the ad group's keywords in most headlines. No exclamation marks in headlines, no prices or promises that are not in the profile, no competitor names. Language: ${plan.language === "en" ? "English" : "Spanish"}.${identity}`,
    user: `Business profile:\n${profile.slice(0, 2500)}\n\nWebsite: ${plan.finalUrl}\nLocation: ${plan.location}\n\nAd groups:\n${plan.groups
      .map((g) => `- ${g.name}: ${g.keywords.map((k) => k.text).join(", ")}`)
      .join("\n")}\n\nWrite 15 headlines and 4 descriptions per group, and up to 15 negative keywords for the whole campaign.`,
  };
}

export function readGooglePlan(v: unknown): GooglePlan | null {
  if (!v || typeof v !== "object") return null;
  const p = v as GooglePlan;
  if (!Array.isArray(p.groups) || typeof p.campaignName !== "string") return null;
  return p;
}

// ---------- CSV para Google Ads Editor ----------

const HEAD = [
  "Campaign",
  "Campaign Type",
  "Networks",
  "Budget",
  "Budget type",
  "Bid Strategy Type",
  "Languages",
  "Location",
  "Campaign Status",
  "Ad Group",
  "Ad Group Status",
  "Keyword",
  "Criterion Type",
  "Ad type",
  "Final URL",
  ...Array.from({ length: HEADLINES_PER_GROUP }, (_, i) => `Headline ${i + 1}`),
  ...Array.from({ length: DESCRIPTIONS_PER_GROUP }, (_, i) => `Description ${i + 1}`),
];

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * CSV para importar en Google Ads Editor (Cuenta › Importar › Desde archivo). Todo queda en PAUSA: el dueño revisa
 * y lo enciende en Google Ads.
 */
export function googlePlanCsv(plan: GooglePlan): string {
  const rows: Record<string, string | number>[] = [];
  const c = plan.campaignName;
  rows.push({
    Campaign: c,
    "Campaign Type": "Search",
    Networks: "Google search",
    Budget: (plan.dailyBudgetCents / 100).toFixed(2),
    "Budget type": "Daily",
    "Bid Strategy Type": "Maximize clicks",
    Languages: plan.language,
    Location: plan.location,
    "Campaign Status": "Paused",
  });
  for (const n of plan.negatives) rows.push({ Campaign: c, Keyword: n, "Criterion Type": "Campaign Negative Phrase" });
  for (const g of plan.groups) {
    rows.push({ Campaign: c, "Ad Group": g.name, "Ad Group Status": "Paused" });
    for (const k of g.keywords) rows.push({ Campaign: c, "Ad Group": g.name, Keyword: k.text, "Criterion Type": k.match === "exact" ? "Exact" : "Phrase" });
    const ad: Record<string, string> = { Campaign: c, "Ad Group": g.name, "Ad type": "Responsive search ad", "Final URL": plan.finalUrl };
    g.headlines.forEach((h, i) => (ad[`Headline ${i + 1}`] = h));
    g.descriptions.forEach((d, i) => (ad[`Description ${i + 1}`] = d));
    rows.push(ad);
  }
  return [HEAD.join(","), ...rows.map((r) => HEAD.map((h) => cell(r[h] ?? "")).join(","))].join("\r\n") + "\r\n";
}

/** Pasos para crearla a mano en Google Ads (para el dueño, sin palabras técnicas). */
export const GOOGLE_STEPS: BiText[] = [
  { es: "Entra a ads.google.com con la cuenta de Google del negocio (si no tienes cuenta, créala; pide una tarjeta para cobrar).", en: "Go to ads.google.com with the business Google account (if you don't have one, create it; it asks for a card)." },
  { es: "Si te ofrece el «modo inteligente», elige «Cambiar al modo experto».", en: "If it offers \"Smart mode\", choose \"Switch to Expert Mode\"." },
  { es: "Crea una campaña nueva › objetivo «Clientes potenciales» o «Tráfico al sitio web» › tipo «Búsqueda».", en: "Create a new campaign › goal \"Leads\" or \"Website traffic\" › type \"Search\"." },
  { es: "Redes: deja solo «Red de Búsqueda de Google» (quita «Red de Display»).", en: "Networks: keep only \"Google Search Network\" (untick \"Display Network\")." },
  { es: "Ubicación e idioma: los de este plan. Presupuesto por día: el sugerido (o menos).", en: "Location and language: the ones in this plan. Daily budget: the suggested one (or less)." },
  { es: "Puja: «Maximizar clics» y pon un límite de costo por clic si quieres más control.", en: "Bidding: \"Maximize clicks\" and set a max cost per click if you want more control." },
  { es: "Crea un grupo de anuncios por cada grupo de este plan y pega sus palabras clave.", en: "Create one ad group for each group in this plan and paste its keywords." },
  { es: "En cada grupo crea un «anuncio de búsqueda responsivo» y pega los títulos y descripciones.", en: "In each group create a \"responsive search ad\" and paste the headlines and descriptions." },
  { es: "En la campaña › Palabras clave › Negativas, pega las palabras negativas.", en: "In the campaign › Keywords › Negative, paste the negative keywords." },
  { es: "Revisa todo y publica. Mira los resultados en una semana y ajusta.", en: "Review everything and publish. Check results in a week and adjust." },
];
