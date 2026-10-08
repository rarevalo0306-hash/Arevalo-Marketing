// Google Analytics 4 («Visitas a tu página»): cómo se leen las respuestas de Google (accountSummaries, dataStreams,
// keyEvents, runReport), las comparaciones contra los 28 días anteriores, la propiedad que se elige sola o se sugiere,
// el propósito "ga4" en el permiso de Google y los errores en palabras claras.
import { beforeEach, describe, expect, it } from "vitest";
import {
  autoPick,
  compareCount,
  compareRate,
  explainGa4Error,
  ga4Ranges,
  hasKeyEventsSetUp,
  isLowEngagementPage,
  needsRefresh,
  orderForPicker,
  organicShare,
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
  readGa4Report,
  suggestProperty,
  type Ga4Property,
} from "@/lib/ga4-shape";
import { GA4_SCOPE, googleAuthUrl, googleStatePurpose } from "@/lib/google-oauth";
import { translator } from "@/lib/i18n";
import { readState } from "@/lib/meta-oauth";

// ---------- Respuestas reales de Google (forma tal como llegan) ----------

const accountSummaries = {
  accountSummaries: [
    {
      name: "accountSummaries/211111111",
      account: "accounts/211111111",
      displayName: "Fameseg",
      propertySummaries: [
        { property: "properties/312345678", displayName: "fameseg.com - GA4", propertyType: "PROPERTY_TYPE_ORDINARY", parent: "accounts/211111111" },
        { property: "properties/398765432", displayName: "Tienda (prueba)", propertyType: "PROPERTY_TYPE_SUBPROPERTY", parent: "accounts/211111111" },
      ],
    },
    {
      name: "accountSummaries/222222222",
      account: "accounts/222222222",
      displayName: "Ricardo PA",
      propertySummaries: [
        { property: "properties/355555555", displayName: "ricardopa.com", propertyType: "PROPERTY_TYPE_ORDINARY", parent: "accounts/222222222" },
        { property: "properties/312345678", displayName: "fameseg.com - GA4", propertyType: "PROPERTY_TYPE_ORDINARY", parent: "accounts/211111111" },
      ],
    },
    { name: "accountSummaries/233333333", account: "accounts/233333333", displayName: "Cuenta vacía" },
  ],
};

const dataStreams = {
  dataStreams: [
    {
      name: "properties/312345678/dataStreams/4455667788",
      type: "WEB_DATA_STREAM",
      displayName: "fameseg.com",
      webStreamData: { measurementId: "G-ABC123XYZ9", firebaseAppId: "", defaultUri: "https://www.fameseg.com" },
      createTime: "2024-02-01T15:00:00.000Z",
      updateTime: "2024-02-01T15:00:00.000Z",
    },
    { name: "properties/312345678/dataStreams/99", type: "ANDROID_APP_DATA_STREAM", displayName: "App", androidAppStreamData: { packageName: "com.fameseg" } },
  ],
};

/** Totales con dos rangos (dateRanges con nombre "cur" y "prev"): GA4 agrega la dimensión "dateRange". */
const totalsResponse = {
  dimensionHeaders: [{ name: "dateRange" }],
  metricHeaders: [
    { name: "totalUsers", type: "TYPE_INTEGER" },
    { name: "newUsers", type: "TYPE_INTEGER" },
    { name: "sessions", type: "TYPE_INTEGER" },
    { name: "engagedSessions", type: "TYPE_INTEGER" },
    { name: "engagementRate", type: "TYPE_FLOAT" },
    { name: "userEngagementDuration", type: "TYPE_SECONDS" },
    { name: "activeUsers", type: "TYPE_INTEGER" },
    { name: "keyEvents", type: "TYPE_FLOAT" },
    { name: "screenPageViews", type: "TYPE_INTEGER" },
  ],
  rows: [
    { dimensionValues: [{ value: "cur" }], metricValues: [{ value: "812" }, { value: "701" }, { value: "1034" }, { value: "566" }, { value: "0.5473887814313346" }, { value: "51240" }, { value: "780" }, { value: "37" }, { value: "2210" }] },
    { dimensionValues: [{ value: "prev" }], metricValues: [{ value: "640" }, { value: "560" }, { value: "820" }, { value: "410" }, { value: "0.5" }, { value: "36000" }, { value: "600" }, { value: "41" }, { value: "1800" }] },
  ],
  rowCount: 2,
  metadata: { currencyCode: "USD", timeZone: "America/Managua" },
  kind: "analyticsData#runReport",
};

const channelsResponse = {
  dimensionHeaders: [{ name: "sessionDefaultChannelGroup" }, { name: "dateRange" }],
  metricHeaders: [{ name: "sessions", type: "TYPE_INTEGER" }, { name: "engagedSessions", type: "TYPE_INTEGER" }, { name: "keyEvents", type: "TYPE_FLOAT" }],
  rows: [
    { dimensionValues: [{ value: "Direct" }, { value: "cur" }], metricValues: [{ value: "420" }, { value: "200" }, { value: "12" }] },
    { dimensionValues: [{ value: "Organic Search" }, { value: "cur" }], metricValues: [{ value: "380" }, { value: "250" }, { value: "18" }] },
    { dimensionValues: [{ value: "Organic Social" }, { value: "cur" }], metricValues: [{ value: "190" }, { value: "90" }, { value: "5" }] },
    { dimensionValues: [{ value: "Referral" }, { value: "cur" }], metricValues: [{ value: "44" }, { value: "26" }, { value: "2" }] },
    { dimensionValues: [{ value: "Direct" }, { value: "prev" }], metricValues: [{ value: "300" }, { value: "150" }, { value: "10" }] },
    { dimensionValues: [{ value: "Organic Search" }, { value: "prev" }], metricValues: [{ value: "400" }, { value: "200" }, { value: "25" }] },
    { dimensionValues: [{ value: "Paid Search" }, { value: "prev" }], metricValues: [{ value: "120" }, { value: "60" }, { value: "6" }] },
  ],
  rowCount: 7,
  metadata: { currencyCode: "USD", timeZone: "America/Managua" },
};

const landingResponse = {
  dimensionHeaders: [{ name: "landingPagePlusQueryString" }],
  metricHeaders: [{ name: "sessions" }, { name: "engagementRate" }, { name: "keyEvents" }, { name: "userEngagementDuration" }],
  rows: [
    { dimensionValues: [{ value: "/" }], metricValues: [{ value: "512" }, { value: "0.61" }, { value: "20" }, { value: "25600" }] },
    { dimensionValues: [{ value: "/cortinas-metalicas" }], metricValues: [{ value: "210" }, { value: "0.18" }, { value: "1" }, { value: "2100" }] },
    { dimensionValues: [{ value: "(not set)" }], metricValues: [{ value: "90" }, { value: "0" }, { value: "0" }, { value: "0" }] },
    { dimensionValues: [{ value: "/portones?utm_source=fb" }], metricValues: [{ value: "88" }, { value: "0.52" }, { value: "4" }, { value: "4000" }] },
    { dimensionValues: [{ value: "/contacto" }], metricValues: [{ value: "15" }, { value: "0.1" }, { value: "6" }, { value: "300" }] },
  ],
};

const eventsResponse = {
  dimensionHeaders: [{ name: "eventName" }, { name: "dateRange" }],
  metricHeaders: [{ name: "keyEvents" }],
  rows: [
    { dimensionValues: [{ value: "click_to_call" }, { value: "cur" }], metricValues: [{ value: "22" }] },
    { dimensionValues: [{ value: "generate_lead" }, { value: "cur" }], metricValues: [{ value: "15" }] },
    { dimensionValues: [{ value: "click_to_call" }, { value: "prev" }], metricValues: [{ value: "30" }] },
    { dimensionValues: [{ value: "whatsapp_click" }, { value: "prev" }], metricValues: [{ value: "11" }] },
  ],
};

const trendResponse = {
  dimensionHeaders: [{ name: "date" }],
  metricHeaders: [{ name: "sessions" }],
  rows: [
    { dimensionValues: [{ value: "20261007" }], metricValues: [{ value: "17" }] },
    { dimensionValues: [{ value: "20260910" }], metricValues: [{ value: "9" }] },
  ],
};

const citiesResponse = {
  dimensionHeaders: [{ name: "city" }, { name: "country" }],
  metricHeaders: [{ name: "sessions" }],
  rows: [
    { dimensionValues: [{ value: "Managua" }, { value: "Nicaragua" }], metricValues: [{ value: "640" }] },
    { dimensionValues: [{ value: "(not set)" }, { value: "Nicaragua" }], metricValues: [{ value: "80" }] },
    { dimensionValues: [{ value: "Miami" }, { value: "United States" }], metricValues: [{ value: "44" }] },
  ],
};

// ---------- Elegir la propiedad ----------

describe("propiedades (accountSummaries.list)", () => {
  const props = parseAccountSummaries(accountSummaries);
  it("lee las propiedades normales, sin subpropiedades ni repetidas", () => {
    expect(props.map((p) => p.id)).toEqual(["312345678", "355555555"]);
    expect(props[0]).toEqual({ id: "312345678", name: "fameseg.com - GA4", account: "Fameseg", urls: [] });
  });
  it("sin cuentas → lista vacía", () => {
    expect(parseAccountSummaries({})).toEqual([]);
  });
  it("los flujos web dan la dirección (las apps no)", () => {
    expect(parseDataStreams(dataStreams)).toEqual(["https://www.fameseg.com"]);
  });
  it("las acciones importantes configuradas", () => {
    expect(parseKeyEventsList({ keyEvents: [{ eventName: "purchase" }, { eventName: "click_to_call" }, { eventName: "purchase" }] })).toEqual(["purchase", "click_to_call"]);
  });
});

describe("cuál propiedad se usa", () => {
  const fameseg: Ga4Property = { id: "1", name: "Fameseg", account: "A", urls: ["https://www.fameseg.com"] };
  const ricardo: Ga4Property = { id: "2", name: "Ricardo PA", account: "B", urls: ["https://ricardopa.com/"] };
  const blog: Ga4Property = { id: "3", name: "Blog", account: "B", urls: ["https://blog.fameseg.com"] };
  const none: Ga4Property = { id: "4", name: "Sin flujo", account: "B", urls: [] };
  it("una sola propiedad → se elige sola", () => {
    expect(autoPick([fameseg])?.id).toBe("1");
    expect(autoPick([fameseg, ricardo])).toBeNull();
    expect(autoPick([])).toBeNull();
  });
  it("sugiere la del mismo dominio que la página (sin www ni protocolo), mejor que un subdominio", () => {
    expect(suggestProperty("fameseg.com", [ricardo, blog, fameseg, none])?.id).toBe("1");
    expect(suggestProperty("https://ricardopa.com/servicios", [fameseg, ricardo])?.id).toBe("2");
    expect(suggestProperty("https://fameseg.com", [ricardo, blog])?.id).toBe("3");
  });
  it("sin página web o sin coincidencia → no sugiere", () => {
    expect(suggestProperty("", [fameseg, ricardo])).toBeNull();
    expect(suggestProperty("otro.com", [fameseg, ricardo])).toBeNull();
  });
  it("dos igual de buenas → no adivina", () => {
    expect(suggestProperty("fameseg.com", [fameseg, { ...fameseg, id: "9" }])).toBeNull();
  });
  it("la lista para elegir pone la sugerida primero", () => {
    const { list, suggested } = orderForPicker("www.fameseg.com", [ricardo, none, fameseg]);
    expect(suggested).toBe("1");
    expect(list.map((p) => p.id)).toEqual(["1", "2", "4"]);
  });
});

// ---------- Leer runReport ----------

describe("runReport", () => {
  it("totales de los dos rangos (tiempo promedio = segundos de interacción / personas activas)", () => {
    const { totals, previous } = parseTotals(parseRunReport(totalsResponse));
    expect(totals.sessions).toBe(1034);
    expect(totals.users).toBe(812);
    expect(totals.keyEvents).toBe(37);
    expect(totals.engagementRate).toBeCloseTo(0.547, 3);
    expect(totals.avgEngagementSec).toBeCloseTo(51240 / 780, 5);
    expect(previous.sessions).toBe(820);
    expect(previous.keyEvents).toBe(41);
  });
  it("sin filas (propiedad nueva) → ceros", () => {
    const { totals, previous } = parseTotals(parseRunReport({ dimensionHeaders: [{ name: "dateRange" }], metricHeaders: [{ name: "sessions" }] }));
    expect(totals.sessions).toBe(0);
    expect(previous.users).toBe(0);
  });
  it("de dónde llegan: actual y anterior juntos, de más a menos visitas (también los que ya no traen visitas)", () => {
    const rows = parseCompared(parseRunReport(channelsResponse), "sessionDefaultChannelGroup");
    expect(rows.map((r) => r.key)).toEqual(["Direct", "Organic Search", "Organic Social", "Referral", "Paid Search"]);
    expect(rows[1]).toEqual({ key: "Organic Search", sessions: 380, prevSessions: 400, engagedSessions: 250, keyEvents: 18 });
    expect(rows[4]).toMatchObject({ key: "Paid Search", sessions: 0, prevSessions: 120 });
  });
  it("las páginas por donde entran, sin «(not set)»", () => {
    const pages = parseLanding(parseRunReport(landingResponse));
    expect(pages.map((p) => p.key)).toEqual(["/", "/cortinas-metalicas", "/portones?utm_source=fb", "/contacto"]);
    expect(pages[0].avgEngagementSec).toBe(50);
  });
  it("acciones importantes por nombre, con las que solo pasaron antes", () => {
    expect(parseKeyEvents(parseRunReport(eventsResponse))).toEqual([
      { key: "click_to_call", count: 22, prevCount: 30 },
      { key: "generate_lead", count: 15, prevCount: 0 },
      { key: "whatsapp_click", count: 0, prevCount: 11 },
    ]);
  });
  it("ciudades sin «(not set)»", () => {
    expect(parsePlaces(parseRunReport(citiesResponse), "city")).toEqual([
      { key: "Managua", country: "Nicaragua", sessions: 640 },
      { key: "Miami", country: "United States", sessions: 44 },
    ]);
  });
  it("visitas desde Google por día: los 28 días, con ceros donde no hubo", () => {
    const { range } = ga4Ranges(new Date("2026-10-08T15:00:00Z"));
    expect(range).toEqual({ start: "2026-09-10", end: "2026-10-07" });
    const days = parseTrend(parseRunReport(trendResponse), range);
    expect(days).toHaveLength(28);
    expect(days[0]).toEqual({ date: "2026-09-10", sessions: 9 });
    expect(days[27]).toEqual({ date: "2026-10-07", sessions: 17 });
    expect(days[5].sessions).toBe(0);
  });
  it("los 28 días anteriores terminan justo antes", () => {
    expect(ga4Ranges(new Date("2026-10-08T15:00:00Z")).previousRange).toEqual({ start: "2026-08-13", end: "2026-09-09" });
  });
});

// ---------- Comparaciones ----------

describe("comparaciones contra los 28 días anteriores", () => {
  it("cantidades: sube, baja, igual, nuevo y sin datos", () => {
    expect(compareCount(1034, 820)).toEqual({ dir: "up", pct: expect.closeTo(0.261, 3) });
    expect(compareCount(37, 41).dir).toBe("down");
    expect(compareCount(100, 100.5).dir).toBe("same");
    expect(compareCount(5, 0).dir).toBe("new");
    expect(compareCount(0, 0).dir).toBe("none");
  });
  it("tasas: la diferencia en puntos", () => {
    expect(compareRate(0.55, 0.5)).toEqual({ dir: "up", pct: expect.closeTo(0.05, 5) });
    expect(compareRate(0.4, 0.5).dir).toBe("down");
    expect(compareRate(0.501, 0.5).dir).toBe("same");
  });
  it("qué parte llega desde Google", () => {
    const channels = parseCompared(parseRunReport(channelsResponse), "sessionDefaultChannelGroup");
    expect(organicShare({ channels, totals: { ...parseTotals(parseRunReport(totalsResponse)).totals } })).toBeCloseTo(380 / 1034, 5);
    expect(organicShare({ channels: [], totals: { ...parseTotals([]).totals } })).toBe(0);
  });
  it("página con muchas visitas donde casi nadie se queda", () => {
    expect(isLowEngagementPage({ sessions: 210, engagementRate: 0.18 }, 1034)).toBe(true);
    expect(isLowEngagementPage({ sessions: 15, engagementRate: 0.1 }, 1034)).toBe(false);
    expect(isLowEngagementPage({ sessions: 512, engagementRate: 0.61 }, 1034)).toBe(false);
  });
});

// ---------- Reporte guardado ----------

const sample = {
  version: 1,
  propertyId: "312345678",
  propertyName: "fameseg.com - GA4",
  fetchedAt: "2026-10-08T12:00:00.000Z",
  timeZone: "America/Managua",
  range: { start: "2026-09-10", end: "2026-10-07" },
  previousRange: { start: "2026-08-13", end: "2026-09-09" },
  totals: { users: 812, newUsers: 701, sessions: 1034, engagedSessions: 566, engagementRate: 0.547, avgEngagementSec: 65.7, keyEvents: 0, pageViews: 2210 },
  previous: { users: 640, newUsers: 560, sessions: 820, engagedSessions: 410, engagementRate: 0.5, avgEngagementSec: 60, keyEvents: 0, pageViews: 1800 },
  channels: [{ key: "Direct", sessions: 420, prevSessions: 300, engagedSessions: 200, keyEvents: 0 }],
  landingPages: [{ key: "/", sessions: 512, engagementRate: 0.61, keyEvents: 0, avgEngagementSec: 50 }],
  cities: [],
  countries: [],
  devices: [],
  keyEvents: [],
  keyEventsConfigured: ["purchase"],
  organicTrend: [],
};

describe("reporte guardado", () => {
  it("se lee tal cual y los formatos raros no rompen", () => {
    const r = readGa4Report(sample)!;
    expect(r.totals.sessions).toBe(1034);
    expect(r.channels[0].key).toBe("Direct");
    expect(readGa4Report({ hola: 1 })).toBeNull();
    expect(readGa4Report(null)).toBeNull();
    expect(readGa4Report({ totals: "x", channels: "y" })!.channels).toEqual([]);
  });
  it("solo «purchase» (lo pone GA4 solo) = no tiene marcadas sus llamadas ni formularios", () => {
    expect(hasKeyEventsSetUp(readGa4Report(sample)!)).toBe(false);
    expect(hasKeyEventsSetUp(readGa4Report({ ...sample, keyEventsConfigured: ["purchase", "click_to_call"] })!)).toBe(true);
    expect(hasKeyEventsSetUp(readGa4Report({ ...sample, keyEventsConfigured: null })!)).toBeNull();
    expect(hasKeyEventsSetUp(readGa4Report({ ...sample, keyEventsConfigured: null, totals: { ...sample.totals, keyEvents: 4 } })!)).toBe(true);
  });
  it("se actualiza sola una vez al día; si falló, espera un día antes de volver a intentar", () => {
    const now = new Date("2026-10-08T20:00:00.000Z");
    expect(needsRefresh({ fetchedAt: "2026-10-08T12:00:00.000Z", now })).toBe(false);
    expect(needsRefresh({ fetchedAt: "2026-10-07T12:00:00.000Z", now })).toBe(true);
    expect(needsRefresh({ fetchedAt: null, now })).toBe(true);
    expect(needsRefresh({ fetchedAt: "2026-10-07T12:00:00.000Z", lastTryAt: "2026-10-08T08:00:00.000Z", now })).toBe(false);
    expect(needsRefresh({ fetchedAt: null, lastTryAt: "2026-10-06T08:00:00.000Z", now })).toBe(true);
  });
});

// ---------- Errores ----------

describe("errores en palabras claras", () => {
  const t = translator("es");
  it("permiso vencido o quitado", () => {
    expect(explainGa4Error("400: invalid_grant — Token has been expired or revoked.", t)).toMatch(/venció o se quitó/);
  });
  it("API sin activar: dice cuál", () => {
    expect(explainGa4Error("403: Google Analytics Data API has not been used in project 123 before or it is disabled.", t)).toMatch(/Google Analytics Data API/);
    expect(explainGa4Error("403: Google Analytics Admin API has not been used in project 123 before or it is disabled.", t)).toMatch(/Google Analytics Admin API/);
  });
  it("sin acceso a la propiedad", () => {
    expect(explainGa4Error("403: User does not have sufficient permissions for this property.", t)).toMatch(/no tiene acceso/);
  });
  it("sin el permiso de Analytics", () => {
    expect(explainGa4Error("403: Request had insufficient authentication scopes.", t)).toMatch(/No diste el permiso/);
  });
  it("el cliente de Google de la app no es válido", () => {
    expect(explainGa4Error("401: invalid_client — The OAuth client was not found.", t)).toMatch(/GOOGLE_CLIENT_ID/);
  });
  it("en inglés también", () => {
    expect(explainGa4Error("400: invalid_grant", translator("en"))).toMatch(/expired or was revoked/);
  });
});

// ---------- El permiso de Google ----------

describe("conectar Google Analytics", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.PUBLIC_BASE_URL = "https://app.example.com/";
    process.env.APP_SECRET = "test-secret";
  });
  it("pide solo lectura de Analytics, usa el mismo regreso y marca el propósito en el state", () => {
    const u = new URL(googleAuthUrl("biz123", "ga4"));
    expect(u.searchParams.get("scope")).toBe(GA4_SCOPE);
    expect(GA4_SCOPE).toBe("https://www.googleapis.com/auth/analytics.readonly");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/google/callback");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(googleStatePurpose(readState(u.searchParams.get("state")!)!)).toEqual({ purpose: "ga4", businessId: "biz123" });
  });
  it("Search Console y el Perfil de Negocio siguen igual", () => {
    expect(googleStatePurpose(readState(new URL(googleAuthUrl("b1", "gsc")).searchParams.get("state")!)!)).toEqual({ purpose: "gsc", businessId: "b1" });
    expect(googleStatePurpose(readState(new URL(googleAuthUrl("b1")).searchParams.get("state")!)!)).toEqual({ purpose: "profile", businessId: "b1" });
    expect(googleStatePurpose("ga4:")).toEqual({ purpose: "ga4", businessId: "" });
  });
});
