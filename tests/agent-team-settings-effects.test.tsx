// «Modo equipo» y el botón «Guardar»: qué campos le avisan al formulario que no se puede guardar. Las pruebas de pantalla pintan con
// `renderToStaticMarkup`, que no corre efectos; aquí se corren a mano para ver las marcas que el formulario recibe con `onInvalid`.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/I18n";
import { TeamSettings } from "@/components/agent/TeamSettings";
import { DEFAULT_SETTINGS, type Snapshot } from "@/components/agent/types";
import type { Settings } from "@/lib/agent/schema";

vi.mock("@/components/agent/AgentCenter.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));
vi.mock("@/components/agent/Team.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));

// The effects the render registers, so the test can run them the way the browser does after painting.
const effects = vi.hoisted(() => ({ pending: [] as (() => unknown)[] }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => unknown) => {
    effects.pending.push(effect);
  },
}));

const CAPTURED = "2026-10-16T18:00:00.000Z";
/** The marks the form receives after the first paint: the last word for each key. */
function marks(settings: Partial<Settings>, only = ""): Record<string, boolean> {
  effects.pending = [];
  const value: Settings = { ...DEFAULT_SETTINGS, teamMode: true, ...settings };
  const data = {
    business: { id: "b1", name: "Techos", timezone: "" },
    settings: { ...value, revision: 1, pausedAt: null, tickAt: CAPTURED },
    team: { today: "2026-10-16", tz: "America/New_York", runs: [], agents: [] },
    capturedAt: CAPTURED,
  } as unknown as Snapshot;
  const received: Record<string, boolean> = {};
  const onInvalid = (key: string, bad: boolean) => {
    received[key] = bad;
  };
  renderToStaticMarkup(
    <I18nProvider lang="es">
      <TeamSettings value={value} set={() => {}} data={data} busy={false} act={async () => true} onInvalid={onInvalid} />
    </I18nProvider>,
  );
  for (const effect of effects.pending) effect();
  return Object.fromEntries(Object.entries(received).filter(([key]) => key.startsWith(only)));
}

/** Each agent's model row reports itself too, and none is blocking. */
const NO_MODEL_MARKS = { "model:director": false, "model:seo": false, "model:strategy": false, "model:copy": false, "model:review": false };

describe("Modo equipo: lo que bloquea «Guardar»", () => {
  beforeEach(() => {
    effects.pending = [];
  });

  it("a chosen model without a price blocks Save from the start, even though its fields show no error yet", () => {
    expect(marks({ agentModels: { review: { provider: "gemini", model: "gemini-2.5-pro" } } }, "price:")).toEqual({
      "price:gemini:gemini-2.5-pro:input": true,
      "price:gemini:gemini-2.5-pro:output": true,
    });
  });

  it("marks only the side that does not read", () => {
    expect(
      marks(
        {
          agentModels: { review: { provider: "gemini", model: "x" } },
          modelPrices: { "gemini:x": { input: 0.15, output: 0 } },
        },
        "price:",
      ),
    ).toEqual({ "price:gemini:x:input": false, "price:gemini:x:output": true });
  });

  it("a model with both prices, a default model and a price nobody uses block nothing", () => {
    expect(
      marks({
        agentModels: { copy: { provider: "claude", model: "sonnet" } },
        modelPrices: { "claude:sonnet": { input: 3, output: 15 }, "claude:old": { input: 1, output: 2 } },
      }),
    ).toEqual({ ...NO_MODEL_MARKS, "price:claude:sonnet:input": false, "price:claude:sonnet:output": false });
    expect(marks({})).toEqual(NO_MODEL_MARKS);
  });

  it("a model of the list blocks nothing: its price is the official one", () => {
    expect(
      marks({ agentModels: { director: { provider: "openai", model: "gpt-4.1-mini" }, seo: { provider: "gemini", model: "gemini-2.5-flash-lite" } } }),
    ).toEqual(NO_MODEL_MARKS);
  });

  it("Otro modelo with a name that does not read blocks Save", () => {
    expect(marks({ agentModels: { copy: { provider: "openai", model: "no vale" } } }, "model:copy")).toEqual({ "model:copy": true });
  });
});
