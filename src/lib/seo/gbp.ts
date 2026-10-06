// "Tu Perfil de Google" (Perfil de Negocio en Google Maps): salud del perfil, reseñas y respuestas con IA.
//
// Funciona SIN conectar la cuenta de Google del dueño: los datos son públicos y vienen de DataForSEO Business Data API.
// - Perfil: https://docs.dataforseo.com/v3/business_data/google/my_business_info/live/ (live, US$0.0054 por perfil,
//   ~6 s). keyword = "cid:<cid>" o "place_id:<id>".
// - Reseñas: https://docs.dataforseo.com/v3/business_data/google/reviews/task_post/ y .../task_get/$id (solo por tareas,
//   no hay live). Se pide con `cid` (o `place_id`) como campo aparte, depth 50, sort_by "newest" y priority 2
//   (cola prioritaria: hasta 1 minuto, US$0.0015 cada 10 reseñas; la normal puede tardar hasta 45 minutos).
//   task_post responde 20100 ("Task Created"); task_get responde 40601/40602 mientras la tarea sigue en la cola.
// - Contestar en Google: solo si hay una conexión "google" (accountId/locationId) y Google aprobó el acceso de la app
//   a la API (v4 accounts.locations.reviews: list + updateReply). Si no, el dueño copia la respuesta y la pega en Google.
//
// Todo lo que no toca la red es puro y se prueba en tests/seo-gbp.test.ts.
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { BiError, bi } from "@/lib/i18n";
import { googleAccessToken, stripGoogleId } from "@/lib/publishers/google";
import { fetchJson } from "@/lib/publishers/http";
import { dfsError, dfsTask, type Zone } from "@/lib/seo/dataforseo";
import type { MapPlace, MapReport } from "@/lib/seo/maprank-shared";
import { biOf, normalizeName, pool, siteDomain } from "@/lib/seo/rank";
import { norm, stem, STOPWORDS } from "@/lib/seo/writer";
import {
  type GbpCheck,
  type GbpCompetitor,
  type GbpProfile,
  type GbpReport,
  type GbpReview,
  MAX_COMPETITORS,
  REVIEWS_DEPTH,
  type ReviewsReport,
  type ReviewStats,
} from "@/lib/seo/gbp-shared";

export * from "@/lib/seo/gbp-shared";

const DAY_MS = 24 * 3600_000;
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const strList = (v: unknown, max = 50) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 200)).slice(0, max) : [];

/** "2019-11-15 12:57:46 +00:00" (formato de DataForSEO) → ISO. "" si no se puede leer. */
export function parseDfsTime(v: unknown): string {
  const s = str(v).trim();
  if (!s) return "";
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  const iso = m ? `${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}${m[3] ? (m[3] === "Z" ? "Z" : m[3].includes(":") ? m[3] : `${m[3].slice(0, 3)}:${m[3].slice(3)}`) : "Z"}` : s;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

// ---------- Perfil (my_business_info) ----------

type RawRating = { value?: number | null; votes_count?: number | null } | null;
type RawInfo = {
  type?: string;
  title?: string;
  description?: string | null;
  category?: string | null;
  additional_categories?: string[] | null;
  cid?: string | number;
  feature_id?: string;
  place_id?: string;
  address?: string | null;
  phone?: string | null;
  url?: string | null;
  domain?: string | null;
  logo?: string | null;
  main_image?: string | null;
  total_photos?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  is_claimed?: boolean | null;
  attributes?: { available_attributes?: Record<string, string[] | null> | null } | null;
  place_topics?: Record<string, number> | null;
  rating?: RawRating;
  rating_distribution?: Record<string, number | null> | null;
  work_time?: { work_hours?: { timetable?: Record<string, unknown[] | null> | null; current_status?: string | null } | null } | null;
};
export type BusinessInfoResult = { items?: RawInfo[] | null };

function distributionOf(raw: unknown): number[] | null {
  const o = obj(raw);
  if (!o) return null;
  const out = [1, 2, 3, 4, 5].map((k) => Math.max(0, Math.round(num(o[String(k)]) ?? 0)));
  return out.some((n) => n > 0) ? out : null;
}

/** El perfil de una respuesta de my_business_info. null si no vino un negocio. */
export function parseProfile(result: BusinessInfoResult | null | undefined): GbpProfile | null {
  const items = Array.isArray(result?.items) ? result.items : [];
  const i = items.find((x) => !!x && typeof x === "object" && (x.type === undefined || x.type === "google_business_info"));
  if (!i) return null;
  const title = str(i.title).trim();
  if (!title) return null;
  const rating = obj(i.rating);
  const timetable = obj(obj(obj(i.work_time)?.work_hours)?.timetable);
  const hoursDays = timetable ? Object.values(timetable).filter((d) => Array.isArray(d) && d.length > 0).length : 0;
  const available = obj(obj(i.attributes)?.available_attributes);
  const attributes = available ? [...new Set(Object.values(available).flatMap((v) => strList(v)))].slice(0, 100) : [];
  const topicsRaw = obj(i.place_topics);
  const topics = topicsRaw
    ? Object.entries(topicsRaw)
        .flatMap(([term, n]) => (term.trim() && num(n) !== null ? [{ term: term.trim().slice(0, 60), count: num(n) as number }] : []))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
    : [];
  const url = str(i.url).trim();
  return {
    title: title.slice(0, 200),
    cid: str(i.cid),
    placeId: str(i.place_id),
    featureId: str(i.feature_id),
    category: str(i.category).trim(),
    additionalCategories: strList(i.additional_categories, 20),
    description: str(i.description).trim().slice(0, 2000),
    address: str(i.address).trim(),
    phone: str(i.phone).trim(),
    url,
    domain: siteDomain(str(i.domain) || url),
    rating: num(rating?.value),
    reviews: num(rating?.votes_count),
    distribution: distributionOf(i.rating_distribution),
    hasHours: hoursDays > 0,
    hoursDays,
    status: str(obj(obj(i.work_time)?.work_hours)?.current_status),
    totalPhotos: num(i.total_photos),
    mainImage: str(i.main_image),
    logo: str(i.logo),
    isClaimed: typeof i.is_claimed === "boolean" ? i.is_claimed : null,
    attributes,
    topics,
    lat: num(i.latitude),
    lng: num(i.longitude),
  };
}

/** Lo que se compara de un competidor. */
export const toCompetitor = (p: GbpProfile): GbpCompetitor => ({
  title: p.title,
  cid: p.cid,
  category: p.category,
  additionalCategories: p.additionalCategories,
  rating: p.rating,
  reviews: p.reviews,
  totalPhotos: p.totalPhotos,
  isClaimed: p.isClaimed,
  hasDescription: p.description.length > 0,
  hasHours: p.hasHours,
});

// ---------- Reseñas (reviews/task_get) ----------

type RawReview = {
  type?: string;
  review_id?: string | null;
  review_text?: string | null;
  original_review_text?: string | null;
  original_language?: string | null;
  rating?: RawRating;
  timestamp?: string | null;
  time_ago?: string | null;
  profile_name?: string | null;
  profile_url?: string | null;
  local_guide?: boolean | null;
  owner_answer?: string | null;
  original_owner_answer?: string | null;
  owner_timestamp?: string | null;
  review_url?: string | null;
  images?: { image_url?: string | null; url?: string | null }[] | null;
};
export type ReviewsResult = { reviews_count?: number | null; rating?: RawRating; items?: RawReview[] | null };

/** Las reseñas de una respuesta de reviews/task_get, sin repetir. */
export function parseReviews(result: ReviewsResult | null | undefined): { total: number | null; rating: number | null; reviews: GbpReview[] } {
  const items = Array.isArray(result?.items) ? result.items : [];
  const seen = new Set<string>();
  const reviews: GbpReview[] = [];
  for (const i of items) {
    if (!i || typeof i !== "object" || (i.type !== undefined && i.type !== "google_reviews_search")) continue;
    const name = str(i.profile_name).trim().slice(0, 120);
    const timestamp = parseDfsTime(i.timestamp);
    const id = str(i.review_id).trim() || (name || timestamp ? `${name}|${timestamp}` : "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const text = str(i.review_text).trim().slice(0, 5000);
    const original = str(i.original_review_text).trim().slice(0, 5000);
    const value = num(obj(i.rating)?.value);
    reviews.push({
      id: id.slice(0, 300),
      name,
      profileUrl: str(i.profile_url),
      localGuide: i.local_guide === true,
      rating: value !== null && value >= 1 && value <= 5 ? value : null,
      text,
      originalText: original && original !== text ? original : "",
      language: str(i.original_language).trim().slice(0, 10),
      timestamp,
      timeAgo: str(i.time_ago).trim().slice(0, 60),
      ownerAnswer: (str(i.owner_answer).trim() || str(i.original_owner_answer).trim()).slice(0, 5000),
      ownerTimestamp: parseDfsTime(i.owner_timestamp),
      url: str(i.review_url),
      images: (Array.isArray(i.images) ? i.images : []).map((im) => str(im?.image_url) || str(im?.url)).filter(Boolean).slice(0, 4),
    });
  }
  const rating = obj(result?.rating);
  return { total: num(result?.reviews_count) ?? num(rating?.votes_count), rating: num(rating?.value), reviews };
}

// ---------- Números de las reseñas ----------

/** Palabras que se repiten en reseñas pero no dicen de qué tratan. */
const REVIEW_STOPWORDS = new Set(
  (
    "google traducido translated original review resena resenas gracias thanks thank really also just even much many well todo toda todos solo " +
    "have from them they were very muy bueno buena buenos buenas good great excelente excellent recomiendo recommend highly siempre always"
  ).split(" "),
);

/** Lo importante de las reseñas: promedio, cuántas están contestadas, reseñas por mes, tiempo de respuesta y temas. */
export function reviewStats(reviews: GbpReview[], now: Date = new Date()): ReviewStats {
  const rated = reviews.filter((r) => r.rating !== null);
  const distribution = [0, 0, 0, 0, 0];
  for (const r of rated) distribution[Math.min(5, Math.max(1, Math.round(r.rating as number))) - 1]++;
  const answeredList = reviews.filter((r) => r.ownerAnswer.trim());
  const unansweredList = reviews.filter((r) => !r.ownerAnswer.trim());
  const nowMs = now.getTime();
  const age = (r: GbpReview) => (r.timestamp ? nowMs - Date.parse(r.timestamp) : Infinity);
  const within = (days: number) => reviews.filter((r) => age(r) >= -DAY_MS && age(r) <= days * DAY_MS).length;

  // Últimos 12 meses (UTC), del más viejo al actual.
  const months: { month: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, count: 0 });
  }
  const byMonth = new Map(months.map((m) => [m.month, m]));
  for (const r of reviews) {
    const m = r.timestamp ? byMonth.get(r.timestamp.slice(0, 7)) : undefined;
    if (m) m.count++;
  }

  const replyDays = answeredList
    .filter((r) => r.timestamp && r.ownerTimestamp)
    .map((r) => (Date.parse(r.ownerTimestamp) - Date.parse(r.timestamp)) / DAY_MS)
    .filter((d) => Number.isFinite(d) && d >= 0);

  // Temas: en cuántas reseñas sale cada palabra (agrupando plurales), mostrando la forma más usada.
  const docs = new Map<string, { count: number; forms: Map<string, number> }>();
  for (const r of reviews) {
    const words = norm(r.originalText || r.text)
      .split(" ")
      .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOPWORDS.has(w) && !REVIEW_STOPWORDS.has(w));
    const inThis = new Set<string>();
    for (const w of words) {
      const k = stem(w);
      const e = docs.get(k) ?? { count: 0, forms: new Map<string, number>() };
      e.forms.set(w, (e.forms.get(w) ?? 0) + 1);
      if (!inThis.has(k)) {
        e.count++;
        inThis.add(k);
      }
      docs.set(k, e);
    }
  }
  const topics = [...docs.values()]
    .filter((e) => e.count >= 2)
    .map((e) => ({ term: [...e.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0], count: e.count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, 8);

  return {
    count: reviews.length,
    average: rated.length ? round(rated.reduce((s, r) => s + (r.rating as number), 0) / rated.length, 2) : null,
    distribution,
    answered: answeredList.length,
    answeredPct: reviews.length ? Math.round((answeredList.length / reviews.length) * 100) : null,
    unanswered: unansweredList.length,
    unansweredLow: unansweredList.filter((r) => r.rating !== null && r.rating <= 3).length,
    months,
    thisMonth: months[months.length - 1].count,
    last7: within(7),
    last30: within(30),
    last90: within(90),
    avgReplyDays: replyDays.length ? round(replyDays.reduce((s, d) => s + d, 0) / replyDays.length, 1) : null,
    topics,
  };
}

// ---------- Lo que te falta en tu perfil ----------

/** Mediana de una lista de números (sin los null). null si no hay ninguno. */
export function median(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const catKey = (c: string) => c.trim().toLowerCase();

/** Categorías que usan tus competidores y tú no, de la más usada a la menos (con cuántos la usan). */
export function missingCategories(profile: Pick<GbpProfile, "category" | "additionalCategories">, competitors: GbpCompetitor[]): { category: string; count: number }[] {
  const mine = new Set([profile.category, ...profile.additionalCategories].filter(Boolean).map(catKey));
  const tally = new Map<string, { category: string; count: number }>();
  for (const c of competitors.filter((x) => !x.error)) {
    for (const cat of new Set([c.category, ...c.additionalCategories].filter(Boolean))) {
      const k = catKey(cat);
      if (mine.has(k)) continue;
      const cur = tally.get(k) ?? { category: cat.trim(), count: 0 };
      cur.count++;
      tally.set(k, cur);
    }
  }
  return [...tally.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)).slice(0, 6);
}

/**
 * Puntos que revisa la lista y cuánto vale cada uno (suman 100). Los que no se pueden revisar (por ejemplo, las
 * reseñas antes de traerlas, o "reclamado" si Google no lo dice) no cuentan y el puntaje se calcula con el resto.
 */
export const CHECK_WEIGHTS = {
  claimed: 12,
  category: 10,
  additional: 5,
  description: 8,
  hours: 8,
  phone: 8,
  website: 8,
  photos: 8,
  rating: 8,
  reviewCount: 7,
  recent: 6,
  answered: 6,
  replyTime: 3,
  attributes: 3,
} as const;

/** Largo de descripción a partir del cual se considera completa (Google permite 750). */
export const GOOD_DESCRIPTION = 250;

/**
 * La lista "Lo que te falta en tu perfil" y el puntaje (0-100) = lo que está bien ÷ lo que se pudo revisar.
 * Compara con los competidores del mapa de calor cuando los hay (categorías, fotos, calificación y reseñas).
 */
export function profileChecklist(
  profile: GbpProfile,
  competitors: GbpCompetitor[] = [],
  stats: ReviewStats | null = null,
): { checklist: GbpCheck[]; score: number } {
  const W = CHECK_WEIGHTS;
  const comps = competitors.filter((c) => !c.error);
  const items: GbpCheck[] = [];
  const add = (id: keyof typeof W, ok: boolean, priority: GbpCheck["priority"], es: string, en: string) => items.push({ id, ok, priority, weight: W[id], es, en });
  const nf1 = (n: number) => String(round(n, 1));

  if (profile.isClaimed !== null)
    add(
      "claimed",
      profile.isClaimed,
      "high",
      profile.isClaimed
        ? "Tu perfil está reclamado (verificado): tú controlas lo que dice."
        : "Tu perfil no está reclamado: cualquiera puede sugerir cambios y no puedes contestar reseñas. Reclámalo gratis en business.google.com.",
      profile.isClaimed
        ? "Your profile is claimed (verified): you control what it says."
        : "Your profile isn't claimed: anyone can suggest edits and you can't reply to reviews. Claim it for free at business.google.com.",
    );

  add(
    "category",
    !!profile.category,
    "high",
    profile.category
      ? `Categoría principal: «${profile.category}».`
      : "No tienes categoría principal. Es lo que más pesa para salir en Google Maps: elígela en business.google.com.",
    profile.category ? `Primary category: “${profile.category}”.` : "You have no primary category. It's the biggest factor for showing up on Google Maps: pick one at business.google.com.",
  );

  const missing = missingCategories(profile, comps);
  const strongMissing = missing.filter((m) => m.count >= 2 || comps.length === 1);
  const list = (xs: { category: string }[]) => xs.map((m) => m.category).join(", ");
  const additionalOk = profile.additionalCategories.length > 0 && strongMissing.length === 0;
  add(
    "additional",
    additionalOk,
    "medium",
    (profile.additionalCategories.length
      ? `Tienes ${profile.additionalCategories.length} ${profile.additionalCategories.length === 1 ? "categoría adicional" : "categorías adicionales"}.`
      : "No tienes categorías adicionales: agrega las que describan otros servicios que das.") +
      (missing.length ? ` Tus competidores usan: ${list(missing)}. Agrega solo las que sí describan lo que haces.` : ""),
    (profile.additionalCategories.length
      ? `You have ${profile.additionalCategories.length} additional ${profile.additionalCategories.length === 1 ? "category" : "categories"}.`
      : "You have no additional categories: add the ones that describe other services you offer.") +
      (missing.length ? ` Your competitors use: ${list(missing)}. Add only the ones that truly describe what you do.` : ""),
  );

  const dl = profile.description.length;
  add(
    "description",
    dl >= GOOD_DESCRIPTION,
    "medium",
    dl >= GOOD_DESCRIPTION
      ? `Tienes descripción (${dl} letras).`
      : dl
        ? `Tu descripción es corta (${dl} letras). Usa hasta 750: qué haces, en qué zonas atiendes y por qué elegirte.`
        : "No tienes descripción. Escribe hasta 750 letras: qué haces, en qué zonas atiendes y por qué elegirte.",
    dl >= GOOD_DESCRIPTION
      ? `You have a description (${dl} characters).`
      : dl
        ? `Your description is short (${dl} characters). Use up to 750: what you do, which areas you serve and why choose you.`
        : "You have no description. Write up to 750 characters: what you do, which areas you serve and why choose you.",
  );

  add(
    "hours",
    profile.hasHours,
    "high",
    profile.hasHours ? `Tienes horario (${profile.hoursDays} días a la semana).` : "No tienes horario: Google muestra menos los negocios sin horario. Agrégalo.",
    profile.hasHours ? `You have business hours (${profile.hoursDays} days a week).` : "You have no business hours: Google shows businesses without hours less often. Add them.",
  );
  add(
    "phone",
    !!profile.phone,
    "high",
    profile.phone ? `Tienes teléfono: ${profile.phone}.` : "No tienes teléfono: los clientes no pueden llamarte desde Google Maps.",
    profile.phone ? `You have a phone number: ${profile.phone}.` : "You have no phone number: customers can't call you from Google Maps.",
  );
  add(
    "website",
    !!profile.url,
    "high",
    profile.url ? `Tienes página web: ${profile.domain || profile.url}.` : "No tienes página web en tu perfil: agrégala para que te visiten.",
    profile.url ? `You have a website: ${profile.domain || profile.url}.` : "You have no website on your profile: add it so people can visit.",
  );

  if (profile.totalPhotos !== null) {
    const compPhotos = median(comps.map((c) => c.totalPhotos));
    const target = Math.max(10, Math.ceil(compPhotos ?? 0));
    const p = profile.totalPhotos;
    add(
      "photos",
      p >= target,
      "medium",
      compPhotos !== null
        ? `Tienes ${p} fotos; tus competidores tienen ${Math.round(compPhotos)} (mediana).${p >= target ? "" : " Sube fotos reales de tu trabajo, tu equipo y tu local."}`
        : `Tienes ${p} fotos.${p >= target ? "" : " Sube al menos 10 fotos reales de tu trabajo, tu equipo y tu local."}`,
      compPhotos !== null
        ? `You have ${p} photos; your competitors have ${Math.round(compPhotos)} (median).${p >= target ? "" : " Upload real photos of your work, your team and your place."}`
        : `You have ${p} photos.${p >= target ? "" : " Upload at least 10 real photos of your work, your team and your place."}`,
    );
  }

  const compRating = median(comps.map((c) => c.rating));
  const compReviews = median(comps.map((c) => c.reviews));
  const rating = profile.rating;
  const ratingOk = rating !== null && (profile.reviews ?? 0) > 0 && (rating >= 4.5 || (compRating !== null && rating >= compRating));
  add(
    "rating",
    ratingOk,
    "high",
    rating === null || !(profile.reviews ?? 0)
      ? "Todavía no tienes calificación en Google: pide a tus clientes contentos que te dejen una reseña."
      : `Tu calificación es ${nf1(rating)} ★${compRating !== null ? `; tus competidores tienen ${nf1(compRating)} ★ (mediana)` : ""}.${ratingOk ? "" : " Contesta las reseñas malas con calma y pide reseñas a los clientes contentos."}`,
    rating === null || !(profile.reviews ?? 0)
      ? "You don't have a Google rating yet: ask your happy customers to leave a review."
      : `Your rating is ${nf1(rating)} ★${compRating !== null ? `; your competitors have ${nf1(compRating)} ★ (median)` : ""}.${ratingOk ? "" : " Reply calmly to bad reviews and ask happy customers for reviews."}`,
  );

  const reviews = profile.reviews ?? 0;
  const reviewTarget = Math.max(10, Math.ceil(compReviews ?? 20));
  add(
    "reviewCount",
    reviews >= reviewTarget,
    "medium",
    `Tienes ${reviews} reseñas${compReviews !== null ? `; tus competidores tienen ${Math.round(compReviews)} (mediana)` : ""}.${reviews >= reviewTarget ? "" : " Pide una reseña a cada cliente satisfecho (mándales el enlace por WhatsApp)."}`,
    `You have ${reviews} reviews${compReviews !== null ? `; your competitors have ${Math.round(compReviews)} (median)` : ""}.${reviews >= reviewTarget ? "" : " Ask every happy customer for a review (send them the link on WhatsApp)."}`,
  );

  if (stats) {
    add(
      "recent",
      stats.last30 > 0,
      "medium",
      stats.last30 > 0
        ? `Recibiste ${stats.last30} ${stats.last30 === 1 ? "reseña" : "reseñas"} en los últimos 30 días.`
        : stats.last90 > 0
          ? `No recibiste reseñas en el último mes (${stats.last90} en los últimos 3 meses). Google prefiere los negocios con reseñas recientes.`
          : "No recibiste reseñas en los últimos 3 meses. Google prefiere los negocios con reseñas recientes: pide reseñas a tus clientes de esta semana.",
      stats.last30 > 0
        ? `You got ${stats.last30} ${stats.last30 === 1 ? "review" : "reviews"} in the last 30 days.`
        : stats.last90 > 0
          ? `You got no reviews in the last month (${stats.last90} in the last 3 months). Google favors businesses with recent reviews.`
          : "You got no reviews in the last 3 months. Google favors businesses with recent reviews: ask this week's customers for one.",
    );
    if (stats.count > 0 && stats.answeredPct !== null) {
      add(
        "answered",
        stats.answeredPct >= 90,
        "high",
        `Contestaste el ${stats.answeredPct} % de tus últimas ${stats.count} reseñas.${stats.unanswered ? ` Te faltan ${stats.unanswered}${stats.unansweredLow ? ` (${stats.unansweredLow} de 3 estrellas o menos)` : ""}: la IA te ayuda a escribirlas abajo.` : ""}`,
        `You replied to ${stats.answeredPct}% of your last ${stats.count} reviews.${stats.unanswered ? ` ${stats.unanswered} left${stats.unansweredLow ? ` (${stats.unansweredLow} with 3 stars or less)` : ""}: the AI helps you write them below.` : ""}`,
      );
    }
    if (stats.avgReplyDays !== null)
      add(
        "replyTime",
        stats.avgReplyDays <= 7,
        "low",
        `Tardas ${nf1(stats.avgReplyDays)} días en promedio en contestar.${stats.avgReplyDays <= 7 ? "" : " Intenta contestar en menos de una semana."}`,
        `You take ${nf1(stats.avgReplyDays)} days on average to reply.${stats.avgReplyDays <= 7 ? "" : " Try to reply within a week."}`,
      );
  }

  add(
    "attributes",
    profile.attributes.length >= 3,
    "low",
    profile.attributes.length
      ? `Tienes ${profile.attributes.length} atributos (como «cita en línea» o «accesible en silla de ruedas»).${profile.attributes.length >= 3 ? "" : " Agrega los que apliquen."}`
      : "No tienes atributos (como «cita en línea», «atención en español» o «accesible en silla de ruedas»). Agrega los que apliquen.",
    profile.attributes.length
      ? `You have ${profile.attributes.length} attributes (like “online appointments” or “wheelchair accessible”).${profile.attributes.length >= 3 ? "" : " Add the ones that apply."}`
      : "You have no attributes (like “online appointments”, “Spanish spoken” or “wheelchair accessible”). Add the ones that apply.",
  );

  const total = items.reduce((s, i) => s + i.weight, 0);
  const earned = items.filter((i) => i.ok).reduce((s, i) => s + i.weight, 0);
  return { checklist: items, score: total ? Math.round((earned / total) * 100) : 0 };
}

// ---------- Competidores (del mapa de calor) ----------

/** Los competidores con cid del último mapa de calor (sin el negocio), hasta 3. */
export function competitorTargets(report: Pick<MapReport, "competitors"> | null, ownCid: string, n = MAX_COMPETITORS): { title: string; cid: string }[] {
  const out: { title: string; cid: string }[] = [];
  for (const c of report?.competitors ?? []) {
    if (!c.cid || c.cid === ownCid || out.some((o) => o.cid === c.cid)) continue;
    out.push({ title: c.title, cid: c.cid });
    if (out.length >= n) break;
  }
  return out;
}

// ---------- Llamadas a DataForSEO ----------

type TaskFn = typeof dfsTask;
export type GbpApi = { task: TaskFn; sleep: (ms: number) => Promise<void>; now: () => number };
const defaultApi: GbpApi = { task: dfsTask, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now };

/** Dónde buscar: la zona principal del negocio o, si no hay, alrededor del negocio (radio de 5 km). */
function locationOf(place: Pick<MapPlace, "lat" | "lng">, zone?: Zone | null): Record<string, unknown> {
  return zone?.code ? { location_code: zone.code } : { location_coordinate: `${round(place.lat, 7)},${round(place.lng, 7)},5000` };
}

const notFound = () =>
  bi(
    "Google no devolvió tu perfil. Revisa que el negocio elegido en el mapa de calor sea el tuyo (o elígelo de nuevo).",
    "Google didn't return your profile. Check that the business picked in the heatmap is yours (or pick it again).",
  );

const INFO_PATH = "/business_data/google/my_business_info/live";

/** Un perfil de Google Maps (live, ~6 s, US$0.0054). */
export async function fetchProfile(
  place: Pick<MapPlace, "title" | "cid" | "placeId" | "lat" | "lng">,
  lang: "es" | "en",
  zone?: Zone | null,
  api: GbpApi = defaultApi,
): Promise<{ profile: GbpProfile; cost: number }> {
  const keyword = place.cid ? `cid:${place.cid}` : place.placeId ? `place_id:${place.placeId}` : place.title;
  const r = await api.task<BusinessInfoResult>("POST", INFO_PATH, { keyword, language_code: lang, ...locationOf(place, zone) }, 60_000);
  if (r.statusCode === 40102) throw notFound();
  if (r.statusCode !== 20000) throw dfsError(r.statusCode, r.statusMessage);
  const profile = parseProfile(r.result[0]);
  if (!profile) throw notFound();
  return { profile, cost: r.cost };
}

/** Los perfiles de los competidores (máximo 3 a la vez). Si uno falla queda con error; no hace fallar a los demás. */
export async function fetchCompetitorProfiles(
  targets: { title: string; cid: string }[],
  lang: "es" | "en",
  zone: Zone | null | undefined,
  place: Pick<MapPlace, "lat" | "lng">,
  api: GbpApi = defaultApi,
): Promise<{ competitors: GbpCompetitor[]; cost: number }> {
  let cost = 0;
  const competitors = await pool(targets.slice(0, MAX_COMPETITORS), MAX_COMPETITORS, async (t): Promise<GbpCompetitor> => {
    try {
      const r = await fetchProfile({ title: t.title, cid: t.cid, placeId: "", lat: place.lat, lng: place.lng }, lang, zone, api);
      cost += r.cost;
      return toCompetitor(r.profile);
    } catch (e) {
      return { title: t.title, cid: t.cid, category: "", additionalCategories: [], rating: null, reviews: null, totalPhotos: null, isClaimed: null, hasDescription: false, hasHours: false, error: biOf(e) };
    }
  });
  return { competitors, cost: round(cost, 4) };
}

/** La tarea de reseñas sigue en la cola de Google: se guarda su id para no pagar otra vez. */
export class ReviewsPendingError extends BiError {
  constructor(
    readonly taskId: string,
    readonly cost: number,
  ) {
    super(
      "Google todavía está juntando tus reseñas. Vuelve a presionar «Actualizar reseñas» en un minuto: no se cobra otra vez.",
      "Google is still gathering your reviews. Press “Update reviews” again in a minute: you won't be charged again.",
    );
  }
}

/** Cada cuánto se pregunta si ya están las reseñas, y cuánto se espera como máximo. */
export const REVIEWS_POLL_MS = 4_000;
export const REVIEWS_WAIT_MS = 120_000;
/** 40601 = "Task Handed", 40602 = "Task In Queue": la tarea todavía no termina. */
const PENDING_CODES = new Set([40601, 40602]);

/**
 * Las reseñas más nuevas (tarea en la cola prioritaria de DataForSEO; suele estar en 10-60 s).
 * `resumeTaskId` sigue esperando una tarea que ya se pagó. Si pasan ~120 s sin respuesta, lanza ReviewsPendingError.
 */
export async function fetchReviews(
  place: Pick<MapPlace, "title" | "cid" | "placeId" | "lat" | "lng">,
  lang: "es" | "en",
  zone: Zone | null | undefined,
  opts: { depth?: number; resumeTaskId?: string; waitMs?: number } = {},
  api: GbpApi = defaultApi,
): Promise<{ total: number | null; rating: number | null; reviews: GbpReview[]; cost: number; taskId: string }> {
  const start = api.now();
  let taskId = opts.resumeTaskId ?? "";
  let cost = 0;
  if (!taskId) {
    const target = place.cid ? { cid: place.cid } : place.placeId ? { place_id: place.placeId } : { keyword: place.title };
    const posted = await api.task("POST", "/business_data/google/reviews/task_post", {
      ...target,
      ...locationOf(place, zone),
      language_code: lang,
      depth: Math.max(10, Math.min(200, opts.depth ?? REVIEWS_DEPTH)),
      sort_by: "newest",
      priority: 2,
    });
    if (posted.statusCode !== 20100 && posted.statusCode !== 20000) throw dfsError(posted.statusCode, posted.statusMessage);
    if (!posted.id) throw bi("DataForSEO no devolvió el número de la tarea. Intenta de nuevo.", "DataForSEO didn't return the task id. Try again.");
    taskId = posted.id;
    cost = posted.cost;
  }
  const waitMs = opts.waitMs ?? REVIEWS_WAIT_MS;
  for (;;) {
    await api.sleep(REVIEWS_POLL_MS);
    const r = await api.task<ReviewsResult>("GET", `/business_data/google/reviews/task_get/${encodeURIComponent(taskId)}`, undefined, 30_000);
    if (r.statusCode === 20000) return { ...parseReviews(r.result[0]), cost: round(cost, 4), taskId };
    if (r.statusCode === 40102) return { total: 0, rating: null, reviews: [], cost: round(cost, 4), taskId };
    if (!PENDING_CODES.has(r.statusCode)) throw dfsError(r.statusCode, r.statusMessage);
    if (api.now() - start + REVIEWS_POLL_MS > waitMs) throw new ReviewsPendingError(taskId, round(cost, 4));
  }
}

/** Junta las respuestas que el dueño ya tenía escritas (o publicadas) con las reseñas nuevas. */
export function carryDrafts(next: GbpReview[], prev: GbpReview[]): GbpReview[] {
  const old = new Map(prev.map((r) => [r.id, r]));
  return next.map((r) => {
    const o = old.get(r.id);
    if (!o) return r;
    if (r.ownerAnswer) return o.postedAt ? { ...r, postedAt: o.postedAt } : r;
    // Publicada desde la app pero Google todavía no la muestra: se conserva.
    if (o.postedAt && o.ownerAnswer) return { ...r, ownerAnswer: o.ownerAnswer, ownerTimestamp: o.ownerTimestamp, postedAt: o.postedAt };
    return o.draft ? { ...r, draft: o.draft, ...(o.draftAt ? { draftAt: o.draftAt } : {}) } : r;
  });
}

// ---------- Lectura segura de lo guardado ----------

const readBi = (v: unknown) => {
  const o = obj(v);
  return o && typeof o.es === "string" ? { es: o.es, en: str(o.en) || o.es } : undefined;
};
const readDate = (v: unknown) => {
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(Date.parse(s)).toISOString() : "";
};

function readProfile(v: unknown): GbpProfile | null {
  const o = obj(v);
  if (!o) return null;
  const title = str(o.title).trim();
  if (!title) return null;
  const dist = Array.isArray(o.distribution) && o.distribution.length === 5 ? o.distribution.map((n) => Math.max(0, num(n) ?? 0)) : null;
  return {
    title: title.slice(0, 200),
    cid: str(o.cid),
    placeId: str(o.placeId),
    featureId: str(o.featureId),
    category: str(o.category),
    additionalCategories: strList(o.additionalCategories, 20),
    description: str(o.description).slice(0, 2000),
    address: str(o.address),
    phone: str(o.phone),
    url: str(o.url),
    domain: str(o.domain),
    rating: num(o.rating),
    reviews: num(o.reviews),
    distribution: dist,
    hasHours: o.hasHours === true,
    hoursDays: Math.max(0, Math.min(7, num(o.hoursDays) ?? 0)),
    status: str(o.status),
    totalPhotos: num(o.totalPhotos),
    mainImage: str(o.mainImage),
    logo: str(o.logo),
    isClaimed: typeof o.isClaimed === "boolean" ? o.isClaimed : null,
    attributes: strList(o.attributes, 100),
    topics: Array.isArray(o.topics)
      ? o.topics.flatMap((t) => {
          const x = obj(t);
          return x && str(x.term) && num(x.count) !== null ? [{ term: str(x.term), count: num(x.count) as number }] : [];
        })
      : [],
    lat: num(o.lat),
    lng: num(o.lng),
  };
}

function readCompetitor(v: unknown): GbpCompetitor | null {
  const o = obj(v);
  if (!o || !str(o.title).trim()) return null;
  const error = readBi(o.error);
  return {
    title: str(o.title).trim().slice(0, 200),
    cid: str(o.cid),
    category: str(o.category),
    additionalCategories: strList(o.additionalCategories, 20),
    rating: num(o.rating),
    reviews: num(o.reviews),
    totalPhotos: num(o.totalPhotos),
    isClaimed: typeof o.isClaimed === "boolean" ? o.isClaimed : null,
    hasDescription: o.hasDescription === true,
    hasHours: o.hasHours === true,
    ...(error ? { error } : {}),
  };
}

/** Lee un reporte de perfil guardado sin confiar en su forma. La lista y el puntaje se vuelven a calcular. null si no sirve. */
export function readGbpReport(json: unknown, stats: ReviewStats | null = null): GbpReport | null {
  const o = obj(json);
  if (!o) return null;
  const profile = readProfile(o.profile);
  if (!profile) return null;
  const competitors = Array.isArray(o.competitors) ? o.competitors.map(readCompetitor).filter((c): c is GbpCompetitor => c !== null).slice(0, MAX_COMPETITORS) : [];
  const { checklist, score } = profileChecklist(profile, competitors, stats);
  return { version: 1, profile, competitors, checklist, score, cost: num(o.cost) ?? 0, createdAt: readDate(o.createdAt) || new Date(0).toISOString() };
}

function readReview(v: unknown): GbpReview | null {
  const o = obj(v);
  if (!o) return null;
  const id = str(o.id).trim();
  if (!id) return null;
  const rating = num(o.rating);
  const draft = str(o.draft);
  const draftAt = readDate(o.draftAt);
  const postedAt = readDate(o.postedAt);
  return {
    id: id.slice(0, 300),
    name: str(o.name).slice(0, 120),
    profileUrl: str(o.profileUrl),
    localGuide: o.localGuide === true,
    rating: rating !== null && rating >= 1 && rating <= 5 ? rating : null,
    text: str(o.text).slice(0, 5000),
    originalText: str(o.originalText).slice(0, 5000),
    language: str(o.language).slice(0, 10),
    timestamp: readDate(o.timestamp),
    timeAgo: str(o.timeAgo).slice(0, 60),
    ownerAnswer: str(o.ownerAnswer).slice(0, 5000),
    ownerTimestamp: readDate(o.ownerTimestamp),
    url: str(o.url),
    images: strList(o.images, 4),
    ...(draft ? { draft: draft.slice(0, 5000) } : {}),
    ...(draftAt ? { draftAt } : {}),
    ...(postedAt ? { postedAt } : {}),
  };
}

/** Lee un reporte de reseñas guardado sin confiar en su forma. Los números se vuelven a calcular. null si no sirve. */
export function readReviewsReport(json: unknown): ReviewsReport | null {
  const o = obj(json);
  if (!o || !Array.isArray(o.reviews)) return null;
  const seen = new Set<string>();
  const reviews: GbpReview[] = [];
  for (const raw of o.reviews.slice(0, 500)) {
    const r = readReview(raw);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    reviews.push(r);
  }
  const createdAt = readDate(o.createdAt) || new Date(0).toISOString();
  const at = Date.parse(createdAt) > 0 ? new Date(createdAt) : new Date();
  return { version: 1, total: num(o.total), rating: num(o.rating), reviews, stats: reviewStats(reviews, at), cost: num(o.cost) ?? 0, createdAt };
}

/** Lee la tarea de reseñas que quedó esperando (para no pagar dos veces). null si no hay o ya es muy vieja. */
export function readPendingTask(json: unknown, now = Date.now()): { taskId: string; cost: number } | null {
  const o = obj(json);
  const taskId = str(o?.taskId).trim();
  const at = Date.parse(str(o?.createdAt));
  // DataForSEO guarda las tareas 30 días; después de 30 minutos ya conviene pedir reseñas nuevas.
  if (!taskId || Number.isNaN(at) || now - at > 30 * 60_000) return null;
  return { taskId, cost: num(o?.cost) ?? 0 };
}

// ---------- Contestar en Google (solo con la conexión "google" y la API aprobada) ----------

/** Una reseña como la devuelve la API de Google (v4 accounts.locations.reviews). */
export type V4Review = {
  name?: string;
  reviewId?: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean } | null;
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string } | null;
};
const STAR: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/**
 * Encuentra en la lista de la API de Google la misma reseña que trajo DataForSEO. El review_id público de Google Maps
 * no siempre es el reviewId de la API, así que: 1) mismo id; si no, 2) mismo nombre + mismas estrellas + fecha
 * cercana (±3 días). Si quedan varias, la de fecha más cercana (si es la única a menos de 1 día) o la que tenga el
 * mismo comienzo del texto. null si no hay una sola segura.
 */
export function matchGoogleReview(review: Pick<GbpReview, "id" | "name" | "rating" | "timestamp" | "text" | "originalText">, list: V4Review[]): V4Review | null {
  const byId = list.find((g) => !!review.id && (g.reviewId === review.id || (g.name ?? "").endsWith(`/reviews/${review.id}`)));
  if (byId) return byId;
  const name = normalizeName(review.name);
  if (!name) return null;
  const at = review.timestamp ? Date.parse(review.timestamp) : NaN;
  const candidates = list.filter((g) => {
    if (normalizeName(g.reviewer?.displayName ?? "") !== name) return false;
    if (review.rating !== null && STAR[g.starRating ?? ""] !== review.rating) return false;
    if (Number.isNaN(at)) return true;
    const t = Date.parse(g.createTime ?? "");
    return !Number.isNaN(t) && Math.abs(t - at) <= 3 * DAY_MS;
  });
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return null;
  const head = norm(review.originalText || review.text).slice(0, 40);
  if (head) {
    const sameText = candidates.filter((g) => norm(g.comment ?? "").includes(head));
    if (sameText.length === 1) return sameText[0];
  }
  if (!Number.isNaN(at)) {
    const close = candidates.filter((g) => Math.abs(Date.parse(g.createTime ?? "") - at) <= DAY_MS);
    if (close.length === 1) return close[0];
  }
  return null;
}

/** Google todavía no aprobó el acceso de la app a la API del Perfil de Negocio. */
export const notApproved = () =>
  bi(
    "Google todavía no aprobó el acceso de la app a tu Perfil de Negocio; copia la respuesta y pégala en Google.",
    "Google hasn't approved the app's access to your Business Profile yet; copy the reply and paste it on Google.",
  );

/** Convierte el error de la API de Google en un mensaje claro en los dos idiomas. */
export function googleReplyError(e: unknown): BiError {
  if (e instanceof BiError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  const status = Number(/^(\d{3}):/.exec(msg)?.[1] ?? 0);
  if (/invalid_grant|expired or revoked|invalid_client|unauthorized_client/i.test(msg) || status === 401)
    return bi(
      "Google ya no acepta la conexión de tu Perfil de Negocio. Vuelve a conectarlo en Conexiones; mientras tanto, copia la respuesta y pégala en Google.",
      "Google no longer accepts your Business Profile connection. Reconnect it in Connections; meanwhile, copy the reply and paste it on Google.",
    );
  if (status === 403 || status === 429 || /PERMISSION_DENIED|RESOURCE_EXHAUSTED|quota|has not been used|is disabled|not been enabled|SERVICE_DISABLED/i.test(msg)) return notApproved();
  if (status === 404)
    return bi(
      "Google no encontró esa reseña (quizás la borraron). Actualiza tus reseñas o copia la respuesta y pégala en Google.",
      "Google couldn't find that review (maybe it was deleted). Update your reviews or copy the reply and paste it on Google.",
    );
  return bi(`Google respondió: ${msg.slice(0, 200)}. Copia la respuesta y pégala en Google.`, `Google responded: ${msg.slice(0, 200)}. Copy the reply and paste it on Google.`);
}

export type ReplyDeps = { token: (creds: Record<string, string>) => Promise<string>; fetch: typeof fetchJson };
const replyDeps: ReplyDeps = { token: googleAccessToken, fetch: fetchJson };

/**
 * Publica la respuesta en Google: busca la reseña en la API (hasta 3 páginas de 50, las más nuevas primero),
 * la empareja con matchGoogleReview y hace PUT .../reviews/{id}/reply con { comment }.
 */
export async function postGoogleReply(creds: Record<string, string>, review: GbpReview, comment: string, deps: ReplyDeps = replyDeps): Promise<void> {
  try {
    if (!creds.accountId?.trim() || !creds.locationId?.trim() || !creds.refreshToken?.trim())
      throw bi("La conexión de Google está incompleta. Vuelve a conectarla en Conexiones.", "The Google connection is incomplete. Reconnect it in Connections.");
    const token = await deps.token(creds);
    const base = `https://mybusiness.googleapis.com/v4/accounts/${stripGoogleId(creds.accountId, "accounts")}/locations/${stripGoogleId(creds.locationId, "locations")}`;
    const auth = { Authorization: `Bearer ${token}` };
    let match: V4Review | null = null;
    let pageToken = "";
    for (let page = 0; page < 3 && !match; page++) {
      const q = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc", ...(pageToken ? { pageToken } : {}) });
      const r = await deps.fetch<{ reviews?: V4Review[]; nextPageToken?: string }>(`${base}/reviews?${q}`, { headers: auth });
      match = matchGoogleReview(review, r.reviews ?? []);
      pageToken = r.nextPageToken ?? "";
      if (!pageToken) break;
    }
    if (!match)
      throw bi(
        "No pudimos encontrar esta reseña en tu Perfil de Negocio para contestarla desde aquí. Copia la respuesta y pégala en Google.",
        "We couldn't find this review in your Business Profile to reply from here. Copy the reply and paste it on Google.",
      );
    const name = match.name || `${base.replace("https://mybusiness.googleapis.com/v4/", "")}/reviews/${match.reviewId}`;
    await deps.fetch(`https://mybusiness.googleapis.com/v4/${name}/reply`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
  } catch (e) {
    throw googleReplyError(e);
  }
}

/** Las credenciales de la conexión "google" si sirven para contestar (cuenta, ubicación y permiso). null si no hay. */
export async function googleReplyCreds(businessId: string): Promise<Record<string, string> | null> {
  const conn = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel: "google" } }, select: { secret: true } });
  if (!conn) return null;
  try {
    const c = decryptJson(conn.secret);
    return c.accountId?.trim() && c.locationId?.trim() && c.refreshToken?.trim() ? c : null;
  } catch {
    return null;
  }
}
