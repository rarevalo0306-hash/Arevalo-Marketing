import { describe, expect, it } from "vitest";
import {
  aiAlerts,
  buildAlertEmail,
  buildWeeklyEmail,
  closestWeekBefore,
  isWeeklyDue,
  parseAlertEmails,
  rankAlerts,
  readGapRecommendations,
  weeklyGbp,
  weeklyMovers,
  type WeeklyData,
} from "@/lib/seo/alerts";
import type { RankReport, RankRow } from "@/lib/seo/rank";
import type { VisibilityReport, VisibilityResult } from "@/lib/seo/visibility";

const row = (keyword: string, position: number | null, extra: Partial<RankRow> = {}): RankRow => ({
  keyword,
  position,
  url: null,
  localPack: null,
  top: [],
  features: [],
  ...extra,
});

const report = (rows: RankRow[], createdAt = "2026-10-05T12:00:00.000Z", location = "Miami,Florida,United States"): RankReport => ({
  location,
  locationCode: 1015116,
  language: "es",
  device: "mobile",
  rows,
  cost: 0,
  createdAt,
  avgPosition: null,
  inTop3: 0,
  inTop10: 0,
  visibility: 0,
});

const top = (...domains: string[]) => domains.map((domain, i) => ({ position: i + 1, domain, title: domain, url: `https://${domain}/` }));

describe("rankAlerts", () => {
  it("detects drops of 3+ places and ignores small moves", () => {
    const r = rankAlerts(report([row("techos", 12), row("goteras", 4)]), report([row("techos", 16), row("goteras", 6)]));
    expect(r.bad).toEqual([{ kind: "drop", keyword: "techos", from: 12, to: 16 }]);
    expect(r.good).toEqual([]);
    expect(r.zone).toBe("Miami, United States");
  });

  it("detects falling off page 1 (including disappearing) instead of a plain drop", () => {
    const r = rankAlerts(report([row("a", 9), row("b", 5)]), report([row("a", 13), row("b", null)]));
    expect(r.bad.map((a) => [a.kind, a.keyword, a.to])).toEqual([
      ["page1-exit", "a", 13],
      ["page1-exit", "b", null],
    ]);
  });

  it("detects leaving the map top 3 only when the map is shown", () => {
    const prev = report([row("a", 5, { localPack: { position: 2, names: [] } }), row("b", 5, { localPack: { position: 1, names: [] } })]);
    const cur = report([row("a", 5, { localPack: { position: null, names: ["X", "Y", "Z"] } }), row("b", 5, { localPack: null })]);
    const r = rankAlerts(prev, cur);
    expect(r.bad).toEqual([{ kind: "map-exit", keyword: "a", from: 2, to: null }]);
  });

  it("flags a new domain in the top 3 above you", () => {
    const prev = report([row("a", 4, { top: top("uno.com", "dos.com", "tres.com", "mio.com") })]);
    const cur = report([row("a", 4, { top: top("uno.com", "nuevo.com", "dos.com", "mio.com") })]);
    const r = rankAlerts(prev, cur);
    expect(r.bad).toEqual([{ kind: "new-competitor", keyword: "a", from: null, to: 2, domain: "nuevo.com" }]);
  });

  it("doesn't flag competitors below you or when there's no previous top", () => {
    const below = rankAlerts(report([row("a", 1, { top: top("mio.com", "x.com", "y.com") })]), report([row("a", 1, { top: top("mio.com", "x.com", "nuevo.com") })]));
    expect(below.bad).toEqual([]);
    const noPrev = rankAlerts(report([row("a", 5)]), report([row("a", 5, { top: top("x.com", "y.com", "z.com") })]));
    expect(noPrev.bad).toEqual([]);
  });

  it("keeps good news separately", () => {
    const prev = report([row("a", 15), row("b", 6), row("c", null), row("d", 8, { localPack: { position: null, names: ["X"] } })]);
    const cur = report([row("a", 9), row("b", 2), row("c", 12), row("d", 8, { localPack: { position: 3, names: ["X"] } })]);
    const r = rankAlerts(prev, cur);
    expect(r.bad).toEqual([]);
    expect(r.good.map((a) => [a.kind, a.keyword, a.from, a.to])).toEqual([
      ["climb", "a", 15, 9],
      ["top3-enter", "b", 6, 2],
      ["climb", "c", null, 12],
      ["map-enter", "d", null, 3],
    ]);
  });

  it("ignores rows with errors on either side and matches keywords case-insensitively", () => {
    const err = { es: "falló", en: "failed" };
    const r = rankAlerts(report([row("A", 3), row("b", 2, { error: err })]), report([row("a", 18, { error: err }), row("b", 20)]));
    expect(r.bad).toEqual([]);
    const ci = rankAlerts(report([row("Techos Miami", 2)]), report([row("techos miami", 9)]));
    expect(ci.bad.map((a) => a.kind)).toEqual(["drop"]);
  });
});

const vis = (results: Partial<VisibilityResult>[]): VisibilityReport => ({
  questions: [],
  results: results.map((r) => ({ question: "", provider: "gemini", answer: "", mentioned: false, position: null, sources: [], competitors: [], ...r })),
  score: null,
  byProvider: {},
  topCompetitors: [],
  topDomains: [],
  recommendations: [],
  lang: "es",
  startedAt: "",
  finishedAt: "",
});

describe("aiAlerts", () => {
  it("finds lost and gained mentions by provider and question", () => {
    const prev = vis([
      { provider: "gemini", question: "Mejor techero en Miami", mentioned: true },
      { provider: "openai", question: "Mejor techero en Miami", mentioned: false },
      { provider: "claude", question: "Reparar goteras", mentioned: true },
    ]);
    const cur = vis([
      { provider: "gemini", question: "mejor techero  en miami", mentioned: false },
      { provider: "openai", question: "Mejor techero en Miami", mentioned: true },
      { provider: "claude", question: "Reparar goteras", mentioned: false, error: "timeout" },
      { provider: "claude", question: "Pregunta nueva", mentioned: true },
    ]);
    expect(aiAlerts(prev, cur)).toEqual({
      lost: [{ provider: "gemini", question: "mejor techero  en miami" }],
      gained: [{ provider: "openai", question: "Mejor techero en Miami" }],
    });
  });
});

const biz = { id: "biz1", name: "Techos <Pérez>", color: "#ff0000" };
const opts = { baseUrl: "https://app.test", tz: "America/New_York" };

describe("buildAlertEmail", () => {
  const zones = [
    {
      zone: "Miami, United States",
      bad: [
        { kind: "drop" as const, keyword: "<script>alert(1)</script>", from: 4, to: 9 },
        { kind: "new-competitor" as const, keyword: "techos", from: null, to: 1, domain: "evil<b>.com" },
      ],
      good: [{ kind: "top3-enter" as const, keyword: "goteras", from: 5, to: 2 }],
    },
  ];

  it("escapes keywords and domains and links back to the app", () => {
    const e = buildAlertEmail(biz, zones, "es", opts);
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(e.html).toContain("evil&lt;b&gt;.com");
    expect(e.html).toContain("Techos &lt;Pérez&gt;");
    expect(e.html).toContain("https://app.test/b/biz1/seo");
    expect(e.html).toContain("#ff0000");
    expect(e.text).toContain("<script>alert(1)</script>");
    expect(e.subject).toBe("Aviso: 2 cambios en tus posiciones en Google — Techos <Pérez>");
    expect(e.html).toContain("Buenas noticias");
    expect(e.text).toContain("dejar de recibir");
  });

  it("speaks English", () => {
    const e = buildAlertEmail(biz, zones, "en", opts);
    expect(e.subject).toBe("Alert: 2 changes in your Google rankings — Techos <Pérez>");
    expect(e.html).toContain("Good news");
    expect(e.html).toContain("you dropped from #4 to #9");
    expect(e.text).toContain("To stop these emails");
  });

  it("falls back to the default brand color when the color is invalid", () => {
    const e = buildAlertEmail({ ...biz, color: "red;background:url(x)" }, zones, "es", opts);
    expect(e.html).toContain("#126BBC");
    expect(e.html).not.toContain("url(x)");
  });
});

const empty: WeeklyData = { zones: [], ai: null, audit: null, gsc: null, recommendations: [] };

describe("buildWeeklyEmail", () => {
  it("omits sections without data", () => {
    const e = buildWeeklyEmail(biz, empty, "es", opts);
    expect(e.html).toContain("Todavía no hay datos");
    expect(e.html).not.toContain("Tus posiciones en Google");
    expect(e.html).not.toContain("Search Console");
    expect(e.html).not.toContain("Lo que te recomendamos");
    expect(e.subject).toBe("Tu resumen SEO de la semana — Techos <Pérez>");
  });

  it("renders every section with escaping, in both languages", () => {
    const prev = report([row("<script>x</script>", 12, { top: top("a.com", "b.com", "c.com") }), row("goteras", 3)], "2026-09-28T12:00:00.000Z");
    const cur = { ...report([row("<script>x</script>", 4, { top: top("a.com", "<i>new</i>.com", "b.com") }), row("goteras", 9)]), avgPosition: 6.5, inTop3: 0, inTop10: 2, visibility: 20 };
    const data: WeeklyData = {
      zones: [{ label: "Miami, United States", cur, prev: { ...prev, avgPosition: 7.5, inTop3: 1, inTop10: 1, visibility: 15 } }],
      ai: {
        date: "2026-10-01T12:00:00.000Z",
        cur: { ...vis([{ provider: "gemini", question: "q", mentioned: true }]), score: 50, byProvider: { gemini: { score: 50, mentioned: 1, total: 2, errors: 0 } } },
        prev: { ...vis([{ provider: "gemini", question: "q", mentioned: false }]), score: 25, byProvider: { gemini: { score: 25, mentioned: 1, total: 4, errors: 0 } } },
      },
      audit: { score: 78, date: "2026-10-02T12:00:00.000Z" },
      gsc: { clicks: 120, impressions: 3400, prevClicks: 100, prevImpressions: 3400, start: "2026-09-04", end: "2026-10-01" },
      recommendations: [{ keyword: "<b>techos</b> baratos", volume: 1300, why: "gap" }],
    };
    const es = buildWeeklyEmail(biz, data, "es", opts);
    expect(es.html).not.toMatch(/<script>|<i>new|<b>techos/);
    expect(es.html).toContain("Tus posiciones en Google");
    expect(es.html).toContain("6,5 (+1)");
    expect(es.html).toContain("Lo que más subió");
    expect(es.html).toContain("Lo que más bajó");
    expect(es.html).toContain("Competidores nuevos en el top 3");
    expect(es.html).toContain("&lt;i&gt;new&lt;/i&gt;.com");
    expect(es.html).toContain("Gemini");
    expect(es.html).toContain("50 (+25)%");
    expect(es.html).toContain("Gemini ahora te menciona");
    expect(es.html).toContain("78 de 100");
    expect(es.html).toContain("Clics desde Google: 120 (+20%)");
    expect(es.html).toContain("Lo que te recomendamos esta semana");
    expect(es.html).toContain("&lt;b&gt;techos&lt;/b&gt; baratos");
    const en = buildWeeklyEmail(biz, data, "en", opts);
    expect(en.subject).toBe("Your weekly SEO summary — Techos <Pérez>");
    expect(en.html).toContain("Biggest climbs");
    expect(en.html).toContain("What we recommend this week");
    expect(en.text).toContain("Clicks from Google: 120 (+20%)");
  });

  it("skips the comparison when there's no report from a week ago", () => {
    const cur = { ...report([row("a", 4)]), avgPosition: 4, inTop3: 0, inTop10: 1, visibility: 7 };
    const e = buildWeeklyEmail(biz, { ...empty, zones: [{ label: "Miami", cur, prev: null }] }, "es", opts);
    expect(e.html).toContain("Tus posiciones en Google");
    expect(e.html).not.toContain("Lo que más subió");
    expect(e.html).not.toContain("(+");
  });
});

describe("weekly email: Google Business Profile", () => {
  const now = new Date("2026-10-05T12:00:00.000Z");
  const saved = {
    version: 1,
    total: 128,
    rating: 4.7,
    cost: 0.0075,
    createdAt: "2026-10-04T12:00:00.000Z",
    reviews: [
      { id: "r1", name: "Ana", rating: 5, text: "Excelente", timestamp: "2026-10-03T10:00:00.000Z", ownerAnswer: "" },
      { id: "r2", name: "Luis", rating: 2, text: "Lento", timestamp: "2026-10-01T10:00:00.000Z", ownerAnswer: "Lo sentimos" },
      { id: "r3", name: "Eva", rating: 4, text: "Bien", timestamp: "2026-09-01T10:00:00.000Z", ownerAnswer: "" },
    ],
  };

  it("weeklyGbp counts new reviews in the last 7 days and unanswered ones", () => {
    expect(weeklyGbp(saved, now)).toEqual({ rating: 4.7, total: 128, newLast7: 2, unanswered: 2, date: "2026-10-04T12:00:00.000Z" });
  });

  it("weeklyGbp is defensive with broken data", () => {
    expect(weeklyGbp(null, now)).toBeNull();
    expect(weeklyGbp({ reviews: "nope" }, now)).toBeNull();
    expect(weeklyGbp({ reviews: [null, { id: "" }, { id: "x", timestamp: "garbage" }] }, now)).toMatchObject({ newLast7: 0, unanswered: 1, total: null });
  });

  it("adds the section only when there's review data", () => {
    expect(buildWeeklyEmail(biz, empty, "es", opts).html).not.toContain("Tu perfil de Google");
    expect(buildWeeklyEmail(biz, { ...empty, gbp: null }, "es", opts).html).not.toContain("Tu perfil de Google");
    const gbp = weeklyGbp(saved, now);
    const es = buildWeeklyEmail(biz, { ...empty, gbp }, "es", opts);
    expect(es.html).toContain("Tu perfil de Google");
    expect(es.html).toContain("Calificación: 4,7 ★ (128 reseñas)");
    expect(es.html).toContain("Reseñas nuevas en los últimos 7 días: 2");
    expect(es.html).toContain("Reseñas sin contestar: 2");
    expect(es.html).not.toContain("Todavía no hay datos");
    const en = buildWeeklyEmail(biz, { ...empty, gbp: { ...gbp!, unanswered: 0, newLast7: 0 } }, "en", opts);
    expect(en.html).toContain("Your Google Business Profile");
    expect(en.text).toContain("No new reviews in the last 7 days.");
    expect(en.text).toContain("All your reviews are answered.");
  });
});

describe("weekly helpers", () => {
  it("weeklyMovers sorts the biggest climbs and drops", () => {
    const prev = report([row("a", 10), row("b", 2), row("c", null), row("d", 5)]);
    const cur = report([row("a", 3), row("b", 8), row("c", 15), row("d", 5)]);
    const m = weeklyMovers([{ label: "Miami", cur, prev }]);
    expect(m.climbs.map((x) => [x.keyword, x.delta])).toEqual([
      ["a", 7],
      ["c", 6],
    ]);
    expect(m.drops.map((x) => [x.keyword, x.delta])).toEqual([["b", -6]]);
  });

  it("closestWeekBefore picks the report nearest to 7 days back, at least a day older", () => {
    const cur = report([], "2026-10-05T12:00:00.000Z");
    const older = ["2026-10-05T06:00:00.000Z", "2026-10-01T12:00:00.000Z", "2026-09-28T13:00:00.000Z", "2026-09-20T12:00:00.000Z"].map((d) => report([], d));
    expect(closestWeekBefore(cur, older)?.createdAt).toBe("2026-09-28T13:00:00.000Z");
    expect(closestWeekBefore(cur, [report([], "2026-10-05T06:00:00.000Z")])).toBeNull();
  });

  it("readGapRecommendations reads the gap report defensively", () => {
    expect(readGapRecommendations(null)).toEqual([]);
    expect(readGapRecommendations({ rows: "x" })).toEqual([]);
    expect(readGapRecommendations([{ keyword: "a" }])).toEqual([]);
    const rows = [{ keyword: "low", volume: 10, score: 1 }, { keyword: "high", volume: 50, opportunity: 9, type: "missing" }, { nope: 1 }, { keyword: "mid", score: 5 }, { keyword: "x", score: 0 }];
    expect(readGapRecommendations({ rows }).map((r) => r.keyword)).toEqual(["high", "mid", "low"]);
  });

  it("parseAlertEmails accepts up to 3 valid addresses", () => {
    expect(parseAlertEmails(" Ana@Mail.com, bo@x.co ;ana@mail.com")).toEqual({ ok: true, emails: ["ana@mail.com", "bo@x.co"] });
    expect(parseAlertEmails("")).toEqual({ ok: true, emails: [] });
    expect(parseAlertEmails("a@b.com, nope")).toEqual({ ok: false, bad: "nope" });
    expect(parseAlertEmails("a@b.com,c@d.com,e@f.com,g@h.com")).toMatchObject({ ok: false, tooMany: true });
  });
});

describe("isWeeklyDue", () => {
  const NY = "America/New_York";
  const MANAGUA = "America/Managua";
  const at = (iso: string) => new Date(iso);

  it("is due Monday from 8:00 local time (Miami, EDT = UTC-4)", () => {
    expect(isWeeklyDue(at("2026-10-05T11:59:00Z"), null, NY)).toBe(false);
    expect(isWeeklyDue(at("2026-10-05T12:00:00Z"), null, NY)).toBe(true);
    expect(isWeeklyDue(at("2026-10-06T03:00:00Z"), null, NY)).toBe(true); // lunes 23:00 en Miami
  });

  it("uses the business time zone (Managua, UTC-6)", () => {
    expect(isWeeklyDue(at("2026-10-05T12:30:00Z"), null, MANAGUA)).toBe(false);
    expect(isWeeklyDue(at("2026-10-05T14:00:00Z"), null, MANAGUA)).toBe(true);
  });

  it("is not due on Sunday, even when it's already Monday in UTC", () => {
    expect(isWeeklyDue(at("2026-10-04T18:00:00Z"), null, NY)).toBe(false);
    expect(isWeeklyDue(at("2026-10-05T03:00:00Z"), null, NY)).toBe(false);
    expect(isWeeklyDue(at("2026-10-06T13:00:00Z"), null, NY)).toBe(false); // martes
  });

  it("waits more than 6 days since the last one", () => {
    const now = at("2026-10-05T13:00:00Z");
    expect(isWeeklyDue(now, at("2026-10-03T13:00:00Z"), NY)).toBe(false);
    expect(isWeeklyDue(now, at("2026-10-05T12:01:00Z"), NY)).toBe(false);
    expect(isWeeklyDue(now, at("2026-09-28T12:05:00Z"), NY)).toBe(true);
  });
});
