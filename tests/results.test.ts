import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { emptyValues, type MetricValues } from "@/lib/post-metrics-shape";
import { latestGood } from "@/lib/results";
import {
  adsSummary,
  buckets,
  byCampaign,
  byChannel,
  byFormat,
  formatOf,
  kpi,
  lastDays,
  localDayHour,
  MIN_POSTS_FOR_TIMING,
  postCount,
  previousRange,
  rankMovement,
  rankPosts,
  rateOf,
  readPeriod,
  reviewsBetween,
  timing,
  totals,
  type TargetRow,
} from "@/lib/results-shape";

const DAY = 86_400_000;
const NOW = new Date("2026-10-09T12:00:00Z");
const m = (x: Partial<MetricValues>): MetricValues => ({ ...emptyValues(), ...x });
let seq = 0;
function row(x: Partial<TargetRow> & { sentAt: Date }): TargetRow {
  seq++;
  return { targetId: `t${seq}`, postId: `p${seq}`, channel: "facebook", url: "", text: "", thumb: "", format: "photo", campaignId: null, campaignName: "", metric: null, ...x };
}

describe("periodos", () => {
  it("7 / 30 / 90 días (30 si no se reconoce)", () => {
    expect(readPeriod("7")).toBe(7);
    expect(readPeriod("90")).toBe(90);
    expect(readPeriod("15")).toBe(30);
    expect(readPeriod(undefined)).toBe(30);
  });
  it("el periodo anterior tiene el mismo largo y termina donde empieza el actual", () => {
    const { from, to } = lastDays(30, NOW);
    const p = previousRange(from, to);
    expect(p.to.getTime()).toBe(from.getTime());
    expect(to.getTime() - from.getTime()).toBe(p.to.getTime() - p.from.getTime());
  });
  it("comparación en %; sin periodo anterior no se inventa", () => {
    expect(kpi(150, 100)).toEqual({ now: 150, prev: 100, change: 50 });
    expect(kpi(50, 100).change).toBe(-50);
    expect(kpi(5, 0).change).toBeNull();
    expect(kpi(5, null).change).toBeNull();
    expect(kpi(null, null)).toEqual({ now: null, prev: null, change: null });
  });
});

describe("sumar resultados", () => {
  it("alcance (o vistas, o reproducciones), interacciones y clics", () => {
    const rows = [
      row({ sentAt: NOW, metric: m({ reach: 100, likes: 5, comments: 2, shares: 1, saves: 2, clicks: 4 }) }),
      row({ sentAt: NOW, channel: "youtube", metric: m({ videoViews: 50, likes: 3 }) }),
      row({ sentAt: NOW, channel: "x", metric: m({ impressions: 30, likes: 1 }) }),
      row({ sentAt: NOW, metric: null }),
    ];
    expect(totals(rows)).toEqual({ reach: 180, interactions: 14, clicks: 4, videoViews: 50, measured: 3 });
  });
  it("una publicación en 3 redes cuenta como 1 publicación", () => {
    expect(postCount([row({ sentAt: NOW, postId: "a" }), row({ sentAt: NOW, postId: "a", channel: "instagram" }), row({ sentAt: NOW, postId: "b" })])).toBe(2);
  });
  it("tasa de interacción: interacciones ÷ alcance; null sin alcance", () => {
    expect(rateOf(m({ reach: 200, likes: 10 }))).toBe(0.05);
    expect(rateOf(m({ likes: 10 }))).toBeNull();
    expect(rateOf(null)).toBeNull();
  });
  it("la última lectura buena se salta las que tuvieron error", () => {
    const at = new Date();
    const good = latestGood([
      { ...emptyValues(), fetchedAt: at, raw: { error: "token vencido" } },
      { ...emptyValues(), reach: 40, likes: 4, fetchedAt: at, raw: { checkpoint: 1 } },
    ]);
    expect(good?.values.reach).toBe(40);
    expect(latestGood([{ ...emptyValues(), fetchedAt: at, raw: { error: "x" } }])).toBeNull();
  });
});

describe("por día o semana, por canal, formato y campaña", () => {
  it("7 días van por día del calendario del negocio; 30 por semanas contadas desde hoy", () => {
    const { from, to } = lastDays(7, NOW); // 2 oct 12:00 → 9 oct 12:00 UTC
    const b = buckets(
      [
        row({ sentAt: new Date("2026-10-05T15:00:00Z"), metric: m({ reach: 10, likes: 1 }) }),
        row({ sentAt: new Date("2026-10-05T20:00:00Z") }),
        // 9 oct 3:00 UTC = 8 oct 9 p. m. en Managua
        row({ sentAt: new Date("2026-10-09T03:00:00Z"), metric: m({ reach: 5 }) }),
      ],
      from,
      to,
      "America/Managua",
    );
    expect(b.unit).toBe("day");
    expect(b.items.map((x) => x.start)).toEqual(["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(b.items[3]).toMatchObject({ start: "2026-10-05", reach: 10, interactions: 1, posts: 2 });
    expect(b.items[6]).toMatchObject({ start: "2026-10-08", reach: 5, posts: 1 });
    const w = buckets([], ...(Object.values(lastDays(30, NOW)) as [Date, Date]));
    expect(w.unit).toBe("week");
    expect(w.items).toHaveLength(5);
    expect(w.items[w.items.length - 1].start).toBe("2026-10-03");
  });
  it("agrupa por canal (más alcance primero), formato y solo las publicaciones con campaña", () => {
    const rows = [
      row({ sentAt: NOW, channel: "facebook", format: "video", metric: m({ reach: 50, likes: 5 }) }),
      row({ sentAt: NOW, channel: "instagram", format: "carousel", campaignId: "c1", campaignName: "Portones", metric: m({ reach: 300, likes: 30 }) }),
      row({ sentAt: NOW, channel: "instagram", format: "carousel", campaignId: "c1", campaignName: "Portones", metric: m({ reach: 100, likes: 2 }) }),
    ];
    const ch = byChannel(rows);
    expect(ch.map((g) => g.key)).toEqual(["instagram", "facebook"]);
    expect(ch[0]).toMatchObject({ posts: 2, reach: 400, interactions: 32, rate: 0.08 });
    expect(byFormat(rows).find((g) => g.key === "video")?.rate).toBe(0.1);
    expect(byCampaign(rows)).toEqual([expect.objectContaining({ key: "c1", label: "Portones", posts: 2 })]);
  });
  it("formato: tipo de publicación, video, diseño, foto o solo texto", () => {
    expect(formatOf("carousel", "photo", false)).toBe("carousel");
    expect(formatOf("story", "video", false)).toBe("story");
    expect(formatOf("post", "video", false)).toBe("video");
    expect(formatOf("post", "photo", true)).toBe("design");
    expect(formatOf("post", "photo", false)).toBe("photo");
    expect(formatOf("post", "none", false)).toBe("text");
  });
});

describe("mejores y peores", () => {
  it("ordena por tasa de interacción, deja fuera las de muy poco alcance y no repite", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ sentAt: NOW, metric: m({ reach: 100, likes: i }) }));
    rows.push(row({ sentAt: NOW, metric: m({ reach: 3, likes: 3 }) }));
    const { best, worst } = rankPosts(rows);
    expect(best.map((p) => p.interactions)).toEqual([11, 10, 9, 8, 7]);
    expect(worst.map((p) => p.interactions)).toEqual([0, 1, 2, 3, 4]);
    expect(best.some((b) => worst.find((w) => w.targetId === b.targetId))).toBe(false);
    expect(best.every((p) => p.reach >= 10)).toBe(true);
  });
  it("con 5 o menos no hay lista de peores", () => {
    const rows = Array.from({ length: 4 }, (_, i) => row({ sentAt: NOW, metric: m({ reach: 50, likes: i }) }));
    expect(rankPosts(rows).worst).toEqual([]);
  });
});

describe("mejor día y hora", () => {
  const tz = "America/Managua"; // UTC-6, sin horario de verano
  it("día y hora en la zona del negocio", () => {
    expect(localDayHour(new Date("2026-10-06T02:30:00Z"), tz)).toEqual({ day: 1, hour: 20 }); // lunes 8:30 p. m.
    expect(localDayHour(new Date("2026-10-06T02:30:00Z"), "Zona/Inventada")).toEqual({ day: 2, hour: 2 });
  });
  it(`con menos de ${MIN_POSTS_FOR_TIMING} publicaciones medidas dice «faltan datos»`, () => {
    const rows = Array.from({ length: 9 }, () => row({ sentAt: new Date("2026-10-06T16:00:00Z"), metric: m({ reach: 100, likes: 5 }) }));
    rows.push(row({ sentAt: NOW, metric: null }), row({ sentAt: NOW, metric: m({ likes: 3 }) }));
    const tm = timing(rows, tz);
    expect(tm.enough).toBe(false);
    expect(tm.measured).toBe(9);
    expect(tm.bestDay).toBeNull();
    expect(tm.bestHour).toBeNull();
  });
  it("gana el día/hora con mejor promedio entre los que tienen al menos 2 publicaciones", () => {
    const at = (iso: string, likes: number) => row({ sentAt: new Date(iso), metric: m({ reach: 100, likes }) });
    const rows = [
      // martes 10 a. m. (Managua): 2 publicaciones, 8 %
      at("2026-10-06T16:00:00Z", 8),
      at("2026-09-29T16:00:00Z", 8),
      // jueves 7 p. m.: 3 publicaciones, 4 %
      at("2026-10-09T01:00:00Z", 4),
      at("2026-10-02T01:00:00Z", 4),
      at("2026-09-25T01:00:00Z", 4),
      // sábado 3 p. m.: 1 sola publicación con 50 % (no compite)
      at("2026-10-03T21:00:00Z", 50),
      // lunes 8 a. m.: 4 publicaciones, 2 %
      at("2026-10-05T14:00:00Z", 2),
      at("2026-09-28T14:00:00Z", 2),
      at("2026-09-21T14:00:00Z", 2),
      at("2026-09-14T14:00:00Z", 2),
    ];
    const tm = timing(rows, tz);
    expect(tm.enough).toBe(true);
    expect(tm.bestDay).toBe(2);
    expect(tm.bestHour).toBe(10);
    expect(tm.days[6]).toMatchObject({ posts: 1, rate: 0.5 });
    expect(tm.days[4].posts).toBe(3);
  });
});

describe("anuncios, reseñas y posiciones", () => {
  const ad = (x: Record<string, unknown>) => ({ name: "Ad", goal: "calls", status: "active", startsAt: "2026-09-20T00:00:00Z", endsAt: "2026-10-20T00:00:00Z", ...x });
  it("solo los anuncios vivos en el periodo; costo por resultado sin los de «que te conozcan»", () => {
    const { from, to } = lastDays(7, NOW);
    const s = adsSummary(
      [
        {
          id: "c1",
          name: "Portones",
          items: [
            ad({ insights: { spentCents: 2000, results: 10, reach: 900, clicks: 40 } }),
            ad({ goal: "awareness", insights: { spentCents: 1000, results: 0, reach: 5000, clicks: 10 } }),
            ad({ startsAt: "2026-08-01T00:00:00Z", endsAt: "2026-08-30T00:00:00Z", insights: { spentCents: 9999, results: 1, reach: 1, clicks: 1 } }),
            ad({ status: "error" }),
          ],
        },
      ],
      from,
      to,
    );
    expect(s.count).toBe(2);
    expect(s.spentCents).toBe(3000);
    expect(s.costPerResultCents).toBe(200);
    expect(s.items[0]).toMatchObject({ campaign: "Portones", costPerResultCents: 200 });
    expect(s.items[1].costPerResultCents).toBeNull();
  });
  it("reseñas nuevas del periodo y su promedio", () => {
    const { from, to } = lastDays(30, NOW);
    const r = reviewsBetween(
      [
        { timestamp: "2026-10-01T10:00:00Z", rating: 5 },
        { timestamp: "2026-09-20T10:00:00Z", rating: 4 },
        { timestamp: "2026-07-01T10:00:00Z", rating: 1 },
        { timestamp: "", rating: 1 },
      ],
      from,
      to,
    );
    expect(r).toEqual({ count: 2, average: 4.5 });
  });
  it("posiciones: última revisión del periodo contra la de antes; subir es positivo", () => {
    const snap = (at: string, rows: [string, number | null][]) => ({ at, avgPosition: 5, inTop3: 1, inTop10: 2, rows: rows.map(([keyword, position]) => ({ keyword, position })) });
    const snaps = [
      snap("2026-10-08T00:00:00Z", [["cortinas metálicas managua", 3], ["portones", 12], ["nueva", 7]]),
      snap("2026-09-20T00:00:00Z", [["cortinas metálicas managua", 6], ["portones", 9]]),
      snap("2026-09-01T00:00:00Z", [["cortinas metálicas managua", 15], ["portones", null]]),
    ];
    const { from, to } = lastDays(30, NOW);
    const mv = rankMovement(snaps, from, to)!;
    expect(mv.now.at).toBe("2026-10-08T00:00:00Z");
    expect(mv.prev?.at).toBe("2026-09-01T00:00:00Z");
    expect(mv.moves[0]).toEqual({ keyword: "cortinas metálicas managua", now: 3, prev: 15, moved: 12 });
    expect(mv.moves.find((x) => x.keyword === "portones")).toMatchObject({ moved: null });
    expect(mv.moves.find((x) => x.keyword === "nueva")?.prev).toBeNull();
    const week = lastDays(7, NOW);
    expect(rankMovement(snaps, week.from, week.to)?.prev?.at).toBe("2026-09-20T00:00:00Z");
    expect(rankMovement([], from, to)).toBeNull();
  });
});
