// Resultados de cada publicación (PostMetric): cuándo se leen, cómo se piden a cada red y cómo se leen sus respuestas.
// PURO: sin red ni base de datos (se prueba en tests/post-metrics.test.ts). Quien llama a las redes y guarda es
// src/lib/post-metrics.ts (syncPostMetrics).
//
// Qué red da qué (revisado en octubre de 2026 con la documentación oficial):
// - Facebook (Graph API, token de la página): los totales del post (reacciones, comentarios, veces compartido) con el
//   permiso pages_read_engagement, que la conexión ya tiene. Las estadísticas (vistas, personas alcanzadas, clics) salen
//   de /{post-id}/insights y piden ADEMÁS read_insights. post_impressions y post_impressions_unique ya no existen
//   después de la v25: se usan post_media_view (vistas) y post_total_media_view_unique (personas), más post_clicks.
//   Los videos (id sin "_") se leen con /{video-id}/video_insights (total_video_views, total_video_impressions…).
// - Instagram (Graph API con Facebook Login): like_count y comments_count con instagram_basic (ya está); las
//   estadísticas (reach, views, shares, saved, total_interactions) de /{media-id}/insights piden instagram_manage_insights.
//   «impressions» quedó obsoleta para lo publicado después de julio de 2024: se usa «views».
// - YouTube (Data API v3): videos.list?part=statistics (viewCount, likeCount, commentCount), 1 unidad de cuota por
//   pedido de hasta 50 videos, con el permiso youtube.readonly (lo pide «Conectar con Google» para YouTube).
// - X (API v2): GET /2/tweets?ids=…&tweet.fields=public_metrics. X COBRA cada publicación leída (pay-per-use,
//   ~US$0,005 cada una): solo se lee si el dueño lo enciende con X_METRICS=on (nunca se gasta sin permiso).
// - LinkedIn: las estadísticas piden r_member_postAnalytics u r_organization_social, que el token hecho a mano
//   (openid, profile, w_member_social) no tiene: se salta.
// - Perfil de Google: Google quitó las vistas y clics de las novedades de la API (febrero de 2023): se salta.
// - TikTok: la app solo tiene video.publish y guarda el publish_id (no el id del video); leer videos pide video.list:
//   se salta.

export const METRIC_KEYS = ["impressions", "reach", "likes", "comments", "shares", "saves", "clicks", "videoViews"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type MetricValues = Record<MetricKey, number>;

export const emptyValues = (): MetricValues => ({ impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, videoViews: 0 });

/** Lo que salió de leer una publicación. ok=false: no se pudo leer nada (el motivo va en raw.error). */
export type FetchOutcome =
  | { ok: true; values: MetricValues; raw: Record<string, unknown> }
  | { ok: false; error: string; raw?: Record<string, unknown>; rateLimited?: boolean };

/** Redes cuyos resultados se leen. X solo si X_METRICS=on (cobra por lectura). */
export function metricChannels(env: Record<string, string | undefined> = process.env): string[] {
  return ["facebook", "instagram", "youtube", ...(env.X_METRICS === "on" ? ["x"] : [])];
}

/** Por qué no hay resultados de una red (para explicarlo en pantalla). */
export const SKIPPED_CHANNELS: Record<string, { es: string; en: string }> = {
  linkedin: {
    es: "LinkedIn no deja leer los resultados con la conexión actual (pide un permiso especial que LinkedIn da solo a apps aprobadas).",
    en: "LinkedIn doesn't let the current connection read results (it needs a special permission LinkedIn only gives approved apps).",
  },
  google: {
    es: "Google ya no da las vistas de las novedades de tu Perfil de Google a las apps; míralas en tu perfil.",
    en: "Google no longer gives apps the views of your Google Profile updates; check them on your profile.",
  },
  tiktok: {
    es: "TikTok todavía no deja leer los resultados desde la app (falta un permiso de TikTok).",
    en: "TikTok doesn't let the app read results yet (a TikTok permission is missing).",
  },
  x: {
    es: "X cobra cada lectura de resultados, así que está apagado. Se enciende con X_METRICS=on.",
    en: "X charges for each results read, so it's off. Turn it on with X_METRICS=on.",
  },
  email: { es: "Los emails no tienen resultados por publicación aquí.", en: "Emails have no per-post results here." },
  sms: { es: "Los mensajes de texto no tienen resultados por publicación.", en: "Text messages have no per-post results." },
  seo: { es: "Los artículos de tu web se miden en «Visitas a tu página» (Google Analytics).", en: "Website articles are measured in “Visits to your site” (Google Analytics)." },
};

// ---------- Cuándo se leen ----------

const H = 3_600_000;
/** Se leen 1 h, 24 h, 72 h, 7 días y 30 días después de publicar. */
export const CHECKPOINTS_MS = [1 * H, 24 * H, 72 * H, 7 * 24 * H, 30 * 24 * H] as const;
/** Después de los 30 días (más 2 de gracia por si el cron no corrió) ya no se lee más. */
export const MAX_AGE_MS = 32 * 24 * H;

/**
 * ¿Toca leer esta publicación ahora? Devuelve el punto de control que toca (0 = 1 h … 4 = 30 días) o null.
 * Toca cuando ya pasó un punto de control y la última lectura (buena o con error) fue antes de ese punto.
 */
export function dueCheckpoint(sentAt: Date, lastFetchedAt: Date | null, now: Date): number | null {
  const age = now.getTime() - sentAt.getTime();
  if (age < CHECKPOINTS_MS[0] || age > MAX_AGE_MS) return null;
  let idx = -1;
  for (let i = 0; i < CHECKPOINTS_MS.length; i++) if (age >= CHECKPOINTS_MS[i]) idx = i;
  if (idx < 0) return null;
  const mark = sentAt.getTime() + CHECKPOINTS_MS[idx];
  if (lastFetchedAt && lastFetchedAt.getTime() >= mark) return null;
  return idx;
}

// ---------- El id de la red ----------

/**
 * El id de la publicación en la red a partir del enlace guardado (para las publicaciones de antes, sin externalId).
 * Facebook: solo los enlaces que arma la app (facebook.com/<id>). Instagram: el enlace (permalink) lleva un código
 * corto que NO es el id de la API, así que no se puede. Perfil de Google y TikTok: el enlace no lleva el id.
 */
export function externalIdFromUrl(channel: string, url: string): string {
  const u = url.trim();
  if (!u) return "";
  let m: RegExpMatchArray | null;
  switch (channel) {
    case "facebook":
      m = u.match(/^https:\/\/(?:www\.)?facebook\.com\/(\d+(?:_\d+)?)\/?$/);
      return m ? m[1] : "";
    case "youtube":
      m = u.match(/(?:youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/watch\?(?:.*&)?v=)([\w-]{6,20})/);
      return m ? m[1] : "";
    case "x":
      m = u.match(/(?:x|twitter)\.com\/(?:i\/web|[\w]+)\/status\/(\d+)/);
      return m ? m[1] : "";
    case "linkedin":
      m = u.match(/linkedin\.com\/feed\/update\/(urn:li:(?:share|ugcPost|activity):\d+)/);
      return m ? m[1] : "";
    default:
      return "";
  }
}

// ---------- Pedidos (sin mandarlos) ----------

/** Versión de la Graph API para leer resultados (post_media_view existe en las versiones actuales). */
export const METRICS_GRAPH = "https://graph.facebook.com/v24.0";
export const YT_API = "https://www.googleapis.com/youtube/v3";
export const X_API = "https://api.x.com";

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

/** Facebook: los totales del post (reacciones, comentarios, compartidos). Solo pages_read_engagement. */
export function fbPostFieldsUrl(postId: string, token: string): string {
  return `${METRICS_GRAPH}/${encodeURIComponent(postId)}?${q({ fields: "shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)", access_token: token })}`;
}
/** Facebook: estadísticas del post (vistas, personas, clics). Pide read_insights. */
export const FB_POST_METRICS = ["post_media_view", "post_total_media_view_unique", "post_clicks"] as const;
export function fbPostInsightsUrl(postId: string, token: string): string {
  return `${METRICS_GRAPH}/${encodeURIComponent(postId)}/insights?${q({ metric: FB_POST_METRICS.join(","), access_token: token })}`;
}
/** Facebook (video): me gusta y comentarios del video. */
export function fbVideoFieldsUrl(videoId: string, token: string): string {
  return `${METRICS_GRAPH}/${encodeURIComponent(videoId)}?${q({ fields: "comments.summary(true).limit(0),likes.summary(true).limit(0)", access_token: token })}`;
}
export const FB_VIDEO_METRICS = ["total_video_views", "total_video_impressions", "total_video_impressions_unique"] as const;
export function fbVideoInsightsUrl(videoId: string, token: string): string {
  return `${METRICS_GRAPH}/${encodeURIComponent(videoId)}/video_insights?${q({ metric: FB_VIDEO_METRICS.join(","), access_token: token })}`;
}

/** Instagram: me gusta, comentarios y tipo (instagram_basic). */
export function igFieldsUrl(mediaId: string, token: string): string {
  return `${METRICS_GRAPH}/${encodeURIComponent(mediaId)}?${q({ fields: "like_count,comments_count,media_type,media_product_type", access_token: token })}`;
}
/** Las estadísticas que se piden según el tipo (las historias no tienen likes/saved; los reels no tienen follows). */
export function igMetricsFor(productType: string): string[] {
  if (productType === "STORY") return ["reach", "views", "shares", "replies"];
  return ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions"];
}
export function igInsightsUrl(mediaId: string, token: string, productType: string): string {
  return `${METRICS_GRAPH}/${encodeURIComponent(mediaId)}/insights?${q({ metric: igMetricsFor(productType).join(","), access_token: token })}`;
}

/** YouTube: estadísticas de hasta 50 videos en un pedido. */
export function ytStatsUrl(ids: string[]): string {
  return `${YT_API}/videos?${q({ part: "statistics", id: ids.slice(0, 50).join(","), maxResults: "50" })}`;
}

/** X: métricas públicas de hasta 100 publicaciones en un pedido (X cobra cada una leída). */
export function xMetricsUrl(ids: string[]): string {
  return `${X_API}/2/tweets?${q({ ids: ids.slice(0, 100).join(","), "tweet.fields": "public_metrics" })}`;
}

// ---------- Leer las respuestas ----------

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Respuesta de /insights (Facebook o Instagram): { data: [{ name, values: [{ value }], total_value? }] } → { name: valor }. */
export function parseInsights(body: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const data = obj(body).data;
  if (!Array.isArray(data)) return out;
  for (const raw of data) {
    const m = obj(raw);
    const name = typeof m.name === "string" ? m.name : "";
    if (!name) continue;
    const total = obj(m.total_value).value;
    const values = Array.isArray(m.values) ? m.values : [];
    const last = values.length ? obj(values[values.length - 1]).value : undefined;
    // Algunas métricas devuelven un objeto por tipo ({ like: 3, love: 1 }): se suman.
    const v = total ?? last;
    out[name] = v && typeof v === "object" ? Object.values(v as Record<string, unknown>).reduce<number>((s, x) => s + num(x), 0) : num(v);
  }
  return out;
}

/** Facebook post: totales (fields) + estadísticas (insights, puede faltar si no hay read_insights). */
export function parseFacebookPost(fields: unknown, insights: Record<string, number> | null): MetricValues {
  const f = obj(fields);
  const v = emptyValues();
  v.likes = num(obj(obj(f.reactions).summary).total_count);
  v.comments = num(obj(obj(f.comments).summary).total_count);
  v.shares = num(obj(f.shares).count);
  if (insights) {
    v.impressions = insights.post_media_view ?? 0;
    v.reach = insights.post_total_media_view_unique ?? 0;
    v.clicks = insights.post_clicks ?? 0;
  }
  return v;
}

/** Facebook video: me gusta y comentarios + video_insights. */
export function parseFacebookVideo(fields: unknown, insights: Record<string, number> | null): MetricValues {
  const f = obj(fields);
  const v = emptyValues();
  v.likes = num(obj(obj(f.likes).summary).total_count);
  v.comments = num(obj(obj(f.comments).summary).total_count);
  if (insights) {
    v.videoViews = insights.total_video_views ?? 0;
    v.impressions = insights.total_video_impressions ?? 0;
    v.reach = insights.total_video_impressions_unique ?? 0;
  }
  return v;
}

/** Instagram: campos básicos + estadísticas (pueden faltar si no hay instagram_manage_insights). */
export function parseInstagram(fields: unknown, insights: Record<string, number> | null): MetricValues {
  const f = obj(fields);
  const v = emptyValues();
  v.likes = num(f.like_count);
  v.comments = num(f.comments_count);
  if (insights) {
    v.reach = insights.reach ?? 0;
    v.impressions = insights.views ?? 0;
    if (insights.likes !== undefined) v.likes = insights.likes;
    if (insights.comments !== undefined) v.comments = insights.comments;
    // En las historias, las respuestas cuentan como comentarios.
    if (insights.replies !== undefined && insights.comments === undefined) v.comments = insights.replies;
    v.shares = insights.shares ?? 0;
    v.saves = insights.saved ?? 0;
    const product = String(f.media_product_type ?? "");
    if (product === "REELS" || f.media_type === "VIDEO") v.videoViews = insights.views ?? 0;
  }
  return v;
}

/** YouTube videos.list → { id: valores }. */
export function parseYoutubeStats(body: unknown): Record<string, MetricValues> {
  const out: Record<string, MetricValues> = {};
  const items = obj(body).items;
  if (!Array.isArray(items)) return out;
  for (const raw of items) {
    const it = obj(raw);
    const id = typeof it.id === "string" ? it.id : "";
    if (!id) continue;
    const s = obj(it.statistics);
    const v = emptyValues();
    v.videoViews = num(s.viewCount);
    v.likes = num(s.likeCount);
    v.comments = num(s.commentCount);
    out[id] = v;
  }
  return out;
}

/** X /2/tweets → { id: valores }. impression_count = vistas. */
export function parseXMetrics(body: unknown): Record<string, MetricValues> {
  const out: Record<string, MetricValues> = {};
  const data = obj(body).data;
  if (!Array.isArray(data)) return out;
  for (const raw of data) {
    const t = obj(raw);
    const id = typeof t.id === "string" ? t.id : "";
    if (!id) continue;
    const m = obj(t.public_metrics);
    const v = emptyValues();
    v.impressions = num(m.impression_count);
    v.likes = num(m.like_count);
    v.comments = num(m.reply_count);
    v.shares = num(m.retweet_count) + num(m.quote_count);
    v.saves = num(m.bookmark_count);
    out[id] = v;
  }
  return out;
}

/** ¿El error es por pedir demasiado seguido? (Meta: códigos 4, 17, 32, 613; HTTP 429). Entonces se para esa red en esta vuelta. */
export function isRateLimit(message: string): boolean {
  return /^429\b/.test(message) || /\(#(4|17|32|613)\)/.test(message) || /rate limit|too many calls|request limit/i.test(message);
}

/** ¿El error es porque falta un permiso de estadísticas? (para explicarlo sin asustar). */
export function isMissingInsightsPermission(message: string): boolean {
  return /\(#10\)|\(#200\)|read_insights|instagram_manage_insights|permission|insufficient/i.test(message);
}

/** El error de la red en palabras claras (lo que se guarda en raw.error). */
export function plainMetricError(channel: string, message: string): string {
  const m = message.slice(0, 300);
  if (/^401\b|token|OAuthException|expired/i.test(m)) return `La conexión con ${channelLabel(channel)} venció o no deja leer resultados. Vuelve a conectarla. (${m})`;
  if (isRateLimit(m)) return `${channelLabel(channel)} pidió esperar un rato antes de leer más resultados. (${m})`;
  if (/^404\b|does not exist|not found|Unsupported get request/i.test(m)) return `${channelLabel(channel)} ya no encuentra esta publicación (¿se borró?). (${m})`;
  if (/^403\b|permission|insufficient/i.test(m)) return `A la conexión con ${channelLabel(channel)} le falta permiso para leer resultados. (${m})`;
  return `No se pudieron leer los resultados de ${channelLabel(channel)}. (${m})`;
}

function channelLabel(c: string): string {
  return ({ facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", x: "X", linkedin: "LinkedIn", google: "Google", tiktok: "TikTok" } as Record<string, string>)[c] ?? c;
}
