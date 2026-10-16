// Campos de números del Centro MATYA (límites en dólares, publicaciones al día, horas): leer lo que escribe el dueño.
import { describe, expect, it } from "vitest";
import { ModelChoice, ModelPrice, type Settings } from "@/lib/agent/schema";
import {
  RATE_MAX,
  formatRate,
  formatUsd,
  pruneModelPrices,
  readCount,
  readModelName,
  readPrice,
  readRate,
  readUsd,
  setAgentModel,
  submitDecision,
} from "@/lib/agent/settings-input";

describe("límites en dólares", () => {
  it("lee dólares con punto, con coma decimal o con el signo", () => {
    expect(readUsd("5")).toBe(500);
    expect(readUsd("1.50")).toBe(150);
    expect(readUsd("2,5")).toBe(250);
    expect(readUsd("0,75")).toBe(75);
    expect(readUsd(" $12.50 ")).toBe(1250);
    expect(readUsd("1,000")).toBe(100000);
    expect(readUsd("0")).toBe(0);
  });
  it("vacío o con letras no es un número (no se convierte en cero)", () => {
    expect(readUsd("")).toBeNull();
    expect(readUsd("  ")).toBeNull();
    expect(readUsd("abc")).toBeNull();
    expect(readUsd("1.234")).toBeNull();
    expect(readUsd("-5")).toBeNull();
  });
  it("se muestra con dos decimales", () => {
    expect(formatUsd(0)).toBe("0.00");
    expect(formatUsd(500)).toBe("5.00");
    expect(formatUsd(150)).toBe("1.50");
    expect(formatUsd(100000)).toBe("1000.00");
  });
});

describe("cantidades enteras", () => {
  it("lee números enteros", () => {
    expect(readCount("4")).toBe(4);
    expect(readCount(" 12 ")).toBe(12);
    expect(readCount("03")).toBe(3);
  });
  it("vacío, decimales o letras no son un número", () => {
    expect(readCount("")).toBeNull();
    expect(readCount("2.5")).toBeNull();
    expect(readCount("tres")).toBeNull();
    expect(readCount("-1")).toBeNull();
  });
});

describe("precios por millón de tokens", () => {
  it("lee dólares con punto, con coma decimal o con el signo", () => {
    expect(readRate("0.15")).toBe(0.15);
    expect(readRate("2,5")).toBe(2.5);
    expect(readRate("$3")).toBe(3);
    expect(readRate(" $ 0,0125 ")).toBe(0.0125);
    expect(readRate("0.0001")).toBe(0.0001);
    expect(readRate("2000")).toBe(2000);
    expect(readRate(".5")).toBe(0.5);
  });
  it("vacío, cero, letras, más de 4 decimales o más de 2000 no son un precio", () => {
    for (const bad of ["", "  ", "0", "0.0000", "abc", "0.00001", "0.12345", "2001", "2000.01", "-1", "1e3", "1.2.3", "1,2,3", "1.5,5", "$", "3 USD"])
      expect(readRate(bad), JSON.stringify(bad)).toBeNull();
  });
  it("lee la entrada hasta 1000 y la salida hasta 2000, como el esquema", () => {
    expect(readPrice("1000", "input")).toBe(1000);
    expect(readPrice("1000.01", "input")).toBeNull();
    expect(readPrice("2000", "output")).toBe(2000);
    expect(readPrice("2001", "output")).toBeNull();
    expect(readPrice("", "output")).toBeNull();
    // Lo que el formulario acepta es exactamente lo que el servidor guarda.
    expect(ModelPrice.safeParse({ input: RATE_MAX.input, output: RATE_MAX.output }).success).toBe(true);
    expect(ModelPrice.safeParse({ input: RATE_MAX.input + 0.0001, output: 1 }).success).toBe(false);
    expect(ModelPrice.safeParse({ input: 1, output: RATE_MAX.output + 0.0001 }).success).toBe(false);
  });
  it("se muestra sin ceros de sobra", () => {
    expect(formatRate(0.15)).toBe("0.15");
    expect(formatRate(3)).toBe("3");
    expect(formatRate(2.5)).toBe("2.5");
    expect(formatRate(0.0001)).toBe("0.0001");
    expect(formatRate(1000)).toBe("1000");
    expect(formatRate(0.1 + 0.2)).toBe("0.3");
    // Lo que se muestra se vuelve a leer igual.
    for (const n of [0.15, 3, 2.5, 0.0125, 1999.9999]) expect(readRate(formatRate(n))).toBe(n);
  });
});

describe("el modelo de cada agente", () => {
  it("lee el nombre del modelo con las mismas reglas que el esquema", () => {
    expect(readModelName(" gpt-5-mini ")).toBe("gpt-5-mini");
    expect(readModelName("claude-sonnet-4.5")).toBe("claude-sonnet-4.5");
    expect(readModelName("models/gemini_2:pro")).toBeNull();
    for (const bad of ["", "   ", "dos palabras", "ñandú", "<b>", "a".repeat(101)]) expect(readModelName(bad), JSON.stringify(bad)).toBeNull();
    for (const name of ["a", "a".repeat(100), "gpt-5.1:mini_x"]) {
      expect(readModelName(name)).toBe(name);
      expect(ModelChoice.safeParse({ provider: "openai", model: name }).success).toBe(true);
    }
    expect(ModelChoice.safeParse({ provider: "openai", model: "a".repeat(101) }).success).toBe(false);
  });

  const models: Settings["agentModels"] = { copy: { provider: "claude", model: "sonnet" }, seo: { provider: "openai", model: "gpt-5-mini" } };

  it("setAgentModel elige el modelo de un agente sin tocar al resto ni al original", () => {
    const next = setAgentModel(models, "review", { provider: "gemini", model: "pro" });
    expect(next).toEqual({ ...models, review: { provider: "gemini", model: "pro" } });
    expect(models).not.toHaveProperty("review");
    expect(setAgentModel(models, "copy", { provider: "openai", model: "gpt-5" }).copy).toEqual({ provider: "openai", model: "gpt-5" });
    expect(models.copy).toEqual({ provider: "claude", model: "sonnet" });
  });

  it("setAgentModel quita la entrada del agente con null", () => {
    const next = setAgentModel(models, "copy", null);
    expect(next).toEqual({ seo: { provider: "openai", model: "gpt-5-mini" } });
    expect(next).not.toHaveProperty("copy");
    expect(models).toHaveProperty("copy");
    expect(setAgentModel({}, "copy", null)).toEqual({});
    expect(setAgentModel(models, "review", null)).toEqual(models);
  });

  it("pruneModelPrices deja solo los precios de los modelos elegidos", () => {
    const prices: Settings["modelPrices"] = {
      "claude:sonnet": { input: 3, output: 15 },
      "openai:gpt-5-mini": { input: 0.25, output: 2 },
      "gemini:old": { input: 1, output: 2 },
      "openai:gpt-5": { input: 1.25, output: 10 },
    };
    const kept = pruneModelPrices(prices, models);
    expect(kept).toEqual({ "claude:sonnet": prices["claude:sonnet"], "openai:gpt-5-mini": prices["openai:gpt-5-mini"] });
    expect(Object.keys(prices)).toHaveLength(4);
    expect(pruneModelPrices(prices, {})).toEqual({});
    // Dos agentes con el mismo modelo comparten un solo precio.
    const same = { copy: models.copy!, review: models.copy! };
    expect(pruneModelPrices(prices, same)).toEqual({ "claude:sonnet": prices["claude:sonnet"] });
    // Un modelo sin precio guardado no inventa uno.
    expect(pruneModelPrices({}, models)).toEqual({});
  });
});

describe("enviar el formulario de la configuración", () => {
  it("sin nada por corregir y sin pedido en curso, guarda", () => {
    expect(submitDecision([], false)).toEqual({ save: true, reveal: false });
  });
  it("con algo por corregir no guarda y muestra lo que falta (clic o Enter)", () => {
    expect(submitDecision(["price:claude:sonnet:input"], false)).toEqual({ save: false, reveal: true });
    expect(submitDecision(["radarHours", "model:copy"], false)).toEqual({ save: false, reveal: true });
  });
  it("con un pedido en curso no hace nada: ni guarda dos veces ni marca campos", () => {
    expect(submitDecision([], true)).toEqual({ save: false, reveal: false });
    expect(submitDecision(["dailyBudgetCents"], true)).toEqual({ save: false, reveal: false });
  });
});
