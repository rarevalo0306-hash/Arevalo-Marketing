// Lo que se manda a la IA, acotado: el contexto, el resumen de una línea y el presupuesto de bytes de la llamada.
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/db", () => ({ db: {} }));

import { AgentError } from "@/lib/agent/access";
import {
  boundedContext,
  boundedJson,
  contextShrinks,
  contextWithout,
  fitPayload,
  oneLine,
  PROMPT_BUDGET,
  shrinkKey,
  shrinkList,
  shrinkText,
  slimContext,
  type BoundedContext,
  type Shrink,
} from "@/lib/agent/bounded-context";
import { MAX_PROMPT_BYTES, meteredAsk, promptBytes, type ModelConfig } from "@/lib/agent/metered";
import { context, maxContext } from "./fixtures/agent-context";

afterEach(() => vi.unstubAllGlobals());

const Answer = z.object({ text: z.string() });
const SYSTEM_TEXT = "Sistema de prueba.";
const MODEL: ModelConfig = { provider: "gemini", model: "gemini-x", inputRate: 0.3, outputRate: 2.5, key: "synthetic-no-provider-access" };

describe("promptBytes y el límite de meteredAsk", () => {
  it("mide exactamente lo que meteredAsk compara con MAX_PROMPT_BYTES: 32,000 pasa y 32,001 se rechaza antes de llamar", async () => {
    const fetchStub = vi.fn().mockRejectedValue(new Error("red simulada"));
    vi.stubGlobal("fetch", fetchStub);
    // El tamaño sube de uno en uno con el texto (ASCII): se busca el que da exactamente el límite.
    const withText = (n: number) => ({ text: "x".repeat(n) });
    let n = 0;
    while (promptBytes(Answer, SYSTEM_TEXT, withText(n + 1)) <= MAX_PROMPT_BYTES) n += 1;
    expect(promptBytes(Answer, SYSTEM_TEXT, withText(n))).toBe(MAX_PROMPT_BYTES);
    expect(promptBytes(Answer, SYSTEM_TEXT, withText(n + 1))).toBe(MAX_PROMPT_BYTES + 1);

    // Justo en el límite sí llega al proveedor (aquí falla la red simulada, no el tamaño).
    await expect(meteredAsk(Answer, SYSTEM_TEXT, withText(n), MODEL)).rejects.toThrow("red simulada");
    expect(fetchStub).toHaveBeenCalledTimes(1);
    // Un byte más: se rechaza sin llamar a nadie.
    await expect(meteredAsk(Answer, SYSTEM_TEXT, withText(n + 1), MODEL)).rejects.toThrow(AgentError);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("cuenta bytes y no letras, y el esquema entra en la cuenta", () => {
    const ascii = promptBytes(Answer, SYSTEM_TEXT, { text: "a" });
    expect(promptBytes(Answer, SYSTEM_TEXT, { text: "漢" })).toBe(ascii + 2);
    expect(promptBytes(z.object({ text: z.string(), other: z.string() }), SYSTEM_TEXT, { text: "a" })).toBeGreaterThan(ascii);
  });
});

describe("fitPayload", () => {
  type P = { items: number[]; note: string; keep: string };
  const size = (p: P) => JSON.stringify(p).length;
  const base = (): P => ({ items: Array.from({ length: 10 }, (_, i) => 1000 + i), note: "n".repeat(100), keep: "k".repeat(20) });
  const items = shrinkList<P, number>((p) => p.items, (p, list) => ({ ...p, items: list }));
  const note = shrinkText<P>((p) => p.note, (p, t) => ({ ...p, note: t }), [50, 0]);

  it("un payload que ya cabe vuelve tal cual, sin pasos", () => {
    const p = base();
    const r = fitPayload(p, size, [items, note], 10_000);
    expect(r.payload).toBe(p);
    expect(r).toMatchObject({ fits: true, steps: 0, bytes: size(p) });
  });

  it("recorta en orden, de lo de menos valor a lo de más, y se detiene en cuanto cabe", () => {
    const start = size(base());
    // Quitar tres items basta: la nota no se toca.
    const budget = start - 3 * 6 - 1;
    const r = fitPayload(base(), size, [items, note], budget);
    expect(r.fits).toBe(true);
    expect(r.payload.items).toEqual(Array.from({ length: 10 }, (_, i) => 1000 + i).slice(0, 10 - r.steps));
    expect(r.payload.items.length).toBeGreaterThan(0);
    expect(r.payload.note).toBe("n".repeat(100));
    // Si la primera se agota, sigue con la segunda.
    const tight = fitPayload(base(), size, [items, note], size({ items: [], note: "n".repeat(50), keep: "k".repeat(20) }));
    expect(tight.payload).toEqual({ items: [], note: "n".repeat(50), keep: "k".repeat(20) });
    expect(tight.fits).toBe(true);
  });

  it("lo que ningún recorte nombra nunca se toca, aunque no quepa: fits es false con lo más pequeño que se logró", () => {
    const r = fitPayload(base(), size, [items, note], 5);
    expect(r.fits).toBe(false);
    expect(r.payload).toEqual({ items: [], note: "", keep: "k".repeat(20) });
    expect(r.bytes).toBe(size(r.payload));
  });

  it("un recorte que nunca se rinde no cuelga la llamada", () => {
    const never: Shrink<P> = (p) => ({ ...p });
    const r = fitPayload(base(), size, [never], 5);
    expect(r.fits).toBe(false);
    expect(r.steps).toBeLessThanOrEqual(2000);
  });

  it("shrinkList quita del final o del principio y se rinde con la lista vacía", () => {
    const end = shrinkList<number[], number>((p) => p, (_, l) => l);
    const start = shrinkList<number[], number>((p) => p, (_, l) => l, "start");
    expect(end([1, 2, 3])).toEqual([1, 2]);
    expect(start([1, 2, 3])).toEqual([2, 3]);
    expect(end([])).toBeNull();
    const none = shrinkList<{ a?: number[] }, number>((p) => p.a, (p, a) => ({ ...p, a }));
    expect(none({})).toBeNull();
  });

  it("shrinkText baja por los tamaños dados y se rinde al llegar al último", () => {
    const cut = shrinkText<string>((s) => s, (_, t) => t, [10, 3, 0]);
    expect(cut("x".repeat(25))).toBe("x".repeat(10));
    expect(cut("x".repeat(10))).toBe("x".repeat(3));
    expect(cut("xxx")).toBe("");
    expect(cut("")).toBeNull();
    expect(shrinkText<{ t?: string }>((p) => p.t, (p, t) => ({ ...p, t }), [1, 0])({})).toBeNull();
  });

  it("shrinkKey recorta una parte del payload y deja el resto", () => {
    const part = shrinkKey<{ a: number[]; b: string }, "a">("a", shrinkList<number[], number>((p) => p, (_, l) => l));
    expect(part({ a: [1, 2], b: "x" })).toEqual({ a: [1], b: "x" });
    expect(part({ a: [], b: "x" })).toBeNull();
  });
});

describe("contexto del encargo", () => {
  it("slimContext deja solo quién es el negocio, su sector y el objetivo", () => {
    const slim = slimContext(maxContext());
    expect(Object.keys(slim).sort()).toEqual(["business", "industry", "objective"]);
    expect(Object.keys(slim.business).sort()).toEqual(["aiProfile", "name", "website"]);
    expect(slim.business.aiProfile).toHaveLength(800);
    expect(slimContext(context()).business.aiProfile).toBe("Reparamos techos.");
    expect(slimContext(maxContext(), 100).business.aiProfile).toHaveLength(100);
  });

  it("contextWithout quita solo lo pedido y no toca el original", () => {
    const c = context({ news: { id: "n" }, signals: { a: 1 } });
    const out = contextWithout(c, "signals") as unknown as Record<string, unknown>;
    expect(out.signals).toBeUndefined();
    expect(out.news).toEqual({ id: "n" });
    expect(contextWithout(c, "news", "signals")).not.toHaveProperty("news");
    expect((c as unknown as Record<string, unknown>).signals).toEqual({ a: 1 });
  });

  it("boundedContext sigue acotando como siempre", () => {
    const b = boundedContext(maxContext());
    expect(b.business.aiProfile).toHaveLength(3000);
    expect(b.business.study.length).toBeLessThanOrEqual(5000);
    expect(b.knowledge).toHaveLength(12);
    expect(b.messages).toHaveLength(6);
    expect(b.posts).toHaveLength(6);
  });

  it("contextShrinks: el contexto más grande posible cabe, lo de menos valor se va primero y el negocio y el objetivo se quedan", () => {
    const full = boundedContext(maxContext());
    const size = (c: BoundedContext) => promptBytes(Answer, SYSTEM_TEXT, { context: c });
    expect(size(full)).toBeGreaterThan(MAX_PROMPT_BYTES);
    const r = fitPayload(full, size, contextShrinks());
    expect(r.fits).toBe(true);
    expect(r.bytes).toBeLessThanOrEqual(PROMPT_BUDGET);
    expect(r.payload.business.name).toBe("Techos Miami");
    expect(r.payload.objective).toBe("o".repeat(1500));
    expect(r.payload.tools).toEqual([]);

    // Poco a poco: con un presupuesto más holgado solo se pierden las herramientas y la evidencia de la noticia.
    const light = fitPayload(full, size, contextShrinks(), size(full) - 100);
    expect(light.fits).toBe(true);
    expect(light.payload.knowledge).toHaveLength(full.knowledge.length);
    expect(light.payload.posts).toEqual(full.posts);
    expect(light.payload.tools.length).toBeLessThan(full.tools.length);

    // Agotados todos los recortes, queda un contexto pequeño pero con sentido.
    const none = fitPayload(full, size, contextShrinks(), 1);
    expect(none.fits).toBe(false);
    expect(none.payload.knowledge).toEqual([]);
    expect(none.payload.messages).toEqual([]);
    expect(none.payload.business.study).toBe("");
    expect(none.payload.memory).toBe("");
    expect(none.payload.business.aiProfile).toHaveLength(200);
  });

  it("oneLine y boundedJson", () => {
    expect(oneLine("a\n\n b\t\u0001 c", 100)).toBe("a b c");
    expect(oneLine(undefined, 5)).toBe("");
    expect(oneLine("abcdef", 3)).toBe("abc");
    expect(boundedJson(undefined, 10)).toBeUndefined();
    expect(boundedJson(null, 10)).toBeUndefined();
    expect(boundedJson({ a: 1 }, 100)).toEqual({ a: 1 });
    expect(boundedJson({ a: "x".repeat(50) }, 10)).toBe('{"a":"xxxx');
  });
});
