// Lee los resultados de cada publicación en las redes (alcance, me gusta, comentarios…) y guarda una fila PostMetric
// por canal y por lectura. Se leen 1 h, 24 h, 72 h, 7 días y 30 días después de publicar (ver dueCheckpoint en
// post-metrics-shape.ts, donde también está qué red da qué y por qué algunas se saltan).
//
// syncPostMetrics(now) lo llama el cron (lo conecta el agente DAILY en src/app/api/cron/route.ts con su propio try/catch).
// - Lote acotado (MAX_PER_RUN lecturas por vuelta); YouTube y X piden varias publicaciones juntas.
// - Nunca lanza un error: si una red falla, guarda una fila con raw.error (en palabras claras) y sigue con las demás.
//   Esa fila cuenta como la lectura de ese punto de control (así no se insiste cada minuto).
// - Si una red pide esperar (límite de pedidos), esa red se para en esta vuelta.
// - Solo LEE: no publica, no envía, no gasta (X solo con X_METRICS=on, porque X cobra cada lectura).
import type { Prisma } from "@prisma/client";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { oauthHeader } from "@/lib/publish-x";
import { fetchJson, form } from "@/lib/publishers/http";
import type { Creds } from "@/lib/publishers/types";
import {
  dueCheckpoint,
  externalIdFromUrl,
  fbPostFieldsUrl,
  fbPostInsightsUrl,
  fbVideoFieldsUrl,
  fbVideoInsightsUrl,
  igFieldsUrl,
  igInsightsUrl,
  isMissingInsightsPermission,
  isRateLimit,
  MAX_AGE_MS,
  metricChannels,
  parseFacebookPost,
  parseFacebookVideo,
  parseInsights,
  parseInstagram,
  parseXMetrics,
  parseYoutubeStats,
  plainMetricError,
  xMetricsUrl,
  ytStatsUrl,
  type FetchOutcome,
  type MetricValues,
} from "@/lib/post-metrics-shape";

/** Lecturas como máximo por vuelta del cron (cada una son 1-2 pedidos a la red). */
export const MAX_PER_RUN = 40;

export type MetricJob = { targetId: string; businessId: string; channel: string; externalId: string; checkpoint: number };

// ---------- Cada red ----------

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Facebook: totales del post y, si hay permiso, sus estadísticas. */
export async function fetchFacebook(externalId: string, creds: Creds): Promise<FetchOutcome> {
  const token = creds.accessToken?.trim() ?? "";
  if (!token) return { ok: false, error: plainMetricError("facebook", "token: falta el token de la página") };
  const isPost = externalId.includes("_");
  let fields: unknown;
  try {
    fields = await fetchJson(isPost ? fbPostFieldsUrl(externalId, token) : fbVideoFieldsUrl(externalId, token));
  } catch (e) {
    const m = errText(e);
    return { ok: false, error: plainMetricError("facebook", m), rateLimited: isRateLimit(m) };
  }
  let insights: Record<string, number> | null = null;
  const raw: Record<string, unknown> = { fields };
  try {
    const body = await fetchJson(isPost ? fbPostInsightsUrl(externalId, token) : fbVideoInsightsUrl(externalId, token));
    insights = parseInsights(body);
    raw.insights = insights;
  } catch (e) {
    const m = errText(e);
    raw.insightsError = isMissingInsightsPermission(m)
      ? "Falta el permiso read_insights: solo se leyeron reacciones, comentarios y compartidos."
      : plainMetricError("facebook", m);
  }
  return { ok: true, values: isPost ? parseFacebookPost(fields, insights) : parseFacebookVideo(fields, insights), raw };
}

/** Instagram: me gusta y comentarios y, si hay permiso, alcance, vistas, compartidos y guardados. */
export async function fetchInstagram(externalId: string, creds: Creds): Promise<FetchOutcome> {
  const token = creds.accessToken?.trim() ?? "";
  if (!token) return { ok: false, error: plainMetricError("instagram", "token: falta el token") };
  let fields: Record<string, unknown>;
  try {
    fields = await fetchJson(igFieldsUrl(externalId, token));
  } catch (e) {
    const m = errText(e);
    return { ok: false, error: plainMetricError("instagram", m), rateLimited: isRateLimit(m) };
  }
  let insights: Record<string, number> | null = null;
  const raw: Record<string, unknown> = { fields };
  try {
    insights = parseInsights(await fetchJson(igInsightsUrl(externalId, token, String(fields.media_product_type ?? ""))));
    raw.insights = insights;
  } catch (e) {
    const m = errText(e);
    raw.insightsError = isMissingInsightsPermission(m)
      ? "Falta el permiso instagram_manage_insights: solo se leyeron me gusta y comentarios."
      : plainMetricError("instagram", m);
  }
  return { ok: true, values: parseInstagram(fields, insights), raw };
}

/** Un access token de YouTube (igual que al publicar: la conexión o las claves de la app). */
async function youtubeToken(creds: Creds): Promise<string> {
  const clientId = creds.clientId?.trim() || process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = creds.clientSecret?.trim() || process.env.GOOGLE_CLIENT_SECRET || "";
  if (!clientId || !clientSecret || !creds.refreshToken?.trim()) throw new Error("token: faltan datos de la conexión de YouTube");
  const t = await fetchJson<{ access_token: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: form({ client_id: clientId, client_secret: clientSecret, refresh_token: creds.refreshToken, grant_type: "refresh_token" }),
  });
  return t.access_token;
}

/** YouTube: varias publicaciones en un solo pedido. Devuelve el resultado de cada id. */
export async function fetchYoutube(ids: string[], creds: Creds): Promise<Record<string, FetchOutcome>> {
  const out: Record<string, FetchOutcome> = {};
  const fail = (m: string) => {
    for (const id of ids) out[id] = { ok: false, error: plainMetricError("youtube", m), rateLimited: isRateLimit(m) };
    return out;
  };
  let body: unknown;
  try {
    const token = await youtubeToken(creds);
    body = await fetchJson(ytStatsUrl(ids), { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    const m = errText(e);
    // Conexiones de antes (solo permiso para subir): hay que volver a conectar para poder leer.
    return fail(/^403\b/.test(m) ? `403: falta el permiso youtube.readonly; vuelve a conectar YouTube. ${m}` : m);
  }
  const stats = parseYoutubeStats(body);
  for (const id of ids)
    out[id] = stats[id] ? { ok: true, values: stats[id], raw: { statistics: stats[id] } } : { ok: false, error: plainMetricError("youtube", "404: video no encontrado o todavía procesándose") };
  return out;
}

/** X: varias publicaciones en un pedido firmado (OAuth 1.0a). Solo con X_METRICS=on. */
export async function fetchX(ids: string[], creds: Creds): Promise<Record<string, FetchOutcome>> {
  const out: Record<string, FetchOutcome> = {};
  const url = xMetricsUrl(ids);
  let body: unknown;
  try {
    const keys = ["apiKey", "apiSecret", "accessToken", "accessSecret"];
    if (keys.some((k) => !creds[k]?.trim())) throw new Error("token: faltan claves de X");
    body = await fetchJson(url, { headers: { Authorization: oauthHeader("GET", url, creds) } });
  } catch (e) {
    const m = errText(e);
    for (const id of ids) out[id] = { ok: false, error: plainMetricError("x", m), rateLimited: isRateLimit(m) };
    return out;
  }
  const stats = parseXMetrics(body);
  for (const id of ids) out[id] = stats[id] ? { ok: true, values: stats[id], raw: { public_metrics: stats[id] } } : { ok: false, error: plainMetricError("x", "404: no encontrada") };
  return out;
}

// ---------- Qué toca leer ----------

/** Las publicaciones (por canal) a las que les toca una lectura ahora, hasta `limit`. */
export async function dueJobs(now: Date, limit = MAX_PER_RUN): Promise<MetricJob[]> {
  const channels = metricChannels();
  const targets = await db.postTarget.findMany({
    where: { status: "sent", channel: { in: channels }, sentAt: { gte: new Date(now.getTime() - MAX_AGE_MS), lte: now } },
    select: {
      id: true,
      channel: true,
      externalId: true,
      externalUrl: true,
      sentAt: true,
      post: { select: { businessId: true } },
      metrics: { orderBy: { fetchedAt: "desc" }, take: 1, select: { fetchedAt: true } },
    },
    orderBy: { sentAt: "desc" },
    take: 1000,
  });
  const jobs: MetricJob[] = [];
  for (const t of targets) {
    if (!t.sentAt) continue;
    const checkpoint = dueCheckpoint(t.sentAt, t.metrics[0]?.fetchedAt ?? null, now);
    if (checkpoint === null) continue;
    let externalId = t.externalId;
    if (!externalId) {
      // Publicaciones de antes: el id sale del enlace cuando se puede (y se guarda para la próxima).
      externalId = externalIdFromUrl(t.channel, t.externalUrl);
      if (!externalId) continue;
      await db.postTarget.update({ where: { id: t.id }, data: { externalId } }).catch(() => undefined);
    }
    jobs.push({ targetId: t.id, businessId: t.post.businessId, channel: t.channel, externalId, checkpoint });
  }
  // Primero los puntos de control tempranos (la primera hora importa para saber cómo arrancó).
  return jobs.sort((a, b) => a.checkpoint - b.checkpoint).slice(0, limit);
}

// ---------- La vuelta ----------

export type SyncSummary = { due: number; saved: number; errors: number; stoppedChannels: string[] };

/**
 * Lee los resultados que tocan y guarda una fila PostMetric por publicación y canal. Nunca lanza un error.
 * `fetchers` se puede reemplazar en las pruebas.
 */
export async function syncPostMetrics(now: Date = new Date(), fetchers = { fetchFacebook, fetchInstagram, fetchYoutube, fetchX }): Promise<SyncSummary> {
  const sum: SyncSummary = { due: 0, saved: 0, errors: 0, stoppedChannels: [] };
  let jobs: MetricJob[];
  try {
    jobs = await dueJobs(now);
  } catch (e) {
    console.error("syncPostMetrics: no se pudo leer qué toca", e);
    return sum;
  }
  sum.due = jobs.length;
  if (!jobs.length) return sum;

  // Credenciales por negocio y canal (descifradas una vez).
  const pairs = [...new Set(jobs.map((j) => `${j.businessId}|${j.channel}`))];
  const conns = await db.connection
    .findMany({ where: { OR: pairs.map((p) => ({ businessId: p.split("|")[0], channel: p.split("|")[1] })) }, select: { businessId: true, channel: true, secret: true } })
    .catch(() => []);
  const credsOf = (businessId: string, channel: string): Creds | null => {
    const c = conns.find((x) => x.businessId === businessId && x.channel === channel);
    if (!c) return null;
    try {
      return decryptJson<Creds>(c.secret);
    } catch {
      return null;
    }
  };

  const stopped = new Set<string>();
  const save = async (job: MetricJob, outcome: FetchOutcome) => {
    if (!outcome.ok && outcome.rateLimited) stopped.add(job.channel);
    const values: MetricValues | null = outcome.ok ? outcome.values : null;
    const raw = outcome.ok ? outcome.raw : { ...(outcome.raw ?? {}), error: outcome.error };
    try {
      await db.postMetric.create({
        data: {
          postTargetId: job.targetId,
          businessId: job.businessId,
          channel: job.channel,
          fetchedAt: now,
          ...(values ?? {}),
          raw: { ...raw, checkpoint: job.checkpoint } as Prisma.InputJsonValue,
        },
      });
      if (outcome.ok) sum.saved++;
      else sum.errors++;
    } catch (e) {
      sum.errors++;
      console.error("syncPostMetrics: no se pudo guardar", job.targetId, e);
    }
  };

  // Facebook e Instagram: una por una.
  for (const job of jobs.filter((j) => j.channel === "facebook" || j.channel === "instagram")) {
    if (stopped.has(job.channel)) continue;
    const creds = credsOf(job.businessId, job.channel);
    if (!creds) {
      await save(job, { ok: false, error: plainMetricError(job.channel, "token: la red ya no está conectada") });
      continue;
    }
    try {
      await save(job, job.channel === "facebook" ? await fetchers.fetchFacebook(job.externalId, creds) : await fetchers.fetchInstagram(job.externalId, creds));
    } catch (e) {
      await save(job, { ok: false, error: plainMetricError(job.channel, errText(e)) });
    }
  }

  // YouTube y X: juntas por negocio (un pedido por grupo).
  for (const channel of ["youtube", "x"] as const) {
    const byBiz = new Map<string, MetricJob[]>();
    for (const j of jobs.filter((x) => x.channel === channel)) byBiz.set(j.businessId, [...(byBiz.get(j.businessId) ?? []), j]);
    for (const [businessId, group] of byBiz) {
      if (stopped.has(channel)) break;
      const creds = credsOf(businessId, channel);
      let results: Record<string, FetchOutcome>;
      if (!creds) results = Object.fromEntries(group.map((j) => [j.externalId, { ok: false, error: plainMetricError(channel, "token: la red ya no está conectada") } as FetchOutcome]));
      else {
        try {
          results = await (channel === "youtube" ? fetchers.fetchYoutube : fetchers.fetchX)(
            group.map((j) => j.externalId),
            creds,
          );
        } catch (e) {
          results = Object.fromEntries(group.map((j) => [j.externalId, { ok: false, error: plainMetricError(channel, errText(e)) } as FetchOutcome]));
        }
      }
      for (const j of group) await save(j, results[j.externalId] ?? { ok: false, error: plainMetricError(channel, "sin respuesta") });
    }
  }

  sum.stoppedChannels = [...stopped];
  return sum;
}
