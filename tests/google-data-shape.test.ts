import { describe, expect, it } from "vitest";
import {
  canRevokeAlone,
  clustersUseGsc,
  DAY_MS,
  GOOGLE_CHECK_EVERY_MS,
  GOOGLE_REVOKED_GRACE_MS,
  googleCheckDue,
  isRevokedGrant,
  scrubOnPageGsc,
  scrubPostedReplies,
  scrubSetupGsc,
  SEO_RETENTION,
  shouldPurgeRevoked,
  youtubeLabelExpired,
} from "@/lib/google-data-shape";
import { readReviewsReport } from "@/lib/seo/gbp";
import { readOnPageReport, sortPages } from "@/lib/seo/onpage";

const now = new Date("2026-10-13T13:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("revisión del permiso de Google", () => {
  it("solo invalid_grant cuenta como permiso quitado", () => {
    expect(isRevokedGrant("400: invalid_grant — Token has been expired or revoked.")).toBe(true);
    expect(isRevokedGrant("401: invalid_client — The OAuth client was not found.")).toBe(false);
    expect(isRevokedGrant("401: unauthorized_client — Unauthorized")).toBe(false);
    expect(isRevokedGrant("503: backendError")).toBe(false);
    expect(isRevokedGrant("fetch failed")).toBe(false);
    expect(isRevokedGrant("Faltan datos de la conexión: clientId, clientSecret")).toBe(false);
  });

  it("toca revisar las conexiones de antes (sin campos) y las revisadas hace más de 20 h", () => {
    expect(googleCheckDue({}, now)).toBe(true);
    expect(googleCheckDue({ checkedAt: "basura" }, now)).toBe(true);
    expect(googleCheckDue({ checkedAt: ago(GOOGLE_CHECK_EVERY_MS - 60_000) }, now)).toBe(false);
    expect(googleCheckDue({ checkedAt: ago(GOOGLE_CHECK_EVERY_MS) }, now)).toBe(true);
  });

  it("se borra a los 3 días de que Google dijo invalid_grant, nunca sin revokedAt", () => {
    expect(shouldPurgeRevoked({}, now)).toBe(false);
    expect(shouldPurgeRevoked({ checkedAt: ago(10 * DAY_MS) }, now)).toBe(false);
    expect(shouldPurgeRevoked({ revokedAt: ago(GOOGLE_REVOKED_GRACE_MS - 60_000) }, now)).toBe(false);
    expect(shouldPurgeRevoked({ revokedAt: ago(GOOGLE_REVOKED_GRACE_MS) }, now)).toBe(true);
    expect(shouldPurgeRevoked({ revokedAt: ago(6 * DAY_MS) }, now)).toBe(true);
  });

  it("el nombre del canal de YouTube vence a los 30 días; sin okAt cuenta la fecha de la conexión", () => {
    const old = new Date(now.getTime() - 31 * DAY_MS);
    const fresh = new Date(now.getTime() - 2 * DAY_MS);
    expect(youtubeLabelExpired({}, old, now)).toBe(true);
    expect(youtubeLabelExpired({}, fresh, now)).toBe(false);
    expect(youtubeLabelExpired({ okAt: ago(DAY_MS) }, old, now)).toBe(false);
    expect(youtubeLabelExpired({ okAt: ago(31 * DAY_MS) }, fresh, now)).toBe(true);
  });

  it("los reportes que se recortan son solo de Google", () => {
    expect(SEO_RETENTION).toEqual({ gsc: { keep: 2, maxAgeDays: 45 }, ga4: { keep: 3, maxAgeDays: 35 } });
  });
});

const SITE = "https://empresa.com";
const onpage = () => ({
  version: 1,
  zone: { code: 2840, name: "Miami" },
  language: "es",
  overrides: { [`${SITE}/b`]: "techos en miami" },
  cost: 0.12,
  createdAt: "2026-10-01T00:00:00.000Z",
  stoppedEarly: false,
  futureField: { keep: true },
  pages: [
    {
      url: `${SITE}/a`,
      title: "Reparación de techos",
      keyword: "reparacion de techos miami",
      keywordSource: "gsc",
      score: 72,
      ideas: [{ id: "length", category: "contenido", priority: "alta", es: "Más texto", en: "More text", impact: 3 }],
      stats: { words: 400, targetWords: 1200, title: "Reparación de techos", h1: "Techos", meta: "", h2: [], images: 1, imagesNoAlt: 0, linksOut: 2, linksIn: 1, external: 0, schema: [], canonical: "", loadSeconds: 1.2, loadSource: "server", position: 8 },
      winners: [{ position: 1, domain: "rival.com", url: "https://rival.com/t", title: "Techos", words: 1300 }],
      brief: { headings: ["Precios"], questions: [], terms: [], serpTitles: [] },
      linksTo: ["empresa.com/b"],
      checkedAt: "2026-10-01T00:00:00.000Z",
      suggestion: { title: "Reparación de techos en Miami", metaDescription: "x", h1: "x", h2s: [], provider: "gemini", createdAt: "2026-10-01T00:00:00.000Z" },
      oldUnknown: 1,
    },
    {
      url: `${SITE}/b`,
      title: "Techos",
      keyword: "techos en miami",
      keywordSource: "owner",
      score: 80,
      ideas: [],
      stats: null,
      winners: [],
      brief: null,
      linksTo: [],
      checkedAt: "2026-10-01T00:00:00.000Z",
    },
  ],
});

describe("scrubOnPageGsc", () => {
  it("limpia solo las páginas con palabra de Search Console y conserva lo demás", () => {
    const raw = onpage();
    const out = scrubOnPageGsc(raw)!;
    expect(out.urls).toEqual([`${SITE}/a`]);
    expect(out.data.futureField).toEqual({ keep: true });
    expect(out.data.overrides).toEqual(raw.overrides);
    const [a, b] = out.data.pages as Record<string, unknown>[];
    expect(a).toMatchObject({ url: `${SITE}/a`, title: "Reparación de techos", keyword: null, keywordSource: null, score: null, ideas: [], winners: [], brief: null, needsRecheck: true, linksTo: ["empresa.com/b"], oldUnknown: 1 });
    expect(a.suggestion).toBeUndefined();
    expect(a.stats).toMatchObject({ words: 400, targetWords: null, position: null, loadSeconds: 1.2 });
    expect(b).toBe(raw.pages[1]);
    // El original no se toca.
    expect(raw.pages[0].keywordSource).toBe("gsc");
  });

  it("devuelve null si no hay nada de Search Console o la fila no es un reporte", () => {
    const raw = onpage();
    raw.pages[0].keywordSource = "rank";
    expect(scrubOnPageGsc(raw)).toBeNull();
    expect(scrubOnPageGsc({ pages: [{ url: `${SITE}/x`, keyword: "x" }] })).toBeNull();
    expect(scrubOnPageGsc({ pages: "x" })).toBeNull();
    expect(scrubOnPageGsc(null)).toBeNull();
  });

  it("el reporte limpio se sigue leyendo y se muestra como «volver a revisar»", () => {
    const r = readOnPageReport(scrubOnPageGsc(onpage())!.data)!;
    expect(r).not.toBeNull();
    expect(r.pages).toHaveLength(2);
    const a = r.pages.find((p) => p.url === `${SITE}/a`)!;
    expect(a).toMatchObject({ keyword: null, keywordSource: null, score: null, ideas: [], winners: [], brief: null, needsRecheck: true });
    expect(a.suggestion).toBeUndefined();
    expect(a.stats).toMatchObject({ words: 400, targetWords: null, position: null });
    expect(r.overrides).toEqual({ [`${SITE}/b`]: "techos en miami" });
    expect(sortPages(r.pages).map((p) => p.url)).toEqual([`${SITE}/b`, `${SITE}/a`]);
  });
});

describe("scrubSetupGsc", () => {
  const setup = () => ({
    version: 1,
    hash: "123",
    rejected: ["techos baratos"],
    proposal: {
      zones: [],
      missingPlaces: [],
      language: "es",
      languageWhy: { es: "", en: "" },
      ai: false,
      createdAt: "2026-10-01T00:00:00.000Z",
      keywords: [
        { keyword: "reparacion de techos", source: "search_console", why: { es: "", en: "" } },
        { keyword: "techos miami", source: "study", why: { es: "", en: "" }, volume: 90 },
      ],
    },
  });

  it("quita solo las palabras de Search Console y conserva las rechazadas y la huella", () => {
    const out = scrubSetupGsc(setup())!;
    expect(out.hash).toBe("123");
    expect(out.rejected).toEqual(["techos baratos"]);
    expect((out.proposal as { keywords: { keyword: string }[] }).keywords.map((k) => k.keyword)).toEqual(["techos miami"]);
    expect((out.proposal as Record<string, unknown>).createdAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("devuelve null sin palabras de Search Console o sin propuesta", () => {
    const s = setup();
    s.proposal.keywords = s.proposal.keywords.filter((k) => k.source !== "search_console");
    expect(scrubSetupGsc(s)).toBeNull();
    expect(scrubSetupGsc({ version: 1, hash: "", proposal: null, rejected: [] })).toBeNull();
    expect(scrubSetupGsc(undefined)).toBeNull();
  });
});

describe("scrubPostedReplies", () => {
  const at = "2026-10-05T10:00:00.000Z";
  const reviews = () => ({
    version: 1,
    total: 3,
    rating: 4.7,
    cost: 0.01,
    createdAt: "2026-10-06T00:00:00.000Z",
    stats: { count: 3, answered: 2 },
    reviews: [
      // Publicada desde Matya y Google todavía no la mostraba: se quita la marca y el texto del dueño se queda.
      { id: "a", name: "Ana", rating: 5, text: "Excelente", timestamp: "2026-10-04T00:00:00.000Z", ownerAnswer: "¡Gracias Ana!", ownerTimestamp: at, postedAt: at },
      // DataForSEO ya trajo la respuesta pública de Google: solo se quita la marca.
      { id: "b", name: "Beto", rating: 4, text: "Bien", timestamp: "2026-10-01T00:00:00.000Z", ownerAnswer: "Gracias Beto", ownerTimestamp: "2026-10-03T08:00:00.000Z", postedAt: "2026-10-02T09:00:00.000Z" },
      { id: "c", name: "Carla", rating: 2, text: "Lento", timestamp: "2026-10-02T00:00:00.000Z", ownerAnswer: "", ownerTimestamp: "", draft: "Lo sentimos" },
    ],
  });

  it("quita solo la marca postedAt: el texto de la respuesta es del dueño y sigue publicado en Google", () => {
    const raw = reviews();
    const out = scrubPostedReplies(raw)!;
    const [a, b, c] = out.reviews as Record<string, unknown>[];
    expect(a).toMatchObject({ id: "a", ownerAnswer: raw.reviews[0].ownerAnswer, ownerTimestamp: raw.reviews[0].ownerTimestamp, text: "Excelente" });
    expect(a).not.toHaveProperty("postedAt");
    expect(b).toMatchObject({ id: "b", ownerAnswer: "Gracias Beto", ownerTimestamp: "2026-10-03T08:00:00.000Z" });
    expect(b).not.toHaveProperty("postedAt");
    expect(c).toBe(raw.reviews[2]);
    expect(out.total).toBe(3);
  });

  it("devuelve null si no hay respuestas publicadas desde Matya", () => {
    const raw = reviews();
    raw.reviews = [raw.reviews[2]];
    expect(scrubPostedReplies(raw)).toBeNull();
    expect(scrubPostedReplies({ reviews: null })).toBeNull();
  });

  it("el reporte limpio se sigue leyendo y recalcula lo contestado", () => {
    const r = readReviewsReport(scrubPostedReplies(reviews()))!;
    expect(r.reviews.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(r.reviews.every((x) => x.postedAt === undefined)).toBe(true);
    expect(r.reviews[2].draft).toBe("Lo sentimos");
    expect(r.stats).toMatchObject({ count: 3, answered: 2, unanswered: 1 });
  });
});

describe("canRevokeAlone", () => {
  it("revoca solo si se sabe la cuenta y ninguna otra conexión usa, o podría usar, la misma", () => {
    expect(canRevokeAlone("g1", [])).toBe(true);
    expect(canRevokeAlone("g1", ["g2", "g3"])).toBe(true);
    expect(canRevokeAlone("g1", ["g2", "g1"])).toBe(false);
    expect(canRevokeAlone("g1", ["g2", undefined])).toBe(false);
    expect(canRevokeAlone("g1", [""])).toBe(false);
    expect(canRevokeAlone(undefined, [])).toBe(false);
    expect(canRevokeAlone(null, ["g2"])).toBe(false);
  });
});

describe("clustersUseGsc", () => {
  it("solo si algún tema agrupó una búsqueda que salió de Search Console", () => {
    expect(clustersUseGsc({ clusters: [{ keywords: [{ keyword: "a", sources: ["rank", "gsc"] }] }] })).toBe(true);
    expect(clustersUseGsc({ clusters: [{ keywords: [{ keyword: "a", sources: ["keywords"] }] }] })).toBe(false);
    expect(clustersUseGsc({ clusters: "x" })).toBe(false);
    expect(clustersUseGsc(null)).toBe(false);
  });
});
