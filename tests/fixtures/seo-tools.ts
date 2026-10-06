// Datos de ejemplo (inventados, con la forma de los reportes guardados) para las herramientas que Fameseg todavía no
// tiene en tests/fixtures/fameseg.json: tono de las menciones en las IAs, páginas que compiten entre sí, enlaces,
// visitas de la competencia y mapas. Los usan las pruebas del resumen simple, del correo semanal y del PDF.
import fameseg from "./fameseg.json";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

type Tone = "positiva" | "neutral" | "negativa";
const TONES: Record<Tone, { reason: string; quote: string; attributes: string[] }> = {
  positiva: { reason: "Lo recomienda por su garantía y por cumplir los tiempos", quote: "Fameseg ofrece cortinas metálicas con garantía", attributes: ["garantía", "puntualidad"] },
  neutral: { reason: "Solo lo nombra en una lista", quote: "Fameseg", attributes: [] },
  negativa: { reason: "Dice que algunos clientes se quejan de demoras en la instalación", quote: "algunos clientes de Fameseg mencionan demoras", attributes: ["demoras"] },
};

/**
 * El reporte de IAs de Fameseg (guardado) con el tono de cada mención: ChatGPT lo nombra en 4 respuestas y cada una
 * recibe el tono de `tones`, en orden. Por defecto 3 positivas y 1 negativa.
 */
export function famesegAiWithTone(tones: Tone[] = ["positiva", "positiva", "negativa", "positiva"]): unknown {
  const data = clone(fameseg.reports.ai.data) as { results: Record<string, unknown>[]; sentiment?: unknown };
  let i = 0;
  for (const r of data.results) {
    if (r.mentioned !== true || r.error) continue;
    const tone = tones[i++];
    if (tone) r.sentiment = { sentiment: tone, ...TONES[tone] };
  }
  data.sentiment = { status: "ok" };
  return data;
}

/** Pares página + búsqueda de Search Console: dos páginas se reparten «cortinas metalicas» (urgente) y otra búsqueda leve. */
export const cannibalPageQueries = [
  { page: "https://fameseg.com/cortinas-metalicas", query: "cortinas metalicas", clicks: 6, impressions: 120, position: 8.2 },
  { page: "https://fameseg.com/blog/precio-cortinas-metalicas", query: "cortinas metalicas", clicks: 3, impressions: 90, position: 11.4 },
  { page: "https://fameseg.com/portones", query: "portones electricos", clicks: 2, impressions: 60, position: 9 },
  { page: "https://fameseg.com/blog/portones-electricos-precio", query: "portones electricos", clicks: 0, impressions: 6, position: 35 },
];
export const cannibalRange = { start: "2026-09-01", end: "2026-09-28" };

/** Un reporte de Search Console guardado (con los pares página + búsqueda). */
export const gscSaved = {
  totals: { clicks: 342, impressions: 12850, ctr: 0.0266, position: 14.2 },
  previous: { clicks: 301, impressions: 13400, ctr: 0.0225, position: 15.8 },
  range: cannibalRange,
  previousRange: { start: "2026-08-04", end: "2026-08-31" },
  queries: [],
  pageQueries: cannibalPageQueries,
};

const backlinks = (referringDomains: number, rank: number, createdAt: string, gap = true) => ({
  domain: "fameseg.com",
  summary: {
    domain: "fameseg.com",
    rank,
    backlinks: referringDomains * 7,
    referringDomains,
    referringMainDomains: referringDomains,
    nofollowLinks: 10,
    dofollowShare: 0.8,
    brokenBacklinks: 0,
    spamScore: 4,
    newDomains1m: 3,
    lostDomains1m: 1,
    trend: [],
  },
  referring: [{ domain: "paginasamarillas.com.ni", rank: 210, backlinks: 2, firstSeen: "2024-03-01T00:00:00.000Z", dofollow: true, spamScore: 2 }],
  referringTotal: referringDomains,
  competitors: [
    { domain: "cormetal.com.ni", rank: 180, backlinks: 400, referringDomains: 40, dofollowShare: 0.7, ok: true },
    { domain: "portoneselectricosbasilio.com", rank: 60, backlinks: 30, referringDomains: 9, dofollowShare: 0.9, ok: true },
  ],
  gap: gap
    ? [
        { domain: "camaradecomercio.org.ni", rank: 240, linksTo: ["cormetal.com.ni", "portoneselectricosbasilio.com"], backlinks: 3, spamScore: 2, hint: "association" },
        { domain: "paginasamarillas.com.ni", rank: 210, linksTo: ["cormetal.com.ni"], backlinks: 2, spamScore: 5, hint: "directory" },
        { domain: "laprensani.com", rank: 300, linksTo: ["cormetal.com.ni"], backlinks: 1, spamScore: 1, hint: "news" },
        { domain: "ferreteriasinsa.com", rank: 150, linksTo: ["cormetal.com.ni"], backlinks: 4, spamScore: 3, hint: "supplier" },
        { domain: "constructores-nica.blogspot.com", rank: 40, linksTo: ["cormetal.com.ni"], backlinks: 1, spamScore: 10, hint: "blog" },
        { domain: "foronica.com", rank: 30, linksTo: ["portoneselectricosbasilio.com"], backlinks: 1, spamScore: 12, hint: "forum" },
        { domain: "facebook.com", rank: 900, linksTo: ["cormetal.com.ni"], backlinks: 5, spamScore: 0, hint: "social" },
        { domain: "mipyme.org.ni", rank: 50, linksTo: ["cormetal.com.ni"], backlinks: 1, spamScore: 8, hint: "association" },
      ]
    : [],
  gapSpamHidden: 0,
  notes: [],
  cost: 0.2,
  createdAt,
});

/** Enlaces: 12 sitios te enlazan (antes 10) y 8 sitios enlazan a tu competencia y a ti no. */
export const backlinksSaved = backlinks(12, 112, "2026-09-20T12:00:00.000Z");
export const backlinksSavedBefore = backlinks(10, 104, "2026-08-20T12:00:00.000Z");

const month = (m: string, etv: number, extra: Record<string, number> = {}) => ({ month: m, etv, keywords: Math.round(etv * 2), top3: 0, top10: 1, value: 0, ...extra });

/** Visitas: Cormetal pasó de 20 a 45 al mes en un año; Fameseg de 1 a 3; un competidor sin datos. */
export const trafficSaved = {
  domain: "fameseg.com",
  country: "Nicaragua",
  location: null,
  domains: [
    { domain: "fameseg.com", isYou: true, history: [month("2025-09", 1), month("2026-03", 2), month("2026-09", 3, { keywords: 12, top10: 4 })], pages: [] },
    {
      domain: "cormetal.com.ni",
      isYou: false,
      history: [month("2025-09", 20), month("2026-03", 31), month("2026-09", 45, { keywords: 60, top10: 15 })],
      pages: [{ url: "https://www.cormetal.com.ni/puertas-de-pvc", etv: 12, keywords: 8, top3: 2, value: 0, topKeyword: "puertas de pvc", topic: "puertas de pvc" }],
    },
    { domain: "cortinasmetalicasurgentes.com", isYou: false, history: [], pages: [] },
  ],
  notes: [],
  cost: 0.05,
  createdAt: "2026-09-25T12:00:00.000Z",
};

const point = (rank: number | null, top3: string[]) => ({ lat: 12.1, lng: -86.2, rank, top3: top3.map((title, i) => ({ title, rank: i + 1 })) });

/** Dos mapas de «cortinas metálicas»: ahora sale en el top 3 en 2 de 4 puntos, antes en 1 de 4. */
export const mapNow = {
  keyword: "cortinas metálicas",
  place: { title: "Fameseg", cid: "" },
  center: { lat: 12.1, lng: -86.2 },
  size: 2,
  spacingKm: 1,
  points: [
    point(1, ["Fameseg", "CortyPort Industrial", "Metalfa"]),
    point(4, ["CortyPort Industrial", "Metalfa", "INDUMECAR"]),
    point(2, ["CortyPort Industrial", "Fameseg", "Metalfa"]),
    point(null, ["CortyPort Industrial", "INDUMECAR", "Metalfa"]),
  ],
  createdAt: "2026-09-26T12:00:00.000Z",
};
export const mapBefore = {
  ...mapNow,
  points: [point(5, ["CortyPort Industrial", "Metalfa", "INDUMECAR"]), point(null, ["A", "B", "C"]), point(2, ["X", "Fameseg", "Y"]), point(9, ["A", "B", "C"])],
  createdAt: "2026-08-26T12:00:00.000Z",
};
