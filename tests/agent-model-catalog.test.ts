// La lista de modelos de «IA de cada agente»: cada uno es una elección y un precio válidos, con el precio oficial verificado y para
// qué sirve; un agente con un modelo de la lista queda listo sin que el dueño escriba el precio.
import { describe, expect, it } from "vitest";
import { MODEL_CATALOG, MODEL_PRICES_VERIFIED_AT, catalogEntry, catalogId, catalogUsd } from "@/lib/agent/model-catalog";
import { PRICE_TABLE, resolveModel } from "@/lib/agent/models";
import { ModelChoice, ModelPrice } from "@/lib/agent/schema";

describe("la lista de modelos", () => {
  it("cada modelo es una elección y un precio que el esquema acepta, sin repetidos", () => {
    expect(MODEL_CATALOG.length).toBeGreaterThan(0);
    for (const m of MODEL_CATALOG) {
      expect(ModelChoice.safeParse({ provider: m.provider, model: m.model }).success).toBe(true);
      expect(ModelPrice.safeParse({ input: m.input, output: m.output }).success).toBe(true);
    }
    const ids = MODEL_CATALOG.map(catalogId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("trae los precios oficiales del día en que se verificaron", () => {
    expect(MODEL_PRICES_VERIFIED_AT).toBe("2026-10-16");
    expect(Object.fromEntries(MODEL_CATALOG.map((m) => [catalogId(m), [m.input, m.output]]))).toEqual({
      "openai:gpt-4.1-mini": [0.4, 1.6],
      "openai:gpt-4.1": [2, 8],
      "openai:gpt-4.1-nano": [0.1, 0.4],
      "gemini:gemini-2.5-flash-lite": [0.1, 0.4],
    });
  });

  it("recomienda uno solo, GPT-4.1 mini, y cada uno dice para qué sirve en español y en inglés", () => {
    expect(MODEL_CATALOG.filter((m) => m.recommended).map(catalogId)).toEqual(["openai:gpt-4.1-mini"]);
    for (const m of MODEL_CATALOG) {
      expect(m.name.trim()).not.toBe("");
      expect(m.use.es.trim()).not.toBe("");
      expect(m.use.en.trim()).not.toBe("");
    }
  });

  it("catalogEntry reconoce solo los modelos de la lista, con su proveedor", () => {
    expect(catalogEntry("openai:gpt-4.1-mini")?.name).toBe("GPT-4.1 mini");
    expect(catalogEntry("gemini:gpt-4.1-mini")).toBeUndefined();
    expect(catalogEntry("openai:gpt-5-mini")).toBeUndefined();
    expect(catalogEntry("")).toBeUndefined();
  });

  it("catalogUsd escribe siempre dos decimales", () => {
    expect(catalogUsd(0.4)).toBe("$0.40");
    expect(catalogUsd(2)).toBe("$2.00");
    expect(catalogUsd(0.1)).toBe("$0.10");
  });

  it("el precio verificado de cada modelo de la lista está en PRICE_TABLE, con la fecha", () => {
    for (const m of MODEL_CATALOG)
      expect(PRICE_TABLE[catalogId(m)]).toEqual({ input: m.input, output: m.output, verifiedAt: MODEL_PRICES_VERIFIED_AT });
  });

  it("un agente con un modelo de la lista funciona sin un precio escrito por el dueño", () => {
    const ws = { agentModels: { copy: { provider: "openai", model: "gpt-4.1-mini" } }, modelPrices: {} };
    expect(resolveModel("copy", ws, { OPENAI_API_KEY: "k" })).toMatchObject({
      provider: "openai",
      model: "gpt-4.1-mini",
      inputRate: 0.4,
      outputRate: 1.6,
      key: "k",
    });
    // Sin la clave del proveedor sigue sin funcionar: la lista no inventa conexiones.
    expect(() => resolveModel("copy", ws, {})).toThrow(/conexión/);
  });
});
