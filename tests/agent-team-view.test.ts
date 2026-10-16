// La vista del equipo: en qué columna está cada encargo, cómo está y qué espera del dueño. Módulo puro: los encargos se arman a mano.
import { describe, expect, it } from "vitest";
import {
  BOARD_COLUMNS,
  boardColumn,
  boardState,
  currentStepId,
  needsYou,
  pieceInfo,
  teamWorking,
  type TeamRunView,
  type TeamStepView,
} from "@/lib/agent/team-view";

const POST = ["copy", "design", "review", "prepare", "schedule", "verify"];
const VIDEO = ["copy", "design", "video", "render", "video_wait", "review", "prepare", "schedule", "verify"];
const ARTICLE = ["article", "review", "article_publish"];
const roof = { id: "p1", topic: "Techos", objective: "", channels: ["facebook"], format: "post", keyword: "" };

/** A piece's plan as the queue stores it: the ids in order, each with the agent that does it. */
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
const review = (name: string, approved: boolean, problems: unknown[] = []) =>
  step(name, { output: { approved, problems, ruleProblems: [] } });

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
const teamRun = (extra: Partial<TeamRunView> = {}) => run({ kind: "team", plan: { kind: "team" }, ...extra });
/** A piece at `stage` of `ids`, with whatever steps already ran. */
const piece = (ids: string[], stage: number, extra: Partial<TeamRunView> = {}) =>
  run({ plan: piecePlan(ids), stage, ...extra });

const problem = { kind: "tono", detail: "El texto promete un resultado.", sendBackTo: "copy" };
const photo = { kind: "foto", detail: "La foto no muestra el techo.", sendBackTo: "design" };

describe("the board's columns", () => {
  it("are the seven of the pipeline, in order", () => {
    expect([...BOARD_COLUMNS]).toEqual(["investigacion", "estrategia", "redaccion", "diseno", "revision", "programada", "publicada"]);
  });
});

describe("currentStepId", () => {
  it("is the plan's step at the stage for a piece", () => {
    expect(currentStepId(piece(POST, 0))).toBe("copy");
    expect(currentStepId(piece(POST, 2))).toBe("review");
    expect(currentStepId(piece(["copy", "design", "review", "copy-r1", "design-r1", "review-r1", "prepare"], 5))).toBe("review-r1");
  });

  it("is the fixed team step at the stage for a team run", () => {
    expect(["plan", "research", "strategy", "dispatch"].map((_, stage) => currentStepId(teamRun({ stage })))).toEqual([
      "plan",
      "research",
      "strategy",
      "dispatch",
    ]);
  });

  it("is null past the end of the plan", () => {
    expect(currentStepId(piece(POST, POST.length))).toBeNull();
    expect(currentStepId(teamRun({ stage: 4 }))).toBeNull();
    expect(currentStepId(piece(POST, -1))).toBeNull();
  });

  it("is null when the plan cannot be read", () => {
    for (const plan of [null, undefined, "x", 7, [], {}, { kind: "piece" }, { kind: "piece", steps: [] }, { kind: "piece", steps: [{ id: 3 }] }])
      expect(currentStepId(run({ plan }))).toBeNull();
  });
});

describe("boardColumn", () => {
  it("a team run at research is in investigacion", () => {
    expect(boardColumn(teamRun({ stage: 1, status: "running" }))).toBe("investigacion");
  });

  it.each([
    [0, "investigacion"],
    [1, "investigacion"],
    [2, "estrategia"],
    [3, "estrategia"],
  ])("a team run at stage %i (plan, research | strategy, dispatch) is in %s", (stage, column) => {
    expect(boardColumn(teamRun({ stage }))).toBe(column);
  });

  it("a finished team run is in estrategia", () => {
    expect(boardColumn(teamRun({ stage: 4, status: "completed" }))).toBe("estrategia");
  });

  it("a piece at copy-r2 is in redaccion", () => {
    const ids = ["copy", "design", "review", "copy-r1", "design-r1", "review-r1", "copy-r2", "design-r2", "review-r2"];
    expect(boardColumn(piece(ids, 6, { status: "running" }))).toBe("redaccion");
  });

  it.each([
    ["copy", "redaccion", POST],
    ["article", "redaccion", ARTICLE],
    ["article-r1", "redaccion", ["article", "review", "article-r1", "review-r1", "article_publish"]],
    ["design", "diseno", POST],
    ["design-r1", "diseno", ["copy", "design", "review", "design-r1", "review-r1"]],
    ["video", "diseno", VIDEO],
    ["render", "diseno", VIDEO],
    ["video_wait", "diseno", VIDEO],
    ["review", "revision", POST],
    ["review-r1", "revision", ["copy", "design", "review", "copy-r1", "design-r1", "review-r1"]],
    ["prepare", "programada", POST],
    ["schedule", "programada", POST],
    ["article_publish", "programada", ARTICLE],
    ["verify", "programada", POST],
  ])("a piece working at %s is in %s", (id, column, ids) => {
    expect(boardColumn(piece(ids, ids.indexOf(id), { status: "running" }))).toBe(column);
  });

  it.each(["prepare", "schedule"])("a piece waiting at %s is in revision", (id) => {
    expect(boardColumn(piece(POST, POST.indexOf(id), { status: "waiting_approval" }))).toBe("revision");
  });

  it("a piece waiting at article_publish is in revision", () => {
    expect(boardColumn(piece(ARTICLE, 2, { status: "waiting_approval" }))).toBe("revision");
  });

  it("a piece waiting at render or at an article draft stays in the column of that step", () => {
    expect(boardColumn(piece(VIDEO, VIDEO.indexOf("render"), { status: "waiting_approval" }))).toBe("diseno");
    expect(boardColumn(piece(ARTICLE, 0, { status: "waiting_approval" }))).toBe("redaccion");
  });

  it("a completed piece is publicada/done", () => {
    const done = piece(POST, POST.length, { status: "completed" });
    expect(boardColumn(done)).toBe("publicada");
    expect(boardState(done)).toBe("done");
  });

  it("a piece that ran every step but did not complete stays in the column of its last step", () => {
    expect(boardColumn(piece(POST, POST.length, { status: "blocked" }))).toBe("programada");
  });

  it("a piece with an unknown step is in redaccion", () => {
    expect(boardColumn(piece(["copy", "mystery", "verify"], 1))).toBe("redaccion");
  });

  it("a piece with plan null is in redaccion and does not throw", () => {
    for (const plan of [null, undefined, "x", [], { kind: "piece" }, { kind: "piece", steps: [{}] }]) {
      const broken = run({ plan, stage: 3 });
      expect(() => boardColumn(broken)).not.toThrow();
      expect(boardColumn(broken)).toBe("redaccion");
      expect(() => boardState(broken)).not.toThrow();
      expect(needsYou([{ ...broken, status: "waiting_approval" }])).toHaveLength(1);
      expect(pieceInfo(broken)).toBeNull();
    }
  });
});

describe("boardState", () => {
  it.each([
    ["queued", "working"],
    ["running", "working"],
    ["waiting_provider", "working"],
    ["waiting_approval", "waiting"],
    ["blocked", "attention"],
    ["uncertain", "attention"],
    ["completed", "done"],
    ["cancelled", "cancelled"],
  ])("%s is %s", (status, state) => {
    expect(boardState(run({ status }))).toBe(state);
    expect(boardState(teamRun({ status }))).toBe(state);
  });

  it("a status nobody knows asks for attention instead of passing as work", () => {
    expect(boardState(run({ status: "mystery" }))).toBe("attention");
  });
});

describe("needsYou", () => {
  it("lists only the runs that wait for the owner, oldest first", () => {
    const late = piece(POST, 3, { id: "late", status: "waiting_approval", createdAt: "2026-10-16T15:00:00.000Z" });
    const early = piece(POST, 4, { id: "early", status: "waiting_approval", createdAt: "2026-10-16T09:00:00.000Z" });
    const others = ["queued", "running", "waiting_provider", "blocked", "uncertain", "completed", "cancelled"].map((status) =>
      piece(POST, 1, { id: status, status }),
    );
    const input = [late, ...others, early];
    const before = input.map((r) => r.id);
    expect(needsYou(input).map((x) => x.runId)).toEqual(["early", "late"]);
    expect(input.map((r) => r.id)).toEqual(before);
    expect(needsYou([])).toEqual([]);
  });

  it("a piece waiting at schedule after an approved review is in revision and needs 'publicar'", () => {
    const waiting = piece(POST, 4, {
      status: "waiting_approval",
      message: "Todo listo: apruébalo para programar.",
      steps: [step("copy"), step("design"), review("review", true), step("prepare")],
    });
    expect(boardColumn(waiting)).toBe("revision");
    expect(boardState(waiting)).toBe("waiting");
    expect(needsYou([waiting])).toEqual([
      {
        runId: waiting.id,
        kind: "publicar",
        topic: "Techos",
        text: "Todo listo: apruébalo para programar.",
        problems: [],
        canRedo: false,
      },
    ]);
  });

  it("a piece at render waiting is a 'video' need without redo", () => {
    const waiting = piece(VIDEO, VIDEO.indexOf("render"), {
      status: "waiting_approval",
      message: "El video necesita tu aprobación antes de generarse ($1.20).",
      steps: [step("copy"), step("design"), step("video")],
    });
    expect(needsYou([waiting])).toMatchObject([{ kind: "video", canRedo: false, problems: [], text: waiting.message }]);
  });

  it("a failed second review is a 'revision' need with its problems and redo", () => {
    const ids = ["copy", "design", "review", "copy-r1", "design-r1", "review-r1", "prepare", "schedule", "verify"];
    const waiting = piece(ids, 6, {
      status: "waiting_approval",
      message: "La revisión no aprobó la pieza.",
      steps: [
        step("copy"),
        step("design"),
        review("review", false, [problem]),
        step("copy-r1"),
        step("design-r1"),
        review("review-r1", false, [problem, photo]),
      ],
    });
    expect(needsYou([waiting])).toEqual([
      {
        runId: waiting.id,
        kind: "revision",
        topic: "Techos",
        text: "La revisión no aprobó la pieza.",
        problems: [
          { kind: "tono", detail: "El texto promete un resultado." },
          { kind: "foto", detail: "La foto no muestra el techo." },
        ],
        canRedo: true,
      },
    ]);
  });

  it("an approved review (approval mode) waiting at prepare is a 'publicar' need that can be redone", () => {
    const waiting = piece(POST, 3, {
      status: "waiting_approval",
      steps: [step("copy"), step("design"), review("review", true)],
    });
    expect(needsYou([waiting])).toMatchObject([{ kind: "publicar", canRedo: true, problems: [] }]);
  });

  it("an article draft waiting for the owner is an 'articulo' need without redo", () => {
    for (const [ids, stage] of [
      [ARTICLE, 0],
      [["article", "review", "article-r1", "review-r1", "article_publish"], 2],
    ] as const) {
      const waiting = piece([...ids], stage, { status: "waiting_approval", message: "Cuesta hasta $0.50.", steps: stage ? [step("article"), review("review", false, [problem])] : [] });
      expect(needsYou([waiting])).toMatchObject([{ kind: "articulo", canRedo: false }]);
    }
  });

  it("an article waiting at its publication after the photo with price is an 'articulo' need that can be redone", () => {
    for (const last of ["article_publish", "article_publish:1"]) {
      const waiting = piece(ARTICLE, 2, {
        status: "waiting_approval",
        message: "La foto con IA cuesta $0.04. Apruébalo para crearla y publicar.",
        steps: [step("article"), review("review", true), step("article_publish"), ...(last === "article_publish" ? [] : [step(last)])],
      });
      expect(needsYou([waiting])).toMatchObject([{ kind: "articulo", canRedo: true, problems: [] }]);
    }
  });

  it("an article waiting at its publication right after its review is not the photo: it is 'publicar', or 'revision' if the review failed", () => {
    const approved = piece(ARTICLE, 2, { status: "waiting_approval", steps: [step("article"), review("review", true)] });
    expect(needsYou([approved])).toMatchObject([{ kind: "publicar", canRedo: true }]);
    const failed = piece(ARTICLE, 2, { status: "waiting_approval", steps: [step("article"), review("review", false, [problem])] });
    expect(needsYou([failed])).toMatchObject([{ kind: "revision", canRedo: true, problems: [{ kind: "tono" }] }]);
  });

  it("only a review that really failed makes a 'revision' need", () => {
    const plain = piece(POST, 3, { status: "waiting_approval", steps: [step("copy"), step("design"), step("review", { output: {} })] });
    expect(needsYou([plain])).toMatchObject([{ kind: "publicar" }]);
    const unreadable = piece(POST, 3, { status: "waiting_approval", steps: [step("review", { output: { approved: false, problems: "x" } })] });
    expect(needsYou([unreadable])).toMatchObject([{ kind: "revision", problems: [] }]);
  });

  it("canRedo follows the rule of redo: the step before is a review and the one waiting is not an article draft", () => {
    for (const [ids, stage, redo] of [
      [POST, 3, true],
      [POST, 4, false],
      [VIDEO, VIDEO.indexOf("render"), false],
      [ARTICLE, 0, false],
      [["article", "review", "article-r1", "review-r1", "article_publish"], 2, false],
      [["copy", "design", "review", "copy-r1", "design-r1", "review-r1", "prepare"], 6, true],
    ] as const)
      expect(needsYou([piece([...ids], stage, { status: "waiting_approval" })])[0].canRedo).toBe(redo);
  });

  it("a team run that waits is a 'publicar' need, with the goal of its plan as the topic", () => {
    const waiting = teamRun({
      stage: 3,
      status: "waiting_approval",
      message: "Elige.",
      steps: [step("plan", { agent: "director", output: { goal: "Más llamadas por goteras", maxPieces: 2 } })],
    });
    expect(needsYou([waiting])).toEqual([{ runId: waiting.id, kind: "publicar", topic: "Más llamadas por goteras", text: "Elige.", problems: [], canRedo: false }]);
    expect(needsYou([teamRun({ status: "waiting_approval" })])[0].topic).toBe("");
  });
});

describe("teamWorking", () => {
  const team = (...runs: TeamRunView[]) => ({ today: "2026-10-16", tz: "America/New_York", runs, agents: [] });

  it("is idle without a team view or without runs", () => {
    expect(teamWorking(null)).toEqual({ pending: false, running: false });
    expect(teamWorking(team())).toEqual({ pending: false, running: false });
  });

  it("a queued piece or one waiting for its channel keeps the center polling without a run in progress", () => {
    for (const status of ["queued", "waiting_provider"])
      expect(teamWorking(team(teamRun({ status: "completed", stage: 4 }), piece(POST, 1, { status })))).toEqual({ pending: true, running: false });
  });

  it("a running piece is both pending and running, even when its team request already completed", () => {
    expect(teamWorking(team(teamRun({ status: "completed", stage: 4 }), piece(POST, 1, { status: "running" })))).toEqual({ pending: true, running: true });
  });

  it("runs that wait for the owner or ended are not work in progress", () => {
    const rest = ["waiting_approval", "blocked", "uncertain", "completed", "cancelled"].map((status) => piece(POST, 1, { status }));
    expect(teamWorking(team(...rest))).toEqual({ pending: false, running: false });
  });
});

describe("pieceInfo", () => {
  it("is the topic, format and channels of the piece in the plan", () => {
    expect(pieceInfo(piece(POST, 0, { plan: piecePlan(POST, { ...roof, format: "carrusel", channels: ["facebook", "instagram"] }) }))).toEqual({
      topic: "Techos",
      format: "carrusel",
      channels: ["facebook", "instagram"],
    });
  });

  it("is null for a team run and for a plan with no readable piece", () => {
    expect(pieceInfo(teamRun())).toBeNull();
    for (const plan of [null, "x", [], { kind: "piece" }, { kind: "piece", piece: null }, { kind: "piece", piece: { topic: 3 } }])
      expect(pieceInfo(run({ plan }))).toBeNull();
  });

  it("keeps what can be read of a piece with a damaged format or channels", () => {
    expect(pieceInfo(run({ plan: piecePlan(POST, { topic: "Techos", format: 3, channels: ["facebook", 4, null] }) }))).toEqual({
      topic: "Techos",
      format: "",
      channels: ["facebook"],
    });
    expect(pieceInfo(run({ plan: piecePlan(POST, { topic: "Techos" }) }))).toEqual({ topic: "Techos", format: "", channels: [] });
  });
});
