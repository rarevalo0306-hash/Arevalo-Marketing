// Piezas del equipo: plantillas de pasos, validador de lo que propone la IA y una sola vuelta de corrección.
import { describe, expect, it } from "vitest";
import {
  Piece,
  TEAM_STEPS,
  capByDirector,
  directorMax,
  problemsOf,
  reworkSteps,
  stepsForPiece,
  stepsOfPlan,
  validatePieces,
} from "@/lib/agent/plan";

const limits = {
  remainingPosts: 2,
  channels: ["facebook", "instagram", "seo"],
  allowSocial: true,
  allowWebArticles: true,
  today: "2026-10-16",
  recentTopics: ["deducible de viento"],
};

describe("piezas del equipo", () => {
  it("plantillas: no se diseña sin texto ni se programa sin revisión", () => {
    expect(stepsForPiece("post").map((s) => s.id)).toEqual([
      "copy",
      "design",
      "review",
      "prepare",
      "schedule",
      "verify",
    ]);
    expect(stepsForPiece("video").map((s) => s.id)).toEqual([
      "copy",
      "design",
      "video",
      "render",
      "video_wait",
      "review",
      "prepare",
      "schedule",
      "verify",
    ]);
    expect(stepsForPiece("articulo").map((s) => s.id)).toEqual([
      "article",
      "review",
      "article_publish",
    ]);
  });

  it("plantillas: carrusel igual que post, agentes y intentos", () => {
    expect(stepsForPiece("carrusel")).toEqual(stepsForPiece("post"));
    expect(
      stepsForPiece("video").map((s) => [s.id, s.agent, s.attempt]),
    ).toEqual([
      ["copy", "copy", 0],
      ["design", "design", 0],
      ["video", "video", 0],
      ["render", "matya", 0],
      ["video_wait", "matya", 0],
      ["review", "review", 0],
      ["prepare", "matya", 0],
      ["schedule", "matya", 0],
      ["verify", "matya", 0],
    ]);
    expect(
      stepsForPiece("articulo").map((s) => [s.id, s.agent, s.attempt]),
    ).toEqual([
      ["article", "copy", 0],
      ["review", "review", 0],
      ["article_publish", "matya", 0],
    ]);
    // Cada llamada devuelve una copia nueva.
    expect(stepsForPiece("post")).not.toBe(stepsForPiece("post"));
  });

  it("descarta lo que no está permitido, con motivo, sin lanzar", () => {
    const r = validatePieces(
      [
        {
          id: "p1",
          topic: "Techos después del huracán",
          channels: ["facebook", "youtube"],
          format: "post",
        },
        {
          id: "p2",
          topic: "Deducible de viento",
          channels: ["facebook"],
          format: "post",
        },
        {
          id: "p3",
          topic: "Seguro de inundación",
          channels: ["tiktok"],
          format: "video",
        },
        {
          id: "p4",
          topic: "Qué cubre tu póliza",
          channels: ["seo"],
          format: "articulo",
          date: "2026-10-01",
        },
        {
          id: "p5",
          topic: "Reclamos rápidos",
          channels: ["instagram"],
          format: "post",
        },
        { id: "p6", topic: "Otro", channels: ["facebook"], format: "post" },
      ],
      limits,
    );
    expect(r.pieces.map((p) => [p.id, p.channels])).toEqual([
      ["p1", ["facebook"]],
      ["p5", ["instagram"]],
    ]);
    expect(r.dropped.map((d) => d.id)).toEqual(["p2", "p3", "p4", "p6"]); // repetido, sin canal, fecha pasada, sin cupo
  });

  it("sin permiso de web descarta artículos; basura no lanza", () => {
    expect(
      validatePieces(
        [{ id: "p1", topic: "Guía", channels: ["seo"], format: "articulo" }],
        { ...limits, allowWebArticles: false },
      ).pieces,
    ).toEqual([]);
    expect(validatePieces("hola", limits)).toEqual({
      pieces: [],
      dropped: [{ id: "?", reason: "formato" }],
    });
  });

  it("cada descarte lleva su motivo exacto", () => {
    const r = validatePieces(
      [
        { id: "p1", topic: "Techos", channels: ["facebook", "youtube"], format: "post" },
        { id: "p2", topic: "DEDUCIBLE  de   Víento", channels: ["facebook"], format: "post" },
        { id: "p3", topic: "Seguro de inundación", channels: ["tiktok"], format: "video" },
        { id: "p4", topic: "Qué cubre tu póliza", channels: ["seo"], format: "articulo", date: "2026-10-01" },
        { id: "p5", topic: "Reclamos rápidos", channels: ["instagram"], format: "post" },
        { id: "p6", topic: "Otro tema", channels: ["facebook"], format: "post" },
        { id: "p7", topic: "Sin formato", channels: ["facebook"], format: "reel" },
        { id: "p8", topic: "Youtube solo", channels: ["youtube"], format: "post" },
        { id: "p9", topic: "reclamos RÁPIDOS", channels: ["facebook"], format: "post" },
      ],
      { ...limits, remainingPosts: 3 },
    );
    expect(r.pieces.map((p) => p.id)).toEqual(["p1", "p5", "p6"]);
    expect(r.dropped).toEqual([
      { id: "p2", reason: "repetido" },
      { id: "p3", reason: "sin canal" },
      { id: "p4", reason: "fecha pasada" },
      { id: "p7", reason: "formato" },
      { id: "p8", reason: "sin canal" },
      { id: "p9", reason: "repetido" },
    ]);
  });

  it("sin allowSocial solo quedan artículos; sin allowWebArticles no hay artículos", () => {
    const items = [
      { id: "p1", topic: "Un post", channels: ["facebook"], format: "post" },
      { id: "p2", topic: "Un artículo", channels: ["seo"], format: "articulo" },
      { id: "p3", topic: "Un video", channels: ["instagram"], format: "video" },
    ];
    const noSocial = validatePieces(items, { ...limits, allowSocial: false });
    expect(noSocial.pieces.map((p) => p.id)).toEqual(["p2"]);
    expect(noSocial.dropped).toEqual([
      { id: "p1", reason: "no permitido" },
      { id: "p3", reason: "no permitido" },
    ]);
    const noWeb = validatePieces(items, { ...limits, allowWebArticles: false });
    expect(noWeb.pieces.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(noWeb.dropped).toEqual([{ id: "p2", reason: "no permitido" }]);
  });

  it("la fecha de hoy sirve; lo descartado no gasta cupo ni cuenta como tema visto", () => {
    const r = validatePieces(
      [
        { id: "p1", topic: "Tema uno", channels: ["facebook"], format: "post", date: "2026-10-16" },
        { id: "p2", topic: "Tema dos", channels: ["tiktok"], format: "post" },
        { id: "p3", topic: "Tema dos", channels: ["facebook"], format: "post", date: "2026-10-17" },
        { id: "p4", topic: "Tema tres", channels: ["facebook"], format: "post" },
      ],
      limits,
    );
    // p2 cae por canal: no gasta cupo y su tema no bloquea a p3.
    expect(r.pieces.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(r.dropped).toEqual([
      { id: "p2", reason: "sin canal" },
      { id: "p4", reason: "sin cupo" },
    ]);
  });

  it("una fecha que no existe en el calendario es formato; el 29 de febrero bisiesto sirve", () => {
    const at = (id: string, topic: string, date: string) => ({
      id,
      topic,
      channels: ["facebook"],
      format: "post",
      date,
    });
    const r = validatePieces(
      [
        at("p1", "Febrero treinta", "2026-02-30"),
        at("p2", "Noviembre treinta y uno", "2026-11-31"),
        at("p3", "Mes trece", "2026-13-45"),
        at("p4", "Mes cero", "2026-00-10"),
        at("p5", "Día cero", "2026-10-00"),
        at("p6", "No bisiesto", "2027-02-29"),
        at("p7", "Siglo sin bisiesto", "2100-02-29"),
        at("p8", "Año cero", "0000-01-01"),
        at("p9", "Bisiesto", "2028-02-29"),
      ],
      { ...limits, remainingPosts: 5 },
    );
    expect(r.pieces.map((p) => [p.id, p.date])).toEqual([["p9", "2028-02-29"]]);
    expect(r.dropped).toEqual(
      ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"].map((id) => ({
        id,
        reason: "formato",
      })),
    );
    // Una fecha imposible es formato aunque el canal tampoco sirva.
    expect(
      validatePieces(
        [{ ...at("p1", "Canal malo", "2026-02-30"), channels: ["youtube"] }],
        limits,
      ).dropped,
    ).toEqual([{ id: "p1", reason: "formato" }]);
  });

  it("el orden de las reglas: canal, permiso, fecha pasada, repetido", () => {
    const past = "2026-10-01";
    const one = (extra: Record<string, unknown>, over = {}) =>
      validatePieces(
        [
          {
            id: "p1",
            topic: "Deducible de viento",
            channels: ["facebook"],
            format: "post",
            ...extra,
          },
        ],
        { ...limits, ...over },
      ).dropped;
    // sin canal antes que no permitido
    expect(one({ channels: ["tiktok"] }, { allowSocial: false })).toEqual([
      { id: "p1", reason: "sin canal" },
    ]);
    // no permitido antes que fecha pasada
    expect(
      one({ topic: "Tema nuevo", date: past }, { allowSocial: false }),
    ).toEqual([{ id: "p1", reason: "no permitido" }]);
    // fecha pasada antes que repetido (el tema ya está en recentTopics)
    expect(one({ date: past })).toEqual([{ id: "p1", reason: "fecha pasada" }]);
    // repetido antes que sin cupo
    expect(one({}, { remainingPosts: 0 })).toEqual([
      { id: "p1", reason: "repetido" },
    ]);
  });

  it("el artículo también gasta cupo", () => {
    const r = validatePieces(
      [
        { id: "p1", topic: "Primero", channels: ["facebook"], format: "post" },
        { id: "p2", topic: "Artículo largo", channels: ["seo"], format: "articulo" },
        { id: "p3", topic: "Tercero", channels: ["facebook"], format: "post" },
      ],
      limits,
    );
    expect(r.pieces.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(r.dropped).toEqual([{ id: "p3", reason: "sin cupo" }]);
    expect(
      validatePieces(
        [{ id: "p1", topic: "Primero", channels: ["facebook"], format: "post" }],
        { ...limits, remainingPosts: 0 },
      ).dropped,
    ).toEqual([{ id: "p1", reason: "sin cupo" }]);
  });

  it("un id repetido se descarta como repetido y el tema compara sin acentos", () => {
    const r = validatePieces(
      [
        { id: "p1", topic: "Cobertura", channels: ["facebook"], format: "post" },
        { id: "p1", topic: "Otra cosa", channels: ["facebook"], format: "post" },
        { id: "p2", topic: "COBERTURA", channels: ["facebook"], format: "post" },
      ],
      { ...limits, remainingPosts: 5 },
    );
    expect(r.pieces.map((p) => p.id)).toEqual(["p1"]);
    expect(r.dropped).toEqual([
      { id: "p1", reason: "repetido" },
      { id: "p2", reason: "repetido" },
    ]);
  });

  it("aplica los valores por defecto y quita canales repetidos", () => {
    const r = validatePieces(
      [{ id: "p3", topic: "  Tema  ", channels: ["facebook", "facebook"], format: "carrusel" }],
      limits,
    );
    expect(r.pieces).toEqual([
      { id: "p3", topic: "Tema", objective: "", channels: ["facebook"], format: "carrusel", keyword: "" },
    ]);
    expect(Piece.safeParse({ id: "p13", topic: "Tema", channels: ["x"], format: "post" }).success).toBe(false);
    expect(Piece.safeParse({ id: "p12", topic: "Tema", channels: ["x"], format: "post" }).success).toBe(true);
  });

  it("nunca lanza, sea lo que sea lo que llegue", () => {
    const boom = {
      get id(): string {
        throw new Error("id");
      },
      get topic(): string {
        throw new Error("topic");
      },
    };
    const trap = new Proxy({}, {
      get() {
        throw new Error("proxy");
      },
      ownKeys() {
        throw new Error("keys");
      },
      has() {
        throw new Error("has");
      },
    });
    const sparse = new Array(2);
    const cyclic: Record<string, unknown> = { id: "p1" };
    cyclic.self = cyclic;
    const inputs: unknown[] = [
      null,
      undefined,
      7,
      NaN,
      true,
      Symbol("x"),
      () => 1,
      {},
      { pieces: [] },
      [null, undefined, 7, "x", [], [[]], {}, boom, trap, sparse, cyclic],
      [{ id: 5, topic: { a: 1 }, channels: "facebook", format: ["post"] }],
      [{ id: "p1", topic: "Tema", channels: [null, 3, {}], format: "post" }],
      [{ id: "p1", topic: "Tema", channels: ["facebook"], format: "post", date: 20261016 }],
    ];
    for (const raw of inputs) {
      const r = validatePieces(raw, limits);
      expect(Array.isArray(r.pieces)).toBe(true);
      expect(Array.isArray(r.dropped)).toBe(true);
      for (const d of r.dropped) {
        expect(typeof d.id).toBe("string");
        expect(typeof d.reason).toBe("string");
      }
    }
    expect(validatePieces(null, limits)).toEqual({
      pieces: [],
      dropped: [{ id: "?", reason: "formato" }],
    });
    const odd = validatePieces([null, 7, boom, trap, { id: "p9" }], limits);
    expect(odd.pieces).toEqual([]);
    expect(odd.dropped).toEqual([
      { id: "?", reason: "formato" },
      { id: "?", reason: "formato" },
      { id: "?", reason: "formato" },
      { id: "?", reason: "formato" },
      { id: "p9", reason: "formato" },
    ]);
  });

  it("una sola vuelta de corrección", () => {
    expect(
      reworkSteps([{ kind: "dato", detail: "x", sendBackTo: "copy" }], 0).map((s) => s.id),
    ).toEqual(["copy-r1", "design-r1", "review-r1"]);
    expect(
      reworkSteps([{ kind: "imagen", detail: "x", sendBackTo: "design" }], 0).map((s) => s.id),
    ).toEqual(["design-r1", "review-r1"]);
    expect(reworkSteps([{ kind: "dato", detail: "x", sendBackTo: "copy" }], 1)).toEqual([]);
  });

  it("la corrección: agentes, intento 1, formatos sin diseño y sin video", () => {
    expect(
      reworkSteps([{ kind: "dato", detail: "x", sendBackTo: "copy" }], 0).map((s) => [s.id, s.agent, s.attempt]),
    ).toEqual([
      ["copy-r1", "copy", 1],
      ["design-r1", "design", 1],
      ["review-r1", "review", 1],
    ]);
    // Un problema de cada lado: el mismo resultado, sin pasos repetidos.
    expect(
      reworkSteps(
        [
          { kind: "dato", detail: "x", sendBackTo: "copy" },
          { kind: "imagen", detail: "y", sendBackTo: "design" },
        ],
        0,
      ).map((s) => s.id),
    ).toEqual(["copy-r1", "design-r1", "review-r1"]);
    // Artículo: todo vuelve al redactor, nunca hay diseño.
    for (const sendBackTo of ["copy", "design"] as const) {
      expect(
        reworkSteps([{ kind: "k", detail: "x", sendBackTo }], 0, "articulo").map((s) => [s.id, s.agent, s.attempt]),
      ).toEqual([
        ["article-r1", "copy", 1],
        ["review-r1", "review", 1],
      ]);
    }
    expect(reworkSteps([{ kind: "k", detail: "x", sendBackTo: "copy" }], 1, "articulo")).toEqual([]);
    // Video y carrusel: nunca se vuelve a generar video ni a renderizar.
    for (const format of ["video", "carrusel", "post"] as const) {
      expect(
        reworkSteps([{ kind: "k", detail: "x", sendBackTo: "copy" }], 0, format).map((s) => s.id),
      ).toEqual(["copy-r1", "design-r1", "review-r1"]);
      expect(
        reworkSteps([{ kind: "k", detail: "x", sendBackTo: "design" }], 0, format).map((s) => s.id),
      ).toEqual(["design-r1", "review-r1"]);
    }
    // Sin problemas no hay nada que corregir.
    expect(reworkSteps([], 0)).toEqual([]);
  });

  it("stepsOfPlan: pieza, equipo y basura", () => {
    const plan = { kind: "piece", steps: stepsForPiece("articulo") };
    expect(stepsOfPlan(plan)).toEqual(["article", "review", "article_publish"]);
    const team = stepsOfPlan({ kind: "team" });
    expect(team).toEqual(["plan", "research", "strategy", "dispatch"]);
    expect(team).toEqual([...TEAM_STEPS]);
    // Es una copia: cambiarla no toca la constante.
    team?.push("x");
    expect(stepsOfPlan({ kind: "team" })).toEqual([...TEAM_STEPS]);
    for (const bad of [
      null,
      undefined,
      "piece",
      7,
      [],
      {},
      { kind: "otra" },
      { kind: "piece" },
      { kind: "piece", steps: [] },
      { kind: "piece", steps: "copy" },
      { kind: "piece", steps: { id: "copy" } },
      { kind: "piece", steps: [null] },
      { kind: "piece", steps: ["copy"] },
      { kind: "piece", steps: [{ agent: "copy" }] },
      { kind: "piece", steps: [{ id: 3 }] },
      { kind: "piece", steps: [{ id: "copy" }, { id: null }] },
    ]) {
      expect(stepsOfPlan(bad)).toBeNull();
    }
    expect(
      stepsOfPlan({
        get kind(): string {
          throw new Error("kind");
        },
      }),
    ).toBeNull();
  });
});

describe("el sitio web es el canal de los artículos y de nada más", () => {
  const piece = (id: string, topic: string, format: string, channels: string[]) => ({
    id,
    topic,
    channels,
    format,
  });

  it("un artículo solo con redes sociales se descarta como sin canal", () => {
    const r = validatePieces([piece("p1", "Guía de reclamos", "articulo", ["facebook"])], limits);
    expect(r).toEqual({ pieces: [], dropped: [{ id: "p1", reason: "sin canal" }] });
  });

  it("una publicación pierde `seo` y conserva sus redes", () => {
    const r = validatePieces([piece("p1", "Techos de tejas", "post", ["seo", "facebook"])], limits);
    expect(r.pieces.map((p) => p.channels)).toEqual([["facebook"]]);
    expect(r.dropped).toEqual([]);
  });

  it("un artículo conserva solo `seo`", () => {
    const r = validatePieces([piece("p1", "Guía de reclamos", "articulo", ["seo", "facebook"])], limits);
    expect(r.pieces.map((p) => p.channels)).toEqual([["seo"]]);
  });

  it("los demás formatos que solo piden `seo` también quedan sin canal", () => {
    for (const format of ["post", "carrusel", "video"]) {
      const r = validatePieces([piece("p1", `Tema ${format}`, format, ["seo"])], limits);
      expect(r.dropped).toEqual([{ id: "p1", reason: "sin canal" }]);
    }
  });

  it("sin conexión al sitio un artículo tampoco tiene canal", () => {
    const r = validatePieces(
      [piece("p1", "Guía de reclamos", "articulo", ["seo"])],
      { ...limits, channels: ["facebook"] },
    );
    expect(r.dropped).toEqual([{ id: "p1", reason: "sin canal" }]);
  });
});

describe("lo que pidió el Director", () => {
  it("lee el máximo de piezas de la salida del plan y nada más", () => {
    expect(directorMax({ goal: "g", maxPieces: 3, reply: "" })).toBe(3);
    expect(directorMax({ maxPieces: 0 })).toBe(0);
    for (const bad of [
      null,
      undefined,
      "3",
      3,
      [],
      {},
      { maxPieces: "3" },
      { maxPieces: 2.5 },
      { maxPieces: -1 },
      { maxPieces: NaN },
      { maxPieces: Infinity },
      {
        get maxPieces(): number {
          throw new Error("boom");
        },
      },
    ])
      expect(directorMax(bad)).toBeNull();
  });

  it("acota solo el cupo, nunca lo sube, y un plan ilegible no agrega tope", () => {
    expect(capByDirector(limits, { maxPieces: 1 })).toEqual({ ...limits, remainingPosts: 1 });
    expect(capByDirector(limits, { maxPieces: 9 })).toEqual(limits);
    expect(capByDirector(limits, { maxPieces: 0 })).toEqual({ ...limits, remainingPosts: 0 });
    expect(capByDirector(limits, null)).toEqual(limits);
    expect(capByDirector(limits, { maxPieces: "1" })).toEqual(limits);
    // Does not change what it receives.
    const before = { ...limits };
    capByDirector(limits, { maxPieces: 1 });
    expect(limits).toEqual(before);
  });
});

describe("problemsOf", () => {
  const problem = { kind: "canal", detail: "Falta el texto", sendBackTo: "copy" };

  it("lee todos los problemas de una revisión guardada, sin importar a quién los manda", () => {
    const design = { kind: "falta-imagen", detail: "Sin imagen", sendBackTo: "design" };
    expect(problemsOf({ approved: false, problems: [problem, design] })).toEqual([problem, design]);
  });

  it("salta lo que no se puede leer y nunca lanza un error", () => {
    expect(problemsOf({ problems: [problem, { kind: "x" }, "basura", null, { ...problem, sendBackTo: "video" }] })).toEqual([problem]);
    for (const output of [null, undefined, "x", 5, [], [problem], {}, { problems: "no" }, { problems: {} }, { problems: [] }])
      expect(problemsOf(output)).toEqual([]);
  });
});
