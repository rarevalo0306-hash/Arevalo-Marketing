// Configuración del equipo de agentes: campos nuevos de Settings, RunKind y valores por defecto.
import { describe, expect, it } from "vitest";
import { AgentKeyEnum, RunKind, Settings } from "@/lib/agent/schema";
import { DEFAULT_SETTINGS } from "@/components/agent/types";

describe("configuración del equipo", () => {
  it("acepta la configuración del equipo y rechaza valores fuera de rango", () => {
    const ok = Settings.parse({
      ...DEFAULT_SETTINGS,
      teamMode: true,
      dailyHour: 7,
      agentModels: {
        director: { provider: "gemini", model: "gemini-2.5-flash" },
      },
      modelPrices: { "gemini:gemini-2.5-flash": { input: 0.3, output: 2.5 } },
    });
    expect(ok.teamMode).toBe(true);
    expect(() => Settings.parse({ ...DEFAULT_SETTINGS, dailyHour: 24 })).toThrow();
    expect(() =>
      Settings.parse({
        ...DEFAULT_SETTINGS,
        agentModels: { boss: { provider: "gemini", model: "x" } },
      }),
    ).toThrow();
    expect(DEFAULT_SETTINGS).toMatchObject({
      teamMode: false,
      dailyHour: 7,
      agentModels: {},
      modelPrices: {},
      allowSocial: true,
      allowWebArticles: true,
    });
  });

  it("los valores por defecto son una configuración válida", () => {
    expect(Settings.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it("la hora diaria es un entero entre 0 y 23", () => {
    for (const dailyHour of [0, 23])
      expect(Settings.parse({ ...DEFAULT_SETTINGS, dailyHour }).dailyHour).toBe(
        dailyHour,
      );
    for (const dailyHour of [-1, 24, 6.5])
      expect(() => Settings.parse({ ...DEFAULT_SETTINGS, dailyHour })).toThrow();
  });

  it("cada agente admite un modelo con proveedor conocido y nombre seguro", () => {
    expect(AgentKeyEnum.options).toEqual([
      "director",
      "seo",
      "strategy",
      "copy",
      "design",
      "video",
      "review",
    ]);
    const parse = (agentModels: unknown) =>
      Settings.parse({ ...DEFAULT_SETTINGS, agentModels });
    expect(
      parse({ review: { provider: "claude", model: "claude-sonnet-4.5:beta_1" } })
        .agentModels.review?.model,
    ).toBe("claude-sonnet-4.5:beta_1");
    expect(() => parse({ copy: { provider: "other", model: "x" } })).toThrow();
    expect(() => parse({ copy: { provider: "openai", model: "" } })).toThrow();
    expect(() =>
      parse({ copy: { provider: "openai", model: "a b" } }),
    ).toThrow();
    expect(() =>
      parse({ copy: { provider: "openai", model: "x".repeat(101) } }),
    ).toThrow();
  });

  it("los precios por millón de tokens son positivos y acotados", () => {
    const parse = (modelPrices: unknown) =>
      Settings.parse({ ...DEFAULT_SETTINGS, modelPrices });
    expect(
      parse({ "openai:x": { input: 1000, output: 2000 } }).modelPrices,
    ).toEqual({ "openai:x": { input: 1000, output: 2000 } });
    for (const price of [
      { input: 0, output: 1 },
      { input: 1, output: 0 },
      { input: 1000.1, output: 1 },
      { input: 1, output: 2000.1 },
      { input: -1, output: 1 },
    ])
      expect(() => parse({ "openai:x": price })).toThrow();
  });

  it("los encargos del equipo y sus piezas son tipos de trabajo válidos", () => {
    expect(RunKind.parse("team")).toBe("team");
    expect(RunKind.parse("piece")).toBe("piece");
    expect(() => RunKind.parse("otro")).toThrow();
  });
});
