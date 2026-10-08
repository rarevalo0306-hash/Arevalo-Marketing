// Google Analytics 4 («Visitas a tu página»): visitas reales de la página web del negocio, de dónde llegan, por qué
// páginas entran y cuántas acciones importantes (llamadas, formularios) hacen. Gratis, solo lectura.
// Lee Google con fetch (Admin API para elegir la propiedad, Data API runReport para los datos) y guarda el reporte
// como SeoReport kind "ga4". La forma del reporte y cómo se leen las respuestas: src/lib/ga4-shape.ts.
import { decryptJson, encryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import {
  CUR,
  GA4_CHANNEL,
  ga4Ranges,
  needsRefresh,
  ORGANIC,
  parseAccountSummaries,
  parseCompared,
  parseDataStreams,
  parseKeyEvents,
  parseKeyEventsList,
  parseLanding,
  parsePlaces,
  parseRunReport,
  parseTotals,
  parseTrend,
  PREV,
  readGa4Report,
  TOTAL_METRICS,
  type AccountSummariesResponse,
  type DataStreamsResponse,
  type Ga4Property,
  type Ga4Range,
  type Ga4Report,
  type Ga4Secret,
  type KeyEventsResponse,
  type ParsedRow,
  type RunReportResponse,
} from "@/lib/ga4-shape";
import { googleAccess } from "@/lib/google-oauth";
import { bi, errorText } from "@/lib/i18n";
import { fetchJson } from "@/lib/publishers/http";
import { latestReports, saveReport } from "@/lib/seo/reports";

export { GA4_CHANNEL } from "@/lib/ga4-shape";

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";
/** Flujos web que se leen para sugerir la propiedad (una consulta por propiedad). */
const STREAMS_MAX = 25;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// ---------- Propiedades ----------

/** Todas las propiedades de GA4 que la cuenta puede ver, con la dirección de sus flujos web (para sugerir una). */
export async function listGa4Properties(accessToken: string): Promise<Ga4Property[]> {
  const props: Ga4Property[] = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ pageSize: "200" });
    if (pageToken) q.set("pageToken", pageToken);
    const r = await fetchJson<AccountSummariesResponse>(`${ADMIN}/accountSummaries?${q}`, { headers: auth(accessToken) });
    props.push(...parseAccountSummaries(r).filter((p) => !props.some((x) => x.id === p.id)));
    pageToken = r.nextPageToken ?? "";
    if (!pageToken) break;
  }
  await Promise.all(
    props.slice(0, STREAMS_MAX).map(async (p) => {
      try {
        p.urls = parseDataStreams(await fetchJson<DataStreamsResponse>(`${ADMIN}/properties/${p.id}/dataStreams?pageSize=50`, { headers: auth(accessToken) }));
      } catch {
        p.urls = []; // sin la dirección solo no se puede sugerir; se puede elegir igual
      }
    }),
  );
  return props;
}

// ---------- La conexión guardada ----------

export async function readGa4Connection(businessId: string): Promise<{ secret: Ga4Secret; label: string } | null> {
  const conn = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel: GA4_CHANNEL } } });
  if (!conn) return null;
  try {
    const secret = decryptJson<Ga4Secret>(conn.secret);
    return { secret: { ...secret, properties: Array.isArray(secret.properties) ? secret.properties : [] }, label: conn.label };
  } catch {
    return { secret: { refreshToken: "", properties: [] }, label: conn.label };
  }
}

export async function writeGa4Connection(businessId: string, secret: Ga4Secret) {
  const data = { secret: encryptJson(secret), label: secret.propertyId ? secret.propertyName || secret.propertyId : "" };
  await db.connection.upsert({
    where: { businessId_channel: { businessId, channel: GA4_CHANNEL } },
    create: { businessId, channel: GA4_CHANNEL, ...data },
    update: data,
  });
}

// ---------- Datos (runReport) ----------

type Body = Record<string, unknown>;

async function runReport(token: string, propertyId: string, body: Body): Promise<{ rows: ParsedRow[]; timeZone: string }> {
  const r = await fetchJson<RunReportResponse>(`${DATA}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { rows: parseRunReport(r), timeZone: r.metadata?.timeZone ?? "" };
}

const both = (range: Ga4Range, prev: Ga4Range) => [
  { startDate: range.start, endDate: range.end, name: CUR },
  { startDate: prev.start, endDate: prev.end, name: PREV },
];
const only = (range: Ga4Range) => [{ startDate: range.start, endDate: range.end, name: CUR }];
const metrics = (...names: string[]) => names.map((name) => ({ name }));
const dims = (...names: string[]) => names.map((name) => ({ name }));
const bySessions = [{ metric: { metricName: "sessions" }, desc: true }];

/** Arma el reporte completo de la propiedad elegida: los últimos 28 días contra los 28 anteriores. */
export async function ga4Report(secret: Ga4Secret, now = new Date()): Promise<Ga4Report> {
  if (!secret.refreshToken) throw bi("No se pudo leer la conexión con Google Analytics. Vuelve a conectarla.", "Couldn't read the Google Analytics connection. Please connect it again.");
  const propertyId = secret.propertyId ?? "";
  if (!propertyId) throw bi("Primero elige la propiedad de Google Analytics de este negocio.", "First pick this business's Google Analytics property.");
  const token = await googleAccess(secret.refreshToken);
  const { range, previousRange } = ga4Ranges(now);
  const [totals, channels, landing, cities, countries, devices, events, trend, configured] = await Promise.all([
    runReport(token, propertyId, { dateRanges: both(range, previousRange), metrics: metrics(...TOTAL_METRICS) }),
    runReport(token, propertyId, {
      dateRanges: both(range, previousRange),
      dimensions: dims("sessionDefaultChannelGroup"),
      metrics: metrics("sessions", "engagedSessions", "keyEvents"),
      limit: 50,
    }),
    runReport(token, propertyId, {
      dateRanges: only(range),
      dimensions: dims("landingPagePlusQueryString"),
      metrics: metrics("sessions", "engagementRate", "keyEvents", "userEngagementDuration"),
      orderBys: bySessions,
      limit: 25,
    }),
    runReport(token, propertyId, { dateRanges: only(range), dimensions: dims("city", "country"), metrics: metrics("sessions"), orderBys: bySessions, limit: 10 }),
    runReport(token, propertyId, { dateRanges: only(range), dimensions: dims("country"), metrics: metrics("sessions"), orderBys: bySessions, limit: 8 }),
    runReport(token, propertyId, { dateRanges: both(range, previousRange), dimensions: dims("deviceCategory"), metrics: metrics("sessions", "engagedSessions", "keyEvents") }),
    runReport(token, propertyId, {
      dateRanges: both(range, previousRange),
      dimensions: dims("eventName"),
      metrics: metrics("keyEvents"),
      metricFilter: { filter: { fieldName: "keyEvents", numericFilter: { operation: "GREATER_THAN", value: { int64Value: "0" } } } },
      limit: 50,
    }),
    runReport(token, propertyId, {
      dateRanges: only(range),
      dimensions: dims("date"),
      metrics: metrics("sessions"),
      dimensionFilter: { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: ORGANIC } } },
      limit: 100,
    }),
    // Qué acciones importantes tiene configuradas (si falla, el reporte sale igual).
    fetchJson<KeyEventsResponse>(`${ADMIN}/properties/${propertyId}/keyEvents?pageSize=200`, { headers: auth(token) })
      .then(parseKeyEventsList)
      .catch(() => null),
  ]);
  const t = parseTotals(totals.rows);
  return {
    version: 1,
    propertyId,
    propertyName: secret.propertyName ?? "",
    fetchedAt: now.toISOString(),
    timeZone: totals.timeZone,
    range,
    previousRange,
    totals: t.totals,
    previous: t.previous,
    channels: parseCompared(channels.rows, "sessionDefaultChannelGroup", 12),
    landingPages: parseLanding(landing.rows, 15),
    cities: parsePlaces(cities.rows, "city", 8),
    countries: parsePlaces(countries.rows, "country", 6),
    devices: parseCompared(devices.rows, "deviceCategory", 5),
    keyEvents: parseKeyEvents(events.rows, 10),
    keyEventsConfigured: configured,
    organicTrend: parseTrend(trend.rows, range),
  };
}

/** El último reporte guardado de la propiedad conectada (los de otra propiedad no cuentan). */
export async function latestGa4Report(businessId: string, propertyId: string): Promise<{ report: Ga4Report; at: Date } | null> {
  const rows = await latestReports(businessId, "ga4", 3);
  for (const r of rows) {
    const report = readGa4Report(r.data);
    if (report && (!report.propertyId || report.propertyId === propertyId)) return { report, at: r.createdAt };
  }
  return null;
}

/** Trae y guarda el reporte. Si falla, guarda el motivo en la conexión (para no reintentar en cada visita). */
export async function refreshGa4(businessId: string, opts: { auto?: boolean; now?: Date } = {}): Promise<{ ok: true; report: Ga4Report } | { ok: false; error: unknown; skipped?: boolean; attempted?: boolean }> {
  const now = opts.now ?? new Date();
  const conn = await readGa4Connection(businessId);
  if (!conn) return { ok: false, error: bi("Primero conecta Google Analytics.", "Connect Google Analytics first.") };
  if (!conn.secret.propertyId) return { ok: false, error: bi("Primero elige la propiedad de Google Analytics de este negocio.", "First pick this business's Google Analytics property.") };
  if (opts.auto) {
    const last = await latestGa4Report(businessId, conn.secret.propertyId);
    if (!needsRefresh({ fetchedAt: last?.report.fetchedAt ?? null, lastTryAt: conn.secret.lastTryAt, now })) return { ok: false, error: null, skipped: true };
  }
  try {
    const report = await ga4Report(conn.secret, now);
    await saveReport(businessId, "ga4", report);
    if (conn.secret.lastError || conn.secret.lastTryAt) await writeGa4Connection(businessId, { ...conn.secret, lastError: undefined, lastTryAt: undefined });
    return { ok: true, report };
  } catch (e) {
    await writeGa4Connection(businessId, { ...conn.secret, lastTryAt: now.toISOString(), lastError: errorText(e, "es").slice(0, 400) }).catch(() => undefined);
    return { ok: false, error: e, attempted: true };
  }
}
