// Las pestañas Hoy y Equipo del Centro MATYA. Hoy: avisos, el plan de hoy, «Necesita tu sí» y el tablero del equipo.
// Equipo: una fila por agente con su IA, si está listo, sus pasos de hoy y su gasto.
// Se pinta con `renderToStaticMarkup` (sin DOM) y el CSS Module simulado, como tests/youtube-fields.test.tsx.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCenter } from "@/components/agent/AgentCenter";
import { I18nProvider } from "@/components/I18n";
import { TeamRoster } from "@/components/agent/TeamRoster";
import { TeamToday, redoBody } from "@/components/agent/TeamToday";
import { DEFAULT_SETTINGS, type Snapshot } from "@/components/agent/types";
import type { TeamAgentView, TeamRunView, TeamSnapshot, TeamStepView } from "@/lib/agent/team-view";

vi.mock("@/components/agent/AgentCenter.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));
vi.mock("@/components/agent/Team.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));

const MIN = 60_000;
// The snapshot's own clock: the tick is measured against the moment the server took it, never against the browser's.
const CAPTURED = "2026-10-16T18:00:00.000Z";
const before = (minutes: number, at = CAPTURED) => new Date(Date.parse(at) - minutes * MIN).toISOString();

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
  capturedAt = CAPTURED,
}: {
  settings?: Record<string, unknown>;
  team?: Partial<TeamSnapshot> | null;
  capturedAt?: string;
} = {}): Snapshot => ({
  business: { id: "b1", name: "Techos Pérez" } as Snapshot["business"],
  industry: { key: "general", name: "General", geography: "Miami", audience: "Familias", focus: [] },
  settings: { ...DEFAULT_SETTINGS, enabled: true, revision: 1, teamMode: true, dailyHour: 7, pausedAt: null, tickAt: before(1, capturedAt), ...settings },
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
  renderToStaticMarkup(<TeamToday data={snap(over)} busy={busy} act={async () => true} onSettings={() => {}} />);

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
    for (const tickAt of [null, before(11)]) {
      const html = render({ settings: { tickAt } });
      expect(html).toContain(TICK_WARNING);
      expect(html).toContain("Ver configuración");
    }
    const fresh = render({ settings: { tickAt: before(2) } });
    expect(fresh).not.toContain("El llamado de cada minuto");
    expect(fresh).not.toContain("Ver configuración");
  });

  it("warns only past 10 minutes, and also for a tick it cannot read", () => {
    expect(render({ settings: { tickAt: before(10) } })).not.toContain("El llamado de cada minuto");
    expect(render({ settings: { tickAt: new Date(Date.parse(CAPTURED) - 10 * MIN - 1000).toISOString() } })).toContain("El llamado de cada minuto");
    expect(render({ settings: { tickAt: "no es una fecha" } })).toContain("El llamado de cada minuto");
    // A tick that landed just after the snapshot was taken is not old.
    expect(render({ settings: { tickAt: before(-1) } })).not.toContain("El llamado de cada minuto");
  });

  describe("with a wrong clock on the owner's device", () => {
    afterEach(() => vi.useRealTimers());

    it("neither hides a stale tick nor fakes a warning for a fresh one", () => {
      for (const wrongNow of ["2020-01-01T00:00:00.000Z", "2031-06-01T00:00:00.000Z"]) {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(wrongNow));
        expect(render({ settings: { tickAt: before(11) } })).toContain("El llamado de cada minuto");
        expect(render({ settings: { tickAt: before(2) } })).not.toContain("El llamado de cada minuto");
        vi.useRealTimers();
      }
    });
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

  it("each card shows a chevron that is hidden from assistive technology and adds no text", () => {
    const card = run({ plan: piecePlan(POST, { ...roof, topic: "Con flecha" }), stage: 0 });
    const html = columnOf(render({ team: { runs: [card] } }), "redaccion");
    const summary = html.match(/<summary>[\s\S]*?<\/summary>/)?.[0] ?? "";
    expect(summary).toContain('<span class="chevron" aria-hidden="true"></span>');
    expect(summary.indexOf("chevron")).toBeGreaterThan(summary.indexOf("Con flecha"));
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
        <TeamToday data={snap({ settings: { pausedAt: "2026-10-16T18:30:00.000Z", tickAt: null }, team: { runs: [blocked] } })} busy={false} act={async () => true} onSettings={() => {}} />
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
        <TeamToday data={snap()} busy={false} act={async () => true} onSettings={() => {}} />
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

describe("Team.module.css", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const TEAM = read("src/components/agent/Team.module.css");
  const CENTER = read("src/components/agent/AgentCenter.module.css");
  const GLOBALS = read("src/app/globals.css");
  const block = (css: string, head: string) => {
    const at = css.indexOf(head);
    expect(at, head).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };
  const hex = (css: string, name: string) => {
    const found = new RegExp(`(?<![\\w-])${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1];
    expect(found, name).toBeDefined();
    return found!;
  };
  const luminance = (color: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("stacks the board on phones with every column stretched to the full width", () => {
    const at = TEAM.indexOf("@media (max-width: 719px)");
    expect(at).toBeGreaterThanOrEqual(0);
    const phones = TEAM.slice(at, TEAM.indexOf("\n}\n", at));
    const board = /\.board \{([^}]*)\}/.exec(phones)?.[1] ?? "";
    expect(board).toContain("display: flex");
    expect(board).toContain("flex-direction: column");
    expect(board).toContain("align-items: stretch");
  });

  it("has a night-theme colour for each hard-coded colour", () => {
    for (const selector of [
      ".error",
      '.state[data-state="attention"]',
      '.state[data-state="blocked"]',
      '.state[data-state="uncertain"]',
      '.need[data-kind="video"]',
      '.need[data-kind="revision"]',
      ".tag",
    ])
      expect(TEAM, selector).toContain(`:global([data-theme="noche"]) ${selector}`);
  });

  it("keeps every text on its background at 4.5:1 in the day and the night theme", () => {
    const day = { surface: hex(block(GLOBALS, ":root {"), "--surface"), surface2: hex(block(GLOBALS, ":root {"), "--surface-2"), muted: hex(block(GLOBALS, ":root {"), "--muted") };
    const nightTokens = block(GLOBALS, 'html[data-theme="noche"] {');
    const night = { surface: hex(nightTokens, "--surface"), surface2: hex(nightTokens, "--surface-2"), muted: hex(nightTokens, "--muted"), ground: hex(nightTokens, "--ground") };
    const dayAccent = block(CENTER, ".root {");
    const nightAccent = block(CENTER, ':global([data-theme="noche"]) .root {');
    const dayError = hex(block(TEAM, ".error {"), "color");
    const nightError = hex(block(TEAM, ':global([data-theme="noche"]) .error,'), "color");
    const dayTag = hex(block(TEAM, ".tag {"), "color");
    const pairs: [string, string, string][] = [
      ["day error on a card", dayError, day.surface],
      ["day error on the column", dayError, day.surface2],
      ["day tag", dayTag, hex(dayAccent, "--agent-tint")],
      ["day state on a card", hex(dayAccent, "--agent-accent"), day.surface],
      ["day muted on a card", day.muted, day.surface],
      ["day muted on the column", day.muted, day.surface2],
      ["night error on a card", nightError, night.surface],
      ["night error on the column", nightError, night.surface2],
      ["night tag", hex(nightAccent, "--agent-accent"), hex(nightAccent, "--agent-tint")],
      ["night state on a card", hex(nightAccent, "--agent-accent"), night.surface],
      ["night muted on a card", night.muted, night.surface],
      ["night muted on the column", night.muted, night.surface2],
      ["night muted on the page", night.muted, night.ground],
    ];
    for (const [name, text, background] of pairs) expect(contrast(text, background), `${name}: ${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Equipo", () => {
  const roster = (over: Parameters<typeof snap>[0] = {}, lang: "es" | "en" = "es") =>
    renderToStaticMarkup(
      <I18nProvider lang={lang}>
        <TeamRoster data={snap(over)} />
      </I18nProvider>,
    );
  /** The markup of each agent row, in page order. */
  const rows = (html: string) => [...html.matchAll(/<li class="agentRow"[\s\S]*?<\/li>/g)].map((m) => m[0]);
  const count = (html: string, text: string) => html.split(text).length - 1;
  const NO_AI = "Sin IA (biblioteca y plantillas)";
  const DEFAULT_MODEL = "Usa el modelo por defecto";

  it("lists the seven agents in order with their model or 'Sin IA'", () => {
    // SEO chose its own model; Copy and the others use the default one; Director has none to show.
    const agents = AGENTS.map((a) => (a.key === "seo" ? { ...a, own: true, model: "openai:gpt-5-mini" } : a));
    const html = roster({ team: { agents } });
    const list = rows(html);
    expect(list).toHaveLength(7);
    ["Director", "SEO", "Estratega", "Redactor", "Diseñador", "Video", "Revisor"].forEach((name, i) => expect(list[i], name).toContain(`>${name}<`));
    // The model is what the agent works with; "Sin IA" is only for Diseño and Video.
    expect(list[1]).toContain("openai:gpt-5-mini");
    expect(list[3]).toContain("claude:sonnet");
    expect(count(html, NO_AI)).toBe(2);
    expect(list[4]).toContain(NO_AI);
    expect(list[5]).toContain(NO_AI);
    list.filter((_, i) => i !== 4 && i !== 5).forEach((row) => expect(row).not.toContain(NO_AI));
    // The default-model note appears for the AI agents that did not choose one, never for the one that did or for the two without AI.
    expect(count(html, DEFAULT_MODEL)).toBe(4);
    expect(list[1]).not.toContain(DEFAULT_MODEL);
    expect(list[3]).toContain(DEFAULT_MODEL);
    expect(list[4]).not.toContain(DEFAULT_MODEL);
    expect(list[5]).not.toContain(DEFAULT_MODEL);
  });

  it("an agent with a problem shows the message", () => {
    const message = "Falta la clave de IA del proveedor de Redacción.";
    const agents = AGENTS.map((a) => (a.key === "copy" ? { ...a, ready: false, problem: message } : a));
    const list = rows(roster({ team: { agents } }));
    expect(list[3]).toContain(message);
    expect(list[3]).toContain("Aviso");
    expect(list[3]).not.toContain("Listo");
    // The six agents that can work say so, and carry no warning.
    list.filter((_, i) => i !== 3).forEach((row) => {
      expect(row).toContain("Listo");
      expect(row).not.toContain("Aviso");
    });
    // Not ready without a message still warns, in words.
    const silent = rows(roster({ team: { agents: AGENTS.map((a) => (a.key === "seo" ? { ...a, ready: false } : a)) } }));
    expect(silent[1]).toContain("Aviso");
    expect(silent[1]).toContain("No está listo.");
    expect(silent[1]).not.toContain("Listo");
  });

  it("the total adds the agents' cents", () => {
    const agents = AGENTS.map((a) => (a.key === "copy" ? { ...a, steps: 3, cents: 12 } : a.key === "review" ? { ...a, steps: 1, cents: 30 } : a.key === "seo" ? { ...a, steps: 2, cents: 1 } : a));
    const html = roster({ settings: { dailyBudgetCents: 500 }, team: { agents } });
    const list = rows(html);
    // Each row has its own steps and spend.
    expect(list[3]).toContain("3 pasos hoy");
    expect(list[3]).toContain("$0.12");
    expect(list[6]).toContain("1 paso hoy");
    expect(list[6]).toContain("$0.30");
    expect(list[1]).toContain("2 pasos hoy");
    expect(list[0]).toContain("0 pasos hoy");
    expect(list[0]).toContain("$0.00");
    // 12 + 30 + 1 = 43 cents of a $5.00 day.
    const total = html.slice(html.indexOf('class="total"'));
    expect(total).toContain("$0.43");
    expect(total).toContain("$5.00");
    expect(total).not.toContain("agentRow");
    // The total comes after the last agent.
    expect(html.indexOf('class="total"')).toBeGreaterThan(html.lastIndexOf("agentRow"));
  });

  it("says when the whole day's spend is higher than the agents' (the conversation spends too)", () => {
    const agents = AGENTS.map((a) => (a.key === "copy" ? { ...a, steps: 1, cents: 12 } : a));
    const base = snap({ settings: { dailyBudgetCents: 500 }, team: { agents } });
    const higher = renderToStaticMarkup(<TeamRoster data={{ ...base, budget: { chargedCents: 250, reservedCents: 0, posts: 0 } }} />);
    expect(higher).toContain("$2.50");
    for (const same of [{ chargedCents: 12, reservedCents: 0, posts: 0 }, { chargedCents: 0, reservedCents: 0, posts: 0 }, null]) {
      const html = renderToStaticMarkup(<TeamRoster data={{ ...base, budget: same }} />);
      expect(html).not.toContain("$2.50");
      expect(html).toContain("$0.12");
    }
  });

  it("shows the model and the problem as escaped text", () => {
    const agents = AGENTS.map((a) =>
      a.key === "copy" ? { ...a, model: "<img src=x onerror=alert(1)>:model", ready: false, problem: "<script>alert(1)</script> sin clave" } : a,
    );
    const html = roster({ team: { agents } });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; sin clave");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;:model");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });

  it("shows an empty state, not a broken list, while the team has no agents", () => {
    for (const team of [null, { agents: [] }]) {
      const html = roster({ team });
      expect(html).toContain("Todavía no hay datos del equipo.");
      expect(rows(html)).toHaveLength(0);
    }
  });

  it("shows every fixed text in English when the app is in English", () => {
    const agents = AGENTS.map((a) => (a.key === "copy" ? { ...a, ready: false, problem: "Missing key", steps: 1, cents: 5 } : { ...a, steps: 2 }));
    const base = snap({ settings: { dailyBudgetCents: 500 }, team: { agents } });
    const html = renderToStaticMarkup(
      <I18nProvider lang="en">
        <TeamRoster data={{ ...base, budget: { chargedCents: 300, reservedCents: 0, posts: 0 } }} />
      </I18nProvider>,
    );
    for (const text of ["The team", "Director", "No AI (library and templates)", "Uses the default model", "Ready", "Warning", "Missing key", "2 steps today", "1 step today", "Team total today", "$0.05", "$5.00", "$3.00"])
      expect(html, text).toContain(text);
    for (const text of ["Sin IA", "Usa el modelo", "Listo", "Aviso", "pasos hoy", "Total del equipo"]) expect(html, text).not.toContain(text);
    expect(roster({ team: null }, "en")).toContain("There is no team data yet.");
  });

  const center = (settings: Record<string, unknown>) => renderToStaticMarkup(<AgentCenter businessId="b1" initial={snap({ settings })} />);

  it("AgentCenter has no Equipo tab when teamMode is off", () => {
    expect(center({ teamMode: false })).not.toContain(">Equipo<");
  });

  it("has the Equipo tab right after Hoy when teamMode is on", () => {
    const html = center({ teamMode: true });
    const order = ["Conversación", "Hoy", "Equipo", "Conocimiento"].map((name) => html.indexOf(`>${name}<`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  describe("Team.module.css", () => {
    const TEAM = readFileSync(new URL("../src/components/agent/Team.module.css", import.meta.url), "utf8");
    const section = TEAM.slice(TEAM.indexOf("/* Equipo"), TEAM.indexOf("/* Pantallas medianas"));

    it("styles the roster with the theme tokens only, so the night theme needs no colours of its own", () => {
      expect(section.length).toBeGreaterThan(0);
      expect(section).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(section).not.toMatch(/\b(rgb|hsl)a?\(/i);
    });

    it("stacks each row on phones and lets long model ids and messages wrap", () => {
      const at = TEAM.indexOf("@media (max-width: 719px)");
      const phones = TEAM.slice(at, TEAM.indexOf("\n}\n", at));
      const row = /\.agentRow \{([^}]*)\}/.exec(phones)?.[1] ?? "";
      expect(row).toContain("grid-template-areas");
      expect(row).toContain("grid-template-columns: minmax(0, 1fr)");
      // The list and its container are one shrinkable column, so a long model id cannot widen the page.
      for (const selector of [".roster {", ".agents {"]) {
        const rule = section.slice(section.indexOf(selector), section.indexOf("}", section.indexOf(selector)));
        expect(rule, selector).toContain("grid-template-columns: minmax(0, 1fr)");
      }
      for (const selector of [".agentRow {", ".model {", ".agentStatus {"]) {
        const rule = section.slice(section.indexOf(selector), section.indexOf("}", section.indexOf(selector)));
        expect(rule, selector).toContain("min-width: 0");
      }
      expect(section).toContain("overflow-wrap: anywhere");
    });
  });
});
