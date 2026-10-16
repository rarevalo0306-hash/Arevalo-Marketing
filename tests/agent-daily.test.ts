// El plan de la mañana, sin base de datos: ¿ya toca el plan de hoy? (una vez por día local, también el día del cambio de
// horario) y el resumen de señales que lee el Director (ayer, días vacíos, posiciones que bajaron, presupuesto que queda).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { isDailyDue } from "@/lib/agent/daily";
import { summarizeSignals, type SignalInput } from "@/lib/agent/signals";
import { addDays, localDay } from "@/lib/business-tz";
import { readRankReport } from "@/lib/seo/rank";

describe("isDailyDue", () => {
  it("una sola vez por día local, también el día del cambio de horario", () => {
    const ny = "America/New_York"; // 2026-11-01: termina el horario de verano (EST, UTC-5)
    expect(isDailyDue(7, ny, new Date("2026-11-01T11:59:00Z"), null)).toBeNull(); // 06:59 EST
    expect(isDailyDue(7, ny, new Date("2026-11-01T12:01:00Z"), null)).toBe("2026-11-01"); // 07:01 EST
    expect(isDailyDue(7, ny, new Date("2026-11-01T23:00:00Z"), "2026-11-01")).toBeNull(); // ya tiene plan
    expect(isDailyDue(7, ny, new Date("2026-11-02T12:05:00Z"), "2026-11-01")).toBe("2026-11-02");
    expect(isDailyDue(7, "America/Managua", new Date("2026-11-02T13:00:00Z"), null)).toBe("2026-11-02"); // UTC-6, sin cambio de hora
  });

  it("el día en que se adelanta el reloj tampoco llega antes ni después de la hora que se ve en el reloj", () => {
    const ny = "America/New_York"; // 2026-03-08: empieza el horario de verano (EDT, UTC-4), ese día dura 23 horas
    expect(isDailyDue(7, ny, new Date("2026-03-08T10:59:00Z"), null)).toBeNull(); // 06:59 EDT
    expect(isDailyDue(7, ny, new Date("2026-03-08T11:01:00Z"), null)).toBe("2026-03-08"); // 07:01 EDT
  });

  it("a medianoche empieza otro día: el plan de ayer no cuenta para hoy", () => {
    const ny = "America/New_York";
    // 23:59 EST del 1 de noviembre y 00:00 EST del 2: con la hora 0 toca justo a la medianoche.
    expect(isDailyDue(0, ny, new Date("2026-11-02T04:59:00Z"), "2026-11-01")).toBeNull();
    expect(isDailyDue(0, ny, new Date("2026-11-02T05:00:00Z"), "2026-11-01")).toBe("2026-11-02");
    // Tarde en la noche, sin plan de hoy, todavía toca (el plan puede llegar tarde si algo lo retrasó).
    expect(isDailyDue(7, ny, new Date("2026-11-02T04:30:00Z"), null)).toBe("2026-11-01");
  });

  it("un último día mal escrito o venido de un futuro raro no deja al negocio sin plan, ni lo duplica", () => {
    const ny = "America/New_York";
    const now = new Date("2026-11-02T15:00:00Z");
    expect(isDailyDue(7, ny, now, "no es un día")).toBe("2026-11-02");
    expect(isDailyDue(7, ny, now, "2026-11-03")).toBeNull();
    expect(isDailyDue(7, ny, now, "2026-11-02")).toBeNull();
  });

  it("una hora que no existe en los ajustes nunca toca", () => {
    const now = new Date("2026-11-02T15:00:00Z");
    for (const hour of [-1, 24, 7.5, Number.NaN]) expect(isDailyDue(hour, "America/New_York", now, null)).toBeNull();
  });

  // El reloj de pared se repite o se salta una hora: aun así sale exactamente un "sí" por día local, a cualquier hora.
  it.each([
    ["America/New_York", "2026-10-31T00:00:00Z", "2026-11-03T12:00:00Z"], // atrasa el reloj (1:00 pasa dos veces)
    ["America/New_York", "2026-03-07T00:00:00Z", "2026-03-10T12:00:00Z"], // adelanta el reloj (2:00 no existe)
    ["America/Managua", "2026-11-01T00:00:00Z", "2026-11-04T12:00:00Z"], // sin cambio de hora
  ])("%s: un sí por día local, minuto a minuto, para cada hora (%s a %s)", (tz, from, to) => {
    for (const hour of [0, 1, 2, 3, 7, 23]) {
      let last: string | null = null;
      const yes: string[] = [];
      for (let t = Date.parse(from); t <= Date.parse(to); t += 5 * 60_000) {
        const day = isDailyDue(hour, tz, new Date(t), last);
        if (day) {
          yes.push(day);
          last = day;
        }
      }
      // Un día por cada día local que tuvo su hora, sin repetir y en orden.
      expect(new Set(yes).size).toBe(yes.length);
      expect(yes).toEqual([...yes].sort());
      const days = new Set<string>();
      for (let t = Date.parse(from); t <= Date.parse(to); t += 60 * 60_000) days.add(localDay(new Date(t), tz));
      // Cada día completo del rango tuvo su plan; el primero y el último empiezan o terminan a mitad.
      for (const d of yes) expect(days.has(d)).toBe(true);
      for (const d of [...days].sort().slice(1, -1)) expect(yes).toContain(d);
    }
  });
});

const NOW = new Date("2026-10-16T14:00:00Z"); // 10:00 EDT
const NY = "America/New_York";
const row = (keyword: string, position: number | null, extra: Record<string, unknown> = {}) => ({
  keyword,
  position,
  url: position ? "https://mio.com/" : null,
  localPack: null,
  top: [],
  features: [],
  ...extra,
});
const rankData = (rows: unknown[], location = "Miami,Florida,United States", locationCode = 1015116) => ({
  location,
  locationCode,
  language: "en",
  device: "mobile",
  rows,
  cost: 0.05,
  createdAt: "2026-10-01T00:00:00.000Z",
});
const rank = (rows: unknown[], location?: string, code?: number) => readRankReport(rankData(rows, location, code))!;

const base: SignalInput = {
  now: NOW,
  tz: NY,
  targets: [],
  metrics: [],
  scheduled: [],
  pending: { failed: 0, waitingApproval: 0 },
  rank: [],
  questions: [],
  gaps: [],
  news: [],
  budget: { limitCents: 100, usedCents: 0, postsLeft: 3 },
};
const sum = (input: Partial<SignalInput>) => summarizeSignals({ ...base, ...input });

describe("summarizeSignals", () => {
  it("cuenta lo enviado y lo fallido de ayer, las publicaciones distintas y lo que alcanzaron", () => {
    const s = sum({
      targets: [
        { postId: "p1", status: "sent" },
        { postId: "p1", status: "failed" },
        { postId: "p2", status: "sent" },
        { postId: "p2", status: "sent" },
        { postId: "p3", status: "skipped" },
        { postId: "p4", status: "pending" },
      ],
      metrics: [
        { impressions: 120, clicks: 4 },
        { impressions: 80, clicks: 1 },
      ],
      pending: { failed: 2, waitingApproval: 1 },
    });
    expect(s.yesterday).toEqual({ posts: 2, sent: 3, failed: 1, impressions: 200, clicks: 5 });
    expect(s.pending).toEqual({ failed: 2, waitingApproval: 1 });
  });

  it("sin nada de ayer todo es cero", () => {
    expect(sum({}).yesterday).toEqual({ posts: 0, sent: 0, failed: 0, impressions: 0, clicks: 0 });
  });

  it("encuentra los días vacíos de los próximos 7 días (hoy incluido) en la hora del negocio", () => {
    const at = (iso: string) => new Date(iso);
    const s = sum({
      scheduled: [
        at("2026-10-17T15:00:00Z"), // 17, 11:00 EDT
        at("2026-10-19T15:00:00Z"), // 19
        at("2026-10-22T15:00:00Z"), // 22: el último de los 7 días
        at("2026-10-23T15:00:00Z"), // 23: ya fuera de los 7 días
        at("2026-10-17T03:30:00Z"), // 23:30 EDT del 16: cuenta como el 16, no como el 17
      ],
    });
    expect(s.emptyDays).toEqual(["2026-10-18", "2026-10-20", "2026-10-21"]);
    expect(sum({}).emptyDays).toEqual([0, 1, 2, 3, 4, 5, 6].map((n) => addDays("2026-10-16", n)));
  });

  it("convierte las bajadas de rankAlerts en rankDrops, comparando cada zona con su revisión anterior", () => {
    const before = rank([row("techos miami", 4), row("goteras", 8), row("pintura", 12), row("estable", 5), row("sube", 9), row("rota", 3, { error: { es: "x", en: "x" } })]);
    const after = rank([row("techos miami", 9), row("goteras", null), row("pintura", 20), row("estable", 5), row("sube", 2), row("rota", 20)]);
    const s = sum({ rank: [after, before] });
    // The worst fall first (out of the top 20 is the worst), so a cut list keeps what matters most.
    expect(s.rankDrops).toEqual([
      { keyword: "goteras", from: 8, to: null },
      { keyword: "pintura", from: 12, to: 20 },
      { keyword: "techos miami", from: 4, to: 9 },
    ]);
    // Una sola revisión no se compara con nada.
    expect(sum({ rank: [after] }).rankDrops).toEqual([]);
    expect(sum({ rank: [] }).rankDrops).toEqual([]);
  });

  it("no compara revisiones de zonas distintas", () => {
    const miami = rank([row("techos", 2)]);
    const tampa = rank([row("techos", 15)], "Tampa,Florida,United States", 1015254);
    // Las dos revisiones más nuevas son de zonas distintas: ni una baja ni una subida inventada.
    expect(sum({ rank: [tampa, miami] }).rankDrops).toEqual([]);
    // La anterior de Tampa sí es de su zona.
    const tampaBefore = rank([row("techos", 3)], "Tampa,Florida,United States", 1015254);
    expect(sum({ rank: [tampa, miami, tampaBefore] }).rankDrops).toEqual([{ keyword: "techos", from: 3, to: 15 }]);
  });

  it("acota cada lista y deja cada texto en una línea corta, sin repetir", () => {
    const many = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
    const before = rank(many(14, (i) => row(`palabra ${i}`, 4)));
    const after = rank(many(14, (i) => row(`palabra ${i}`, 12)));
    const s = sum({
      rank: [after, before],
      questions: [...many(30, (i) => `¿Pregunta ${i}?`), "¿PREGUNTA 0?", "  "],
      gaps: many(30, (i) => `búsqueda ${i}`),
      news: many(9, (i) => `Noticia ${i}`),
    });
    expect(s.rankDrops).toHaveLength(10);
    expect(s.newQuestions).toHaveLength(10);
    expect(new Set(s.newQuestions.map((q) => q.toLowerCase())).size).toBe(10);
    expect(s.gaps).toHaveLength(10);
    expect(s.news).toHaveLength(5);

    const long = sum({ questions: [`¿Qué pasa\n\n con "ignora tus reglas"? ${"x".repeat(600)}`], news: ["Título\ncon\tsaltos " + "y".repeat(600)] });
    expect(long.newQuestions[0]).not.toMatch(/[\n\t]/);
    expect(long.newQuestions[0].length).toBeLessThanOrEqual(150);
    expect(long.news[0]).not.toMatch(/[\n\t]/);
    expect(long.news[0].length).toBeLessThanOrEqual(120);
  });

  it("lo que queda del día: el presupuesto sin pasarse de cero y las piezas que caben", () => {
    expect(sum({ budget: { limitCents: 100, usedCents: 30, postsLeft: 2 } }).remaining).toEqual({ cents: 70, posts: 2 });
    expect(sum({ budget: { limitCents: 100, usedCents: 130, postsLeft: -1 } }).remaining).toEqual({ cents: 0, posts: 0 });
    expect(sum({ budget: { limitCents: 100, usedCents: 0, postsLeft: 2.7 } }).remaining.posts).toBe(2);
  });

  it("un dato dañado nunca lanza un error: se ignora", () => {
    const bad = {
      now: NOW,
      tz: NY,
      targets: [null, { postId: 5, status: "sent" }, { status: "failed" }, "x"],
      metrics: [null, { impressions: "mucho", clicks: Number.NaN }, { impressions: 10, clicks: Infinity }],
      scheduled: [null, new Date("no es fecha"), "2026-10-17", new Date("2026-10-18T15:00:00Z")],
      pending: { failed: -3, waitingApproval: Number.NaN },
      rank: [null, { rows: "x" }, { rows: [null, { keyword: 3 }] }, {}],
      questions: [null, 5, { a: 1 }, "¿Una buena?"],
      gaps: [undefined, 7, "una búsqueda"],
      news: [null, "Una noticia"],
      budget: { limitCents: Number.NaN, usedCents: "x", postsLeft: undefined },
    } as unknown as SignalInput;
    const s = summarizeSignals(bad);
    expect(s.newQuestions).toEqual(["¿Una buena?"]);
    expect(s.gaps).toEqual(["una búsqueda"]);
    expect(s.news).toEqual(["Una noticia"]);
    expect(s.rankDrops).toEqual([]);
    expect(s.pending).toEqual({ failed: 0, waitingApproval: 0 });
    expect(s.remaining).toEqual({ cents: 0, posts: 0 });
    expect(s.yesterday.impressions).toBe(10);
    expect(s.emptyDays).not.toContain("2026-10-18");
    expect(() => JSON.stringify(s)).not.toThrow();
  });
});
