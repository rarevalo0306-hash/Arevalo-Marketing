// La sección MATYA del reporte diario: cuándo el reporte puede salir (`matyaReportReady`), cómo se escribe la sección en HTML y en
// texto, y cómo entra en el email del reporte. Módulo puro: no toca la base de datos. La espera del plan de la mañana, los datos de
// ayer / hoy / te necesita y la vuelta global están en tests/agent-database.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadTeamRuns } from "@/lib/agent/team-load";
import { loadTeamRuns as loadTeamRunsFromService } from "@/lib/agent/service";
import { matyaReportReady, matyaSectionHtml, matyaSectionText, type MatyaDaily } from "@/lib/agent/daily-section";
import { buildDailyEmail } from "@/lib/daily-report";
import { buildPeriodReport, dayPeriod, type ReportInputs } from "@/lib/report-period";
import { ruleHighlights } from "@/lib/report-period-view";
import { escapeHtml } from "@/lib/text";

const NY = "America/New_York";
const MINUTE = 60_000;

describe("matyaReportReady", () => {
  // 08:00 in New York (UTC-4 in October): two hours short of 7 + 3 for a team that plans at 7.
  const NOW = new Date("2026-10-16T12:00:00Z");
  const waiting: Parameters<typeof matyaReportReady>[0] = {
    teamMode: true,
    enabled: true,
    paused: false,
    tickAt: new Date(NOW.getTime() - MINUTE),
    dailyHour: 7,
    tz: NY,
    now: NOW,
    dailyRunStatus: "running",
  };
  /** The tick is a minute old at the moment asked (`now`) unless the case says otherwise. */
  const ready = (over: Partial<typeof waiting> = {}) => {
    const now = over.now ?? NOW;
    return matyaReportReady({ ...waiting, now, tickAt: new Date(now.getTime() - MINUTE), ...over });
  };
  /** The business's wall clock is `hhmm` on 2026-10-16 in New York. */
  const at = (hhmm: string) => new Date(`2026-10-16T${hhmm}:00-04:00`);

  it("waits while the team is on, running, ticking and its morning plan is not done", () => {
    expect(ready()).toBe(false);
    expect(ready({ dailyRunStatus: null })).toBe(false);
    for (const status of ["queued", "running", "waiting_provider", "waiting_approval"]) expect(ready({ dailyRunStatus: status })).toBe(false);
  });

  it("is ready when team mode is off, MATYA is off or MATYA is paused: no plan is coming", () => {
    expect(ready({ teamMode: false })).toBe(true);
    expect(ready({ enabled: false })).toBe(true);
    expect(ready({ paused: true })).toBe(true);
  });

  it("is ready when the once-a-minute call is not running: no tick, or one older than 10 minutes", () => {
    expect(ready({ tickAt: null })).toBe(true);
    expect(ready({ tickAt: new Date(NOW.getTime() - 11 * MINUTE) })).toBe(true);
    // Exactly 10 minutes is still alive: it is "more than 10" that is stale (the same rule as the Hoy screen).
    expect(ready({ tickAt: new Date(NOW.getTime() - 10 * MINUTE) })).toBe(false);
    expect(ready({ tickAt: new Date(NOW.getTime() - 9 * MINUTE) })).toBe(false);
  });

  it("is ready once the morning plan ended, whichever way", () => {
    for (const status of ["completed", "blocked", "uncertain", "cancelled"]) expect(ready({ dailyRunStatus: status })).toBe(true);
  });

  it("is ready three hours after the plan's hour, by the business's wall clock", () => {
    expect(ready({ dailyHour: 4, now: at("06:59") })).toBe(false);
    expect(ready({ dailyHour: 4, now: at("07:00") })).toBe(true);
    expect(ready({ dailyHour: 5, now: at("07:59") })).toBe(false);
    expect(ready({ dailyHour: 5, now: at("08:00") })).toBe(true);
    expect(ready({ dailyHour: 0, now: at("02:59") })).toBe(false);
    expect(ready({ dailyHour: 0, now: at("03:00") })).toBe(true);
  });

  it("reads the wall clock of the business, not UTC", () => {
    // 06:59 UTC is 07:59 in London in October (summer time): past 04 + 3 hours, one minute short of 05 + 3.
    const london = new Date("2026-10-16T06:59:00Z");
    expect(ready({ dailyHour: 4, tz: "Europe/London", now: london })).toBe(true);
    expect(ready({ dailyHour: 5, tz: "Europe/London", now: london })).toBe(false);
    // 06:59 UTC is 00:59 in Managua: far from any plan's hour.
    expect(ready({ dailyHour: 4, tz: "America/Managua", now: london })).toBe(false);
  });

  it("counts the wall clock on a daylight-saving day, not the minutes since midnight", () => {
    // 2026-11-01 has 25 hours in New York. 11:59 UTC is 06:59 by the clock on the wall (EST), though 7 hours 59 minutes have
    // passed since midnight: it is not yet 04 + 3 hours.
    expect(ready({ dailyHour: 4, now: new Date("2026-11-01T11:59:00Z") })).toBe(false);
    expect(ready({ dailyHour: 4, now: new Date("2026-11-01T12:00:00Z") })).toBe(true);
    // 2026-03-08 has 23 hours: 10:59 UTC is 06:59 EDT, 11:00 UTC is 07:00.
    expect(ready({ dailyHour: 4, now: new Date("2026-03-08T10:59:00Z") })).toBe(false);
    expect(ready({ dailyHour: 4, now: new Date("2026-03-08T11:00:00Z") })).toBe(true);
  });

  it("never reaches the clock rule for a plan at 21:00 or later: that day's report waits for the plan itself", () => {
    expect(ready({ dailyHour: 21, now: at("23:59") })).toBe(false);
    expect(ready({ dailyHour: 21, now: at("23:59"), dailyRunStatus: "completed" })).toBe(true);
  });
});

const BASE = "https://matya.app";
const full: MatyaDaily = {
  yesterday: {
    byChannel: [
      { channel: "facebook", posts: 2 },
      { channel: "instagram", posts: 1 },
    ],
    reach: 12345,
    likes: 45,
    comments: 6,
    cents: 87,
  },
  today: {
    goal: "Conseguir llamadas para <inspecciones> & más",
    pieces: [
      { topic: "Techos <script>alert(1)</script>", format: "video", channels: ["facebook", "instagram"], objective: "Que llamen \"hoy\"" },
      { topic: "Goteras", format: "post", channels: ["facebook"], objective: "" },
    ],
  },
  needs: [
    { topic: "Techos <b>nuevos</b>", kind: "video" },
    { topic: "", kind: "revision" },
  ],
};
const empty: MatyaDaily = { yesterday: { byChannel: [], reach: 0, likes: 0, comments: 0, cents: 0 }, today: null, needs: [] };

describe("the MATYA section of the daily report", () => {
  it("the section html escapes topics and lists Ayer, Hoy and Te necesita", () => {
    const html = matyaSectionHtml(full, "es", BASE, "biz 1", "#126BBC");
    for (const title of ["Ayer", "Hoy", "Te necesita"]) expect(html).toContain(`>${title}</td>`);
    expect(html).toContain("Abrir el Centro MATYA");
    expect(html).toContain(`href="${BASE}/b/biz%201/matya"`);
    // Whatever the owner or the AI wrote is escaped.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<inspecciones>");
    expect(html).not.toContain("<b>nuevos</b>");
    expect(html).toContain(escapeHtml("Techos <script>alert(1)</script>"));
    expect(html).toContain(escapeHtml("Conseguir llamadas para <inspecciones> & más"));
    expect(html).toContain(escapeHtml("Techos <b>nuevos</b>"));
    // The three titles come in that order.
    expect(html.indexOf(">Ayer<")).toBeLessThan(html.indexOf(">Hoy<"));
    expect(html.indexOf(">Hoy<")).toBeLessThan(html.indexOf(">Te necesita<"));
    // What happened yesterday, what is planned today, what waits for the owner.
    expect(html).toContain("Facebook");
    expect(html).toContain("Instagram");
    expect(html).toContain("12.345");
    expect(html).toContain("$0.87");
    expect(html).toContain("Goteras");
    expect(html).toContain("Un video espera tu aprobación");
    expect(html).toContain("Una pieza no pasó la revisión");
  });

  it("is written in English for English businesses", () => {
    const html = matyaSectionHtml(full, "en", BASE, "biz1", "#126BBC");
    for (const title of ["Yesterday", "Today", "Needs you"]) expect(html).toContain(`>${title}</td>`);
    expect(html).toContain("Open the MATYA Center");
    expect(html).not.toContain("Abrir el Centro");
    expect(html).not.toContain("Te necesita");
    expect(html).toContain("12,345");
    const text = matyaSectionText(full, "en", BASE, "biz1");
    expect(text).toContain("YESTERDAY");
    expect(text).toContain("NEEDS YOU");
    expect(text).toContain(`Open the MATYA Center: ${BASE}/b/biz1/matya`);
  });

  it("no plan yet says 'El plan de hoy todavía no está listo.'", () => {
    expect(matyaSectionHtml(empty, "es", BASE, "biz1", "#126BBC")).toContain("El plan de hoy todavía no está listo.");
    expect(matyaSectionText(empty, "es", BASE, "biz1")).toContain("El plan de hoy todavía no está listo.");
    expect(matyaSectionHtml(empty, "en", BASE, "biz1", "#126BBC")).toContain(escapeHtml("Today's plan is not ready yet."));
    // A plan the director left with no goal and no pieces is no plan to tell.
    const blank: MatyaDaily = { ...empty, today: { goal: "", pieces: [] } };
    expect(matyaSectionText(blank, "es", BASE, "biz1")).toContain("El plan de hoy todavía no está listo.");
    // With a plan, the line is gone.
    expect(matyaSectionText(full, "es", BASE, "biz1")).not.toContain("todavía no está listo");
  });

  it("says plainly when there was nothing yesterday and nothing waits for the owner", () => {
    const text = matyaSectionText(empty, "es", BASE, "biz1");
    expect(text).toContain("AYER");
    expect(text).toContain("El equipo no publicó nada ayer.");
    expect(text).toContain("TE NECESITA");
    expect(text).toContain("Nada espera tu respuesta.");
    // Money spent with nothing published is still told.
    const spent = matyaSectionText({ ...empty, yesterday: { ...empty.yesterday, cents: 40 } }, "es", BASE, "biz1");
    expect(spent).toContain("$0.40");
  });

  it("the text lists the same three parts and the link", () => {
    const text = matyaSectionText(full, "es", BASE, "biz 1");
    expect(text.indexOf("AYER")).toBeLessThan(text.indexOf("HOY"));
    expect(text.indexOf("HOY")).toBeLessThan(text.indexOf("TE NECESITA"));
    expect(text).toContain("Facebook: 2");
    expect(text).toContain("Instagram: 1");
    expect(text).toContain("Conseguir llamadas para <inspecciones> & más");
    expect(text).toContain("Goteras");
    expect(text).toContain("Abrir el Centro MATYA: https://matya.app/b/biz%201/matya");
  });

  it("caps a long plan and a long list of waiting items", () => {
    const many: MatyaDaily = {
      ...full,
      today: { goal: "Meta", pieces: Array.from({ length: 12 }, (_, i) => ({ topic: `Tema ${i}`, format: "post", channels: ["facebook"], objective: "" })) },
      needs: Array.from({ length: 12 }, (_, i) => ({ topic: `Pieza ${i}`, kind: "publicar" })),
    };
    const text = matyaSectionText(many, "es", BASE, "biz1");
    expect(text).toContain("Tema 7");
    expect(text).not.toContain("Tema 8");
    expect(text).toContain("y 4 más en el Centro MATYA");
    expect(text).toContain("Pieza 7");
    expect(text).not.toContain("Pieza 8");
  });
});

// A day with no posts, as the report builds it: enough to put the section in a real email.
function quietReport() {
  const period = dayPeriod("2026-10-15", NY);
  const inputs: ReportInputs = {
    business: { id: "biz1", name: "Ricardo PA", color: "#126BBC", color2: "", color3: "", website: "", logoUrl: "", fontHeading: "montserrat", aiText: "" },
    period,
    now: new Date("2026-10-16T12:00:00Z"),
    zones: [],
    targets: [],
    prevSent: 0,
    recentTargets: [],
    actions: [],
    prevActions: { auto: 0, costCents: 0 },
    campaigns: [],
    adSnapshots: [],
    metrics: [],
    reviews: null,
    gbp: null,
    ga4: null,
    rank: [],
    tasksDone: [],
    tasksOpen: [],
    proposals: [],
    upcoming: null,
  };
  return buildPeriodReport(inputs);
}

describe("the MATYA section inside the daily email", () => {
  const report = quietReport();
  const hl = { items: ruleHighlights(report, "es"), source: "rules" as const };

  it("goes after the report's own sections, in the html and in the text", () => {
    const e = buildDailyEmail(report, "es", hl, { baseUrl: BASE, matya: full });
    expect(e.html).toContain(">Ayer</td>");
    expect(e.html).toContain(">Hoy</td>");
    expect(e.html).toContain(">Te necesita</td>");
    expect(e.html).toContain("Abrir el Centro MATYA");
    expect(e.html).toContain(`${BASE}/b/biz1/matya`);
    expect(e.html.indexOf("Próximos pasos")).toBeLessThan(e.html.indexOf(">Ayer</td>"));
    // Still before the button of the full report, so the email ends the way it always did.
    expect(e.html.indexOf(">Te necesita</td>")).toBeLessThan(e.html.indexOf("Ver el reporte completo"));
    expect(e.text.indexOf("PRÓXIMOS PASOS")).toBeLessThan(e.text.indexOf("AYER"));
    expect(e.text.indexOf("TE NECESITA")).toBeLessThan(e.text.indexOf("Ver el reporte completo"));
    expect(e.text).toContain("Goteras");
  });

  it("without it, the email is exactly what it was", () => {
    const plain = buildDailyEmail(report, "es", hl, { baseUrl: BASE });
    expect(buildDailyEmail(report, "es", hl, { baseUrl: BASE, matya: null })).toEqual(plain);
    expect(buildDailyEmail(report, "es", hl, { baseUrl: BASE, matya: undefined })).toEqual(plain);
    expect(plain.html).not.toContain("Abrir el Centro MATYA");
    expect(plain.html).not.toContain("Te necesita");
    expect(plain.text).not.toContain("TE NECESITA");
  });

  it("uses the brand color for the titles and the button", () => {
    const e = buildDailyEmail({ ...report, business: { ...report.business, color: "#bb1111" } }, "es", hl, { baseUrl: BASE, matya: full });
    const section = e.html.slice(e.html.indexOf(">Ayer</td>") - 200, e.html.indexOf("Ver el reporte completo"));
    expect(section).toContain("color:#bb1111");
    expect(section).toContain("background:#bb1111");
  });
});

describe("where the team's runs are read from", () => {
  const source = (file: string) => readFileSync(path.join(process.cwd(), "src/lib/agent", file), "utf8");

  it("service.ts keeps exporting loadTeamRuns, and it is the one of team-load.ts", () => {
    expect(loadTeamRunsFromService).toBe(loadTeamRuns);
  });

  it("the alerts and the report's section import it from team-load.ts, never from service.ts (service.ts calls both: that would be a cycle)", () => {
    for (const file of ["alerts.ts", "daily-section.ts", "team-load.ts"]) {
      expect(source(file), file).not.toMatch(/["']\.\/service["']|@\/lib\/agent\/service/);
    }
    expect(source("alerts.ts")).toContain('import { loadTeamRuns } from "./team-load";');
    expect(source("daily-section.ts")).toContain('import { loadTeamRuns, objectOrNull } from "./team-load";');
  });
});
