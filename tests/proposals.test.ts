import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------- Base de datos falsa en memoria (aplicar, deshacer, no repetir, aplicar solas) ----------
type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({
  proposals: [] as Row[],
  campaigns: [] as Row[],
  businesses: [] as Row[],
  actions: [] as Row[],
  posts: [] as Row[],
  targets: [] as Row[],
  logs: [] as Row[],
  reports: [] as Row[],
  paused: [] as string[],
}));

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    const cur = row[k];
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if ("in" in o) return (o.in as unknown[]).includes(cur);
      if ("not" in o) return cur !== o.not && cur !== null && cur !== undefined;
      if ("lt" in o || "gte" in o || "lte" in o) {
        const t = cur instanceof Date ? cur.getTime() : NaN;
        if ("lt" in o && !(t < (o.lt as Date).getTime())) return false;
        if ("gte" in o && !(t >= (o.gte as Date).getTime())) return false;
        if ("lte" in o && !(t <= (o.lte as Date).getTime())) return false;
        return true;
      }
      return true;
    }
    return cur === v;
  });
}

vi.mock("@/lib/db", () => {
  let n = 0;
  const table = (rows: () => Row[]) => ({
    findFirst: async ({ where }: { where: Row }) => rows().find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: { where: Row }) => rows().find((r) => matches(r, where)) ?? null,
    findUniqueOrThrow: async ({ where }: { where: Row }) => {
      const r = rows().find((x) => matches(x, where));
      if (!r) throw new Error("not found");
      return r;
    },
    findMany: async ({ where }: { where?: Row } = {}) => rows().filter((r) => matches(r, where)),
    count: async ({ where }: { where?: Row } = {}) => rows().filter((r) => matches(r, where)).length,
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const r = rows().find((x) => matches(x, where))!;
      Object.assign(r, data);
      return r;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const list = rows().filter((r) => matches(r, where));
      for (const r of list) Object.assign(r, data);
      return { count: list.length };
    },
    create: async ({ data }: { data: Row }) => {
      const r = { id: `id${++n}`, createdAt: new Date(), decidedAt: null, appliedAt: null, ...data };
      rows().push(r);
      return r;
    },
    delete: async ({ where }: { where: Row }) => {
      const i = rows().findIndex((r) => matches(r, where));
      return rows().splice(i, 1)[0];
    },
  });
  const db: Record<string, unknown> = {
    aiProposal: table(() => mem.proposals),
    campaign: table(() => mem.campaigns),
    business: table(() => mem.businesses),
    aiAction: table(() => mem.actions),
    post: table(() => mem.posts),
    postTarget: table(() => mem.targets),
    actionTask: { findMany: async () => [] },
    seoReport: table(() => mem.reports),
    $queryRaw: async () => [],
  };
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return { db };
});
vi.mock("@/lib/ads", () => ({
  getAdsSettings: async () => ({ monthlyCapCents: 10_000, specialCategory: "NONE", country: "NI" }),
  pauseAd: async (_b: string, _c: string, adId: string) => {
    mem.paused.push(adId);
  },
}));
vi.mock("@/lib/seo/setup", () => ({ rememberChoices: async () => undefined }));
vi.mock("@/lib/seo/reports", () => ({
  saveReport: async (businessId: string, kind: string, data: unknown) => mem.reports.push({ businessId, kind, data, createdAt: new Date() }),
  latestReports: async () => [],
}));
vi.mock("@/lib/ai-actions", () => ({ logAiAction: async (a: Row) => void mem.logs.push(a) }));
vi.mock("@/lib/ai", () => ({ askGemini: vi.fn(async () => ({ items: [], ideas: [] })) }));
// Sin el resumen de resultados, el motor lee las publicaciones directo (respaldo).
vi.mock("@/lib/results", () => ({ resultsSummary: async () => Promise.reject(new Error("sin resumen")) }));

import { defaultRules, readRules, type CampaignRules } from "@/lib/campaign-shape";
import { readCampaignAds, type AdEntry } from "@/lib/ads-shape";
import { acceptProposal, generateProposals, mergeWording, rejectProposal, undoProposal } from "@/lib/proposals";
import {
  adDailyProblems,
  canAutoApply,
  canUndo,
  daysLeft,
  isDuplicate,
  isExpired,
  maxDailyCents,
  readAction,
  readEvidence,
  timeLabel,
  validateAction,
  type ApplyContext,
  type CampaignState,
} from "@/lib/proposals-shape";
import { bestHour, detectProposals, raiseShare, statsFromPosts, statsFromSummary, type PostStat, type RulesInput } from "@/lib/proposals-rules";
import type { ResultsSummary } from "@/lib/results";
import type { GscReport } from "@/lib/seo/gsc";

const TZ = "America/Managua"; // UTC-6, sin cambio de horario
const NOW = new Date("2026-10-09T18:00:00Z");
const DAY = 86_400_000;

/** Una publicación que salió a esa hora de Managua, hace `daysAgo` días. */
function stat(hour: number, reach: number, over: Partial<PostStat> = {}, daysAgo = 3): PostStat {
  const at = new Date(Date.UTC(2026, 9, 9 - daysAgo, hour + 6, 5));
  return { postId: `p${hour}-${reach}-${Math.random()}`, campaignId: null, kind: "post", channel: "facebook", at, reach, impressions: reach, engagement: 10, ...over };
}

function ad(over: Partial<AdEntry> = {}): AdEntry {
  return {
    id: "ad1",
    platform: "meta",
    name: "Portones",
    goal: "messages",
    source: { kind: "new", text: "x", headline: "x", image: "", link: "" },
    ext: { adId: "m1" },
    status: "active",
    dailyCents: 500,
    totalCents: 5000,
    startsAt: "2026-10-01T00:00:00Z",
    endsAt: "2026-10-30T00:00:00Z",
    targeting: { lat: 0, lng: 0, radiusKm: 10, ageMin: null, ageMax: null, interests: [], place: "", cityKey: "" },
    specialCategory: "NONE",
    insights: { spentCents: 1000, todayCents: 0, monthCents: 1000, impressions: 1000, reach: 900, clicks: 10, results: 10, fetchedAt: "2026-10-09T00:00:00Z" },
    createdAt: "2026-10-01T00:00:00Z",
    createdBy: "owner",
    errors: [],
    ...over,
  };
}

function rules(over: Partial<CampaignRules> = {}): CampaignRules {
  return { ...defaultRules({ email: "a@b.com" }), timezone: TZ, ...over };
}

function campaign(over: Partial<CampaignState> = {}): CampaignState {
  return {
    id: "c1",
    name: "Portones",
    status: "active",
    mode: "approval",
    channels: ["facebook"],
    perWeek: 3,
    keywords: [],
    rules: rules(),
    budgetCents: 10_000,
    spentCents: 2000,
    ads: readCampaignAds({ items: [] }),
    ...over,
  };
}

function input({ posts = [], ...over }: Partial<RulesInput> & { posts?: PostStat[] } = {}): RulesInput {
  return {
    now: NOW,
    from: new Date(NOW.getTime() - 28 * DAY),
    to: NOW,
    tz: TZ,
    businessName: "Fameseg",
    stats: statsFromPosts(posts, TZ),
    campaigns: [campaign()],
    connected: ["facebook", "instagram"],
    tracked: [],
    gsc: null,
    monthlyCapCents: 10_000,
    monthSpentCents: 2000,
    ...over,
  };
}

const ctx = (c: CampaignState | null, over: Partial<ApplyContext> = {}): ApplyContext => ({
  campaign: c,
  connected: ["facebook", "instagram"],
  tracked: [],
  monthlyCapCents: 10_000,
  monthSpentCents: 2000,
  now: NOW,
  ...over,
});

/** 4 publicaciones a las 7 p. m. donde reacciona el 10 % y 6 a otras horas donde reacciona el 3.3 %. */
const timingPosts = () => [...[19, 19, 19, 19].map((h) => stat(h, 300, { engagement: 30 })), ...[10, 10, 13, 13, 18, 18].map((h) => stat(h, 300))];

describe("reglas: encontrar mejoras con los números", () => {
  it("horarios: a las 7 p. m. reacciona 3× más gente → cambia la hora que peor funciona", () => {
    const b = bestHour(statsFromPosts(timingPosts(), TZ));
    expect(b?.time).toBe("19:00");
    expect(b?.ratio).toBeCloseTo(3);
    const list = detectProposals(input({ posts: timingPosts() }));
    const p = list.find((d) => d.kind === "timing")!;
    expect(p).toBeTruthy();
    expect(p.impact).toBe(3);
    expect(p.action).toMatchObject({ type: "campaign.update", campaignId: "c1" });
    const times = (p.action as { patch: { postTimes: string[] } }).patch.postTimes;
    expect(times).toContain("19:00");
    expect(times).toHaveLength(3);
    expect(p.evidence.facts[0].value).toBe("10 %");
    expect(p.evidence.facts[0].label.es).toContain("(4 publicaciones)");
    expect(p.evidence.change[0].after).toContain("7:00 p. m.");
    expect(p.evidence.key).toBe("timing:c1:19:00");
  });

  it("horarios: con pocas publicaciones o diferencia chica no propone nada", () => {
    expect(bestHour(statsFromPosts(timingPosts().slice(0, 5), TZ))).toBeNull();
    const close = [...[19, 19, 19, 19].map((h) => stat(h, 300, { engagement: 15 })), ...[10, 10, 13, 13, 18, 18].map((h) => stat(h, 300))];
    expect(bestHour(statsFromPosts(close, TZ))).toBeNull();
  });

  it("horarios: nunca propone una hora dentro de las horas sin publicar", () => {
    const night = [...[22, 22, 22, 22].map((h) => stat(h, 300, { engagement: 40 })), ...[10, 10, 13, 13, 18, 18].map((h) => stat(h, 300))];
    expect(bestHour(statsFromPosts(night, TZ))?.time).toBe("22:00");
    expect(detectProposals(input({ posts: night })).some((d) => d.kind === "timing")).toBe(false);
  });

  it("formatos: los carruseles ganan → sube su parte", () => {
    const posts = [...[1, 2, 3].map(() => stat(10, 300, { engagement: 10 })), ...[1, 2, 3].map(() => stat(13, 300, { kind: "carousel", engagement: 25 }))];
    const p = detectProposals(input({ posts })).find((d) => d.kind === "format")!;
    expect(p.action).toMatchObject({ type: "campaign.update", patch: { contentMix: { post: 80, carousel: 20, story: 0, video: 0 } } });
    expect(p.impact).toBe(3);
  });

  it("raiseShare suma siempre 100 y no pasa del 60 %", () => {
    const m = raiseShare({ post: 50, carousel: 50, story: 0, video: 0 }, "carousel");
    expect(m.carousel).toBe(60);
    expect(m.post + m.carousel + m.story + m.video).toBe(100);
    expect(raiseShare({ post: 1, carousel: 1, story: 1, video: 1 }, "video").video).toBe(45);
  });

  it("anuncios: uno cuesta 2× más por resultado → pausarlo; uno barato pausado por el dueño → solo un consejo", () => {
    const good = ad({ id: "good", name: "Bueno", insights: { ...ad().insights!, spentCents: 1000, results: 20 } });
    const bad = ad({ id: "bad", name: "Caro", insights: { ...ad().insights!, spentCents: 1500, results: 6 } });
    const off = ad({ id: "off", name: "Apagado", status: "paused", pausedReason: "owner", insights: { ...ad().insights!, spentCents: 400, results: 10 } });
    const c = campaign({ ads: readCampaignAds({ items: [good, bad, off] }) });
    const list = detectProposals(input({ campaigns: [c] }));
    const pause = list.find((d) => d.kind === "ads-pause");
    expect(pause?.action).toEqual({ type: "ad.pause", campaignId: "c1", adId: "bad" });
    const review = list.find((d) => d.evidence.key === "ads-budget:off:review");
    expect(review?.action).toBeNull();
  });

  it("palabras clave: búsqueda de Search Console que no se sigue → seguirla (sin la marca)", () => {
    const row = (key: string, impressions: number, position: number) => ({ key, clicks: 3, impressions, ctr: 0.02, position });
    const gsc = { opportunities: [row("portones enrollables managua", 140, 8.2)], queries: [row("fameseg managua", 300, 1.1), row("cortinas metalicas", 10, 9)] } as unknown as GscReport;
    const list = detectProposals(input({ gsc, tracked: ["puertas de garaje"] }));
    const kws = list.filter((d) => d.kind === "keyword");
    expect(kws).toHaveLength(1);
    expect(kws[0].action).toEqual({ type: "keyword.track", keywords: ["portones enrollables managua"] });
    expect(kws[0].impact).toBe(2);
  });

  it("nunca propone nada para una campaña parada o terminada", () => {
    const list = detectProposals(input({ posts: timingPosts(), campaigns: [campaign({ status: "stopped" }), campaign({ id: "c2", status: "ended" })] }));
    expect(list.filter((d) => d.campaignId)).toHaveLength(0);
  });

  it("lee los números del resumen de Resultados (formatos, canales, horas y posiciones)", () => {
    const g = (key: string, measured: number, interactions: number, reach = 1000) => ({ key, label: key, posts: measured, measured, reach, interactions, clicks: 0, rate: null });
    const hours = Array.from({ length: 24 }, (_, key) => ({ key, posts: key === 19 ? 4 : key === 10 ? 6 : 0, rate: key === 19 ? 0.09 : key === 10 ? 0.03 : null }));
    const summary = {
      timing: { enough: true, measured: 10, days: [], hours, bestDay: null, bestHour: 19 },
      byFormat: [g("photo", 2, 20), g("design", 1, 10), g("text", 1, 10), g("carousel", 3, 60)],
      byChannel: [g("facebook", 6, 60), g("instagram", 4, 80)],
      google: { rank: { now: {}, prev: {}, moves: [{ keyword: "portones managua", now: 4, prev: 9, moved: 5 }] }, organic: null },
    } as unknown as ResultsSummary;
    const stats = statsFromSummary(summary);
    expect(stats.formats.find((f) => f.key === "post")).toMatchObject({ posts: 4, interactions: 40 });
    const list = detectProposals({ ...input(), stats });
    expect(list.find((d) => d.kind === "timing")?.evidence.key).toBe("timing:c1:19:00");
    expect(list.find((d) => d.kind === "format")?.evidence.key).toBe("format:c1:carousel");
    expect(list.find((d) => d.kind === "channel")?.evidence.key).toBe("channel:c1:add:instagram");
    expect(list.find((d) => d.evidence.rule === "rank-rising")?.action).toEqual({ type: "campaign.update", campaignId: "c1", patch: { addKeywords: ["portones managua"] } });
  });

  it("sin datos no inventa nada", () => {
    expect(detectProposals(input())).toEqual([]);
  });
});

describe("seguridad: topes de dinero y campañas paradas", () => {
  const live = ad({ id: "a", dailyCents: 500, totalCents: 5000 });
  const other = ad({ id: "b", dailyCents: 600, totalCents: 3000 });

  it("bajar el gasto por día se puede; subirlo solo dentro del tope diario de la campaña", () => {
    const c = campaign({ ads: readCampaignAds({ dailyCapCents: 1300, items: [live, other] }) });
    expect(adDailyProblems(live, 300, c, ctx(c))).toEqual([]);
    expect(adDailyProblems(live, 700, c, ctx(c))).toEqual([]);
    expect(adDailyProblems(live, 800, c, ctx(c)).length).toBeGreaterThan(0);
    expect(maxDailyCents(live, c, ctx(c))).toBe(700);
  });

  it("nunca sube por encima de lo que le queda a la campaña ni del máximo del mes", () => {
    const c = campaign({ budgetCents: 10_000, spentCents: 9_400, ads: readCampaignAds({ items: [live] }) });
    expect(maxDailyCents(live, c, ctx(c))).toBe(600);
    expect(adDailyProblems(live, 700, c, ctx(c)).length).toBeGreaterThan(0);
    const c2 = campaign({ ads: readCampaignAds({ items: [live] }) });
    expect(maxDailyCents(live, c2, ctx(c2, { monthlyCapCents: 10_000, monthSpentCents: 9_950 }))).toBeNull();
    expect(maxDailyCents(live, c2, ctx(c2, { monthlyCapCents: 10_000, monthSpentCents: 9_450 }))).toBe(550);
    expect(adDailyProblems(live, 600, c2, ctx(c2, { monthlyCapCents: 0 })).length).toBeGreaterThan(0);
  });

  it("nunca pasa del total del anuncio ni baja del mínimo de Meta", () => {
    const c = campaign({ ads: readCampaignAds({ items: [live] }) });
    expect(adDailyProblems(live, 5100, c, ctx(c)).length).toBeGreaterThan(0);
    expect(adDailyProblems(live, 50, c, ctx(c)).length).toBeGreaterThan(0);
  });

  it("la regla de «darle más» respeta los topes (sin espacio, no propone)", () => {
    const cheap = ad({ id: "cheap", status: "capped_today", dailyCents: 500, insights: { ...ad().insights!, spentCents: 1000, results: 40 } });
    const pricey = ad({ id: "pricey", status: "paused", pausedReason: "budget", insights: { ...ad().insights!, spentCents: 1000, results: 10 } });
    const roomy = campaign({ ads: readCampaignAds({ items: [cheap, pricey] }) });
    const up = detectProposals(input({ campaigns: [roomy] })).find((d) => d.evidence.key === "ads-budget:cheap:up");
    expect(up?.action).toMatchObject({ type: "ad.daily", dailyCents: 630 });
    const full = campaign({ spentCents: 9_950, ads: readCampaignAds({ items: [cheap, pricey] }) });
    expect(detectProposals(input({ campaigns: [full] })).some((d) => d.evidence.key === "ads-budget:cheap:up")).toBe(false);
  });

  it("no toca campañas paradas (ningún tipo de cambio)", () => {
    const c = campaign({ status: "stopped", ads: readCampaignAds({ items: [live] }) });
    expect(validateAction({ type: "campaign.update", campaignId: "c1", patch: { postTimes: ["19:00"] } }, ctx(c)).length).toBeGreaterThan(0);
    expect(validateAction({ type: "ad.daily", campaignId: "c1", adId: "a", dailyCents: 300 }, ctx(c)).length).toBeGreaterThan(0);
    expect(validateAction({ type: "ad.pause", campaignId: "c1", adId: "a" }, ctx(c)).length).toBeGreaterThan(0);
    expect(validateAction({ type: "post.draft", campaignId: "c1", text: "Hola", postKind: "post" }, ctx(c)).length).toBeGreaterThan(0);
  });

  it("no agrega un canal que no está conectado ni horas en las horas sin publicar; ni ideas con temas prohibidos", () => {
    const c = campaign();
    expect(validateAction({ type: "campaign.update", campaignId: "c1", patch: { addChannels: ["tiktok"] } }, ctx(c)).length).toBeGreaterThan(0);
    expect(validateAction({ type: "campaign.update", campaignId: "c1", patch: { postTimes: ["22:00", "23:00"] } }, ctx(c)).length).toBeGreaterThan(0);
    expect(validateAction({ type: "post.draft", campaignId: "c1", text: "Descuento del 20% esta semana", postKind: "post" }, ctx(c)).length).toBeGreaterThan(0);
  });

  it("palabras clave: no repite ni pasa de 25", () => {
    expect(validateAction({ type: "keyword.track", keywords: ["Portones"] }, ctx(null, { tracked: ["portones"] })).length).toBe(1);
    const many = Array.from({ length: 25 }, (_, i) => `k${i}`);
    expect(validateAction({ type: "keyword.track", keywords: ["nueva"] }, ctx(null, { tracked: many })).length).toBe(1);
  });

  it("lector tolerante: lo que no se entiende nunca se aplica", () => {
    expect(readAction(null)).toBeNull();
    expect(readAction({ type: "ad.activate", campaignId: "c1", adId: "a" })).toBeNull();
    expect(readAction({ type: "campaign.update", campaignId: "c1", patch: { postTimes: ["99:00"] } })?.type).toBe("campaign.update");
    expect(readAction({ type: "campaign.update", campaignId: "c1", patch: { foo: 1 } })).toBeNull();
    expect(readEvidence("x")).toMatchObject({ key: "", facts: [], change: [] });
    expect(timeLabel("19:00", "en")).toBe("7:00 PM");
  });

  it("campaign-shape: el permiso nuevo se lee sin romper lo viejo", () => {
    expect(readRules({ autoApplyProposals: true }).autoApplyProposals).toBe(true);
    expect("autoApplyProposals" in readRules({})).toBe(false);
    expect("autoApplyProposals" in readRules({ autoApplyProposals: "yes" })).toBe(false);
  });
});

describe("no repetir y vencer", () => {
  it("no repite lo abierto, lo rechazado hace menos de 30 días ni lo aplicado hace menos de 14", () => {
    const ex = (status: string, daysAgo: number) => ({ key: "k", status, createdAt: new Date(NOW.getTime() - daysAgo * DAY), decidedAt: new Date(NOW.getTime() - daysAgo * DAY) });
    expect(isDuplicate("k", [ex("proposed", 1)], NOW)).toBe(true);
    expect(isDuplicate("k", [ex("rejected", 10)], NOW)).toBe(true);
    expect(isDuplicate("k", [ex("rejected", 40)], NOW)).toBe(false);
    expect(isDuplicate("k", [ex("applied", 5)], NOW)).toBe(true);
    expect(isDuplicate("k", [ex("applied", 20)], NOW)).toBe(false);
    expect(isDuplicate("k", [ex("expired", 1)], NOW)).toBe(false);
    expect(isDuplicate("otra", [ex("proposed", 1)], NOW)).toBe(false);
  });

  it("vence a los 14 días", () => {
    expect(isExpired({ status: "proposed", createdAt: new Date(NOW.getTime() - 15 * DAY) }, NOW)).toBe(true);
    expect(isExpired({ status: "proposed", createdAt: new Date(NOW.getTime() - 13 * DAY) }, NOW)).toBe(false);
    expect(isExpired({ status: "applied", createdAt: new Date(NOW.getTime() - 30 * DAY) }, NOW)).toBe(false);
    expect(daysLeft(new Date(NOW.getTime() - 4 * DAY), NOW)).toBe(10);
  });
});

describe("aplicar solas: solo lo de bajo riesgo", () => {
  const auto = campaign({ mode: "auto", rules: rules({ autoApplyProposals: true }) });
  const times = { type: "campaign.update" as const, campaignId: "c1", patch: { postTimes: ["10:00", "19:00"] } };

  it("horarios y formatos, en 100% IA con el permiso encendido", () => {
    expect(canAutoApply("timing", times, auto)).toBe(true);
    expect(canAutoApply("format", { ...times, patch: { contentMix: { post: 80, carousel: 20, story: 0, video: 0 } } }, auto)).toBe(true);
  });

  it("nunca canales, palabras clave, anuncios ni ideas; ni sin permiso; ni en otros modos", () => {
    expect(canAutoApply("channel", { ...times, patch: { addChannels: ["instagram"] } }, auto)).toBe(false);
    expect(canAutoApply("timing", { ...times, patch: { postTimes: ["19:00"], addChannels: ["instagram"] } }, auto)).toBe(false);
    expect(canAutoApply("keyword", { type: "keyword.track", keywords: ["x"] }, auto)).toBe(false);
    expect(canAutoApply("ads-budget", { type: "ad.daily", campaignId: "c1", adId: "a", dailyCents: 300 }, auto)).toBe(false);
    expect(canAutoApply("timing", times, campaign({ mode: "auto" }))).toBe(false);
    expect(canAutoApply("timing", times, campaign({ mode: "approval", rules: rules({ autoApplyProposals: true }) }))).toBe(false);
    expect(canAutoApply("timing", times, { ...auto, status: "stopped" })).toBe(false);
  });
});

// ---------- Con la base de datos falsa ----------

const BIZ = "b1";

function seedCampaign(over: Row = {}) {
  const row: Row = {
    id: "c1",
    businessId: BIZ,
    name: "Portones",
    goal: "",
    mode: "approval",
    status: "active",
    channels: ["facebook"],
    perWeek: 3,
    keywords: [],
    rules: { ...rules(), engine: { handled: ["2026-10-10T16:00:00.000Z"] } },
    budgetCents: 10_000,
    spentCents: 2000,
    ads: null,
    createdAt: new Date(),
    ...over,
  };
  mem.campaigns.push(row);
  return row;
}

function seedProposal(over: Row = {}) {
  const row: Row = {
    id: `pr${mem.proposals.length + 1}`,
    businessId: BIZ,
    campaignId: "c1",
    kind: "timing",
    title: { es: "Publicar a las 7 p. m.", en: "Post at 7 PM" },
    detail: { es: "x", en: "x" },
    impact: 2,
    status: "proposed",
    action: { type: "campaign.update", campaignId: "c1", patch: { postTimes: ["10:00", "13:00", "19:00"] } },
    evidence: { key: "timing:c1:19:00" },
    createdAt: new Date(),
    decidedAt: null,
    appliedAt: null,
    ...over,
  };
  mem.proposals.push(row);
  return row;
}

beforeEach(() => {
  for (const k of ["proposals", "campaigns", "businesses", "actions", "posts", "targets", "logs", "reports", "paused"] as const) mem[k].length = 0;
  mem.businesses.push({ id: BIZ, name: "Fameseg", timezone: TZ, seoKeywords: ["puertas"], aiProfile: "", brandIdentity: null, seoLanguage: "es", connections: [{ channel: "facebook" }, { channel: "instagram" }], createdAt: new Date() });
});

describe("aceptar, deshacer y rechazar", () => {
  it("aceptar aplica el cambio (sin perder el estado del motor), lo anota y se puede deshacer", async () => {
    seedCampaign();
    const p = seedProposal();
    const r = await acceptProposal(p.id as string, { businessId: BIZ });
    expect(r.ok).toBe(true);
    const c = mem.campaigns[0];
    expect((c.rules as { postTimes: string[] }).postTimes).toEqual(["10:00", "13:00", "19:00"]);
    expect((c.rules as { engine: { handled: string[] } }).engine.handled).toEqual(["2026-10-10T16:00:00.000Z"]);
    expect(p.status).toBe("applied");
    const stored = readAction(p.action);
    expect(stored?.applied?.before).toEqual({ postTimes: ["10:00", "13:00", "18:00"] });
    expect(stored?.applied?.actor).toBe("approved");
    expect(mem.actions).toHaveLength(1);
    expect(mem.actions[0]).toMatchObject({ kind: "proposal.applied", actor: "approved", campaignId: "c1" });
    expect(canUndo({ status: p.status as string, action: stored }, new Date())).toBe(true);

    // Dos veces no se aplica.
    expect((await acceptProposal(p.id as string, { businessId: BIZ })).ok).toBe(false);

    const u = await undoProposal(p.id as string, { businessId: BIZ });
    expect(u.ok).toBe(true);
    expect((c.rules as { postTimes: string[] }).postTimes).toEqual(["10:00", "13:00", "18:00"]);
    expect(p.status).toBe("rejected");
    expect(mem.actions[1]).toMatchObject({ kind: "proposal.undone", actor: "owner" });
    expect((await undoProposal(p.id as string, { businessId: BIZ })).ok).toBe(false);
  });

  it("no se puede deshacer después de 24 horas", async () => {
    seedCampaign();
    const p = seedProposal();
    await acceptProposal(p.id as string, { businessId: BIZ, now: new Date(Date.now() - 25 * 3_600_000) });
    const u = await undoProposal(p.id as string, { businessId: BIZ });
    expect(u.ok).toBe(false);
  });

  it("revisa otra vez al aplicar: si la campaña se paró, no toca nada", async () => {
    seedCampaign({ status: "stopped" });
    const p = seedProposal();
    const r = await acceptProposal(p.id as string, { businessId: BIZ });
    expect(r.ok).toBe(false);
    expect(p.status).toBe("proposed");
    expect((mem.campaigns[0].rules as { postTimes: string[] }).postTimes).toEqual(["10:00", "13:00", "18:00"]);
    expect(mem.actions).toHaveLength(0);
  });

  it("revisa los topes al aplicar: subir el gasto por día que ya no cabe se rechaza", async () => {
    seedCampaign({ spentCents: 9_900, ads: { items: [ad({ id: "a1", dailyCents: 500 })] } });
    const p = seedProposal({ kind: "ads-budget", action: { type: "ad.daily", campaignId: "c1", adId: "a1", dailyCents: 600 } });
    const r = await acceptProposal(p.id as string, { businessId: BIZ });
    expect(r.ok).toBe(false);
    expect(readCampaignAds(mem.campaigns[0].ads).items[0].dailyCents).toBe(500);
  });

  it("bajar el gasto por día se aplica y se deshace", async () => {
    seedCampaign({ ads: { items: [ad({ id: "a1", dailyCents: 500 })] } });
    const p = seedProposal({ kind: "ads-budget", action: { type: "ad.daily", campaignId: "c1", adId: "a1", dailyCents: 350 } });
    expect((await acceptProposal(p.id as string, { businessId: BIZ })).ok).toBe(true);
    expect(readCampaignAds(mem.campaigns[0].ads).items[0].dailyCents).toBe(350);
    expect((await undoProposal(p.id as string, { businessId: BIZ })).ok).toBe(true);
    expect(readCampaignAds(mem.campaigns[0].ads).items[0].dailyCents).toBe(500);
  });

  it("pausar un anuncio pasa por la pausa de siempre y NO se puede deshacer (encender es del dueño)", async () => {
    seedCampaign({ ads: { items: [ad({ id: "a1" })] } });
    const p = seedProposal({ kind: "ads-pause", action: { type: "ad.pause", campaignId: "c1", adId: "a1" } });
    expect((await acceptProposal(p.id as string, { businessId: BIZ })).ok).toBe(true);
    expect(mem.paused).toEqual(["a1"]);
    expect(canUndo({ status: p.status as string, action: readAction(p.action) }, new Date())).toBe(false);
  });

  it("palabra clave: se agrega a las que se siguen y se quita al deshacer", async () => {
    const p = seedProposal({ campaignId: null, kind: "keyword", action: { type: "keyword.track", keywords: ["Portones Managua"] } });
    expect((await acceptProposal(p.id as string, { businessId: BIZ })).ok).toBe(true);
    expect(mem.businesses[0].seoKeywords).toEqual(["puertas", "portones managua"]);
    expect((await undoProposal(p.id as string, { businessId: BIZ })).ok).toBe(true);
    expect(mem.businesses[0].seoKeywords).toEqual(["puertas"]);
  });

  it("idea de publicación: queda como borrador en la campaña; deshacer lo borra si sigue en borrador", async () => {
    seedCampaign();
    const p = seedProposal({ kind: "content", action: { type: "post.draft", campaignId: "c1", text: "Mira cómo instalamos este portón", postKind: "post" } });
    expect((await acceptProposal(p.id as string, { businessId: BIZ })).ok).toBe(true);
    expect(mem.posts).toHaveLength(1);
    expect(mem.posts[0]).toMatchObject({ status: "draft", campaignId: "c1", source: "ai" });
    expect(mem.actions[0].postId).toBe(mem.posts[0].id);
    expect((await undoProposal(p.id as string, { businessId: BIZ })).ok).toBe(true);
    expect(mem.posts).toHaveLength(0);
  });

  it("un consejo se acepta sin cambiar nada; rechazar guarda el motivo", async () => {
    const tip = seedProposal({ kind: "ads-budget", action: null });
    expect((await acceptProposal(tip.id as string, { businessId: BIZ })).ok).toBe(true);
    expect(tip.status).toBe("accepted");
    expect(mem.actions).toHaveLength(0);
    const other = seedProposal({ id: "zz" });
    expect((await rejectProposal("zz", "Ahora no", { businessId: BIZ })).ok).toBe(true);
    expect(other.status).toBe("rejected");
    expect((other.detail as { rejectReason: string }).rejectReason).toBe("Ahora no");
  });

  it("una propuesta vieja vence al intentar aceptarla", async () => {
    seedCampaign();
    const p = seedProposal({ createdAt: new Date(Date.now() - 15 * DAY) });
    expect((await acceptProposal(p.id as string, { businessId: BIZ })).ok).toBe(false);
    expect(p.status).toBe("expired");
  });

  it("de otro negocio no se puede tocar", async () => {
    seedCampaign();
    const p = seedProposal();
    expect((await acceptProposal(p.id as string, { businessId: "otro" })).ok).toBe(false);
    expect(p.status).toBe("proposed");
  });

  it("aplicar solo (actor auto) se niega para lo que no es de bajo riesgo", async () => {
    seedCampaign({ mode: "auto", rules: { ...rules(), autoApplyProposals: true } });
    const p = seedProposal({ kind: "channel", action: { type: "campaign.update", campaignId: "c1", patch: { addChannels: ["instagram"] } } });
    expect((await acceptProposal(p.id as string, { businessId: BIZ, actor: "auto" })).ok).toBe(false);
    expect(p.status).toBe("proposed");
  });
});

describe("generar: reglas, no repetir y aplicar solas", () => {
  function seedTargets() {
    const now = Date.now();
    const hours = [19, 19, 19, 19, 10, 10, 13, 13, 18, 18];
    hours.forEach((h, i) => {
      const d = new Date(now - (i + 2) * DAY);
      const local = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h + 6, 5));
      mem.targets.push({
        id: `t${i}`,
        status: "sent",
        channel: "facebook",
        sentAt: local,
        post: { id: `post${i}`, kind: "post", campaignId: "c1" },
        metrics: [{ reach: 300, impressions: 0, likes: h === 19 ? 30 : 5, comments: 1, shares: 0, saves: 0, clicks: 0 }],
      });
    });
  }

  it("crea la propuesta de horario, la guarda con su «por qué» y no la repite en la segunda vuelta", async () => {
    seedCampaign();
    seedTargets();
    const now = new Date();
    const r1 = await generateProposals(BIZ, now, { actor: "auto", useAi: false });
    expect(r1.created).toBe(1);
    expect(mem.proposals[0]).toMatchObject({ kind: "timing", status: "proposed", campaignId: "c1" });
    expect(readEvidence(mem.proposals[0].evidence).facts.length).toBe(2);
    expect(mem.reports.find((x) => x.kind === "proposals")).toBeTruthy();
    const r2 = await generateProposals(BIZ, now, { actor: "auto", useAi: false });
    expect(r2.created).toBe(0);
    expect(mem.proposals).toHaveLength(1);
  });

  it("en 100% IA con permiso, el horario se aplica solo (actor auto)", async () => {
    seedCampaign({ mode: "auto", rules: { ...rules(), autoApplyProposals: true } });
    seedTargets();
    const r = await generateProposals(BIZ, new Date(), { actor: "auto", useAi: false });
    expect(r.autoApplied).toBe(1);
    expect(mem.proposals[0].status).toBe("applied");
    expect(mem.actions[0]).toMatchObject({ kind: "proposal.applied", actor: "auto" });
    expect((mem.campaigns[0].rules as { postTimes: string[] }).postTimes).toContain("19:00");
  });

  it("sin permiso queda esperando al dueño", async () => {
    seedCampaign({ mode: "auto" });
    seedTargets();
    const r = await generateProposals(BIZ, new Date(), { actor: "auto", useAi: false });
    expect(r.autoApplied).toBe(0);
    expect(mem.proposals[0].status).toBe("proposed");
  });

  it("la redacción de la IA cambia solo los textos y sus ideas pasan por las mismas reglas", () => {
    const d = detectProposals(input({ posts: timingPosts() }));
    const out = mergeWording(
      d,
      {
        items: [{ ref: "p0", titleEs: "Publica a las 7 de la noche", titleEn: "Post at 7 in the evening", detailEs: "", detailEn: "" }],
        ideas: [{ campaignRef: "c1", titleEs: "Antes y después", titleEn: "Before and after", whyEs: "Gusta.", whyEn: "People like it.", postText: "Así quedó este portón." }],
      },
      [campaign()],
      NOW,
      TZ,
    );
    expect(out[0].title.es).toBe("Publica a las 7 de la noche");
    expect(out[0].detail.es).toBe(d[0].detail.es);
    expect(out[0].action).toEqual(d[0].action);
    const idea = out.at(-1)!;
    expect(idea).toMatchObject({ kind: "content", action: { type: "post.draft", campaignId: "c1", text: "Así quedó este portón." } });
  });
});
