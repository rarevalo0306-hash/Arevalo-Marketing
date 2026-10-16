// La pestaña Hoy del Centro MATYA: avisos, el plan de hoy, «Necesita tu sí» y el tablero del equipo.
// Se pinta con `renderToStaticMarkup` (sin DOM) y el CSS Module simulado, como tests/youtube-fields.test.tsx.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentCenter } from "@/components/agent/AgentCenter";
import { I18nProvider } from "@/components/I18n";
import { TeamToday, redoBody } from "@/components/agent/TeamToday";
import { DEFAULT_SETTINGS, type Snapshot } from "@/components/agent/types";
import type { TeamAgentView, TeamRunView, TeamSnapshot, TeamStepView } from "@/lib/agent/team-view";

vi.mock("@/components/agent/AgentCenter.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));
vi.mock("@/components/agent/Team.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));

const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN).toISOString();

const agent = (key: string, es: string, en: string, extra: Partial<TeamAgentView> = {}): TeamAgentView => ({
  key,
  label: { es, en },
  usesModel: true,
  model: "",
  own: false,
  ready: true,
  problem: "",
  steps: 0,
  cents: 0,
  ...extra,
});
const AGENTS = [
  agent("director", "Director", "Director"),
  agent("seo", "SEO", "SEO"),
  agent("strategy", "Estratega", "Strategist"),
  agent("copy", "Redactor", "Copywriter", { model: "claude:sonnet" }),
  agent("design", "Diseñador", "Designer", { usesModel: false }),
  agent("video", "Video", "Video", { usesModel: false }),
  agent("review", "Revisor", "Reviewer"),
];

const POST = ["copy", "design", "review", "prepare", "schedule", "verify"];
const VIDEO = ["copy", "design", "video", "render", "video_wait", "review", "prepare", "schedule", "verify"];
const roof = { id: "p1", topic: "Techos que duran", objective: "", channels: ["facebook", "instagram"], format: "post", keyword: "" };
const piecePlan = (ids: string[], piece: Record<string, unknown> = roof) => ({
  kind: "piece",
  piece,
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
const run = (extra: Partial<TeamRunView> = {}): TeamRunView => ({
  id: `run-${n++}`,
  kind: "piece",
  origin: "owner",
  parentRunId: null,
  status: "running",
  stage: 0,
  plan: piecePlan(POST),
  error: "",
  chargedCents: 0,
  createdAt: "2026-10-16T12:00:00.000Z",
  message: "",
  steps: [],
  ...extra,
});
const teamRun = (extra: Partial<TeamRunView> = {}) => run({ kind: "team", plan: { kind: "team" }, stage: 4, status: "completed", ...extra });

const snap = ({
  settings = {},
  team = {},
  capturedAt = new Date().toISOString(),
}: {
  settings?: Record<string, unknown>;
  team?: Partial<TeamSnapshot> | null;
  capturedAt?: string;
} = {}): Snapshot => ({
  business: { id: "b1", name: "Techos Pérez" } as Snapshot["business"],
  industry: { key: "general", name: "General", geography: "Miami", audience: "Familias", focus: [] },
  settings: { ...DEFAULT_SETTINGS, enabled: true, revision: 1, teamMode: true, dailyHour: 7, pausedAt: null, tickAt: ago(1), ...settings },
  runs: [],
  messages: [],
  news: [],
  budget: { chargedCents: 0, reservedCents: 0, posts: 0 },
  aiReady: true,
  team: team === null ? null : { today: "2026-10-16", tz: "America/New_York", runs: [], agents: AGENTS, ...team },
  tools: [],
  connections: [],
  posts: [],
  campaigns: [],
  capturedAt,
});
const render = (over: Parameters<typeof snap>[0] = {}, busy = false) =>
  renderToStaticMarkup(<TeamToday data={snap(over)} busy={busy} act={async () => true} />);

const TICK_WARNING = "El llamado de cada minuto no está activo: el equipo no avanza ni llega el plan de la mañana.";

describe("Hoy: avisos", () => {
  it("shows the pause banner with Reanudar when pausedAt is set", () => {
    const html = render({ settings: { pausedAt: "2026-10-16T18:30:00.000Z" } });
    expect(html).toContain("MATYA está en pausa desde");
    expect(html).toContain("Reanudar");
    const free = render();
    expect(free).not.toContain("en pausa");
    expect(free).not.toContain("Reanudar");
  });

  it("tells the pause hour in the business's time zone", () => {
    // 18:30 UTC: 2:30 p.m. en Miami, 12:30 p.m. en Managua.
    expect(render({ settings: { pausedAt: "2026-10-16T18:30:00.000Z" } })).toContain("2:30");
    expect(render({ settings: { pausedAt: "2026-10-16T18:30:00.000Z" }, team: { tz: "America/Managua" } })).toContain("12:30");
  });

  it("shows the tick warning when tickAt is null or 11 minutes old, not when 2 minutes old", () => {
    for (const tickAt of [null, ago(11)]) {
      const html = render({ settings: { tickAt } });
      expect(html).toContain(TICK_WARNING);
      expect(html).toContain("Ver configuración");
    }
    const fresh = render({ settings: { tickAt: ago(2) } });
    expect(fresh).not.toContain("El llamado de cada minuto");
    expect(fresh).not.toContain("Ver configuración");
  });

  it("keeps working without a team snapshot (nothing loaded yet)", () => {
    const html = render({ team: null });
    expect(html).toContain("Nada espera tu aprobación.");
    expect(html).toContain("Hoy todavía no hay piezas.");
  });
});

describe("Hoy: el plan de hoy", () => {
  it("says when the plan arrives if the Director has not planned today", () => {
    expect(render({ settings: { dailyHour: 7 } })).toContain("El plan de hoy llega a las 7:00.");
    expect(render({ settings: { dailyHour: 9 } })).toContain("El plan de hoy llega a las 9:00.");
  });

  it("shows today's daily goal and its piece count", () => {
    const daily = teamRun({
      origin: "daily",
      steps: [
        step("plan", { output: { goal: "Llenar la agenda de inspecciones de octubre", maxPieces: 3 } }),
        step("dispatch", { output: { pieces: [roof, { ...roof, id: "p2" }, { ...roof, id: "p3" }], dropped: [] } }),
      ],
    });
    const html = render({ team: { runs: [daily] } });
    expect(html).toContain("Llenar la agenda de inspecciones de octubre");
    expect(html).toContain("3 piezas");
    expect(html).not.toContain("El plan de hoy llega a las");
  });

  it("ignores a team request the owner made and a plan of another day", () => {
    const owner = teamRun({ origin: "owner", steps: [step("plan", { output: { goal: "Objetivo del dueño", maxPieces: 1 } })] });
    const old = teamRun({
      origin: "daily",
      createdAt: "2026-10-14T12:00:00.000Z",
      steps: [step("plan", { output: { goal: "Plan de anteayer", maxPieces: 1 } })],
    });
    const html = render({ team: { runs: [owner, old] } });
    const summary = html.match(/<h2[^>]*>El plan de hoy<\/h2>[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(summary).toContain("El plan de hoy llega a las 7:00.");
    expect(summary).not.toContain("Plan de anteayer");
    expect(summary).not.toContain("Objetivo del dueño");
  });
});

describe("Hoy: el tablero", () => {
  const TITLES = ["Investigación", "Estrategia", "Redacción", "Diseño o video", "Revisión", "Programada", "Publicada"];
  const columnOf = (html: string, key: string) => html.match(new RegExp(`<section[^>]*data-column="${key}"[\\s\\S]*?</section>`))?.[0] ?? "";

  it("each column title appears once and a piece at review is under Revisión", () => {
    const atReview = run({ plan: piecePlan(POST, { ...roof, topic: "Pieza en revisión" }), stage: 2, status: "running" });
    const html = render({ team: { runs: [atReview] } });
    for (const title of TITLES) expect(html.match(new RegExp(`<h3[^>]*>${title}</h3>`, "g"))).toHaveLength(1);
    expect(TITLES.map((title) => html.indexOf(`>${title}</h3>`))).toEqual([...TITLES.map((title) => html.indexOf(`>${title}</h3>`))].sort((a, b) => a - b));
    expect(columnOf(html, "revision")).toContain("Pieza en revisión");
    for (const other of ["investigacion", "estrategia", "redaccion", "diseno", "programada", "publicada"])
      expect(columnOf(html, other)).not.toContain("Pieza en revisión");
  });

  it("puts each run in the column the view model says", () => {
    const runs = [
      teamRun({ stage: 1, status: "running", steps: [step("plan", { output: { goal: "Meta del día" } })] }),
      run({ plan: piecePlan(POST, { ...roof, topic: "Pieza redactada" }), stage: 0 }),
      run({ plan: piecePlan(VIDEO, { ...roof, topic: "Pieza en video", format: "video" }), stage: 3 }),
      run({ plan: piecePlan(POST, { ...roof, topic: "Pieza publicada" }), stage: POST.length, status: "completed" }),
    ];
    const html = render({ team: { runs } });
    expect(columnOf(html, "investigacion")).toContain("Meta del día");
    expect(columnOf(html, "redaccion")).toContain("Pieza redactada");
    expect(columnOf(html, "diseno")).toContain("Pieza en video");
    expect(columnOf(html, "publicada")).toContain("Pieza publicada");
  });

  it("each card shows the topic, format, channels, state and cost", () => {
    const card = run({
      plan: piecePlan(POST, { ...roof, topic: "Impermeabilizar antes de lluvias", format: "carrusel", channels: ["facebook", "instagram"] }),
      stage: 1,
      status: "waiting_provider",
      chargedCents: 125,
    });
    const html = columnOf(render({ team: { runs: [card] } }), "diseno");
    expect(html).toContain("Impermeabilizar antes de lluvias");
    expect(html).toContain("Carrusel");
    expect(html).toContain("Facebook, Instagram");
    expect(html).toContain("Esperando al canal");
    expect(html).toContain("$1.25");
    expect(html).toMatch(/<details/);
  });

  it("opening a card shows each step with its name, agent, model, cost, state, error and output", () => {
    const card = run({
      plan: piecePlan(["copy", "design", "review", "copy-r1", "review-r1"], { ...roof, topic: "Detalle de pieza" }),
      stage: 4,
      steps: [
        step("copy", { agent: "copy", model: "claude:sonnet", chargedCents: 7, output: { text: "Texto del borrador" } }),
        step("review", { agent: "review", status: "blocked", error: "El modelo no respondió" }),
        step("copy-r1", { agent: "copy", output: { text: "Segundo borrador" } }),
        step("prepare", { agent: "matya" }),
      ],
    });
    const html = render({ team: { runs: [card] } });
    expect(html).toContain("Redacción");
    expect(html).toContain("Redactor");
    expect(html).toContain("claude:sonnet");
    expect(html).toContain("$0.07");
    expect(html).toContain("Texto del borrador");
    expect(html).toContain("El modelo no respondió");
    expect(html).toContain("Revisión editorial");
    expect(html).toContain("Redacción (vuelta 1)");
    expect(html).toContain("Campaña preparada");
    // Un paso de código (sin agente de IA) no inventa un modelo.
    expect(html).toContain("MATYA");
  });

  it("tells the morning plan apart and does not break on a piece whose plan cannot be read", () => {
    const daily = teamRun({ origin: "daily", steps: [step("plan", { output: { goal: "Meta de la mañana" } })] });
    const damaged = run({ plan: null, stage: 0, status: "blocked", error: "El plan no se puede leer." });
    const html = render({ team: { runs: [daily, damaged] } });
    expect(columnOf(html, "estrategia")).toContain("Plan de la mañana");
    expect(columnOf(html, "redaccion")).toContain("Pieza sin tema");
    expect(columnOf(html, "redaccion")).toContain("El plan no se puede leer.");
    expect(columnOf(html, "redaccion")).toContain("Necesita atención");
  });

  it("names the new team steps", () => {
    const daily = teamRun({
      origin: "daily",
      steps: [step("plan"), step("research"), step("strategy"), step("dispatch")],
    });
    const article = run({
      plan: piecePlan(["article", "review", "article_publish"], { ...roof, format: "articulo", channels: ["seo"] }),
      stage: 2,
      steps: [step("article"), step("article_publish:2")],
    });
    const video = run({ plan: piecePlan(VIDEO, { ...roof, format: "video" }), stage: 3, steps: [step("render")] });
    const html = render({ team: { runs: [daily, article, video] } });
    for (const name of ["Plan del Director", "Investigación y SEO", "Piezas creadas", "Artículo", "Publicación en la web", "Generación del video"])
      expect(html).toContain(name);
  });

  it("shows the step names in English too", async () => {
    const { stepLabel } = await import("@/components/agent/shared");
    const t = (_es: string, en: string) => en;
    expect(stepLabel("plan", t)).toBe("Director's plan");
    expect(stepLabel("strategy", t)).toBe("Strategy");
    expect(stepLabel("dispatch", t)).toBe("Pieces created");
    expect(stepLabel("review-r1", t)).toBe("Editorial review (round 1)");
    expect(stepLabel("render", t)).toBe("Video render");
    expect(stepLabel("article", t)).toBe("Article");
    expect(stepLabel("article_publish:2", t)).toBe("Website publishing");
  });

  it("empty team: 'Nada espera tu aprobación.' and 'Hoy todavía no hay piezas.'", () => {
    const html = render();
    expect(html).toContain("Nada espera tu aprobación.");
    expect(html).toContain("Hoy todavía no hay piezas.");
  });

  it("does not say there are no pieces when the board has some", () => {
    const html = render({ team: { runs: [run()] } });
    expect(html).not.toContain("Hoy todavía no hay piezas.");
  });
});

describe("Hoy: «Necesita tu sí»", () => {
  const problem = (detail: string) => ({ kind: "tono", detail, sendBackTo: "copy" });
  const reviewed = (problems: unknown[], extra: Partial<TeamRunView> = {}) =>
    run({
      plan: piecePlan(POST, { ...roof, topic: "Pieza que no pasó" }),
      stage: 3,
      status: "waiting_approval",
      message: "El revisor encontró un problema.",
      steps: [step("review", { output: { approved: false, problems, ruleProblems: [] } })],
      ...extra,
    });

  it("a 'revision' need shows its problems, Aprobar, Rehacer and Cancelar; a 'video' need has no Rehacer", () => {
    const html = render({ team: { runs: [reviewed([problem("El texto promete un resultado.")])] } });
    expect(html).toContain("No pasó la revisión");
    expect(html).toContain("Pieza que no pasó");
    expect(html).toContain("El revisor encontró un problema.");
    expect(html).toContain("El texto promete un resultado.");
    expect(html).toContain("Aprobar");
    expect(html).toContain("Rehacer");
    expect(html).toContain("Cancelar");
    expect(html).not.toContain("Nada espera tu aprobación.");

    const video = run({
      plan: piecePlan(VIDEO, { ...roof, topic: "Video caro", format: "video" }),
      stage: 3,
      status: "waiting_approval",
      message: "El video cuesta $2.00.",
    });
    const videoHtml = render({ team: { runs: [video] } });
    expect(videoHtml).toContain("Video con costo");
    expect(videoHtml).toContain("El video cuesta $2.00.");
    expect(videoHtml).toContain("Aprobar");
    expect(videoHtml).toContain("Cancelar");
    expect(videoHtml).not.toContain("Rehacer");
  });

  it("labels each kind of go-ahead", () => {
    const publish = run({ plan: piecePlan(POST, { ...roof, topic: "Lista" }), stage: 3, status: "waiting_approval" });
    const article = run({
      plan: piecePlan(["article", "review", "article_publish"], { ...roof, topic: "Texto largo", format: "articulo", channels: ["seo"] }),
      stage: 0,
      status: "waiting_approval",
    });
    const html = render({ team: { runs: [publish, article] } });
    expect(html).toContain("Lista para publicar");
    expect(html).toContain("Artículo");
  });

  it("an owner note with <script> is rendered escaped in a problem", () => {
    const html = render({ team: { runs: [reviewed([{ kind: "dueño", detail: "<script>alert(1)</script> mejor el precio", sendBackTo: "copy" }])] } });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<script");
  });

  it("disables the buttons while a request is in flight", () => {
    const html = render({ team: { runs: [reviewed([problem("Falta la oferta.")])] } }, true);
    const buttons = [...html.matchAll(/<button[^>]*>[^<]*<\/button>/g)].map((m) => m[0]).filter((b) => /Aprobar|Rehacer|Cancelar/.test(b));
    expect(buttons.length).toBe(3);
    expect(buttons.every((b) => b.includes('disabled=""'))).toBe(true);
  });
});

describe("Hoy en inglés", () => {
  it("shows every fixed text in English when the app is in English", () => {
    const blocked = run({
      plan: piecePlan(POST, { ...roof, topic: "Roofs that last", format: "carrusel" }),
      stage: 3,
      status: "waiting_approval",
      steps: [step("review", { output: { approved: false, problems: [{ kind: "tone", detail: "Promises a result.", sendBackTo: "copy" }], ruleProblems: [] } })],
    });
    const html = renderToStaticMarkup(
      <I18nProvider lang="en">
        <TeamToday data={snap({ settings: { pausedAt: "2026-10-16T18:30:00.000Z", tickAt: null }, team: { runs: [blocked] } })} busy={false} act={async () => true} />
      </I18nProvider>,
    );
    for (const text of [
      "MATYA has been paused since",
      "Resume",
      "The every-minute call is not active",
      "View settings",
      "Today&#x27;s plan",
      "Today&#x27;s plan arrives at 7:00.",
      "Needs your OK",
      "Did not pass review",
      "Approve",
      "Redo",
      "Cancel",
      "Team board",
      "Research",
      "Design or video",
      "Published",
      "Carousel",
      "Editorial review",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("Necesita tu sí");
    expect(html).not.toContain("Aprobar");
    const empty = renderToStaticMarkup(
      <I18nProvider lang="en">
        <TeamToday data={snap()} busy={false} act={async () => true} />
      </I18nProvider>,
    );
    expect(empty).toContain("Nothing is waiting for your approval.");
    expect(empty).toContain("There are no pieces yet today.");
  });
});

describe("redoBody", () => {
  it("sends the trimmed note only when it has text", () => {
    expect(redoBody("run-1", "  Más corto y con el precio  ")).toEqual({ action: "redo", runId: "run-1", note: "Más corto y con el precio" });
  });

  it("sends no note at all when the text is empty or only spaces", () => {
    for (const note of ["", "   ", "\n\t"]) {
      const body = redoBody("run-1", note);
      expect(body).toEqual({ action: "redo", runId: "run-1" });
      expect("note" in body).toBe(false);
    }
  });
});

describe("AgentCenter: la pestaña Hoy", () => {
  const center = (settings: Record<string, unknown>) =>
    renderToStaticMarkup(<AgentCenter businessId="b1" initial={snap({ settings })} />);

  it("AgentCenter has no Hoy tab when teamMode is off", () => {
    const html = center({ teamMode: false });
    expect(html).toContain(">Conversación<");
    expect(html).toContain(">Conocimiento<");
    expect(html).not.toContain(">Hoy<");
  });

  it("has the Hoy tab right after Conversación when teamMode is on", () => {
    const html = center({ teamMode: true });
    const order = ["Conversación", "Hoy", "Conocimiento"].map((name) => html.indexOf(`>${name}<`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
