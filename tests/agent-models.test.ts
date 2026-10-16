// IA y precio por agente: cada agente usa su modelo, con el precio del negocio, el verificado o el de las variables.
import { afterEach, describe, expect, it } from "vitest";
import { AgentError } from "@/lib/agent/access";
import { callCeiling, keyFor } from "@/lib/agent/metered";
import { PRICE_TABLE, agentCeiling, resolveModel } from "@/lib/agent/models";

const env = {
  GEMINI_API_KEY: "k",
  MATYA_AGENT_PROVIDER: "gemini",
  MATYA_AGENT_MODEL: "gemini-x",
  MATYA_AGENT_INPUT_USD_PER_MILLION: "0.3",
  MATYA_AGENT_OUTPUT_USD_PER_MILLION: "2.5",
};
const none = { agentModels: {}, modelPrices: {} };

afterEach(() => {
  for (const k of Object.keys(PRICE_TABLE)) delete PRICE_TABLE[k];
});

describe("modelo y precio por agente", () => {
  it("usa la elección del agente y el precio del negocio", () => {
    const c = resolveModel(
      "director",
      {
        agentModels: { director: { provider: "gemini", model: "gemini-y" } },
        modelPrices: { "gemini:gemini-y": { input: 1, output: 4 } },
      },
      env,
    );
    expect(c).toMatchObject({
      provider: "gemini",
      model: "gemini-y",
      inputRate: 1,
      outputRate: 4,
      key: "k",
    });
  });

  it("sin elección usa el modelo y las tarifas de las variables", () => {
    expect(resolveModel("copy", none, env)).toMatchObject({
      model: "gemini-x",
      inputRate: 0.3,
      outputRate: 2.5,
      key: "k",
    });
  });

  it("sin precio o sin clave no trabaja (AgentError)", () => {
    const noPrice = () =>
      resolveModel(
        "seo",
        {
          agentModels: { seo: { provider: "gemini", model: "sin-precio" } },
          modelPrices: {},
        },
        env,
      );
    expect(noPrice).toThrow(AgentError);
    expect(noPrice).toThrow(
      "Falta el precio verificado del modelo gemini:sin-precio para el agente seo.",
    );
    const noKey = () =>
      resolveModel(
        "seo",
        {
          agentModels: { seo: { provider: "claude", model: "c" } },
          modelPrices: { "claude:c": { input: 1, output: 1 } },
        },
        env,
      );
    expect(noKey).toThrow(AgentError);
    expect(noKey).toThrow("Falta la conexión del modelo de seo.");
  });

  it("si faltan el precio y la clave, avisa primero del precio", () => {
    expect(() =>
      resolveModel(
        "seo",
        {
          agentModels: { seo: { provider: "openai", model: "o" } },
          modelPrices: {},
        },
        env,
      ),
    ).toThrow(/precio/);
  });

  it("el precio del negocio gana al verificado, y este a las variables", () => {
    const ws = (prices: Record<string, { input: number; output: number }>) => ({
      agentModels: {},
      modelPrices: prices,
    });
    PRICE_TABLE["gemini:gemini-x"] = {
      input: 5,
      output: 6,
      verifiedAt: "2026-10-16",
    };
    expect(resolveModel("copy", none, env)).toMatchObject({
      inputRate: 5,
      outputRate: 6,
    });
    expect(
      resolveModel(
        "copy",
        ws({ "gemini:gemini-x": { input: 7, output: 8 } }),
        env,
      ),
    ).toMatchObject({ inputRate: 7, outputRate: 8 });
  });

  it("el precio verificado sirve a un modelo que las variables no cubren", () => {
    PRICE_TABLE["claude:c"] = {
      input: 3,
      output: 15,
      verifiedAt: "2026-10-16",
    };
    expect(
      resolveModel(
        "design",
        {
          agentModels: { design: { provider: "claude", model: "c" } },
          modelPrices: {},
        },
        { ...env, ANTHROPIC_API_KEY: "a" },
      ),
    ).toMatchObject({
      provider: "claude",
      model: "c",
      inputRate: 3,
      outputRate: 15,
      key: "a",
    });
  });

  it("las tarifas de las variables no valen para otro modelo", () => {
    expect(() =>
      resolveModel(
        "copy",
        {
          agentModels: { copy: { provider: "gemini", model: "otro" } },
          modelPrices: {},
        },
        env,
      ),
    ).toThrow(/precio/);
  });

  it("un valor inválido cuenta como sin elección o sin precio, no como un fallo", () => {
    for (const agentModels of [
      null,
      undefined,
      "x",
      7,
      [],
      { copy: "x" },
      { copy: { provider: "otro", model: "m" } },
    ])
      expect(
        resolveModel("copy", { agentModels, modelPrices: null }, env),
      ).toMatchObject({
        model: "gemini-x",
      });
    expect(() =>
      resolveModel(
        "copy",
        {
          agentModels: { copy: { provider: "gemini", model: "m" } },
          modelPrices: { "gemini:m": { input: -1, output: "x" } },
        },
        env,
      ),
    ).toThrow(/precio/);
  });

  it("la elección inválida de un agente no afecta a los demás", () => {
    const ws = {
      agentModels: {
        copy: { provider: "nadie", model: "m" },
        seo: { provider: "gemini", model: "gemini-y" },
      },
      modelPrices: {
        "gemini:gemini-y": { input: 1, output: 4 },
        "gemini:roto": { input: 0, output: 1 },
      },
    };
    expect(resolveModel("seo", ws, env)).toMatchObject({
      model: "gemini-y",
      inputRate: 1,
    });
    expect(resolveModel("copy", ws, env)).toMatchObject({ model: "gemini-x" });
  });

  it("sin modelo en las variables ni elección, mantiene el aviso de siempre", () => {
    expect(() => resolveModel("copy", none, { GEMINI_API_KEY: "k" })).toThrow(
      AgentError,
    );
    expect(() => resolveModel("copy", none, { GEMINI_API_KEY: "k" })).toThrow(
      /Falta configurar el modelo/,
    );
  });

  it("el tope de una llamada sale del modelo y precio del agente", () => {
    const ws = {
      agentModels: { video: { provider: "gemini", model: "gemini-y" } },
      modelPrices: { "gemini:gemini-y": { input: 1, output: 4 } },
    };
    expect(agentCeiling("video", ws, env)).toBe(
      callCeiling(resolveModel("video", ws, env)),
    );
    // 1 y 4 USD por millón: más caro que las tarifas de las variables (0.3 y 2.5).
    expect(agentCeiling("video", ws, env)).toBe(5);
    expect(agentCeiling("copy", none, env)).toBe(2);
    const sinPrecio = {
      agentModels: { seo: { provider: "claude", model: "c" } },
      modelPrices: {},
    };
    expect(() => agentCeiling("seo", sinPrecio, env)).toThrow(AgentError);
  });

  it("keyFor busca la clave de cada proveedor", () => {
    const keys = {
      OPENAI_API_KEY: "o",
      ANTHROPIC_API_KEY: "a",
      GEMINI_API_KEY: "g",
    };
    expect(keyFor("openai", keys)).toBe("o");
    expect(keyFor("claude", keys)).toBe("a");
    expect(keyFor("gemini", keys)).toBe("g");
    expect(keyFor("claude", {})).toBeUndefined();
  });
});
