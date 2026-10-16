// Las alertas del equipo por email: qué hechos hay (`alertFacts`) y cómo se escribe el email (`buildAlertEmail`). Módulo puro: los
// encargos se arman a mano. El envío, el tope de cinco al día y el registro están en tests/agent-database.test.ts.
import { describe, expect, it } from "vitest";
import { ALERTS_PER_DAY, alertFacts, buildAlertEmail, type AlertFact } from "@/lib/agent/alerts";
import type { TeamRunView, TeamStepView } from "@/lib/agent/team-view";
import { escapeHtml } from "@/lib/text";

const POST = ["copy", "design", "review", "prepare", "schedule", "verify"];
const VIDEO = ["copy", "design", "video", "render", "video_wait", "review", "prepare", "schedule", "verify"];
const RETRY = ["copy", "design", "review", "copy-r1", "design-r1", "review-r1", "prepare", "schedule", "verify"];
const roof = (topic: string) => ({ id: "p1", topic, objective: "", channels: ["facebook"], format: "post", keyword: "" });

const piecePlan = (ids: string[], topic = "Techos") => ({
  kind: "piece",
  piece: roof(topic),
  steps: ids.map((id) => ({ id, agent: "matya", attempt: Number(/-r(\d+)$/.exec(id)?.[1] ?? 0) })),
});

let n = 0;
const step = (name: string, extra: Partial<TeamStepView> = {}): TeamStepView => ({
  name,
  agent: "",
  model: "",
  attempt: 0,
  status: "succeeded",
  output: null,
  error: "",
  chargedCents: 0,
  createdAt: new Date(Date.UTC(2026, 9, 16, 12, 0, n++)).toISOString(),
  finishedAt: null,
  ...extra,
});
const review = (name: string, approved: boolean) =>
  step(name, { output: { approved, problems: approved ? [] : [{ kind: "tono", detail: "Promete un resultado.", sendBackTo: "copy" }], ruleProblems: [] } });
const run = (extra: Partial<TeamRunView> = {}): TeamRunView => ({
  id: `run-${n++}`,
  kind: "piece",
  origin: "owner",
  parentRunId: null,
  status: "queued",
  stage: 0,
  plan: piecePlan(POST),
  error: "",
  chargedCents: 0,
  createdAt: "2026-10-16T12:00:00.000Z",
  message: "",
  steps: [],
  ...extra,
});
/** A video piece parked at its render, waiting for the owner's go-ahead. */
const waitingVideo = (id: string, topic = "Techos", createdAt = "2026-10-16T12:00:00.000Z") =>
  run({ id, status: "waiting_approval", stage: VIDEO.indexOf("render"), plan: piecePlan(VIDEO, topic), createdAt, steps: [step("copy"), step("design"), step("video")] });
/** A piece whose second review failed, parked for the owner (the failed review is `review-r1`). */
const failedPiece = (id: string, topic = "Techos") =>
  run({
    id,
    status: "waiting_approval",
    stage: RETRY.indexOf("prepare"),
    plan: piecePlan(RETRY, topic),
    steps: [step("copy"), step("design"), review("review", false), step("copy-r1"), step("design-r1"), review("review-r1", false)],
  });

const quiet = { day: "2026-10-16", runs: [], braked: [], dayBudgetBlocked: false, selfDisabled: null, dailyRun: null };
const fact = (type: AlertFact["type"], key: string, es = "Texto.", en = "Text."): AlertFact => ({ type, key, text: { es, en } });
const business = { id: "biz-1", name: "Ricardo PA" };

describe("alertFacts", () => {
  it("alertFacts gives one fact per situation with the keys above", () => {
    const facts = alertFacts({
      day: "2026-10-16",
      runs: [waitingVideo("v1"), failedPiece("r1")],
      braked: [
        { channel: "facebook", savedAt: "2026-10-10T15:00:00.000Z" },
        { channel: "instagram", savedAt: "nunca" },
      ],
      dayBudgetBlocked: true,
      selfDisabled: { runId: "s1" },
      dailyRun: { status: "blocked" },
    });
    expect(facts.map((f) => [f.type, f.key])).toEqual([
      ["video", "video:v1"],
      ["revision", "revision:r1:review-r1"],
      ["freno", "freno:facebook:2026-10-10T15:00:00.000Z"],
      ["freno", "freno:instagram:nunca"],
      ["presupuesto", "presupuesto:2026-10-16"],
      ["apagado", "apagado:s1"],
      ["plan", "plan:2026-10-16"],
    ]);
    // Every fact says it in both languages, and names the topic or the channel it is about.
    for (const f of facts) {
      expect(f.text.es.length).toBeGreaterThan(10);
      expect(f.text.en.length).toBeGreaterThan(10);
    }
    expect(facts[0].text).toEqual({ es: expect.stringContaining("«Techos»"), en: expect.stringContaining("“Techos”") });
    expect(facts[1].text.es).toContain("«Techos»");
    expect(facts[2].text).toEqual({ es: expect.stringContaining("Facebook"), en: expect.stringContaining("Facebook") });
  });

  it("has nothing to say when nothing needs the owner", () => {
    expect(alertFacts(quiet)).toEqual([]);
    // A morning plan that is working, done or still waiting its turn is not an alert; only blocked and uncertain are.
    for (const status of ["queued", "running", "waiting_approval", "waiting_provider", "completed", "cancelled"])
      expect(alertFacts({ ...quiet, dailyRun: { status } })).toEqual([]);
    for (const status of ["blocked", "uncertain"]) expect(alertFacts({ ...quiet, dailyRun: { status } }).map((f) => f.key)).toEqual(["plan:2026-10-16"]);
  });

  it("only a video and a failed review wait as alerts: publishing and article go-aheads and other runs do not", () => {
    const ready = run({ id: "publicar", status: "waiting_approval", stage: 3, steps: [step("copy"), step("design"), review("review", true)] });
    const article = run({ id: "articulo", status: "waiting_approval", stage: 0, plan: piecePlan(["article", "review", "article_publish"]) });
    const working = [waitingVideo("working-video"), failedPiece("working-failed")].map((r) => ({ ...r, status: "running" }));
    expect(alertFacts({ ...quiet, runs: [ready, article, ...working] })).toEqual([]);
  });

  it("the revision key follows the failed review, so a new round that fails again is a new alert", () => {
    const ids = [...RETRY.slice(0, 6), "copy-r2", "design-r2", "review-r2", "prepare"];
    const again = run({
      id: "r1",
      status: "waiting_approval",
      stage: ids.indexOf("prepare"),
      plan: piecePlan(ids),
      steps: [...failedPiece("x").steps, step("copy-r2"), step("design-r2"), review("review-r2", false)],
    });
    expect(alertFacts({ ...quiet, runs: [failedPiece("r1")] }).map((f) => f.key)).toEqual(["revision:r1:review-r1"]);
    expect(alertFacts({ ...quiet, runs: [again] }).map((f) => f.key)).toEqual(["revision:r1:review-r2"]);
  });

  it("lists the waiting ones oldest first and a video before a failed review, and leaves the input as it was", () => {
    const runs = [failedPiece("r-late"), waitingVideo("v-late", "B", "2026-10-16T15:00:00.000Z"), waitingVideo("v-early", "A", "2026-10-16T09:00:00.000Z")];
    const before = runs.map((r) => r.id);
    expect(alertFacts({ ...quiet, runs }).map((f) => f.key)).toEqual(["video:v-early", "video:v-late", "revision:r-late:review-r1"]);
    expect(runs.map((r) => r.id)).toEqual(before);
  });

  it("a video or piece without a topic is still told, without the quotes", () => {
    const [f] = alertFacts({ ...quiet, runs: [waitingVideo("v1", "")] });
    expect(f.key).toBe("video:v1");
    expect(f.text.es).not.toContain("«");
    expect(f.text.en).not.toContain("“");
  });

  it("the cap is five a day", () => {
    expect(ALERTS_PER_DAY).toBe(5);
  });
});

describe("buildAlertEmail", () => {
  it("two waiting videos are two video facts grouped in one email section", () => {
    const facts = alertFacts({ ...quiet, runs: [waitingVideo("v1", "Techos", "2026-10-16T09:00:00.000Z"), waitingVideo("v2", "Goteras", "2026-10-16T10:00:00.000Z")] });
    expect(facts.map((f) => f.type)).toEqual(["video", "video"]);
    const email = buildAlertEmail(business, facts, "es", "https://app.example.com");
    // One section title for both, and each fact's text under it.
    expect(email.html.match(/Un video espera tu aprobación/g)).toHaveLength(1);
    expect(email.html).toContain("«Techos»");
    expect(email.html).toContain("«Goteras»");
    expect(email.html.indexOf("«Techos»")).toBeLessThan(email.html.indexOf("«Goteras»"));
    expect(email.text.match(/UN VIDEO ESPERA TU APROBACIÓN/g)).toHaveLength(1);
    expect(email.subject).toBe("MATYA te necesita: un video espera tu aprobación");
  });

  it("buildAlertEmail escapes a topic with <b>", () => {
    const facts = alertFacts({ ...quiet, runs: [waitingVideo("v1", '<b>Oferta</b> & "más"')] });
    const email = buildAlertEmail({ id: "biz-1", name: "Casa <i>Sol</i> & Co" }, facts, "es", "https://app.example.com");
    expect(email.html).toContain("&lt;b&gt;Oferta&lt;/b&gt; &amp; &quot;más&quot;");
    expect(email.html).not.toContain("<b>");
    expect(email.html).not.toContain("<i>");
    expect(email.html).toContain("Casa &lt;i&gt;Sol&lt;/i&gt; &amp; Co");
    // The subject and the plain text are text, not markup: they carry what the owner wrote as it is.
    expect(email.text).toContain("<b>Oferta</b>");
  });

  it("subject with three types says 'y 2 avisos más'", () => {
    const three = [fact("video", "video:v1"), fact("video", "video:v2"), fact("freno", "freno:facebook:nunca"), fact("presupuesto", "presupuesto:2026-10-16")];
    expect(buildAlertEmail(business, three, "es", "https://app.example.com").subject).toBe("MATYA te necesita: un video espera tu aprobación y 2 avisos más");
    expect(buildAlertEmail(business, three, "en", "https://app.example.com").subject).toBe("MATYA needs you: a video is waiting for your approval and 2 more alerts");
    // Two types say "1 aviso más"; one type (however many facts) says nothing more.
    expect(buildAlertEmail(business, three.slice(1, 3), "es", "https://app.example.com").subject).toBe("MATYA te necesita: un video espera tu aprobación y 1 aviso más");
    expect(buildAlertEmail(business, three.slice(1, 3), "en", "https://app.example.com").subject).toBe("MATYA needs you: a video is waiting for your approval and 1 more alert");
    expect(buildAlertEmail(business, three.slice(0, 2), "es", "https://app.example.com").subject).toBe("MATYA te necesita: un video espera tu aprobación");
  });

  it("each type has its label in the subject", () => {
    const labels: [AlertFact["type"], string, string][] = [
      ["video", "un video espera tu aprobación", "a video is waiting for your approval"],
      ["revision", "una pieza no pasó la revisión", "a piece did not pass the review"],
      ["freno", "un canal salió del plan", "a channel left the plan"],
      ["presupuesto", "se acabó el presupuesto de hoy", "today's budget ran out"],
      ["apagado", "MATYA se apagó sola", "MATYA turned itself off"],
      ["plan", "el plan de la mañana se detuvo", "the morning plan stopped"],
    ];
    for (const [type, es, en] of labels) {
      expect(buildAlertEmail(business, [fact(type, `${type}:1`)], "es", "https://x.test").subject).toBe(`MATYA te necesita: ${es}`);
      expect(buildAlertEmail(business, [fact(type, `${type}:1`)], "en", "https://x.test").subject).toBe(`MATYA needs you: ${en}`);
    }
  });

  it("sections go by type, in the order the types first appear, each with its own facts", () => {
    const facts = [fact("freno", "freno:facebook:nunca", "Canal uno."), fact("video", "video:v1", "Video uno."), fact("freno", "freno:x:nunca", "Canal dos.")];
    const email = buildAlertEmail(business, facts, "es", "https://x.test");
    expect(email.subject).toBe("MATYA te necesita: un canal salió del plan y 1 aviso más");
    const at = (s: string) => email.html.indexOf(s);
    expect(at("Un canal salió del plan")).toBeLessThan(at("Canal uno."));
    expect(at("Canal uno.")).toBeLessThan(at("Canal dos."));
    expect(at("Canal dos.")).toBeLessThan(at("Un video espera tu aprobación"));
    expect(at("Un video espera tu aprobación")).toBeLessThan(at("Video uno."));
  });

  it("opens the Centro MATYA of the business, with the button in the language of the email", () => {
    const facts = [fact("plan", "plan:2026-10-16")];
    const es = buildAlertEmail(business, facts, "es", "https://app.example.com");
    expect(es.html).toContain('href="https://app.example.com/b/biz-1/matya"');
    expect(es.html).toContain("Abrir el Centro MATYA");
    expect(es.text).toContain("Abrir el Centro MATYA: https://app.example.com/b/biz-1/matya");
    expect(es.html).toContain('<html lang="es">');
    const en = buildAlertEmail(business, facts, "en", "https://app.example.com/");
    expect(en.html).toContain('href="https://app.example.com/b/biz-1/matya"');
    expect(en.html).toContain("Open the MATYA Center");
    expect(en.html).toContain('<html lang="en">');
    expect(en.text).toContain("Open the MATYA Center: https://app.example.com/b/biz-1/matya");
  });

  it("writes each fact in the language of the email", () => {
    const facts = alertFacts({ ...quiet, dayBudgetBlocked: true });
    const es = buildAlertEmail(business, facts, "es", "https://x.test");
    const en = buildAlertEmail(business, facts, "en", "https://x.test");
    expect(es.html).toContain(escapeHtml(facts[0].text.es));
    expect(es.html).not.toContain(escapeHtml(facts[0].text.en));
    expect(en.html).toContain(escapeHtml(facts[0].text.en));
    expect(en.html).not.toContain(escapeHtml(facts[0].text.es));
    expect(en.text).toContain(facts[0].text.en);
  });
});
