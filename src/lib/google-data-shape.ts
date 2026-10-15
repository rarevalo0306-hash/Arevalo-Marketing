// Datos de Google que guarda Matya: cuándo se revisa que cada conexión siga con permiso, cuándo se borra lo de una
// conexión a la que el dueño le quitó el acceso desde su cuenta de Google, cuánto se guardan los datos de YouTube y
// los reportes, y cómo se limpian los reportes que mezclan datos de Search Console o de respuestas a reseñas.
// PURO: sin red ni base de datos (se prueba en tests/google-data-shape.test.ts). Quien llama a Google y borra es
// src/lib/google-data.ts (cron) y src/lib/data-deletion.ts (purgeGoogleChannelData).
//
// El estado de la revisión va DENTRO del secreto cifrado de la conexión (Connection.secret), como lastTryAt en GA4:
// no hace falta cambiar la base. Las conexiones de antes (sin estos campos) cuentan como «toca revisar, con permiso».

const H = 3_600_000;
export const DAY_MS = 24 * H;

/** Cada conexión de Google se revisa (pidiendo un permiso nuevo) más o menos una vez al día. */
export const GOOGLE_CHECK_EVERY_MS = 20 * H;
/** Desde que Google dice que el permiso se quitó hasta que se borra: 3 días (dentro de los 7 que pide Google aunque falle un cron). */
export const GOOGLE_REVOKED_GRACE_MS = 3 * DAY_MS;
/** Los resultados de YouTube (PostMetric) se guardan 28 días: nunca pasan de 30 con un cron diario. */
export const YOUTUBE_KEEP_DAYS = 28;
/** El nombre del canal de YouTube se borra si no se pudo volver a leer en 30 días. */
export const YOUTUBE_LABEL_DAYS = 30;

/** Lo que se guarda en el secreto: última revisión, última que salió bien y desde cuándo Google dice que se quitó el permiso. */
export type GoogleHealth = { checkedAt?: string; okAt?: string; revokedAt?: string };

/** ¿Google dice que el permiso se quitó o venció? Solo invalid_grant: nunca invalid_client, unauthorized_client, 5xx ni red. */
export const isRevokedGrant = (msg: string) => /\binvalid_grant\b/i.test(msg);

const msOf = (iso: string | undefined) => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** ¿Toca revisar la conexión? Sí si nunca se revisó o la última revisión tiene más de 20 h. */
export function googleCheckDue(h: GoogleHealth, now: Date): boolean {
  const at = msOf(h.checkedAt);
  return at === null || now.getTime() - at >= GOOGLE_CHECK_EVERY_MS;
}

/** ¿Ya pasaron los 3 días desde que Google dijo que el permiso se quitó? Entonces se borra la conexión y sus datos. */
export function shouldPurgeRevoked(h: GoogleHealth, now: Date): boolean {
  const at = msOf(h.revokedAt);
  return at !== null && now.getTime() - at >= GOOGLE_REVOKED_GRACE_MS;
}

/** ¿El nombre del canal de YouTube ya tiene más de 30 días sin volver a leerse? (sin okAt cuenta la fecha de la conexión) */
export function youtubeLabelExpired(h: GoogleHealth, updatedAt: Date, now: Date): boolean {
  const at = msOf(h.okAt) ?? updatedAt.getTime();
  return now.getTime() - at > YOUTUBE_LABEL_DAYS * DAY_MS;
}

// ---------- Limpiar reportes que mezclan datos de Google ----------
// Editan el JSON TAL CUAL está guardado (no pasan por los lectores, que normalizan y botarían campos de filas viejas),
// tocan solo lo que vino de Google y devuelven null cuando no hay nada que cambiar (así esa fila no se reescribe).

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Revisión de páginas ("onpage"): las páginas cuya palabra clave salió de Search Console quedan como cuando el dueño
 * cambia la palabra (applyOverride en seo/onpage.ts): sin palabra, sin nota, ideas ni ganadores, y «volver a revisar».
 * Se conservan las palabras que eligió el dueño (overrides). Devuelve también las direcciones limpiadas (sus tareas
 * del plan "onpage:<url>:…" se borran).
 */
export function scrubOnPageGsc(data: unknown): { data: Json; urls: string[]; keywords: { url: string; keyword: string }[] } | null {
  if (!isObj(data) || !Array.isArray(data.pages)) return null;
  const urls: string[] = [];
  const keywords: { url: string; keyword: string }[] = [];
  let changed = false;
  const pages = data.pages.map((p) => {
    if (!isObj(p) || p.keywordSource !== "gsc") return p;
    changed = true;
    if (typeof p.url === "string") {
      urls.push(p.url);
      if (typeof p.keyword === "string" && p.keyword.trim()) keywords.push({ url: p.url, keyword: p.keyword.trim() });
    }
    const rest: Json = { ...p };
    for (const k of ["suggestion", "error", "skipped"]) delete rest[k];
    return {
      ...rest,
      keyword: null,
      keywordSource: null,
      score: null,
      ideas: [],
      winners: [],
      brief: null,
      needsRecheck: true,
      ...(isObj(p.stats) ? { stats: { ...p.stats, targetWords: null, position: null } } : {}),
    };
  });
  return changed ? { data: { ...data, pages }, urls, keywords } : null;
}

/** ¿Un reporte de temas ("clusters") agrupó búsquedas que salieron de Search Console? (se arma de nuevo con un clic). */
export function clustersUseGsc(data: unknown): boolean {
  if (!isObj(data) || !Array.isArray(data.clusters)) return false;
  return data.clusters.some((c) => isObj(c) && Array.isArray(c.keywords) && c.keywords.some((k) => isObj(k) && Array.isArray(k.sources) && k.sources.includes("gsc")));
}

/** Las búsquedas de Search Console de una revisión de páginas que compiten ("cannibal" con source "gsc"). */
export function gscCannibalQueries(data: unknown): string[] {
  if (!isObj(data) || data.source !== "gsc" || !Array.isArray(data.issues)) return [];
  return data.issues.flatMap((i) => (isObj(i) && i.source === "gsc" && typeof i.query === "string" && i.query.trim() ? [i.query] : []));
}

/** Propuesta de Ajustes SEO ("setup"): quita las palabras que salieron de Search Console. Se conservan las rechazadas y la huella. */
export function scrubSetupGsc(data: unknown): Json | null {
  if (!isObj(data) || !isObj(data.proposal) || !Array.isArray(data.proposal.keywords)) return null;
  const all = data.proposal.keywords;
  const keywords = all.filter((k) => !(isObj(k) && k.source === "search_console"));
  if (keywords.length === all.length) return null;
  return { ...data, proposal: { ...data.proposal, keywords } };
}

/**
 * Reseñas ("reviews", datos públicos de DataForSEO): solo quita la marca «publicada desde Matya» (postedAt). El texto de
 * la respuesta lo escribió el dueño (no viene de Google) y sigue publicado en Google, así que se queda.
 */
export function scrubPostedReplies(data: unknown): Json | null {
  if (!isObj(data) || !Array.isArray(data.reviews)) return null;
  let changed = false;
  const reviews = data.reviews.map((r) => {
    if (!isObj(r) || !("postedAt" in r)) return r;
    changed = true;
    const rest: Json = { ...r };
    delete rest.postedAt;
    return rest;
  });
  return changed ? { ...data, reviews } : null;
}

/**
 * Revocar en Google quita el permiso de TODAS las conexiones hechas con esa cuenta de Google (es un solo permiso por cuenta,
 * con include_granted_scopes), también las de otros negocios, y el cron las tomaría por «el dueño quitó el acceso» y las
 * borraría. Solo se revoca cuando se sabe de qué cuenta es la conexión y ninguna otra usa, o podría usar (cuenta
 * desconocida, conexiones de antes), la misma. Si no, Matya solo borra su copia y sus datos.
 */
export function canRevokeAlone(user: string | undefined | null, others: (string | undefined | null)[]): boolean {
  return !!user && others.every((o) => !!o && o !== user);
}

// ---------- Cuánto se guardan los reportes de Google ----------

/**
 * Se borra una fila solo si está fuera de las `keep` más nuevas de su negocio Y tiene más de `maxAgeDays`.
 * Solo reportes de Google: gsc (el PDF del mes necesita la fila de fin del mes pasado) y ga4 (latestGa4Report lee 3).
 */
export const SEO_RETENTION: Record<string, { keep: number; maxAgeDays: number }> = {
  gsc: { keep: 2, maxAgeDays: 45 },
  ga4: { keep: 3, maxAgeDays: 35 },
};
