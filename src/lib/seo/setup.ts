// Puesta en marcha automática del SEO: con lo que ya se sabe del negocio (perfil para la IA, estudio, página web,
// Search Console, ideas de Google ya pagadas) se proponen las zonas de Google, el idioma y 12-15 palabras clave.
// El dueño acepta o quita cada cosa; nada se guarda en los Ajustes hasta que él acepta.
// La propuesta se guarda (SeoReport kind "setup") para no volver a pedirla a la IA en cada visita; también guarda
// las palabras que el dueño rechazó, para no volver a sugerirlas.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { aiEnabled, ask } from "@/lib/ai";
import { db } from "@/lib/db";
import { BiError, errorText } from "@/lib/i18n";
import { asGscReport } from "@/lib/seo/gsc";
import { readKeywordsReport } from "@/lib/seo/keywords";
import { findPlace } from "@/lib/seo/locations";
import { readMapPlace } from "@/lib/seo/maprank";
import { readTrackedKeywords, readZones, type Zone } from "@/lib/seo/dataforseo";
import {
  type Bi,
  COUNTRIES,
  isCountry,
  type KeywordSource,
  normKeyword,
  type ProposedKeyword,
  similarKey,
  type ProposedZone,
  type SetupProposal,
  zoneCountry,
} from "@/lib/seo/setup-shared";
import { htmlToText, readInput, readStudy, topKeywords } from "@/lib/study-shape";

export const SETUP_KIND = "setup";
export const MAX_PROPOSED = 15;
const MAX_REJECTED = 200;

type SetupRecord = { version: 1; hash: string; proposal: SetupProposal | null; rejected: string[] };

const BUSINESS_SELECT = {
  id: true,
  name: true,
  website: true,
  aiProfile: true,
  aiText: true,
  study: true,
  studyInput: true,
  seoLanguage: true,
  seoKeywords: true,
  seoLocations: true,
  seoLocationCode: true,
  seoLocationName: true,
  seoMapPlace: true,
} as const;
type SetupBusiness = Prisma.BusinessGetPayload<{ select: typeof BUSINESS_SELECT }>;

// ---------- Guardado ----------

function readRecord(json: unknown): SetupRecord {
  const o = (json && typeof json === "object" && !Array.isArray(json) ? json : {}) as Partial<SetupRecord>;
  return {
    version: 1,
    hash: typeof o.hash === "string" ? o.hash : "",
    proposal: o.proposal && typeof o.proposal === "object" && Array.isArray((o.proposal as SetupProposal).keywords) ? (o.proposal as SetupProposal) : null,
    rejected: Array.isArray(o.rejected) ? o.rejected.filter((k): k is string => typeof k === "string").slice(-MAX_REJECTED) : [],
  };
}

async function loadRecord(businessId: string): Promise<{ id: string | null; record: SetupRecord }> {
  const row = await db.seoReport.findFirst({ where: { businessId, kind: SETUP_KIND }, orderBy: { createdAt: "desc" }, select: { id: true, data: true } });
  return { id: row?.id ?? null, record: readRecord(row?.data) };
}

async function storeRecord(businessId: string, id: string | null, record: SetupRecord) {
  const data = record as unknown as Prisma.InputJsonValue;
  if (id) await db.seoReport.update({ where: { id }, data: { data } });
  else await db.seoReport.create({ data: { businessId, kind: SETUP_KIND, data } });
}

/** Una huella de lo que se sabe del negocio: si cambia (nuevo estudio, perfil editado), la propuesta guardada ya no sirve. */
function inputHash(b: SetupBusiness): string {
  const s = [b.website, b.aiProfile, JSON.stringify(readStudy(b.study)?.keywords ?? null), JSON.stringify(b.studyInput ?? null)].join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/** Lo guardado: la propuesta (si sigue vigente) y las palabras rechazadas. */
export async function setupState(businessId: string): Promise<{ proposal: SetupProposal | null; rejected: string[] }> {
  const [b, { record }] = await Promise.all([db.business.findUnique({ where: { id: businessId }, select: BUSINESS_SELECT }), loadRecord(businessId)]);
  if (!b) return { proposal: null, rejected: [] };
  return { proposal: record.hash === inputHash(b) ? record.proposal : null, rejected: record.rejected };
}

/** Agrega palabras rechazadas (para no volver a sugerirlas) y quita las que el dueño sí aceptó después. */
export async function rememberChoices(businessId: string, rejected: string[], accepted: string[]) {
  if (!rejected.length && !accepted.length) return;
  const { id, record } = await loadRecord(businessId);
  const ok = new Set(accepted.map(normKeyword));
  const next = [...new Set([...record.rejected, ...rejected.map(normKeyword)])].filter((k) => k && !ok.has(k)).slice(-MAX_REJECTED);
  await storeRecord(businessId, id, { ...record, rejected: next });
}

/** Guarda las búsquedas al mes medidas para las palabras propuestas. */
export async function rememberVolumes(businessId: string, volumes: Map<string, number | null>, zoneName: string) {
  const { id, record } = await loadRecord(businessId);
  if (!record.proposal) return;
  const keywords = record.proposal.keywords.map((k) => (volumes.has(normKeyword(k.keyword)) ? { ...k, volume: volumes.get(normKeyword(k.keyword)) ?? null } : k));
  await storeRecord(businessId, id, { ...record, proposal: { ...record.proposal, keywords, measuredAt: new Date().toISOString(), measuredZone: zoneName } });
}

// ---------- Lo que ya se sabe (gratis) ----------

const NO_ACCENTS = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Palabras del nombre del negocio y su dominio, para no proponer búsquedas de la marca. */
function brandWords(b: Pick<SetupBusiness, "name" | "website">): string[] {
  const domain = NO_ACCENTS(b.website).replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[./]/)[0] ?? "";
  const words = NO_ACCENTS(b.name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5 && !["public", "services", "service", "group", "corporation", "company", "servicios"].includes(w));
  return [...new Set([domain, ...words])].filter((w) => w.length >= 4);
}

const isBranded = (k: string, brand: string[]) => {
  const n = NO_ACCENTS(k).replace(/[^a-z0-9]/g, "");
  return brand.some((w) => n.includes(w.replace(/[^a-z0-9]/g, "")));
};

type Candidates = { study: string[]; gsc: string[]; ideas: { keyword: string; volume: number | null }[] };

/** Las palabras que ya salen de datos guardados del negocio: estudio, Search Console e ideas de Google ya pagadas. */
export async function freeCandidates(b: SetupBusiness): Promise<Candidates> {
  const study = readStudy(b.study);
  const brand = brandWords(b);
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const [gscRow, kwRows] = await Promise.all([
    db.seoReport.findFirst({ where: { businessId: b.id, kind: "gsc" }, orderBy: { createdAt: "desc" }, select: { data: true } }),
    db.seoReport.findMany({ where: { businessId: b.id, kind: "keywords" }, orderBy: { createdAt: "desc" }, take: 5, select: { data: true } }),
  ]);
  const gsc = asGscReport(gscRow?.data);
  const kw = kwRows.map((r) => readKeywordsReport(r.data)).find((r) => r && (!zones[0] || r.locationCode === zones[0].code || r.locationCode === 0)) ?? null;
  return {
    study: study ? topKeywords(study, 20) : [],
    gsc: (gsc?.queries ?? [])
      .filter((q) => q.key && q.key.split(" ").length <= 8 && !isBranded(q.key, brand))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 15)
      .map((q) => q.key),
    ideas: (kw?.ideas ?? []).filter((i) => !isBranded(i.keyword, brand)).slice(0, 15).map((i) => ({ keyword: i.keyword, volume: i.volume })),
  };
}

function sourceOf(k: string, c: Candidates, tracked: Set<string>): KeywordSource {
  const n = normKeyword(k);
  if (tracked.has(n)) return "tracked";
  if (c.gsc.some((x) => normKeyword(x) === n)) return "search_console";
  if (c.study.some((x) => normKeyword(x) === n)) return "study";
  if (c.ideas.some((x) => normKeyword(x.keyword) === n)) return "google_ideas";
  return "profile";
}

const WHY: Record<KeywordSource, Bi> = {
  tracked: { es: "Ya la estás siguiendo.", en: "You already track it." },
  study: { es: "La recomendó el estudio de tu negocio.", en: "Your business study recommended it." },
  search_console: { es: "Google ya te muestra con esta búsqueda (Search Console).", en: "Google already shows you for this search (Search Console)." },
  google_ideas: { es: "Google dice que mucha gente busca esto.", en: "Google says many people search for this." },
  profile: { es: "Sale de los servicios de tu perfil.", en: "It comes from the services in your profile." },
};

/** Sin IA: las del estudio, Search Console y las ideas de Google, sin repetir. */
export function plainKeywords(c: Candidates, rejected: Set<string>, tracked: Set<string>, max = MAX_PROPOSED): ProposedKeyword[] {
  const out: ProposedKeyword[] = [];
  // Sin casi-repetidas ("cortina metálica" y "cortinas metalicas" cuentan como la misma).
  const seen = new Set<string>([...rejected, ...tracked].map(similarKey));
  const push = (k: string, volume?: number | null) => {
    const n = normKeyword(k);
    if (!n || seen.has(similarKey(n)) || out.length >= max) return;
    seen.add(similarKey(n));
    const source = sourceOf(n, c, tracked);
    out.push({ keyword: n, source, why: WHY[source], ...(volume !== undefined ? { volume } : {}) });
  };
  for (const k of c.gsc.slice(0, 5)) push(k);
  for (const k of c.study) push(k);
  for (const i of c.ideas.slice(0, 5)) push(i.keyword, i.volume);
  for (const k of c.gsc.slice(5)) push(k);
  return out;
}

// ---------- Zonas sin IA ----------

const US_STATES =
  /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|miami|houston|los angeles|chicago)\b/;

/** El país más probable del negocio (ISO), por lo que dice el perfil, el estudio o sus zonas. */
export function guessCountry(text: string, zones: Zone[]): string {
  for (const z of zones) {
    const c = zoneCountry(z.name);
    if (c) return c;
  }
  const t = NO_ACCENTS(text);
  for (const [iso, es, en] of COUNTRIES) if (iso !== "us" && (t.includes(NO_ACCENTS(es)) || t.includes(en.toLowerCase()))) return iso;
  if (US_STATES.test(t) || t.includes("estados unidos") || t.includes("united states")) return "us";
  return "us";
}

// ---------- Con IA ----------

const PLACE_TYPES = ["Country", "State", "Department", "Province", "Region", "County", "Municipality", "City"] as const;

const ProposalSchema = z.object({
  language: z.enum(["es", "en"]).describe("The language most of this business's customers use when they type searches into Google"),
  languageWhyEs: z.string().describe("One short sentence in Spanish with correct accents: why that language"),
  languageWhyEn: z.string().describe("The same sentence in English"),
  places: z
    .array(
      z.object({
        name: z.string().describe("The place as Google Ads location targeting names it, in English: e.g. 'Miami-Dade County', 'Florida', 'Managua', 'Nicaragua'"),
        type: z.enum(PLACE_TYPES),
        country: z.string().describe("ISO 3166-1 alpha-2 country code of the place, lowercase (e.g. 'us', 'ni')"),
        whyEs: z.string().describe("Very short reason in Spanish (max 12 words)"),
        whyEn: z.string().describe("The same reason in English"),
      }),
    )
    .describe("1 to 5 Google areas where this business's customers are, most important first"),
  keywords: z
    .array(
      z.object({
        keyword: z.string().describe("Exactly what a customer types into Google, lowercase, 2-6 words"),
        whyEs: z.string().describe("Very short reason in Spanish (max 12 words)"),
        whyEn: z.string().describe("The same reason in English"),
      }),
    )
    .describe("12 to 15 keywords to track rankings for, most valuable first"),
});

const SYSTEM = `You are a careful local SEO expert setting up rank tracking for ONE small business.
Use ONLY the facts given about THIS business (its profile, study, website text and its own search data). Never use examples, services, places or keywords of any other business.
Places: the Google areas where the business's customers are, as the owner describes its service area. Use the most precise level the owner names (counties or cities if named; the state or the whole country if it serves all of it). At most 5. If the owner names several counties and the whole state, include the counties first and the state last.
Language: the language customers mostly use when typing in Google. If customers use two languages, pick the main one for the area.
Keywords: 12 to 15 phrases real customers type when they need what this business sells, in the language(s) they actually use in that area (you may mix languages if the profile says customers speak both). Mostly local and commercial intent: service + city/county, problem-based searches, "near me" style. Only services the business really offers. No brand names (not this business's, not competitors'). Prefer phrases from the "already known" lists when they fit. No duplicates or near-duplicates.`;

async function websiteText(website: string): Promise<string> {
  if (!/^https?:\/\//i.test(website) && !website.includes(".")) return "";
  try {
    const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 (compatible; Nehora/1.0)" } });
    if (!res.ok) return "";
    return htmlToText(await res.text(), 4000);
  } catch {
    return "";
  }
}

function contextText(b: SetupBusiness, extraWebsite: string): string {
  const study = readStudy(b.study);
  const input = readInput(b.studyInput);
  const place = readMapPlace(b.seoMapPlace);
  return [
    `Business name: ${b.name}`,
    b.website && `Website: ${b.website}`,
    place?.address && `Google Maps address: ${place.address}`,
    b.aiProfile && `Owner's profile of the business:\n${b.aiProfile.slice(0, 5000)}`,
    input?.zone && `Area the owner said they serve: ${input.zone}`,
    input?.services && `Services the owner listed: ${input.services}`,
    study && `Study summary: ${study.summary}`,
    study && `Services: ${study.services.map((s) => s.name).join("; ")}`,
    study && `Places to target (from the study): ${study.market.places.join(", ")}`,
    extraWebsite && `Text from the website home page:\n${extraWebsite}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function aiProposal(b: SetupBusiness, c: Candidates, rejected: string[]) {
  const site = !b.aiProfile || b.aiProfile.length < 300 ? await websiteText(b.website) : "";
  const known = [
    c.gsc.length && `Searches Google already shows this business for (Search Console): ${c.gsc.join("; ")}`,
    c.study.length && `Keywords from the business study: ${c.study.join("; ")}`,
    c.ideas.length && `Google keyword ideas with monthly searches: ${c.ideas.map((i) => `${i.keyword} (${i.volume ?? "?"})`).join("; ")}`,
    rejected.length && `The owner REJECTED these, do not propose them: ${rejected.slice(-60).join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  const user = `${contextText(b, site)}\n\nAlready known:\n${known || "(nothing yet)"}`;
  return ask(b.aiText, ProposalSchema, SYSTEM, user, 6000);
}

/** Convierte los lugares que nombró la IA en zonas reales de Google (gratis). */
async function resolvePlaces(places: { name: string; type?: string; country: string; why: Bi }[]): Promise<{ zones: ProposedZone[]; missing: string[] }> {
  const zones: ProposedZone[] = [];
  const missing: string[] = [];
  for (const p of places) {
    if (zones.length >= 5) break;
    const iso = p.country.trim().toLowerCase();
    try {
      const hit = isCountry(iso) || /^[a-z]{2}$/.test(iso) ? await findPlace(iso, p.name, p.type) : null;
      if (hit && !zones.some((z) => z.code === hit.code)) zones.push({ code: hit.code, name: hit.name, type: hit.type, why: p.why });
      else if (!hit) missing.push(p.name);
    } catch {
      missing.push(p.name);
    }
  }
  return { zones, missing };
}

const biOf = (e: unknown): Bi => ({ es: errorText(e, "es"), en: e instanceof BiError ? e.en : errorText(e, "en") });

/**
 * Arma la propuesta completa. Usa la guardada si el negocio no cambió (salvo force).
 * Las zonas y palabras que el negocio ya tiene se respetan: van primero y marcadas.
 */
export async function buildProposal(businessId: string, opts: { force?: boolean } = {}): Promise<SetupProposal> {
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: BUSINESS_SELECT });
  const { id, record } = await loadRecord(businessId);
  const hash = inputHash(b);
  if (!opts.force && record.proposal && record.hash === hash) return record.proposal;

  const c = await freeCandidates(b);
  const tracked = new Set(readTrackedKeywords(b.seoKeywords).map(normKeyword));
  const rejected = new Set(record.rejected);
  const current = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const study = readStudy(b.study);
  const input = readInput(b.studyInput);

  let ai: z.infer<typeof ProposalSchema> | null = null;
  let aiError: Bi | undefined;
  if (aiEnabled()) {
    try {
      ai = await aiProposal(b, c, record.rejected);
    } catch (e) {
      aiError = biOf(e);
    }
  } else {
    aiError = { es: "No hay una IA conectada; la propuesta sale solo de tu estudio y tus datos.", en: "No AI is connected; the proposal only comes from your study and your data." };
  }

  // Palabras: las de la IA (limpias, sin marca, sin rechazadas) y, si faltan, las de los datos guardados.
  const brand = brandWords(b);
  const competitors = (study?.market.competitors ?? []).map((x) => NO_ACCENTS(x.name)).filter((n) => n.length >= 4);
  const keywords: ProposedKeyword[] = [];
  const seen = new Set<string>([...rejected, ...tracked].map(similarKey));
  for (const k of ai?.keywords ?? []) {
    const n = normKeyword(k.keyword.replace(/["“”«»]/g, ""));
    if (!n || n.split(" ").length > 8 || seen.has(similarKey(n)) || isBranded(n, brand) || competitors.some((x) => NO_ACCENTS(n).includes(x))) continue;
    seen.add(similarKey(n));
    const source = sourceOf(n, c, tracked);
    const volume = c.ideas.find((i) => normKeyword(i.keyword) === n)?.volume;
    keywords.push({ keyword: n, source, why: source === "profile" ? { es: k.whyEs, en: k.whyEn } : WHY[source], ...(volume !== undefined ? { volume } : {}) });
    if (keywords.length >= MAX_PROPOSED) break;
  }
  if (keywords.length < 8) {
    for (const k of plainKeywords(c, rejected, new Set([...tracked, ...keywords.map((x) => x.keyword)]), MAX_PROPOSED - keywords.length)) keywords.push(k);
  }

  // Zonas: las que ya tiene; si no tiene, las de la IA; si no hay IA, los lugares del estudio.
  let zones: ProposedZone[] = current.map((z) => ({ ...z, why: { es: "Ya la tienes elegida.", en: "You already picked it." } }));
  let missing: string[] = [];
  if (!zones.length) {
    const textAll = [b.aiProfile, input?.zone, study?.market.area, study?.market.places.join(", ")].filter(Boolean).join(" ");
    const country = guessCountry(textAll, current);
    const places = ai?.places.length
      ? ai.places.map((p) => ({ name: p.name, type: p.type, country: p.country || country, why: { es: p.whyEs, en: p.whyEn } }))
      : [
          ...(study?.market.places ?? []).slice(0, 4).map((p) => ({ name: p, country, why: { es: "Sale en tu estudio.", en: "It's in your study." } })),
          ...(input?.zone ? [{ name: input.zone.split(/[,;]/)[0], country, why: { es: "La zona que nos dijiste.", en: "The area you told us." } }] : []),
        ];
    try {
      ({ zones, missing } = await resolvePlaces(places));
    } catch {
      missing = places.map((p) => p.name);
    }
  }

  const proposal: SetupProposal = {
    zones,
    missingPlaces: missing,
    language: ai?.language ?? (b.seoLanguage === "en" || input?.lang === "en" ? "en" : "es"),
    languageWhy: ai ? { es: ai.languageWhyEs, en: ai.languageWhyEn } : { es: "Es el idioma de tu negocio en la app.", en: "It's your business's language in the app." },
    keywords,
    ai: Boolean(ai),
    ...(aiError ? { aiError } : {}),
    createdAt: new Date().toISOString(),
  };
  await storeRecord(businessId, id, { version: 1, hash, proposal, rejected: record.rejected });
  return proposal;
}

/** Sugerencias para Ajustes sin gastar: la propuesta guardada (si hay) y los datos guardados, menos lo que ya sigue o rechazó. */
export async function settingsSuggestions(businessId: string): Promise<{ list: ProposedKeyword[]; fromAi: boolean }> {
  const b = await db.business.findUnique({ where: { id: businessId }, select: BUSINESS_SELECT });
  if (!b) return { list: [], fromAi: false };
  const { record } = await loadRecord(businessId);
  const tracked = new Set(readTrackedKeywords(b.seoKeywords).map(normKeyword));
  const rejected = new Set(record.rejected);
  const saved = record.hash === inputHash(b) ? record.proposal : null;
  const skip = new Set([...tracked, ...rejected].map(similarKey));
  const list = (saved?.keywords ?? []).filter((k) => !skip.has(similarKey(k.keyword)));
  const c = await freeCandidates(b);
  for (const k of plainKeywords(c, rejected, new Set([...tracked, ...list.map((x) => normKeyword(x.keyword))]), MAX_PROPOSED)) list.push(k);
  return { list: list.slice(0, 20), fromAi: Boolean(saved?.ai) };
}

// ---------- Guardar lo elegido (Ajustes y "Aceptar todo") ----------

const parseJson = (v: FormDataEntryValue | null): unknown => {
  try {
    return JSON.parse(String(v ?? ""));
  } catch {
    return null;
  }
};
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Guarda zonas, idioma, palabras clave y cada cuánto se revisan las posiciones, con los campos del formulario:
 * zones (JSON), language (es|en), keywords (una por línea), rankDays (0|1|7|15|30) — o el viejo daily=on —,
 * y rejected (JSON) con las sugerencias que el dueño quitó.
 */
export async function applySettingsForm(businessId: string, f: FormData): Promise<{ zones: Zone[]; keywords: string[] }> {
  const zones = readZones(parseJson(f.get("zones")) ?? []).slice(0, 5);
  const keywords = [...new Set(String(f.get("keywords") ?? "").split("\n").map(normKeyword).filter(Boolean))].slice(0, 25);
  const days = Number(f.get("rankDays"));
  const hasDays = f.has("rankDays") && [0, 1, 7, 15, 30].includes(days);
  await db.business.update({
    where: { id: businessId },
    data: {
      // La primera zona es la principal (la usan la competencia y los datos de un solo lugar).
      seoLocations: zones,
      seoLocationCode: zones[0]?.code ?? null,
      seoLocationName: zones[0]?.name ?? "",
      seoLanguage: f.get("language") === "en" ? "en" : "es",
      seoKeywords: keywords,
      seoDaily: hasDays ? days > 0 : f.get("daily") === "on",
      ...(hasDays && days > 0 ? { seoRankDays: days } : {}),
    },
  });
  await rememberChoices(businessId, strings(parseJson(f.get("rejected"))), keywords);
  return { zones, keywords };
}
