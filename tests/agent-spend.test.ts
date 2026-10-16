// Una sola llamada de pago por paso de un agente con modelo, y un paso que falla antes de su llamada no gastó nada (spend.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentRun } from "@prisma/client";

vi.mock("@/lib/seo/writer-run", async (original) => ({
  ...(await original<typeof import("@/lib/seo/writer-run")>()),
  createArticleReport: vi.fn(),
}));

import { AgentError } from "@/lib/agent/access";
import { meteredAsk, type ModelConfig } from "@/lib/agent/metered";
import { oneCall, paidCall, Unspent } from "@/lib/agent/spend";
import { toolsFor } from "@/lib/agent/tools";
import { createArticleReport } from "@/lib/seo/writer-run";

const config: ModelConfig = { provider: "openai", model: "fixture", inputRate: 1, outputRate: 4, key: "k" };
const Answer = z.object({ text: z.string() });
const ok = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: '{"text":"Hola"}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  );
const ask = () => meteredAsk(Answer, "s", {}, config);

describe("oneCall", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("lets one paid call through and refuses a second one before it is sent", async () => {
    const f = vi.fn().mockImplementation(async () => ok());
    vi.stubGlobal("fetch", f);
    await expect(oneCall(async () => (await ask()).value.text)).resolves.toBe("Hola");
    expect(f).toHaveBeenCalledTimes(1);
    const twice = oneCall(async () => {
      await ask();
      return ask();
    });
    await expect(twice).rejects.toThrow("Este paso ya hizo su llamada de pago: no se hizo otra.");
    // The first call happened: what failed after it is not "unspent".
    await expect(twice).rejects.not.toBeInstanceOf(Unspent);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("outside a step it counts nothing (the campaigns' flow)", async () => {
    const f = vi.fn().mockImplementation(async () => ok());
    vi.stubGlobal("fetch", f);
    await ask();
    await ask();
    expect(() => paidCall()).not.toThrow();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("a refusal before the call comes out as Unspent with the same words; a size refusal too", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const before = oneCall(async () => {
      throw new AgentError("Falta completar el paso anterior.", 409);
    });
    await expect(before).rejects.toBeInstanceOf(Unspent);
    await expect(before).rejects.toMatchObject({ message: "Falta completar el paso anterior.", status: 409 });
    // meteredAsk's own size guard fires before any request leaves.
    const big = oneCall(() => meteredAsk(Answer, "s", "a".repeat(33000), config));
    await expect(big).rejects.toBeInstanceOf(Unspent);
    await expect(big).rejects.toThrow("contexto");
    expect(f).not.toHaveBeenCalled();
  });

  it("a failure once the call started keeps its own error (the outcome is not known)", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", f);
    const after = oneCall(ask);
    await expect(after).rejects.toThrow("500");
    await expect(after).rejects.not.toBeInstanceOf(Unspent);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(oneCall(ask)).rejects.toBeInstanceOf(TypeError);
  });

  it("an error that is not an AgentError is passed on as it is, even before a call", async () => {
    const bug = oneCall(async () => {
      throw new TypeError("bug");
    });
    await expect(bug).rejects.toBeInstanceOf(TypeError);
    await expect(bug).rejects.not.toBeInstanceOf(Unspent);
  });

  it("counts the call through timers and promise chains, and two steps at once count apart", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok()));
    const late = oneCall(async () => {
      await new Promise((r) => setTimeout(r, 5));
      await ask();
      await new Promise((r) => setTimeout(r, 5));
      return ask();
    });
    await expect(late).rejects.toThrow("ya hizo su llamada de pago");
    const both = await Promise.all([oneCall(ask), oneCall(ask)]);
    expect(both.map((r) => r.value.text)).toEqual(["Hola", "Hola"]);
  });

  it("a tool that pays someone counts as the step's paid call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok()));
    const tools = toolsFor({ key: "copy", tools: ["writeArticle"] }, { id: "r", businessId: "b" } as AgentRun);
    await expect(
      oneCall(async () => {
        await ask();
        return tools.use("writeArticle")("reparar techo", "es");
      }),
    ).rejects.toThrow("ya hizo su llamada de pago");
    expect(createArticleReport).not.toHaveBeenCalled();
  });
});
