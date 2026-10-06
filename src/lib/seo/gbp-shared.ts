// "Tu Perfil de Google": lo que también usa el navegador (tipos, costos, idioma de las respuestas, enlaces).
// Sin dependencias (no importa la base de datos ni la red), para poder usarlo en componentes "use client"
// y en src/lib/ai.ts. La lógica que llama a DataForSEO y a Google está en src/lib/seo/gbp.ts (que reexporta todo esto).

// ---------- Precios (DataForSEO, octubre 2026) ----------
// https://dataforseo.com/pricing/business-data/business-data-api → My Business Info "live": US$0.0054 por perfil.
// https://dataforseo.com/pricing/business-data/google-reviews-api → Reviews, cola prioritaria (hasta 1 minuto):
//   US$0.0015 por cada 10 reseñas (la cola normal es US$0.00075 pero puede tardar hasta 45 minutos).

/** Precio de un perfil en modo live (USD). */
export const PROFILE_COST = 0.0054;
/** Precio de cada 10 reseñas en la cola prioritaria (USD). */
export const REVIEWS_COST_PER_10 = 0.0015;
/** Cuántas reseñas se traen (las más nuevas). */
export const REVIEWS_DEPTH = 50;
/** Competidores del mapa de calor que se comparan (solo su perfil, nunca sus reseñas). */
export const MAX_COMPETITORS = 3;
/** Cuántos reportes de perfil y de reseñas se guardan por negocio. */
export const GBP_KEEP = 10;
/** Cuántas respuestas escribe la IA de una vez con "Escribir todas las respuestas". */
export const DRAFT_BATCH = 10;

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Costo estimado de "Actualizar perfil": tu perfil + el de cada competidor. */
export const profileCostEstimate = (competitors: number) => round4(PROFILE_COST * (1 + Math.max(0, Math.min(MAX_COMPETITORS, competitors))));
/** Costo estimado de "Actualizar reseñas" (se cobra por cada 10, redondeando hacia arriba). */
export const reviewsCostEstimate = (depth = REVIEWS_DEPTH) => round4(Math.ceil(Math.max(1, depth) / 10) * REVIEWS_COST_PER_10);

// ---------- Tipos ----------

export type Bi = { es: string; en: string };

/** Tu perfil de Google Maps (normalizado desde my_business_info). */
export type GbpProfile = {
  title: string;
  cid: string;
  placeId: string;
  featureId: string;
  category: string;
  additionalCategories: string[];
  description: string;
  address: string;
  phone: string;
  url: string;
  domain: string;
  rating: number | null;
  reviews: number | null;
  /** Reseñas por estrellas: [1★, 2★, 3★, 4★, 5★]. null si Google no lo dio. */
  distribution: number[] | null;
  /** ¿Tiene horario? */
  hasHours: boolean;
  /** Días con horario (0-7). */
  hoursDays: number;
  /** "opened" | "closed" | "temporarily_closed" | "closed_forever" | "". */
  status: string;
  totalPhotos: number | null;
  mainImage: string;
  logo: string;
  /** null = Google no dijo. */
  isClaimed: boolean | null;
  /** Atributos que tiene (ej. "is_small_business", "offers_online_appointments"). */
  attributes: string[];
  /** Temas que más mencionan las reseñas según Google. */
  topics: { term: string; count: number }[];
  lat: number | null;
  lng: number | null;
};

/** Lo que se compara de un competidor (su perfil, no sus reseñas). */
export type GbpCompetitor = {
  title: string;
  cid: string;
  category: string;
  additionalCategories: string[];
  rating: number | null;
  reviews: number | null;
  totalPhotos: number | null;
  isClaimed: boolean | null;
  hasDescription: boolean;
  hasHours: boolean;
  error?: Bi;
};

export type GbpPriority = "high" | "medium" | "low";

/** Un punto de la lista "Lo que te falta en tu perfil". */
export type GbpCheck = {
  id: string;
  ok: boolean;
  priority: GbpPriority;
  /** Cuánto vale en el puntaje (los que se pudieron revisar suman 100 al normalizar). */
  weight: number;
  es: string;
  en: string;
};

export type GbpReport = {
  version: 1;
  profile: GbpProfile;
  competitors: GbpCompetitor[];
  checklist: GbpCheck[];
  score: number;
  cost: number;
  createdAt: string;
};

/** Una reseña de Google (normalizada desde reviews/task_get). */
export type GbpReview = {
  /** review_id de DataForSEO (el id público de Google Maps). */
  id: string;
  name: string;
  profileUrl: string;
  localGuide: boolean;
  rating: number | null;
  /** Lo que se muestra (puede venir traducido por Google). */
  text: string;
  /** El texto como lo escribió el cliente, si es distinto. */
  originalText: string;
  /** Idioma original según Google ("es", "en"…). "" si no se sabe. */
  language: string;
  /** ISO. "" si no se sabe. */
  timestamp: string;
  timeAgo: string;
  ownerAnswer: string;
  /** ISO. "" si no hay respuesta o no se sabe cuándo. */
  ownerTimestamp: string;
  url: string;
  images: string[];
  /** Respuesta escrita por la IA (o editada por el dueño), todavía sin publicar. */
  draft?: string;
  draftAt?: string;
  /** Cuándo se publicó la respuesta desde la app (API de Google). */
  postedAt?: string;
};

export type ReviewStats = {
  /** Reseñas revisadas (las más nuevas que se trajeron). */
  count: number;
  /** Promedio de estrellas de esas reseñas. */
  average: number | null;
  /** [1★, 2★, 3★, 4★, 5★]. */
  distribution: number[];
  answered: number;
  /** 0-100. null si no hay reseñas. */
  answeredPct: number | null;
  unanswered: number;
  /** Sin contestar con 3 estrellas o menos. */
  unansweredLow: number;
  /** Los últimos 12 meses, del más viejo al actual ("2026-10"). */
  months: { month: string; count: number }[];
  thisMonth: number;
  last7: number;
  last30: number;
  last90: number;
  /** Días promedio entre la reseña y la respuesta del dueño. null si no se puede saber. */
  avgReplyDays: number | null;
  /** Palabras que más se repiten en las reseñas (en cuántas reseñas sale cada una). */
  topics: { term: string; count: number }[];
};

export type ReviewsReport = {
  version: 1;
  /** Total de reseñas en Google (no solo las que se trajeron). */
  total: number | null;
  rating: number | null;
  reviews: GbpReview[];
  stats: ReviewStats;
  cost: number;
  createdAt: string;
};

// ---------- Enlaces ----------

/** Abre el negocio en Google Maps. */
export const mapsUrl = (cid: string) => (cid ? `https://www.google.com/maps?cid=${encodeURIComponent(cid)}` : "");

// ---------- Idioma y firma de las respuestas ----------

const ES_WORDS = new Set(
  "el la los las de del que y en un una muy por para con es se lo su al excelente servicio gracias atencion todo bien pero me mi nos fue son mas buen buena recomiendo lugar atendieron siempre".split(" "),
);
const EN_WORDS = new Set(
  "the and to of is in it for was with very great service thank thanks you they my we but this that were are highly recommend would their had our good excellent".split(" "),
);

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Idioma de un texto (español o inglés) por sus palabras más comunes. null si no se puede saber. */
export function detectLanguage(text: string): "es" | "en" | null {
  if (!text.trim()) return null;
  let es = /[ñ¿¡áéíóú]/i.test(text) ? 2 : 0;
  let en = 0;
  for (const w of plain(text).split(" ")) {
    if (ES_WORDS.has(w)) es++;
    if (EN_WORDS.has(w)) en++;
  }
  if (Math.max(es, en) < 2 || es === en) return null;
  return es > en ? "es" : "en";
}

/** En qué idioma contestar: el que dice Google, si no el del texto, si no el del negocio. */
export function replyLanguage(review: Pick<GbpReview, "language" | "text" | "originalText">, fallback: "es" | "en"): "es" | "en" {
  const g = review.language.toLowerCase();
  if (g.startsWith("es")) return "es";
  if (g.startsWith("en")) return "en";
  return detectLanguage(review.originalText || review.text) ?? fallback;
}

/** El primer nombre del cliente ("María José Pérez" → "María"). "" si no parece un nombre (iniciales, números, "A Google User"). */
export function firstName(name: string): string {
  const n = name.trim();
  if (!n || /google user|usuario de google/i.test(n)) return "";
  const first = n.split(/\s+/)[0];
  if (!/^\p{L}[\p{L}'’-]*$/u.test(first) || first.replace(/[^\p{L}]/gu, "").length < 2) return "";
  // "JUAN" → "Juan"
  return first === first.toUpperCase() ? first.charAt(0) + first.slice(1).toLowerCase() : first;
}

/** La firma de las respuestas. */
export const replySignature = (businessName: string, lang: "es" | "en") => (lang === "en" ? `— ${businessName.trim()} Team` : `— Equipo ${businessName.trim()}`);

/** Largo máximo de una respuesta (Google acepta 4096 bytes; las buenas respuestas son cortas). */
export const MAX_REPLY = 1500;

/** Deja la respuesta lista: sin comillas ni markdown, sin firmas que haya puesto la IA, con la firma del negocio al final. */
export function finishReply(text: string, signature: string): string {
  const lines = text
    .replace(/\r/g, "")
    .replace(/\*\*|__|`/g, "")
    .trim()
    .replace(/^["“”']+|["“”']+$/g, "")
    .split("\n")
    .map((l) => l.trimEnd());
  // Quita firmas al final ("— Equipo X", "-- El equipo", "Saludos," …).
  while (lines.length && (/^\s*[—–-]{1,2}\s*\S/.test(lines[lines.length - 1]) || !lines[lines.length - 1].trim())) lines.pop();
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const room = MAX_REPLY - signature.length - 1;
  const cut = body.length > room ? body.slice(0, room).replace(/\s+\S*$/, "") + "…" : body;
  return cut ? `${cut}\n${signature}` : signature;
}
