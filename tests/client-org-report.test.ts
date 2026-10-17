import { describe, expect, it } from "vitest";
import {
  buildClientOrgEmail,
  CLIENT_SECTIONS,
  clientOnly,
  clientView,
  dueWeek,
  orgHighlights,
  readReportSettings,
  reportWeek,
  retryable,
  type ClientOrgEmail,
} from "@/lib/client-org-report";
import { reportHighlights } from "@/lib/daily-report";
import { BiError } from "@/lib/i18n";
import { buildPeriodReport, periodText, rangePeriod } from "@/lib/report-period";
import { reportSections, type ViewSection } from "@/lib/report-period-view";
import { richInputs } from "./helpers/report-inputs";

describe("the reported week", () => {
  it("is the Monday-to-Sunday week that just closed, in the organization's zone", () => {
    // Monday 2026-10-19 08:00 in New York
    expect(reportWeek(new Date("2026-10-19T12:00:00Z"), "America/New_York")).toEqual({ week: "2026-10-12", fromDay: "2026-10-12", toDay: "2026-10-18" });
    // Sunday 2026-10-18 23:30 in New York is still inside the week: the closed one is the week before
    expect(reportWeek(new Date("2026-10-19T03:30:00Z"), "America/New_York").week).toBe("2026-10-05");
    // the same instant is already Monday in Madrid
    expect(reportWeek(new Date("2026-10-19T03:30:00Z"), "Europe/Madrid").week).toBe("2026-10-12");
  });
  it("still runs Monday to Monday across the daylight-saving change", () => {
    // New York leaves DST on Sunday 2026-11-01; Monday 2026-11-02 08:00 EST = 13:00Z
    const w = reportWeek(new Date("2026-11-02T13:00:00Z"), "America/New_York");
    expect(w).toEqual({ week: "2026-10-26", fromDay: "2026-10-26", toDay: "2026-11-01" });
    const p = rangePeriod(w.fromDay, w.toDay, "America/New_York");
    expect(p.to.getTime() - p.from.getTime()).toBe((7 * 24 + 1) * 3600_000); // the 25-hour Sunday
  });
});

describe("when the weekly report is due", () => {
  const monday8 = { reportOn: true, reportDay: 1, reportHour: 8 };
  it("Monday 8:00 local: not at 7:59, yes at 8:00 and later that week", () => {
    expect(dueWeek(monday8, new Date("2026-10-19T11:59:00Z"), "America/New_York")).toBeNull();
    expect(dueWeek(monday8, new Date("2026-10-19T12:00:00Z"), "America/New_York")?.week).toBe("2026-10-12");
    expect(dueWeek(monday8, new Date("2026-10-22T20:00:00Z"), "America/New_York")?.week).toBe("2026-10-12");
  });
  it("8:00 local right after the DST change is 13:00Z, not 12:00Z", () => {
    expect(dueWeek(monday8, new Date("2026-11-02T12:30:00Z"), "America/New_York")).toBeNull();
    expect(dueWeek(monday8, new Date("2026-11-02T13:00:00Z"), "America/New_York")?.week).toBe("2026-10-26");
  });
  it("a Sunday send reports the week that closed the Sunday before", () => {
    const sunday18 = { reportOn: true, reportDay: 0, reportHour: 18 };
    expect(dueWeek(sunday18, new Date("2026-10-25T21:59:00Z"), "America/New_York")).toBeNull();
    expect(dueWeek(sunday18, new Date("2026-10-25T22:00:00Z"), "America/New_York")?.week).toBe("2026-10-12");
  });
  it("is never due when the report is off", () => {
    expect(dueWeek({ ...monday8, reportOn: false }, new Date("2026-10-22T20:00:00Z"), "America/New_York")).toBeNull();
  });
});

describe("report settings", () => {
  const ok = { contactName: " Juan Pérez ", reportEmail: "A@x.com; b@y.com", phone: "+1 305 555 0100", reportLang: "en", reportOn: "on", reportDay: "5", reportHour: "17", timezone: "America/Managua" };
  it("trims, parses and keeps valid values", () => {
    expect(readReportSettings(ok)).toEqual({ contactName: "Juan Pérez", reportEmail: "a@x.com, b@y.com", phone: "+1 305 555 0100", reportLang: "en", reportOn: true, reportDay: 5, reportHour: 17, timezone: "America/Managua" });
    expect(readReportSettings({ ...ok, reportOn: "", timezone: "" })).toMatchObject({ reportOn: false, timezone: "" });
  });
  it.each([
    ["reportEmail", "a@x.com, b@x.com, c@x.com, d@x.com"],
    ["reportEmail", "no-es-un-email"],
    ["contactName", "x".repeat(121)],
    ["phone", "1".repeat(41)],
    ["reportLang", "fr"],
    ["reportDay", "7"],
    ["reportHour", "24"],
    ["reportHour", "8.5"],
    ["timezone", "Mars/Olympus"],
  ])("rejects %s = %j with a bilingual error", (key, value) => {
    expect(() => readReportSettings({ ...ok, [key]: value })).toThrow(BiError);
  });
});

describe("retrying a failed automatic send", () => {
  const now = new Date("2026-10-19T13:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  it("retries an error or a stuck send after 30 minutes, up to 3 attempts", () => {
    expect(retryable({ state: "error", attempts: 1, updatedAt: ago(30) }, now)).toBe(true);
    expect(retryable({ state: "sending", attempts: 2, updatedAt: ago(31) }, now)).toBe(true);
    expect(retryable({ state: "error", attempts: 1, updatedAt: ago(29) }, now)).toBe(false);
    expect(retryable({ state: "error", attempts: 3, updatedAt: ago(90) }, now)).toBe(false);
    expect(retryable({ state: "sent", attempts: 1, updatedAt: ago(90) }, now)).toBe(false);
  });
});

// ---------- Lo que ve el cliente ----------

const WEEK = { week: "2026-10-12", fromDay: "2026-10-12", toDay: "2026-10-18" };
const NY = "America/New_York";

/** Un email armado como lo arma el envío: solo la lista blanca del reporte, y las frases de «Resumen» sobre esa misma lista. */
async function clientEmailOf(lang: "es" | "en", over: Partial<ClientOrgEmail> = {}) {
  const full = buildPeriodReport(richInputs()); // todas las secciones llenas, con costos, IA, anuncios, propuestas, tareas y avisos
  const hl = await reportHighlights(clientOnly(full), lang, { ai: false });
  return buildClientOrgEmail({
    orgName: "Juan Pérez",
    accountName: "Ricardo Arevalo",
    week: WEEK,
    tz: NY,
    lang,
    test: false,
    businesses: [{ name: "Techos Pérez", color: "#0a7", sections: clientView(full, lang) }],
    highlights: orgHighlights([{ name: "Techos Pérez", items: hl.items }]),
    ...over,
  });
}

/** Las razones (de richInputs) por las que una publicación no salió o se saltó: son un solo texto, en los dos idiomas. */
const REASONS = ["LinkedIn pidió volver a conectar la cuenta", "TikTok solo recibe videos"];

/** Todo lo que no puede aparecer en el email de un cliente: los títulos de lo interno, sus palabras y sus datos de la prueba. */
const FORBIDDEN = {
  es: {
    // Los títulos exactos que reportSections da a lo interno.
    titles: ["Necesita tu atención", "Campañas", "Lo que hizo la IA sola", "Anuncios pagados", "Tareas del plan que terminaste", "Nuevas propuestas de la IA", "Costos"],
    words: ["Costos", "Gasto", "anuncios", "IA", "Propuestas", "propuesta", "Tareas", "tarea", "Avisos", "Atención", "atención", "MATYA", "/b/", "Ver en Matya", "$"],
    // Datos de richInputs() que solo viven en lo interno (anuncio, campaña, acciones de la IA, aviso, tarea, propuesta).
    data: ["Llamadas Managua", "Portones octubre", "La IA programó", "Aprobaste una publicación", "La campaña se pausó", "Meta rechazó la foto", "Agregar el horario en Google", "Pedir 5 reseñas", "Publicar a las 7 p. m."],
    // Lo que sale mal o se queda a medias en la agencia: publicaciones que no salieron o se saltaron (con su razón) y reseñas sin responder.
    agency: ["No salió", "No salieron", "Se saltó", "Se saltaron", "no es un error", "LinkedIn", "TikTok", ...REASONS, "sin responder", "respondida"],
  },
  en: {
    titles: ["Needs your attention", "Campaigns", "What the AI did on its own", "Paid ads", "Action-plan tasks you finished", "New AI proposals", "Costs"],
    words: ["Costs", "Spent", "AI", "Proposals", "proposal", "Tasks", "task", "Alerts", "Heads up", "attention", "MATYA", "/b/", "See in Matya", "$"],
    data: ["Llamadas Managua", "Portones octubre", "The AI scheduled a post", "You approved a post", "The campaign paused", "Meta rejected the photo", "Add hours on Google", "Ask 5 customers for reviews", "Post at 7 p.m."],
    agency: ["Didn't go out", "Skipped", "isn't an error", "LinkedIn", "TikTok", ...REASONS, "answered", "unanswered"],
  },
};

/** Lo prohibido que aparece en un email: [] = limpio. («IA», «AI» y «ads» solo como palabras sueltas.) */
function leaks(all: string, lang: "es" | "en"): string[] {
  const f = FORBIDDEN[lang];
  const found = [...f.titles, ...f.words, ...f.data, ...f.agency].filter((w) => all.includes(w));
  if (/\b(IA|AI)\b/.test(all)) found.push("IA/AI");
  if (/\bads?\b/i.test(all)) found.push("ads");
  if (/matya/i.test(all)) found.push("matya");
  if (all.includes(process.env.PUBLIC_BASE_URL || "https://app.matya.app")) found.push("app url");
  return found;
}

/** Los destinos de todos los links del html. */
const hrefsOf = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe("what the client sees", () => {
  const full = buildPeriodReport(richInputs());
  it("clientOnly keeps the whitelist and nothing else", () => {
    const c = clientOnly(full);
    for (const k of ["campaigns", "ai", "ads", "tasks", "proposals", "alerts", "costs"] as const) expect(c[k]).toBeNull();
    // posts: only what went out
    expect(c.posts).toEqual({
      sent: 2,
      failed: 0,
      skipped: 0,
      prevSent: full.posts!.prevSent,
      byChannel: [
        { channel: "facebook", sent: 1, failed: 0, skipped: 0 },
        { channel: "instagram", sent: 1, failed: 0, skipped: 0 },
      ],
      items: full.posts!.items.filter((i) => i.status === "sent"),
    });
    expect(c.posts!.items.map((i) => i.channel).sort()).toEqual(["facebook", "instagram"]);
    expect(c.results).toEqual(full.results);
    expect(c.reviews).toEqual(full.reviews);
    expect(c.web).toEqual(full.web);
    expect(c.rankings).toEqual(full.rankings);
    expect(c.business).toBe(full.business);
    expect(c.period).toBe(full.period);
    expect(c.next?.tasks).toEqual([]);
    expect(c.next?.upcoming).toEqual(full.next?.upcoming);
  });
  it("clientOnly drops next entirely when there are no upcoming posts", () => {
    expect(clientOnly({ ...full, next: { tasks: full.next!.tasks, upcoming: null } }).next).toBeNull();
    expect(clientOnly({ ...full, next: null }).next).toBeNull();
  });
  it("the fixture really has every internal section full (so the tests below can fail)", () => {
    for (const k of ["campaigns", "ai", "ads", "tasks", "proposals", "alerts", "costs"] as const) expect(full[k]).not.toBeNull();
    expect(full.next?.tasks.length).toBeGreaterThan(0);
  });
  it("the fixture really has failed and skipped posts with their reasons, and answered and unanswered reviews", () => {
    expect(full.posts).toMatchObject({ sent: 2, failed: 1, skipped: 1 });
    for (const reason of REASONS) expect(full.posts!.items.some((i) => i.detail.includes(reason))).toBe(true);
    expect(full.reviews!.items.some((i) => i.answered)).toBe(true);
    expect(full.reviews!.items.some((i) => !i.answered)).toBe(true);
  });
  it("clientView has only client sections and no link into the app", () => {
    for (const lang of ["es", "en"] as const) {
      const v = clientView(full, lang);
      expect(v.map((s) => s.id)).toEqual(["posts", "results", "reviews", "web", "rankings", "next"]);
      expect(v.map((s) => s.id).every((id) => (CLIENT_SECTIONS as readonly string[]).includes(id))).toBe(true);
      expect(v.every((s) => s.href === undefined && s.hrefText === undefined)).toBe(true);
      const links = v.flatMap((s) => [s.href, ...(s.items ?? []).map((i) => i.href), ...(s.table?.links ?? [])]).filter(Boolean);
      expect(links.length).toBeGreaterThan(0); // the public post and review links stay
      expect(links.every((l) => l!.startsWith("https://"))).toBe(true);
    }
  });
  it("clientView keeps the public link of a post and of a review, and drops app paths", () => {
    const v = clientView(full, "es");
    const posts = v.find((s) => s.id === "posts")!;
    expect(posts.items!.map((i) => i.href).filter(Boolean).sort()).toEqual(["https://facebook.com/123_456", "https://instagram.com/p/abc"]);
    const reviews = v.find((s) => s.id === "reviews")!;
    expect(reviews.items!.map((i) => i.href).filter(Boolean)).toEqual(["https://maps.google.com/r1"]);
    const next = v.find((s) => s.id === "next")!;
    expect(next.items).toHaveLength(1); // only the upcoming posts line: no owner task
    expect(next.items![0].href).toBeUndefined();
    expect(next.items![0].linkText).toBeUndefined();
  });
  it("clientView drops a link to the app itself even when it is https", () => {
    const withApp = { ...full, posts: { ...full.posts!, items: full.posts!.items.map((i) => ({ ...i, url: "https://app.matya.app/b/biz1/historial" })) } };
    const links = clientView(withApp, "es").flatMap((s) => (s.items ?? []).map((i) => i.href)).filter((l) => l?.includes("matya"));
    expect(links).toEqual([]);
  });

  it.each(["es", "en"] as const)("the %s email of a full report shows no internal word, cost or app link, not even in the summary", async (lang) => {
    const mail = await clientEmailOf(lang);
    const all = mail.html + mail.text;
    expect(leaks(all, lang)).toEqual([]);
    for (const word of [...FORBIDDEN[lang].titles, ...FORBIDDEN[lang].words, ...FORBIDDEN[lang].data, ...FORBIDDEN[lang].agency]) expect(all).not.toContain(word);
    expect(all).not.toContain(process.env.PUBLIC_BASE_URL || "https://app.matya.app");
    expect(mail.html).toContain(lang === "en" ? "Sent by Ricardo Arevalo" : "Enviado por Ricardo Arevalo");
    // the client part is really there: the posts, the results and the public links
    expect(mail.html).toContain(lang === "en" ? "Posts" : "Publicaciones");
    expect(mail.html).toContain(lang === "en" ? "Google reviews" : "Reseñas en Google");
    // the only links are the public ones of the posts and of the review
    expect(new Set(hrefsOf(mail.html))).toEqual(new Set(["https://facebook.com/123_456", "https://instagram.com/p/abc", "https://maps.google.com/r1"]));
    expect(mail.text.match(/https?:\/\/\S+/g)!.every((u) => ["https://facebook.com/123_456", "https://instagram.com/p/abc", "https://maps.google.com/r1"].includes(u))).toBe(true);
  });
  it.each(["es", "en"] as const)("the %s summary of a week with only internal activity says nothing of it", async (lang) => {
    // The AI, the ads, the tasks and the proposals are all busy, but the client has no post, review, visit or ranking to hear about.
    const inputs = { ...richInputs(), targets: [], recentTargets: [], metrics: [], reviews: null, ga4: null, rank: [], upcoming: null, tasksOpen: [] };
    const internal = buildPeriodReport(inputs);
    for (const k of ["ai", "ads", "costs", "tasks", "proposals", "alerts"] as const) expect(internal[k]).not.toBeNull();
    expect(internal.posts).toBeNull();
    // what an unfiltered summary would say (so the check below means something)
    expect(leaks((await reportHighlights(internal, lang, { ai: false })).items.join(" "), lang)).not.toEqual([]);
    const hl = await reportHighlights(clientOnly(internal), lang, { ai: false });
    expect(leaks(hl.items.join(" "), lang)).toEqual([]);
    const mail = await clientEmailOf(lang, { businesses: [{ name: "Techos Pérez", color: "#0a7", sections: clientView(internal, lang) }], highlights: orgHighlights([{ name: "Techos Pérez", items: hl.items }]) });
    expect(leaks(mail.html + mail.text, lang)).toEqual([]);
    expect(mail.html).toContain(lang === "en" ? "No activity this week." : "Sin actividad esta semana.");
  });
  it("the check is not vacuous: an email built from the unfiltered report does trip it", () => {
    for (const lang of ["es", "en"] as const) {
      const leaked = buildClientOrgEmail({
        orgName: "Juan Pérez",
        accountName: "Ricardo Arevalo",
        week: WEEK,
        tz: NY,
        lang,
        test: false,
        businesses: [{ name: "Techos Pérez", color: "#0a7", sections: reportSections(full, lang) }],
        highlights: [],
      });
      const found = leaks(leaked.html + leaked.text, lang);
      expect(found).toEqual(expect.arrayContaining([FORBIDDEN[lang].titles[0], FORBIDDEN[lang].titles[2], FORBIDDEN[lang].titles[3], "$"]));
    }
  });
});

describe("the client hears only about what went out", () => {
  const full = buildPeriodReport(richInputs());
  const PUBLIC = ["https://facebook.com/123_456", "https://instagram.com/p/abc", "https://maps.google.com/r1"];
  const failedAndSkippedOnly = buildPeriodReport({ ...richInputs(), targets: richInputs().targets.filter((t) => t.status !== "sent"), recentTargets: [], metrics: [] });

  it.each(["es", "en"] as const)("clientView(%s): posts keep the sent ones with their public link, no failed or skipped, no reasons, no note", (lang) => {
    const posts = clientView(full, lang).find((s) => s.id === "posts")!;
    expect(posts.items).toHaveLength(2);
    expect(posts.items!.map((i) => i.href).sort()).toEqual([PUBLIC[0], PUBLIC[1]]);
    expect(posts.items!.every((i) => i.tone === "good")).toBe(true);
    expect(posts.stats).toHaveLength(1); // only the «Publicadas» / "Posted" count
    expect(posts.stats![0].value).toBe("2");
    expect(posts.note).toBeUndefined();
    expect(JSON.stringify(posts)).not.toMatch(/LinkedIn|TikTok|pidió|solo recibe/);
  });
  it.each(["es", "en"] as const)("clientView(%s): reviews keep rating, totals, new count and every text with its link, without the answered marker", (lang) => {
    const reviews = clientView(full, lang).find((s) => s.id === "reviews")!;
    expect(reviews.stats).toHaveLength(3); // new reviews, rating, total
    expect(reviews.items!.map((i) => i.text).join("|")).toContain("Excelente servicio, muy rápidos.");
    expect(reviews.items!.map((i) => i.text).join("|")).toContain("Tardaron en llegar.");
    expect(reviews.items!.map((i) => i.href).filter(Boolean)).toEqual([PUBLIC[2]]);
    for (const i of reviews.items!) {
      expect(i.meta).toMatch(/\d/); // the time stays
      expect(i.meta).not.toMatch(/respondida|sin responder|answered/i);
    }
  });
  it.each(["es", "en"] as const)("the %s email and its summary have no failed or skipped post, no reason, no skipped note and no unanswered marker; the sent posts stay with their links", async (lang) => {
    const mail = await clientEmailOf(lang);
    const all = mail.html + mail.text;
    for (const word of FORBIDDEN[lang].agency) expect(all).not.toContain(word);
    // the sent posts and their public links are still there
    expect(mail.html).toContain("Portones enrollables en Managua");
    expect(mail.html).toContain("Facebook: Portones enrollables en Managua");
    expect(mail.html).toContain("Instagram: Portones enrollables en Managua");
    expect(mail.html).toContain(lang === "en" ? "Posted" : "Publicadas");
    expect(mail.text).toContain("https://facebook.com/123_456");
    expect(mail.text).toContain("https://instagram.com/p/abc");
    // the reviews are still there
    expect(mail.html).toContain("Excelente servicio, muy rápidos.");
    // the summary lines
    const hl = (await reportHighlights(clientOnly(full), lang, { ai: false })).items.join(" ");
    for (const word of FORBIDDEN[lang].agency) expect(hl).not.toContain(word);
    expect(hl).not.toMatch(/no salió|saltó|didn't go out|skipped/i);
  });
  it.each(["es", "en"] as const)("%s: when every post failed or was skipped there is no posts section and the summary does not mention them", async (lang) => {
    expect(failedAndSkippedOnly.posts).toMatchObject({ sent: 0, failed: 1, skipped: 1 });
    expect(clientOnly(failedAndSkippedOnly).posts).toBeNull();
    expect(clientView(failedAndSkippedOnly, lang).some((s) => s.id === "posts")).toBe(false);
    const hl = (await reportHighlights(clientOnly(failedAndSkippedOnly), lang, { ai: false })).items.join(" ");
    expect(hl).not.toMatch(/publicaron|went out|salió|saltó|skipped|LinkedIn|TikTok/i);
    const mail = await clientEmailOf(lang, { businesses: [{ name: "Techos Pérez", color: "#0a7", sections: clientView(failedAndSkippedOnly, lang) }], highlights: [hl] });
    for (const word of FORBIDDEN[lang].agency) expect(mail.html + mail.text).not.toContain(word);
  });
});

describe("orgHighlights", () => {
  it("takes one item from each business in turn, at most 3, prefixed with the business", () => {
    const two = orgHighlights([
      { name: "A", items: ["a1", "a2", "a3"] },
      { name: "B", items: ["b1", "b2", "b3"] },
    ]);
    expect(two).toEqual(["A: a1", "B: b1", "A: a2"]);
    expect(orgHighlights([{ name: "A", items: ["a1"] }, { name: "B", items: ["b1"] }, { name: "C", items: ["c1"] }, { name: "D", items: ["d1"] }])).toEqual(["A: a1", "B: b1", "C: c1"]);
  });
  it("does not prefix a single business, and still caps at 3", () => {
    expect(orgHighlights([{ name: "A", items: ["a1", "a2", "a3", "a4"] }])).toEqual(["a1", "a2", "a3"]);
    expect(orgHighlights([{ name: "A", items: ["a1"] }])).toEqual(["a1"]);
  });
  it("skips a business that has run out of items, and handles no businesses", () => {
    expect(orgHighlights([{ name: "A", items: ["a1"] }, { name: "B", items: ["b1", "b2", "b3"] }])).toEqual(["A: a1", "B: b1", "B: b2"]);
    expect(orgHighlights([])).toEqual([]);
    expect(orgHighlights([{ name: "A", items: [] }])).toEqual([]);
  });
});

describe("buildClientOrgEmail", () => {
  const section = (over: Partial<ViewSection> = {}): ViewSection => ({ id: "posts", title: "Publicaciones", stats: [{ label: "Publicadas", value: "2", sub: "antes: 1", tone: "good" }], ...over });
  const base = (over: Partial<ClientOrgEmail> = {}): ClientOrgEmail => ({
    orgName: "Juan Pérez",
    accountName: "Ricardo Arevalo",
    week: WEEK,
    tz: NY,
    lang: "es",
    test: false,
    businesses: [{ name: "Techos Pérez", color: "#0a7", sections: [section()] }],
    highlights: ["Se publicaron 2 cosas."],
    ...over,
  });
  const weekEs = periodText(rangePeriod(WEEK.fromDay, WEEK.toDay, NY), "es", "long");
  const weekEn = periodText(rangePeriod(WEEK.fromDay, WEEK.toDay, NY), "en", "long");

  it("writes the subject and the header with the organization and the long week", () => {
    const m = buildClientOrgEmail(base());
    expect(m.subject).toBe(`Reporte semanal de Juan Pérez: ${weekEs}`);
    expect(m.html).toContain(weekEs);
    expect(m.html).toContain("Juan Pérez");
    expect(m.html).toContain("Resumen");
    expect(m.html).toContain("Se publicaron 2 cosas.");
    expect(m.html).toContain("Techos Pérez");
    expect(m.html).toContain('<html lang="es">');
    expect(m.text).toContain(weekEs);
    expect(m.text).toContain("Se publicaron 2 cosas.");
  });
  it("starts the subject with «Prueba · » on a test send", () => {
    expect(buildClientOrgEmail(base({ test: true })).subject).toBe(`Prueba · Reporte semanal de Juan Pérez: ${weekEs}`);
    expect(buildClientOrgEmail(base({ test: true, lang: "en" })).subject).toBe(`Test · Weekly report for Juan Pérez: ${weekEn}`);
  });
  it("says «Sin actividad esta semana.» for a business with no client section", () => {
    const m = buildClientOrgEmail(base({ businesses: [{ name: "Techos Pérez", color: "#0a7", sections: [] }, { name: "Otro", color: "#123456", sections: [section()] }] }));
    expect(m.html).toContain("Sin actividad esta semana.");
    expect(m.text).toContain("Sin actividad esta semana.");
    expect(buildClientOrgEmail(base()).html).not.toContain("Sin actividad esta semana.");
  });
  it("shows the stats and the items, and «Ver» only for an https link", () => {
    const m = buildClientOrgEmail(
      base({
        businesses: [
          {
            name: "Techos Pérez",
            color: "#0a7",
            sections: [
              section({
                items: [
                  { text: "Facebook: Portones", tone: "good", meta: "Publicado · 10:00", href: "https://facebook.com/123_456", linkText: "Ver publicación" },
                  { text: "Instagram: Portones", href: "/b/biz1/historial", linkText: "Abrir" },
                  { text: "TikTok: Portones", href: "http://insecure.example.com/x" },
                  { text: "Otro: Portones", href: "javascript:alert(1)" },
                  { text: "Sin link: Portones" },
                ],
                href: "/b/biz1/historial",
                hrefText: "Ver el historial",
              }),
            ],
          },
        ],
      }),
    );
    expect(m.html).toContain("Publicadas");
    expect(m.html).toContain("antes: 1");
    expect(m.html).toContain("Publicado · 10:00");
    expect(hrefsOf(m.html)).toEqual(["https://facebook.com/123_456"]);
    expect(m.html.match(/>Ver</g)).toHaveLength(1);
    for (const gone of ["/b/biz1", "Ver el historial", "insecure.example.com", "javascript:"]) expect(m.html).not.toContain(gone);
    expect(m.text).not.toContain("/b/biz1");
    expect(m.text).toContain("https://facebook.com/123_456");
  });
  it("renders a table with a link only on https rows", () => {
    const m = buildClientOrgEmail(
      base({
        businesses: [
          {
            name: "Techos Pérez",
            color: "#0a7",
            sections: [{ id: "results", title: "Resultados", table: { head: ["Publicación", "Alcance"], rows: [["Facebook: A", "700"], ["Instagram: B", "350"], ["TikTok: C", "9"]], links: ["https://facebook.com/1", "/b/biz1/resultados", null] } }],
          },
        ],
      }),
    );
    expect(m.html).toContain("Facebook: A");
    expect(m.html).toContain("700");
    expect(hrefsOf(m.html)).toEqual(["https://facebook.com/1"]);
    expect(m.text).toContain("Instagram: B");
  });
  it("never links to the app, whatever the sections carry", () => {
    const m = buildClientOrgEmail(
      base({
        businesses: [
          {
            name: "Techos Pérez",
            color: "#0a7",
            sections: [
              section({ href: "https://app.matya.app/b/biz1/historial", hrefText: "Ver", items: [{ text: "x", href: "https://app.matya.app/b/biz1/plan" }, { text: "y", href: "https://matya.app/b/biz1" }] }),
            ],
          },
        ],
      }),
    );
    expect(hrefsOf(m.html)).toEqual([]);
    expect(m.html + m.text).not.toMatch(/matya/i);
  });
  it("uses the English copy", () => {
    const m = buildClientOrgEmail(base({ lang: "en", businesses: [{ name: "Techos", color: "#0a7", sections: [] }] }));
    expect(m.subject).toBe(`Weekly report for Juan Pérez: ${weekEn}`);
    expect(m.html).toContain("Summary");
    expect(m.html).toContain("No activity this week.");
    expect(m.html).toContain("Sent by Ricardo Arevalo");
    expect(m.html).toContain('<html lang="en">');
    expect(m.html).not.toContain("Resumen");
    expect(m.html).not.toContain("Enviado por");
    expect(m.text).toContain("Sent by Ricardo Arevalo");
    expect(m.text).toContain("No activity this week.");
  });
  it("keeps the «Resumen» heading even with no highlights", () => {
    const m = buildClientOrgEmail(base({ highlights: [] }));
    expect(m.html).toContain("Resumen");
  });
  it("escapes the organization, account and business names, and the text version has no HTML", () => {
    const evil = "<script>alert(1)</script>";
    const m = buildClientOrgEmail(
      base({
        orgName: evil,
        accountName: evil,
        businesses: [{ name: evil, color: "#0a7", sections: [section({ title: evil, items: [{ text: evil, meta: evil }] })] }],
        highlights: [evil],
      }),
    );
    expect(m.html).not.toContain("<script");
    expect(m.html).not.toContain("</script");
    expect(m.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(m.text).not.toMatch(/<\/?[a-z]/i);
    expect(m.text).not.toContain("<script>");
    expect(m.text).toContain("alert(1)");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
  it("keeps the subject on one line even when a name has line breaks", () => {
    expect(buildClientOrgEmail(base({ orgName: "Juan\r\nBcc: x@y.com" })).subject).toBe(`Reporte semanal de Juan Bcc: x@y.com: ${weekEs}`);
  });
  it("only accepts a plain color for the business dot", () => {
    const m = buildClientOrgEmail(base({ businesses: [{ name: "A", color: 'red;" onload="x', sections: [] }] }));
    expect(m.html).not.toContain("onload");
    expect(buildClientOrgEmail(base({ businesses: [{ name: "A", color: "#bb1111", sections: [] }] })).html).toContain("#bb1111");
  });
  it("has no button and nothing about the sender's product", () => {
    const m = buildClientOrgEmail(base());
    expect(m.html).not.toMatch(/display:inline-block;background/);
    expect(m.html + m.text).not.toMatch(/matya/i);
  });
  it("shows every business, in order, each with its own sections", () => {
    const m = buildClientOrgEmail(
      base({
        businesses: [
          { name: "Primero SA", color: "#0a7", sections: [section({ title: "Publicaciones" })] },
          { name: "Segundo SA", color: "#a70", sections: [section({ id: "web", title: "Visitas a tu página web" })] },
        ],
      }),
    );
    expect(m.html.indexOf("Primero SA")).toBeGreaterThan(-1);
    expect(m.html.indexOf("Segundo SA")).toBeGreaterThan(m.html.indexOf("Primero SA"));
    expect(m.html.indexOf("Visitas a tu página web")).toBeGreaterThan(m.html.indexOf("Segundo SA"));
  });
  it("cuts a long list and says how many more, without pointing to the app", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ text: `Post número ${i + 1}` }));
    const m = buildClientOrgEmail(base({ businesses: [{ name: "A", color: "#0a7", sections: [section({ items, more: "y 5 más en el historial" })] }] }));
    expect(m.html).toContain("Post número 1<");
    expect(m.html).not.toContain("Post número 20");
    expect(m.html).toMatch(/y \d+ más\./);
    expect(m.html + m.text).not.toContain("historial");
  });
});
