import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  addDays,
  businessTz,
  dailyDueDay,
  dailyKey,
  dayRange,
  daysRange,
  isDay,
  isValidTz,
  minutesSinceMidnight,
  suggestTz,
  yesterday,
} from "@/lib/business-tz";
import {
  adsSection,
  alertsSection,
  buildPeriodReport,
  dayPeriod,
  isQuiet,
  parseRange,
  periodText,
  postsSection,
  presetPeriod,
  rankingsSection,
  reportCounts,
  reviewsSection,
  webSection,
  type InputCampaign,
  type InputTarget,
  type ReportInputs,
} from "@/lib/report-period";
import { readAdSnapshot } from "@/lib/report-period-load";
import { highlightFacts, reportSections, ruleHighlights } from "@/lib/report-period-view";
import { buildDailyEmail, closesDay, dailyRecipients, dailySubject, displayState, publicBase, readDailyRecord, readReportSettingsJson, reportHighlights, reportUrl } from "@/lib/daily-report";
import { pdfText, periodPdfName, renderPeriodPdf } from "@/lib/report-period-pdf";

const MGA = "America/Managua";
const NY = "America/New_York";
const H = 3600_000;
// 9 de octubre de 2026, 9:00 a. m. en Managua (UTC−6).
const NOW = new Date("2026-10-09T15:00:00.000Z");

// ---------- Zona horaria y días ----------

describe("business-tz", () => {
  it("validates IANA zones and falls back to the app zone", () => {
    expect(isValidTz("America/Managua")).toBe(true);
    expect(isValidTz("Mars/Olympus")).toBe(false);
    expect(isValidTz("")).toBe(false);
    expect(isValidTz("America/New York")).toBe(false);
    expect(businessTz({ timezone: "America/Managua" })).toBe(MGA);
    expect(businessTz({ timezone: "nope/nope" })).toBe(process.env.BUSINESS_TZ || NY);
    expect(businessTz({ timezone: "" })).toBe(process.env.BUSINESS_TZ || NY);
  });

  it("gives [start, end) of a local day in UTC (Managua has no DST)", () => {
    const r = dayRange(MGA, "2026-10-08");
    expect(r.from.toISOString()).toBe("2026-10-08T06:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-09T06:00:00.000Z");
  });

  it("handles DST days: 23 hours in spring, 25 in fall (New York)", () => {
    const spring = dayRange(NY, "2026-03-08");
    expect(spring.from.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect((spring.to.getTime() - spring.from.getTime()) / H).toBe(23);
    const fall = dayRange(NY, "2026-11-01");
    expect(fall.from.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect((fall.to.getTime() - fall.from.getTime()) / H).toBe(25);
    const week = daysRange(NY, "2026-03-05", "2026-03-11");
    expect((week.to.getTime() - week.from.getTime()) / H).toBe(7 * 24 - 1);
  });

  it("knows yesterday and when midnight has passed since the last report", () => {
    expect(yesterday(MGA, NOW)).toBe("2026-10-08");
    // 23:30 del 8 en Managua: todavía es el 8 → toca el 7 si no se mandó.
    const late = new Date("2026-10-09T05:30:00.000Z");
    expect(yesterday(MGA, late)).toBe("2026-10-07");
    // 00:02 del 9: dentro de los minutos de gracia → todavía no.
    const justAfter = new Date("2026-10-09T06:02:00.000Z");
    expect(minutesSinceMidnight(MGA, justAfter)).toBe(2);
    expect(dailyDueDay(null, MGA, justAfter)).toBeNull();
    const after = new Date("2026-10-09T06:06:00.000Z");
    expect(dailyDueDay(null, MGA, after)).toBe("2026-10-08");
    expect(dailyDueDay("2026-10-07", MGA, after)).toBe("2026-10-08");
    expect(dailyDueDay("2026-10-08", MGA, after)).toBeNull();
    // Nunca días viejos atrasados: siempre ayer.
    expect(dailyDueDay("2026-09-01", MGA, after)).toBe("2026-10-08");
  });

  it("has a stable idempotency key per business and day", () => {
    expect(dailyKey("b1", "2026-10-08")).toBe("daily:b1:2026-10-08");
    expect(dailyKey("b1", "2026-10-08")).not.toBe(dailyKey("b1", "2026-10-09"));
    expect(dailyKey("b1", "2026-10-08")).not.toBe(dailyKey("b2", "2026-10-08"));
  });

  it("checks day strings and adds days across months", () => {
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-10-08")).toBe(true);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("suggests a time zone from the business place", () => {
    expect(suggestTz({ city: "Managua", country: "Nicaragua" })).toBe(MGA);
    expect(suggestTz({ country: "Nicaragua" })).toBe(MGA);
    expect(suggestTz({ city: "Miami", state: "Florida", country: "United States" })).toBe(NY);
    expect(suggestTz({ city: "Houston", country: "United States" })).toBe("America/Chicago");
    expect(suggestTz({ state: "TX", country: "United States" })).toBe("America/Chicago");
    expect(suggestTz({ city: "San José", country: "Costa Rica" })).toBe("America/Costa_Rica");
    expect(suggestTz({ city: "San Jose", state: "California", country: "United States" })).toBe("America/Los_Angeles");
    expect(suggestTz({ city: "León", country: "México" })).toBe("America/Mexico_City");
    expect(suggestTz({ city: "León", country: "Nicaragua" })).toBe(MGA);
    expect(suggestTz({ city: "Cancún", country: "Mexico" })).toBe("America/Cancun");
    expect(suggestTz({ city: "Atlantis" })).toBeNull();
    expect(suggestTz(null)).toBeNull();
  });
});

// ---------- Periodos ----------

describe("periods", () => {
  it("builds the presets in the business time zone", () => {
    const y = presetPeriod("ayer", MGA, NOW);
    expect([y.fromDay, y.toDay, y.days]).toEqual(["2026-10-08", "2026-10-08", 1]);
    expect(y.prevFrom.toISOString()).toBe("2026-10-07T06:00:00.000Z");
    const w = presetPeriod("7-dias", MGA, NOW);
    expect([w.fromDay, w.toDay, w.days]).toEqual(["2026-10-02", "2026-10-08", 7]);
    const m = presetPeriod("mes-pasado", MGA, NOW);
    expect([m.fromDay, m.toDay]).toEqual(["2026-09-01", "2026-09-30"]);
    expect(m.prevFrom.toISOString()).toBe("2026-08-01T06:00:00.000Z");
    const tm = presetPeriod("este-mes", MGA, NOW);
    expect([tm.fromDay, tm.toDay]).toEqual(["2026-10-01", "2026-10-09"]);
  });

  it("parses the URL range: default, reversed, future, too long and preset names", () => {
    expect(parseRange({}, MGA, NOW).preset).toBe("ayer");
    const rev = parseRange({ desde: "2026-10-05", hasta: "2026-10-01" }, MGA, NOW);
    expect([rev.fromDay, rev.toDay, rev.preset]).toEqual(["2026-10-01", "2026-10-05", "custom"]);
    const fut = parseRange({ desde: "2026-10-07", hasta: "2026-12-31" }, MGA, NOW);
    expect(fut.toDay).toBe("2026-10-09");
    const long = parseRange({ desde: "2020-01-01", hasta: "2026-10-08" }, MGA, NOW);
    expect(long.days).toBe(366);
    expect(parseRange({ desde: "2026-10-02", hasta: "2026-10-08" }, MGA, NOW).preset).toBe("7-dias");
    expect(parseRange({ p: "mes-pasado" }, MGA, NOW).fromDay).toBe("2026-09-01");
    expect(parseRange({ desde: "basura" }, MGA, NOW).preset).toBe("ayer");
  });

  it("writes the period in words", () => {
    expect(periodText(dayPeriod("2026-10-08", MGA), "en")).toBe("Oct 8, 2026");
    expect(periodText(dayPeriod("2026-10-08", MGA), "es", "long")).toContain("8 de octubre de 2026");
  });
});

// ---------- Datos de prueba ----------

const DAY = dayPeriod("2026-10-08", MGA);
const at = (h: number) => new Date(DAY.from.getTime() + h * H);

const target = (o: Partial<InputTarget>): InputTarget => ({
  id: "t1",
  postId: "p1",
  channel: "facebook",
  status: "sent",
  externalUrl: "https://facebook.com/123_456",
  detail: "",
  at: at(10),
  title: "Portones enrollables en Managua",
  campaignId: "c1",
  kind: "post",
  ...o,
});

const adItem = (o: Record<string, unknown> = {}) => ({
  id: "ad_1",
  platform: "meta",
  name: "Llamadas Managua",
  goal: "calls",
  source: { kind: "new", text: "x", headline: "y", image: "", link: "" },
  ext: {},
  status: "active",
  dailyCents: 500,
  totalCents: 5000,
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-10-20T00:00:00.000Z",
  targeting: { lat: 12.1, lng: -86.2, radiusKm: 10, ageMin: null, ageMax: null, interests: [], place: "Managua", cityKey: "" },
  specialCategory: "NONE",
  insights: { spentCents: 1800, todayCents: 300, monthCents: 1800, impressions: 9000, reach: 4000, clicks: 120, results: 9, fetchedAt: "2026-10-09T06:03:00.000Z" },
  createdAt: "2026-10-01T15:00:00.000Z",
  createdBy: "owner",
  errors: [{ at: at(14).toISOString(), es: "Meta rechazó la foto.", en: "Meta rejected the photo." }],
  ...o,
});

const campaign = (o: Partial<InputCampaign> = {}): InputCampaign => ({
  id: "c1",
  name: "Portones octubre",
  status: "active",
  mode: "auto",
  startsAt: new Date("2026-10-01T00:00:00Z"),
  endsAt: null,
  ads: { aiCanCreate: false, dailyCapCents: 0, items: [adItem()], proposals: [] },
  ...o,
});

const rankRow = (keyword: string, position: number | null, top: { position: number; domain: string }[] = []) => ({
  keyword,
  position,
  url: null,
  localPack: null,
  top: top.map((t) => ({ ...t, title: t.domain, url: `https://${t.domain}` })),
  features: [],
});

function richInputs(): ReportInputs {
  return {
    business: { id: "biz1", name: "Fameseg <Portones>", color: "#bb1111", color2: "", color3: "", website: "https://fameseg.com", logoUrl: "", fontHeading: "montserrat", aiText: "" },
    period: DAY,
    now: new Date("2026-10-09T06:10:00.000Z"),
    zones: [{ code: 2558, name: "Nicaragua" }],
    targets: [
      target({}),
      target({ id: "t2", channel: "instagram", externalUrl: "https://instagram.com/p/abc", at: at(10.1) }),
      target({ id: "t3", channel: "linkedin", status: "failed", externalUrl: "", detail: "LinkedIn pidió volver a conectar la cuenta.", at: at(10.2) }),
      target({ id: "t4", channel: "tiktok", status: "skipped", externalUrl: "", detail: "TikTok solo recibe videos", at: at(10.3) }),
    ],
    prevSent: 1,
    recentTargets: [target({}), target({ id: "t2", channel: "instagram", externalUrl: "https://instagram.com/p/abc" })],
    actions: [
      { id: "a1", kind: "post.scheduled", actor: "auto", summary: { es: "La IA programó una publicación para el viernes.", en: "The AI scheduled a post for Friday." }, costCents: 4, createdAt: at(9), campaignId: "c1" },
      { id: "a2", kind: "campaign.paused", actor: "auto", summary: { es: "La campaña se pausó por llegar al límite del día.", en: "The campaign paused after hitting the daily limit." }, costCents: 0, createdAt: at(16), campaignId: "c1" },
      { id: "a3", kind: "post.approved", actor: "approved", summary: { es: "Aprobaste una publicación.", en: "You approved a post." }, costCents: 0, createdAt: at(11), campaignId: "c1" },
    ],
    prevActions: { auto: 3, costCents: 7 },
    campaigns: [campaign()],
    adSnapshots: [{ at: new Date("2026-10-08T06:04:00.000Z"), items: [{ id: "ad_1", campaignId: "c1", spentCents: 1300, impressions: 6000, reach: 3000, clicks: 80, results: 6 }] }],
    metrics: [
      { postTargetId: "t1", channel: "facebook", fetchedAt: at(20), impressions: 900, reach: 700, likes: 30, comments: 4, shares: 2, saves: 1, clicks: 12, videoViews: 0 },
      { postTargetId: "t1", channel: "facebook", fetchedAt: at(12), impressions: 100, reach: 80, likes: 3, comments: 0, shares: 0, saves: 0, clicks: 1, videoViews: 0 },
      { postTargetId: "t2", channel: "instagram", fetchedAt: at(20), impressions: 400, reach: 350, likes: 20, comments: 1, shares: 0, saves: 3, clicks: 0, videoViews: 0 },
    ],
    reviews: {
      createdAt: at(22),
      data: {
        total: 41,
        rating: 4.8,
        createdAt: at(22).toISOString(),
        reviews: [
          { id: "r1", name: "Ana López", rating: 5, text: "Excelente servicio, muy rápidos.", timestamp: at(13).toISOString(), url: "https://maps.google.com/r1" },
          { id: "r2", name: "Pedro", rating: 2, text: "Tardaron en llegar.", timestamp: at(15).toISOString(), ownerAnswer: "Gracias, Pedro." },
          { id: "r3", name: "Old", rating: 5, text: "Viejo", timestamp: "2026-09-01T12:00:00.000Z" },
        ],
      },
    },
    gbp: null,
    ga4: {
      createdAt: new Date("2026-10-09T05:00:00.000Z"),
      data: {
        propertyId: "1",
        fetchedAt: "2026-10-09T05:00:00.000Z",
        range: { start: "2026-09-11", end: "2026-10-08" },
        previousRange: { start: "2026-08-14", end: "2026-09-10" },
        totals: { users: 300, newUsers: 200, sessions: 420, engagedSessions: 200, engagementRate: 0.5, avgEngagementSec: 40, keyEvents: 12, pageViews: 900 },
        previous: { users: 250, newUsers: 180, sessions: 380, engagedSessions: 150, engagementRate: 0.4, avgEngagementSec: 30, keyEvents: 8, pageViews: 800 },
        channels: [{ key: "Organic Search", sessions: 200, prevSessions: 150, engagedSessions: 100, keyEvents: 5 }],
        organicTrend: [
          { date: "2026-10-06", sessions: 6 },
          { date: "2026-10-07", sessions: 9 },
          { date: "2026-10-08", sessions: 14 },
        ],
      },
    },
    rank: [
      {
        createdAt: at(8),
        data: { location: "Nicaragua", locationCode: 2558, rows: [rankRow("portones enrollables", 2), rankRow("cortinas metálicas", 15, [{ position: 1, domain: "rival.com.ni" }])] },
      },
      {
        createdAt: new Date(DAY.from.getTime() - 6 * 24 * H),
        data: { location: "Nicaragua", locationCode: 2558, rows: [rankRow("portones enrollables", 6), rankRow("cortinas metálicas", 8, [{ position: 1, domain: "fameseg.com" }])] },
      },
    ],
    tasksDone: [{ title: { es: "Agregar el horario en Google", en: "Add hours on Google" }, area: "maps", href: "/b/biz1/seo", impact: 3, effort: 1, doneAt: at(12) }],
    tasksOpen: [{ title: { es: "Pedir 5 reseñas a clientes", en: "Ask 5 customers for reviews" }, area: "maps", href: "/b/biz1/directorios", impact: 3, effort: 1, doneAt: null }],
    proposals: [{ id: "pr1", kind: "timing", title: { es: "Publicar a las 7 p. m.", en: "Post at 7 p.m." }, impact: 3, status: "proposed", createdAt: at(5) }],
    upcoming: { count: 2, next: new Date("2026-10-09T15:00:00.000Z") },
  };
}

function quietInputs(): ReportInputs {
  const r = richInputs();
  return { ...r, targets: [], recentTargets: [], actions: [], prevActions: { auto: 0, costCents: 0 }, campaigns: [], adSnapshots: [], metrics: [], reviews: null, ga4: null, rank: [], tasksDone: [], proposals: [] };
}

// ---------- Secciones ----------

describe("section builders", () => {
  it("counts posts per channel, newest first, with links only for sent ones", () => {
    const p = postsSection(richInputs().targets, 1)!;
    expect([p.sent, p.failed, p.skipped, p.prevSent]).toEqual([2, 1, 1, 1]);
    expect(p.items[0].channel).toBe("tiktok");
    expect(p.items.find((i) => i.status === "failed")!.url).toBe("");
    expect(p.items.find((i) => i.channel === "facebook")!.url).toContain("facebook.com");
    expect(postsSection([], 0)).toBeNull();
  });

  it("subtracts the previous daily snapshot to get the ads spend of the day", () => {
    const i = richInputs();
    const a = adsSection(i.campaigns, i.adSnapshots, DAY, i.now)!;
    expect(a.rows[0].cumulative).toBe(false);
    expect(a.spentCents).toBe(500);
    expect(a.results).toBe(3);
    expect(a.rows[0].clicks).toBe(40);
  });

  it("says «acumulado» when there's no snapshot to subtract", () => {
    const i = richInputs();
    const a = adsSection(i.campaigns, [], DAY, i.now)!;
    expect(a.rows[0].cumulative).toBe(true);
    expect(a.spentCents).toBe(0);
    expect(a.cumulativeCents).toBe(1800);
    // Un anuncio creado dentro del periodo empieza en 0: no necesita foto.
    const fresh = campaign({ ads: { items: [adItem({ createdAt: at(2).toISOString() })] } });
    expect(adsSection([fresh], [], DAY, i.now)!.rows[0]).toMatchObject({ cumulative: false, spentCents: 1800 });
  });

  it("finds new reviews in the period and notes when they weren't checked after it", () => {
    const i = richInputs();
    const r = reviewsSection(i.reviews, null, DAY)!;
    expect(r.newCount).toBe(2);
    expect(r.rating).toBe(4.8);
    expect(r.items.map((x) => x.name)).toEqual(["Pedro", "Ana López"]);
    expect(r.items[0].answered).toBe(true);
    expect(r.stale).toBe(true);
    // Un día sin reseñas nuevas no se muestra.
    expect(reviewsSection({ ...i.reviews!, data: { ...(i.reviews!.data as object), reviews: [] } }, null, DAY)).toBeNull();
  });

  it("uses GA4 daily organic visits when they cover the period, else only the 28-day window", () => {
    const i = richInputs();
    const w = webSection(i.ga4, DAY)!;
    expect(w.organic).toBe(14);
    expect(w.prevOrganic).toBe(9);
    expect(w.window.sessions).toBe(420);
    const older = webSection(i.ga4, dayPeriod("2026-09-01", MGA))!;
    expect(older.organic).toBeNull();
  });

  it("compares rankings with the last check before the period (alerts.ts logic)", () => {
    const i = richInputs();
    const k = rankingsSection(i.rank, i.zones, DAY)!;
    expect(k.zones[0].avgPosition).toBe(8.5);
    expect(k.bad.map((x) => x.kind)).toContain("page1-exit");
    expect(k.bad.find((x) => x.kind === "new-competitor")?.domain).toBe("rival.com.ni");
    expect(k.good.map((x) => x.kind)).toContain("top3-enter");
    expect(rankingsSection(i.rank, i.zones, dayPeriod("2026-10-05", MGA))).toBeNull();
  });

  it("collects alerts: publish failures, campaign pauses and ad errors", () => {
    const i = richInputs();
    const a = alertsSection(i.targets, i.actions, i.campaigns, DAY, "biz1")!;
    const texts = a.items.map((x) => x.text.es).join(" | ");
    expect(texts).toContain("LinkedIn");
    expect(texts).toContain("se pausó");
    expect(texts).toContain("Meta rechazó la foto");
    expect(a.items.every((x) => x.tone === "bad")).toBe(true);
  });

  it("builds the full report, its counts, and detects a quiet day", () => {
    const r = buildPeriodReport(richInputs());
    expect(r.posts && r.results && r.campaigns && r.ai && r.ads && r.reviews && r.web && r.rankings && r.tasks && r.proposals && r.alerts && r.costs && r.next).toBeTruthy();
    expect(r.results!.rows[0].interactions).toBe(37);
    expect(r.ai!.total).toBe(2);
    expect(r.ai!.approved).toBe(1);
    expect(r.costs).toMatchObject({ aiCents: 4, adsCents: 500, prevAiCents: 7 });
    expect(isQuiet(r)).toBe(false);
    expect(reportCounts(r)).toMatchObject({ sent: 2, failed: 1, ai: 2, reviews: 2, tasks: 1, proposals: 1 });
    const q = buildPeriodReport(quietInputs());
    expect(isQuiet(q)).toBe(true);
    expect(q.next?.tasks.length).toBe(1);
  });

  it("turns the report into the same sections for screen, email and PDF", () => {
    const r = buildPeriodReport(richInputs());
    const ids = reportSections(r, "es").map((s) => s.id);
    expect(ids).toEqual(["alerts", "posts", "results", "campaigns", "ai", "ads", "reviews", "web", "rankings", "tasks", "proposals", "costs", "next"]);
    const en = reportSections(r, "en");
    expect(en.find((s) => s.id === "ai")!.title).toBe("What the AI did on its own");
    const hl = ruleHighlights(r, "es");
    expect(hl).toHaveLength(3);
    expect(hl[0]).toMatch(/atención/i);
    const quiet = ruleHighlights(buildPeriodReport(quietInputs()), "es");
    expect(quiet[0]).toMatch(/tranquilo/);
    expect(quiet).toHaveLength(3);
  });
});

// ---------- «Lo más importante» con IA ----------

describe("reportHighlights", () => {
  const r = buildPeriodReport(richInputs());
  it("uses the AI bullets when every number is in the data", async () => {
    const h = await reportHighlights(r, "es", { ai: true, ask: async () => ({ bullets: ["Una publicación no salió en LinkedIn.", "Llegaron 2 reseñas nuevas en Google.", "Los anuncios gastaron $5."] }) });
    expect(h.source).toBe("ai");
    expect(h.items).toHaveLength(3);
  });
  it("falls back to the rules when the AI invents a number, fails or isn't asked", async () => {
    expect((await reportHighlights(r, "es", { ai: true, ask: async () => ({ bullets: ["Ganaste 937 clientes.", "Bien.", "Muy bien hecho todo."] }) })).source).toBe("rules");
    expect((await reportHighlights(r, "es", { ai: true, ask: async () => Promise.reject(new Error("429")) })).source).toBe("rules");
    expect((await reportHighlights(r, "es", { ai: false })).items).toEqual(ruleHighlights(r, "es"));
  });
  it("gives the AI only facts with exact numbers", () => {
    const facts = highlightFacts(r, "en").join("\n");
    expect(facts).toContain("Posts sent: 2");
    expect(facts).toContain("New Google reviews: 2");
  });
});

// ---------- Email ----------

describe("daily email", () => {
  const r = buildPeriodReport(richInputs());
  const hl = { items: ruleHighlights(r, "es"), source: "rules" as const };

  it("has the brand header, highlights, sections and the full-report link", () => {
    const e = buildDailyEmail(r, "es", hl, { baseUrl: "https://matya.app" });
    expect(e.html).toContain("MATYA");
    expect(e.html).toContain("Fameseg &lt;Portones&gt;");
    expect(e.html).not.toContain("Fameseg <Portones>");
    expect(e.html).toContain("Lo más importante del día");
    for (const title of ["Publicaciones", "Lo que hizo la IA sola", "Anuncios pagados", "Reseñas en Google", "Tus posiciones en Google", "Próximos pasos"]) expect(e.html).toContain(title);
    expect(e.html).toContain("https://matya.app/b/biz1/reportes?desde=2026-10-08&amp;hasta=2026-10-08");
    expect(e.html).toContain("https://facebook.com/123_456");
    expect(e.html).toContain("https://matya.app/b/biz1/historial");
    expect(e.html).toContain("#bb1111");
    expect(e.html).toContain('name="viewport"');
    expect(e.text).toContain("Ver el reporte completo: https://matya.app/b/biz1/reportes?desde=2026-10-08&hasta=2026-10-08");
    expect(e.subject).toContain("Fameseg <Portones>");
    expect(e.subject).toContain("2 publicaciones");
  });

  it("is written in English for English businesses and short on quiet days", () => {
    const e = buildDailyEmail(r, "en", { items: ruleHighlights(r, "en"), source: "rules" }, { baseUrl: "https://matya.app" });
    expect(e.html).toContain("See the full report");
    expect(e.html).toContain('lang="en"');
    const q = buildPeriodReport(quietInputs());
    expect(dailySubject(q, "es", true)).toMatch(/^Día tranquilo en/);
    const qe = buildDailyEmail(q, "es", { items: ruleHighlights(q, "es"), source: "rules" }, { baseUrl: "https://matya.app" });
    expect(qe.html).toContain("Día tranquilo");
    expect(qe.html).toContain("Próximos pasos");
    expect(qe.html).not.toContain("Anuncios pagados");
  });

  it("builds links and recipients safely", () => {
    expect(publicBase("matya.app/")).toBe("https://matya.app");
    expect(publicBase("http://localhost:3000")).toBe("http://localhost:3000");
    expect(publicBase("")).toBe("https://matya.app");
    expect(reportUrl("https://x.app/", "b 1", { fromDay: "2026-10-01", toDay: "2026-10-07" })).toBe("https://x.app/b/b%201/reportes?desde=2026-10-01&hasta=2026-10-07");
    expect(dailyRecipients({ reportEmail: "", ownerEmail: "Dueno@Ejemplo.com" })).toEqual(["dueno@ejemplo.com"]);
    expect(dailyRecipients({ reportEmail: "a@x.com, b@y.com", ownerEmail: "c@z.com" })).toEqual(["a@x.com", "b@y.com"]);
    expect(dailyRecipients({ reportEmail: "no-es-email", ownerEmail: "c@z.com" })).toEqual([]);
    expect(dailyRecipients({ reportEmail: "", ownerEmail: "" })).toEqual([]);
  });
});

// ---------- Registro del envío (idempotencia) ----------

describe("daily record", () => {
  const now = new Date("2026-10-09T07:00:00.000Z");
  it("closes the day once it was sent, skipped, is sending, or failed for good", () => {
    const base = { retry: false, attempts: 1, lastTryAt: "" };
    expect(closesDay({ ...base, state: "sent" }, now, now)).toBe(true);
    expect(closesDay({ ...base, state: "skipped" }, now, now)).toBe(true);
    expect(closesDay({ ...base, state: "sending" }, now, now)).toBe(true);
    expect(closesDay({ ...base, state: "error" }, now, now)).toBe(true);
    expect(closesDay({ state: "error", retry: true, attempts: 3, lastTryAt: "" }, now, now)).toBe(true);
    // Falló por algo pasajero: espera 10 minutos y se reintenta.
    expect(closesDay({ state: "error", retry: true, attempts: 1, lastTryAt: new Date(now.getTime() - 5 * 60_000).toISOString() }, now, now)).toBe(true);
    expect(closesDay({ state: "error", retry: true, attempts: 1, lastTryAt: new Date(now.getTime() - 11 * 60_000).toISOString() }, now, now)).toBe(false);
  });

  it("reads records defensively and shows a stuck send", () => {
    const rec = readDailyRecord({ day: "2026-10-08", state: "sent", trigger: "cron", to: ["a@x.com"], counts: { sent: 2 }, highlights: { items: ["a", "b", "c"], source: "ai" } })!;
    expect(rec).toMatchObject({ day: "2026-10-08", fromDay: "2026-10-08", state: "sent", to: ["a@x.com"] });
    expect(rec.highlights?.source).toBe("ai");
    expect(readDailyRecord(null)).toBeNull();
    expect(readDailyRecord({ state: "weird" })!.state).toBe("error");
    expect(displayState({ state: "sending" }, new Date(now.getTime() - 40 * 60_000), now)).toBe("stuck");
    expect(displayState({ state: "sending" }, new Date(now.getTime() - 5 * 60_000), now)).toBe("sending");
  });

  it("reads the stored ads snapshot and the report settings", () => {
    const s = readAdSnapshot({ ads: { at: "2026-10-08T06:04:00.000Z", items: [{ id: "ad_1", campaignId: "c1", spentCents: 1300.4, impressions: "x" }] } })!;
    expect(s.items[0]).toMatchObject({ id: "ad_1", spentCents: 1300, impressions: 0 });
    expect(readAdSnapshot({})).toBeNull();
    expect(readReportSettingsJson({ quietDays: "skip" }).quietDays).toBe("skip");
    expect(readReportSettingsJson(null).quietDays).toBe("send");
  });
});

// ---------- PDF ----------

describe("period PDF (smoke)", () => {
  it("cleans characters Helvetica can't draw", () => {
    expect(pdfText("★★★★★ Ana: genial")).toBe("(5/5) Ana: genial");
    expect(pdfText("4,8 ★")).toBe("4,8");
    expect(pdfText("UTC−6 → «hola»")).toBe("UTC-6 «hola»");
  });

  it("renders a rich report and a quiet one", async () => {
    const r = buildPeriodReport(richInputs());
    const pdf = await renderPeriodPdf(r, { lang: "es", highlights: ruleHighlights(r, "es"), logo: null, baseUrl: "https://matya.app" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(5_000);
    const q = buildPeriodReport(quietInputs());
    const qpdf = await renderPeriodPdf(q, { lang: "en", highlights: ruleHighlights(q, "en"), logo: null, baseUrl: "https://matya.app" });
    expect(qpdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(periodPdfName("Fameseg Puertas Ñ", r, "es")).toBe("reporte-fameseg-puertas-n-2026-10-08.pdf");
    const out = process.env.REPORT_PDF_DIR;
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(path.join(out, "period-report.pdf"), pdf);
    }
  }, 30_000);
});
