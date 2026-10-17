// La sección «Modo equipo» de la configuración del Centro MATYA: el interruptor, la hora del plan, los permisos, la IA y el precio de cada
// agente, el aviso del llamado de cada minuto y «Pausar todo». Se pinta con `renderToStaticMarkup` (sin DOM) y el CSS Module simulado,
// como tests/agent-team-today.test.tsx; lo que cambia al escribir se prueba en las funciones puras de settings-input.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSettings, SaveButton, focusFirstInvalid, nextFormKey, submitSettings } from "@/components/agent/AgentSettings";
import { I18nProvider } from "@/components/I18n";
import { AI_AGENTS, OTHER_MODEL, PauseBlock, TeamSettings, choiceFor, pauseAll, pickFor, resumeAll } from "@/components/agent/TeamSettings";
import { DEFAULT_SETTINGS, type Snapshot } from "@/components/agent/types";
import type { Settings } from "@/lib/agent/schema";
import { isTickStale, type TeamAgentView } from "@/lib/agent/team-view";

vi.mock("@/components/agent/AgentCenter.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));
vi.mock("@/components/agent/Team.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));
// The agents' registry (used by the label check below) opens the database only when a tool runs.
vi.mock("@/lib/db", () => ({ db: {} }));

const MIN = 60_000;
// The snapshot's own clock: the tick is measured against the moment the server took it, never against the browser's.
const CAPTURED = "2026-10-16T18:00:00.000Z";
const before = (minutes: number) => new Date(Date.parse(CAPTURED) - minutes * MIN).toISOString();

const agent = (key: string, es: string, en: string, extra: Partial<TeamAgentView> = {}): TeamAgentView => ({
  key,
  label: { es, en },
  usesModel: true,
  model: "",
  own: false,
  ready: true,
  problem: "",
  steps: 0,
  cents: 0,
  ...extra,
});
const AGENTS = [
  agent("director", "Director", "Director"),
  agent("seo", "SEO e investigación", "SEO and research"),
  agent("strategy", "Estrategia de contenido", "Content strategy"),
  agent("copy", "Redacción", "Copywriting"),
  agent("design", "Diseño", "Design", { usesModel: false }),
  agent("video", "Video", "Video", { usesModel: false }),
  agent("review", "Revisión editorial", "Editorial review"),
];

type Over = {
  settings?: Partial<Settings>;
  server?: { pausedAt?: string | null; tickAt?: string | null };
  agents?: TeamAgentView[];
  team?: null;
  tz?: string;
  timezone?: string;
};
/** A snapshot whose server-side settings and the form's own value are the same, unless the test says otherwise. */
const fixture = (over: Over = {}) => {
  const value: Settings = { ...DEFAULT_SETTINGS, enabled: true, teamMode: true, dailyHour: 7, ...over.settings };
  const data = {
    business: { id: "b1", name: "Techos Pérez", timezone: over.timezone ?? "" } as Snapshot["business"],
    industry: { key: "general", name: "General", geography: "Miami", audience: "Familias", focus: [] },
    settings: { ...value, revision: 1, pausedAt: null, tickAt: before(1), ...over.server },
    runs: [],
    messages: [],
    news: [],
    budget: { chargedCents: 0, reservedCents: 0, posts: 0 },
    aiReady: true,
    team: over.team === null ? null : { today: "2026-10-16", tz: over.tz ?? "America/New_York", runs: [], agents: over.agents ?? AGENTS },
    tools: [],
    connections: [],
    posts: [],
    campaigns: [],
    capturedAt: CAPTURED,
  } as Snapshot;
  return { value, data };
};
const render = (over: Over = {}, { busy = false, lang = "es" as "es" | "en", reveal = false } = {}) => {
  const { value, data } = fixture(over);
  return renderToStaticMarkup(
    <I18nProvider lang={lang}>
      <TeamSettings value={value} set={() => {}} data={data} busy={busy} act={async () => true} onInvalid={() => {}} revealErrors={reveal} />
    </I18nProvider>,
  );
};

const count = (html: string, text: string) => html.split(text).length - 1;
/** The markup of each agent's AI row, in page order. */
const modelRows = (html: string) => [...html.matchAll(/<li class="aiRow" data-agent="(\w+)"[\s\S]*?<\/li>/g)].map((m) => ({ key: m[1], html: m[0] }));
const priceRows = (html: string) => [...html.matchAll(/<li class="priceRow" data-model="([^"]+)"[\s\S]*?<\/li>/g)].map((m) => ({ id: m[1], html: m[0] }));
const hourSelect = (html: string) => html.match(/(?:Hora del plan de la mañana|Morning plan time)[\s\S]*?<\/select>/)?.[0] ?? "";
const TICK_WARNING = "El llamado de cada minuto no está activo. Sin él no avanza ningún paso ni llega el plan de la mañana.";

describe("Modo equipo: la sección", () => {
  it("the section shows Modo equipo, the hour select with 24 options, both permissions and five model rows", () => {
    const html = render();
    expect(html).toMatch(/<h2[^>]*>Modo equipo<\/h2>/);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""[^>]*\/>Modo equipo/);
    expect(html).toContain("El Director arma un plan cada mañana y reparte las piezas entre los agentes.");

    const hour = hourSelect(html);
    expect(hour).toContain("Hora del plan de la mañana");
    expect(count(hour, "<option")).toBe(24);
    expect(hour).toMatch(/<option value="7" selected="">7:00 a\. m\.<\/option>/);

    expect(html).toContain("Publicar en redes sociales");
    expect(html).toContain("Publicar artículos en la web");
    // Both permissions come on from the defaults.
    expect(html).toMatch(/checked=""[^>]*\/>Publicar en redes sociales/);
    expect(html).toMatch(/checked=""[^>]*\/>Publicar artículos en la web/);

    const rows = modelRows(html);
    expect(rows.map((r) => r.key)).toEqual(["director", "seo", "strategy", "copy", "review"]);
    // The two agents that make no AI call have no row.
    expect(html).not.toContain('data-agent="design"');
    expect(html).not.toContain('data-agent="video"');
  });

  it("shows the whole section with team mode off, so the owner can check the agents before turning it on", () => {
    const html = render({ settings: { teamMode: false, allowSocial: false, allowWebArticles: false } });
    expect(html).toMatch(/<h2[^>]*>Modo equipo<\/h2>/);
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked=""[^>]*\/>Modo equipo/);
    expect(count(hourSelect(html), "<option")).toBe(24);
    expect(modelRows(html)).toHaveLength(5);
    expect(html).not.toMatch(/checked=""[^>]*\/>Publicar en redes sociales/);
    expect(html).not.toMatch(/checked=""[^>]*\/>Publicar artículos en la web/);
    expect(html).toContain("Pausar todo");
  });

  it("writes the hour as 12-hour clock text in the business's time zone", () => {
    const hour = hourSelect(render({ settings: { dailyHour: 19 } }));
    const labels = [...hour.matchAll(/<option value="(\d+)"[^>]*>([^<]*)<\/option>/g)].map((m) => [Number(m[1]), m[2]]);
    expect(labels).toHaveLength(24);
    expect(labels.map((l) => l[0])).toEqual([...Array(24).keys()]);
    expect(labels[0][1]).toBe("12:00 a. m.");
    expect(labels[7][1]).toBe("7:00 a. m.");
    expect(labels[12][1]).toBe("12:00 p. m.");
    expect(labels[19][1]).toBe("7:00 p. m.");
    expect(labels[23][1]).toBe("11:00 p. m.");
    expect(hour).toMatch(/<option value="19" selected="">7:00 p\. m\.<\/option>/);
    expect(count(hour, "selected=")).toBe(1);

    expect(render({ tz: "America/New_York" })).toContain("hora de Miami");
    expect(render({ tz: "America/Managua" })).toContain("hora de Managua");
    // Without the team snapshot the business's own zone is used.
    expect(render({ team: null, timezone: "America/Chicago" })).toContain("hora de Chicago");
    const en = render({ tz: "America/Managua" }, { lang: "en" });
    expect(en).toContain("Managua time");
    expect(hourSelect(en)).toContain("7:00 AM");
    expect(hourSelect(en)).toContain("12:00 PM");
  });
});

describe("Modo equipo: la IA de cada agente", () => {
  const options = (select = "") => [...select.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
  const selects = (html: string) => html.match(/<select[\s\S]*?<\/select>/g) ?? [];

  it("each row has one AI list: the default model, the models by provider with their two prices, and Otro modelo", () => {
    for (const row of modelRows(render())) {
      const [select = "", ...more] = selects(row.html);
      expect(more).toHaveLength(0);
      expect(options(select)).toEqual([
        ["", "Modelo por defecto"],
        ["openai:gpt-4.1-mini", "GPT-4.1 mini · $0.40 / $1.60 · recomendado"],
        ["openai:gpt-4.1", "GPT-4.1 · $2.00 / $8.00"],
        ["openai:gpt-4.1-nano", "GPT-4.1 nano · $0.10 / $0.40"],
        ["gemini:gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite · $0.10 / $0.40"],
        ["other", "Otro modelo (escribir el nombre)"],
      ]);
      // Grouped by provider; Claude has no model on the list, so no group.
      expect([...select.matchAll(/<optgroup label="([^"]+)"/g)].map((m) => m[1])).toEqual(["OpenAI", "Gemini"]);
      // With the default model there is no model to type, no price to set and nothing to describe.
      expect(row.html).toMatch(/<option value="" selected="">Modelo por defecto<\/option>/);
      expect(row.html).not.toContain("<input");
      expect(row.html).not.toContain("Precio oficial");
    }
  });

  it("a model of the list is selected, says what it is for and its official price, and has nothing to type", () => {
    const html = render({ settings: { agentModels: { copy: { provider: "openai", model: "gpt-4.1" } } } });
    const rows = modelRows(html);
    const copy = rows.find((r) => r.key === "copy")!.html;
    expect(copy).toMatch(/<option value="openai:gpt-4\.1" selected="">GPT-4\.1 · \$2\.00 \/ \$8\.00<\/option>/);
    expect(copy).toContain("El que mejor escribe y decide de la lista");
    expect(copy).toContain("Precio oficial por millón de tokens: entrada $2.00, salida $8.00.");
    // The description is tied to the list, and there is no provider list or name field.
    const use = /<p id="([^"]+)" class="note">El que mejor/.exec(copy)?.[1];
    expect(use).toBeTruthy();
    expect(copy).toContain(`aria-describedby="${use}"`);
    expect(selects(copy)).toHaveLength(1);
    expect(copy).not.toContain("<input");
    // Its price is the official one: no price row to fill.
    expect(priceRows(html)).toHaveLength(0);
    for (const other of rows.filter((r) => r.key !== "copy")) expect(other.html).not.toContain("Precio oficial");
  });

  it("a model not on the list opens Otro modelo: its provider selected and the model in a text field", () => {
    const html = render({ settings: { agentModels: { copy: { provider: "claude", model: "claude-sonnet-4.5" } } } });
    const rows = modelRows(html);
    const copy = rows.find((r) => r.key === "copy")!.html;
    const [list, provider] = selects(copy);
    expect(list).toMatch(/<option value="other" selected="">Otro modelo \(escribir el nombre\)<\/option>/);
    expect(options(provider)).toEqual([
      ["openai", "OpenAI"],
      ["claude", "Claude"],
      ["gemini", "Gemini"],
    ]);
    expect(provider).toMatch(/<option value="claude" selected="">Claude<\/option>/);
    expect(copy).toContain("Proveedor de IA");
    expect(copy).toMatch(/<input[^>]*type="text"[^>]*value="claude-sonnet-4\.5"/);
    expect(copy).toContain("Redacción");
    expect(copy).not.toContain("Precio oficial");
    for (const other of rows.filter((r) => r.key !== "copy")) expect(other.html).not.toContain("<input");
  });

  it("pickFor: the default, a model of the list by its id, anything else Otro modelo", () => {
    expect(pickFor(undefined)).toBe("");
    expect(pickFor({ provider: "openai", model: "gpt-4.1-mini" })).toBe("openai:gpt-4.1-mini");
    expect(pickFor({ provider: "gemini", model: "gemini-2.5-flash-lite" })).toBe("gemini:gemini-2.5-flash-lite");
    // Same name under another provider is not the listed model.
    expect(pickFor({ provider: "gemini", model: "gpt-4.1-mini" })).toBe(OTHER_MODEL);
    expect(pickFor({ provider: "claude", model: "claude-sonnet-4.5" })).toBe(OTHER_MODEL);
  });

  it("choiceFor: what the settings get for each pick", () => {
    expect(choiceFor("", "openai", "")).toBeNull();
    expect(choiceFor("openai:gpt-4.1-mini", "claude", "ignored")).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
    expect(choiceFor("gemini:gemini-2.5-flash-lite", "openai", "")).toEqual({ provider: "gemini", model: "gemini-2.5-flash-lite" });
    // Otro modelo: the provider and the name typed, trimmed; nothing while the name does not read.
    expect(choiceFor(OTHER_MODEL, "claude", "  claude-sonnet-4.5 ")).toEqual({ provider: "claude", model: "claude-sonnet-4.5" });
    expect(choiceFor(OTHER_MODEL, "claude", "")).toBeNull();
    expect(choiceFor(OTHER_MODEL, "openai", "no vale")).toBeNull();
    // A value that is not on the list (an old page, a tampered option) is the default model, never a made-up choice.
    expect(choiceFor("openai:gpt-9", "openai", "")).toBeNull();
  });

  it("shows the list, its description and the price in English too", () => {
    const html = render({ settings: { agentModels: { seo: { provider: "gemini", model: "gemini-2.5-flash-lite" } } } }, { lang: "en" });
    const seo = modelRows(html).find((r) => r.key === "seo")!.html;
    expect(options(selects(seo)[0])).toContainEqual(["openai:gpt-4.1-mini", "GPT-4.1 mini · $0.40 / $1.60 · recommended"]);
    expect(options(selects(seo)[0])).toContainEqual(["other", "Other model (type its name)"]);
    expect(seo).toContain("Very cheap and fast, from Google.");
    expect(seo).toContain("Official price per million tokens: input $0.10, output $0.40.");
    expect(html).toContain("what the agent reads and what it writes");
  });

  it("names each agent with its label from the server, or its own name when the team has no data yet", () => {
    const named = modelRows(render({ agents: AGENTS.map((a) => (a.key === "copy" ? { ...a, label: { es: "Redactor", en: "Writer" } } : a)) }));
    expect(named.find((r) => r.key === "copy")!.html).toContain("Redactor");
    const none = modelRows(render({ team: null }));
    expect(none.map((r) => r.key)).toEqual(["director", "seo", "strategy", "copy", "review"]);
    expect(none.find((r) => r.key === "copy")!.html).toContain("Redacción");
    expect(none.find((r) => r.key === "review")!.html).toContain("Revisión editorial");
  });

  it("shows the server's state: Listo, or the problem as text, and says it is the saved one", () => {
    const problem = "Falta la clave de IA del proveedor de Redacción.";
    const html = render({ agents: AGENTS.map((a) => (a.key === "copy" ? { ...a, ready: false, problem } : a.key === "seo" ? { ...a, ready: false } : a)) });
    const rows = modelRows(html);
    const by = (key: string) => rows.find((r) => r.key === key)!.html;
    expect(by("copy")).toContain(problem);
    expect(by("copy")).not.toContain("Listo");
    expect(by("seo")).toContain("No está listo.");
    expect(by("seo")).not.toContain("Listo");
    for (const key of ["director", "strategy", "review"]) {
      expect(by(key)).toContain("Listo");
      expect(by(key)).not.toContain("No está listo.");
    }
    // The state is the one saved: it can be old until the owner saves.
    expect(html).toContain("después de guardar");
  });

  it("without the team snapshot there is no state to show, only when it will be checked", () => {
    const html = render({ team: null });
    const rows = modelRows(html);
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.html).not.toContain("Listo");
      expect(row.html).toContain("después de guardar");
    }
  });

  it("shows the problem and the model as escaped text", () => {
    const html = render({
      settings: { agentModels: { copy: { provider: "openai", model: "<img src=x onerror=alert(1)>" } } },
      agents: AGENTS.map((a) => (a.key === "copy" ? { ...a, ready: false, problem: "<script>alert(1)</script> sin clave" } : a)),
    });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; sin clave");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });
});

describe("Modo equipo: los precios", () => {
  const PRICE_IN = "Entrada (USD por millón de tokens)";
  const PRICE_OUT = "Salida (USD por millón de tokens)";

  it("choosing a model shows its two price fields", () => {
    const none = render();
    expect(none).not.toContain(PRICE_IN);
    expect(none).not.toContain(PRICE_OUT);
    expect(priceRows(none)).toHaveLength(0);

    const html = render({
      settings: {
        agentModels: { copy: { provider: "claude", model: "sonnet" } },
        modelPrices: { "claude:sonnet": { input: 3, output: 15 } },
      },
    });
    const rows = priceRows(html);
    expect(rows.map((r) => r.id)).toEqual(["claude:sonnet"]);
    expect(count(html, PRICE_IN)).toBe(1);
    expect(count(html, PRICE_OUT)).toBe(1);
    // The saved price comes in as the initial value, without extra zeros.
    expect(rows[0].html).toMatch(/<input[^>]*aria-invalid="false"[^>]*value="3"/);
    expect(rows[0].html).toMatch(/<input[^>]*aria-invalid="false"[^>]*value="15"/);
    expect(rows[0].html).toContain("claude:sonnet");
    expect(rows[0].html).toContain("Redacción");
    expect(rows[0].html).not.toContain("fieldError");
  });

  it("an untouched new price row shows both fields empty and no error text, so the layout does not jump while the owner types the model", () => {
    const html = render({ settings: { agentModels: { review: { provider: "gemini", model: "gemini-2.5-pro" } } } });
    const [row] = priceRows(html);
    expect(row.id).toBe("gemini:gemini-2.5-pro");
    expect([...row.html.matchAll(/<input[^>]*aria-invalid="false"[^>]*value=""/g)]).toHaveLength(2);
    expect(row.html).not.toContain("fieldError");
    expect(row.html).not.toContain("Escribe el precio");
    expect(row.html).not.toContain('aria-invalid="true"');
    expect(row.html).not.toContain("aria-describedby");
    // A saved pair that does not read (a zero) is just as quiet until the owner touches it.
    const half = priceRows(
      render({
        settings: { agentModels: { review: { provider: "gemini", model: "x" } }, modelPrices: { "gemini:x": { input: 0.15, output: 0 } } },
      }),
    )[0];
    expect(half.html).not.toContain("fieldError");
    expect(half.html).not.toContain('aria-invalid="true"');
  });

  it("after a Save attempt every price that does not read shows how to fill it", () => {
    const html = render({ settings: { agentModels: { review: { provider: "gemini", model: "gemini-2.5-pro" } } } }, { reveal: true });
    const [row] = priceRows(html);
    expect([...row.html.matchAll(/<input[^>]*aria-invalid="true"[^>]*value=""/g)]).toHaveLength(2);
    expect(count(row.html, 'class="fieldError"')).toBe(2);
    expect(row.html).toContain("Escribe el precio en dólares entre $0.0001 y $1000, por ejemplo 0.15 o 3.");
    expect(row.html).toContain("Escribe el precio en dólares entre $0.0001 y $2000, por ejemplo 0.15 o 3.");
    // Only the side that does not read is marked.
    const half = priceRows(
      render(
        { settings: { agentModels: { review: { provider: "gemini", model: "x" } }, modelPrices: { "gemini:x": { input: 0.15, output: 0 } } } },
        { reveal: true },
      ),
    )[0];
    expect(half.html).toMatch(/aria-invalid="false"[^>]*value="0\.15"/);
    expect(half.html).toMatch(/aria-invalid="true"[^>]*value="0"/);
    expect(count(half.html, 'class="fieldError"')).toBe(1);
    // A pair that reads has nothing to reveal.
    const ok = priceRows(
      render({ settings: { agentModels: { copy: { provider: "claude", model: "sonnet" } }, modelPrices: { "claude:sonnet": { input: 3, output: 15 } } } }, { reveal: true }),
    )[0];
    expect(ok.html).not.toContain("fieldError");
  });

  it("each pair of prices is a group named after its model, so the two fields are announced with the model", () => {
    const html = render({
      settings: {
        agentModels: { copy: { provider: "claude", model: "sonnet" }, review: { provider: "openai", model: "gpt-5-mini" } },
        modelPrices: { "claude:sonnet": { input: 3, output: 15 }, "openai:gpt-5-mini": { input: 0.25, output: 2 } },
      },
    });
    const rows = priceRows(html);
    expect(rows).toHaveLength(2);
    const ids = new Set<string>();
    for (const row of rows) {
      const group = /<div class="priceFields" role="group" aria-labelledby="([^"]+)"/.exec(row.html);
      expect(group, row.id).not.toBeNull();
      const name = new RegExp(`<strong id="${group![1]}"[^>]*>${row.id}</strong>`).exec(row.html);
      expect(name, row.id).not.toBeNull();
      // Both inputs are inside the group.
      expect(row.html.slice(row.html.indexOf("role=\"group\""))).toContain("Entrada (USD por millón de tokens)");
      expect(row.html.slice(row.html.indexOf("role=\"group\""))).toContain("Salida (USD por millón de tokens)");
      ids.add(group![1]);
    }
    // Each group points at its own name.
    expect(ids.size).toBe(2);
  });

  it("both price inputs say they are required", () => {
    const html = render({ settings: { agentModels: { copy: { provider: "claude", model: "sonnet" } } } });
    const [row] = priceRows(html);
    const inputs = [...row.html.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(input).toContain('aria-required="true"');
  });

  it("two agents on the same model share one pair of fields; different models get one each", () => {
    const same = priceRows(
      render({
        settings: {
          agentModels: { copy: { provider: "claude", model: "sonnet" }, review: { provider: "claude", model: "sonnet" } },
          modelPrices: { "claude:sonnet": { input: 3, output: 15 } },
        },
      }),
    );
    expect(same).toHaveLength(1);
    expect(same[0].html).toContain("Redacción");
    expect(same[0].html).toContain("Revisión editorial");

    const different = priceRows(
      render({
        settings: {
          agentModels: { copy: { provider: "claude", model: "sonnet" }, review: { provider: "openai", model: "gpt-5-mini" }, director: { provider: "claude", model: "sonnet" } },
          modelPrices: { "claude:sonnet": { input: 3, output: 15 }, "openai:gpt-5-mini": { input: 0.25, output: 2 } },
        },
      }),
    );
    // In the order of the first agent that uses each.
    expect(different.map((r) => r.id)).toEqual(["claude:sonnet", "openai:gpt-5-mini"]);
  });

  it("a model of the list gets no price row, next to one that needs it", () => {
    const html = render({
      settings: {
        agentModels: { director: { provider: "openai", model: "gpt-4.1-mini" }, copy: { provider: "claude", model: "sonnet" } },
      },
    });
    expect(priceRows(html).map((r) => r.id)).toEqual(["claude:sonnet"]);
    expect(priceRows(html)[0].html).toContain("Redacción");
    expect(priceRows(html)[0].html).not.toContain("Director");
  });

  it("a price kept for a model nobody uses is not shown", () => {
    expect(priceRows(render({ settings: { modelPrices: { "claude:old": { input: 1, output: 2 } } } }))).toHaveLength(0);
    // A model chosen for an agent that makes no AI call needs no price either.
    expect(priceRows(render({ settings: { agentModels: { design: { provider: "claude", model: "x" } } } }))).toHaveLength(0);
  });

  it("shows the price fields in English too", () => {
    const html = render(
      { settings: { agentModels: { copy: { provider: "claude", model: "sonnet" } }, modelPrices: { "claude:sonnet": { input: 3, output: 15 } } } },
      { lang: "en" },
    );
    expect(html).toContain("Input (USD per million tokens)");
    expect(html).toContain("Output (USD per million tokens)");
    expect(html).not.toContain("Entrada (USD");
  });
});

describe("Modo equipo: el aviso del llamado de cada minuto", () => {
  it("the tick warning shows only with teamMode on and a stale tick", () => {
    for (const tickAt of [null, before(11)]) {
      expect(render({ server: { tickAt } })).toContain(TICK_WARNING);
      // Off, there is nothing to warn about: the team is not running anyway.
      expect(render({ settings: { teamMode: false }, server: { tickAt } })).not.toContain("El llamado de cada minuto");
    }
    expect(render({ server: { tickAt: before(2) } })).not.toContain("El llamado de cada minuto");
    expect(render({ settings: { teamMode: false }, server: { tickAt: before(2) } })).not.toContain("El llamado de cada minuto");
  });

  it("follows the switch as it is in the form, before saving", () => {
    // The owner turns it on and has not saved yet: the server still has it off, and the warning is already there.
    const { value, data } = fixture({ settings: { teamMode: true }, server: { tickAt: null } });
    const server = { ...data, settings: { ...data.settings!, teamMode: false } };
    const html = renderToStaticMarkup(<TeamSettings value={value} set={() => {}} data={server} busy={false} act={async () => true} onInvalid={() => {}} />);
    expect(html).toContain(TICK_WARNING);
  });

  it("warns only past 10 minutes of the server's clocks, and also for a tick it cannot read", () => {
    expect(render({ server: { tickAt: before(10) } })).not.toContain("El llamado de cada minuto");
    expect(render({ server: { tickAt: new Date(Date.parse(CAPTURED) - 10 * MIN - 1000).toISOString() } })).toContain("El llamado de cada minuto");
    expect(render({ server: { tickAt: "no es una fecha" } })).toContain("El llamado de cada minuto");
    expect(render({ server: { tickAt: before(-1) } })).not.toContain("El llamado de cada minuto");
  });

  describe("with a wrong clock on the owner's device", () => {
    afterEach(() => vi.useRealTimers());

    it("neither hides a stale tick nor fakes a warning for a fresh one", () => {
      for (const wrongNow of ["2020-01-01T00:00:00.000Z", "2031-06-01T00:00:00.000Z"]) {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(wrongNow));
        expect(render({ server: { tickAt: before(11) } })).toContain("El llamado de cada minuto");
        expect(render({ server: { tickAt: before(2) } })).not.toContain("El llamado de cada minuto");
        vi.useRealTimers();
      }
    });
  });

  it("is the same rule the Hoy tab uses", () => {
    expect(isTickStale(CAPTURED, null)).toBe(true);
    expect(isTickStale(CAPTURED, undefined)).toBe(true);
    expect(isTickStale(CAPTURED, "nope")).toBe(true);
    expect(isTickStale(CAPTURED, before(11))).toBe(true);
    expect(isTickStale(CAPTURED, before(10))).toBe(false);
    expect(isTickStale(CAPTURED, before(0))).toBe(false);
    expect(isTickStale("no es una fecha", before(1))).toBe(true);
  });
});

describe("Modo equipo: «Pausar todo»", () => {
  const PAUSED_AT = "2026-10-16T18:30:00.000Z";

  it("not paused: Pausar todo, a button that does not submit the form, and no Reanudar", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Pausar todo<\/button>/);
    expect(html).not.toContain("Reanudar");
    expect(html).not.toContain("En pausa desde");
  });

  it("paused: 'En pausa desde' and Reanudar instead of Pausar todo", () => {
    const html = render({ server: { pausedAt: PAUSED_AT } });
    expect(html).toContain("En pausa desde");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Reanudar<\/button>/);
    expect(html).not.toContain("Pausar todo");
  });

  it("tells the hour of the pause in the business's time zone", () => {
    // 18:30 UTC: 2:30 p.m. en Miami, 12:30 p.m. en Managua.
    expect(render({ server: { pausedAt: PAUSED_AT } })).toContain("2:30");
    expect(render({ server: { pausedAt: PAUSED_AT }, tz: "America/Managua" })).toContain("12:30");
  });

  it("every button of the section is type=button, so none of them saves", () => {
    for (const over of [{}, { server: { pausedAt: PAUSED_AT } }]) {
      const buttons = [...render(over).matchAll(/<button[^>]*>/g)].map((m) => m[0]);
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) expect(button).toContain('type="button"');
    }
  });

  it("disables the buttons while a request is in flight", () => {
    for (const over of [{}, { server: { pausedAt: PAUSED_AT } }]) {
      const buttons = [...render(over, { busy: true }).matchAll(/<button[^>]*>/g)].map((m) => m[0]);
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every((b) => b.includes('disabled=""'))).toBe(true);
    }
  });

  it("is on its own, outside the fields that are saved", () => {
    const html = render();
    const at = html.indexOf('class="pauseBlock"');
    expect(at).toBeGreaterThan(0);
    // The block closes the section: nothing after it is a field, and the button is nowhere before it.
    const block = html.slice(at, html.indexOf("</section>", at));
    expect(block).toContain("Pausar todo");
    expect(block).not.toMatch(/<(input|select|textarea)/);
    expect(html.slice(0, at)).not.toContain("Pausar todo");
  });

  it("shows the pause in English too", () => {
    expect(render({}, { lang: "en" })).toContain("Pause everything");
    const paused = render({ server: { pausedAt: PAUSED_AT } }, { lang: "en" });
    expect(paused).toContain("Paused since");
    expect(paused).toContain("Resume");
    expect(paused).not.toContain("Pause everything");
  });

  it("shows no error line until a pause or a resume fails", () => {
    expect(render()).not.toContain("role=\"alert\"");
    expect(render({ server: { pausedAt: PAUSED_AT } })).not.toContain("role=\"alert\"");
  });
});

describe("Modo equipo: pausar sin que el error se pierda", () => {
  const pause = (props: Partial<Parameters<typeof PauseBlock>[0]> = {}, lang: "es" | "en" = "es") =>
    renderToStaticMarkup(
      <I18nProvider lang={lang}>
        <PauseBlock paused={false} since="" busy={false} pending={null} failed={null} onPause={() => {}} onResume={() => {}} {...props} />
      </I18nProvider>,
    );
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*>[^<]*<\/button>/g)].map((m) => m[0]);

  it("a failed pause shows its own line inside the block, as an alert, next to the button", () => {
    const html = pause({ failed: "pause" });
    expect(html).toMatch(/<p[^>]*role="alert"[^>]*>No se pudo pausar\. Intenta de nuevo\.<\/p>/);
    // The line is inside the block that holds the button.
    const block = html.slice(html.indexOf('class="pauseBlock"'));
    expect(block).toContain("No se pudo pausar. Intenta de nuevo.");
    expect(html).toContain("Pausar todo");
    expect(html).not.toContain("No se pudo reanudar");
  });

  it("a failed resume shows its own line, and a failure of the other kind is not shown", () => {
    const html = pause({ paused: true, since: "16 oct 2026, 2:30 p. m.", failed: "resume" });
    expect(html).toMatch(/<p[^>]*role="alert"[^>]*>No se pudo reanudar\. Intenta de nuevo\.<\/p>/);
    expect(html).toContain("Reanudar");
    expect(html).not.toContain("No se pudo pausar");
    // It is already paused (the pause went through meanwhile): the old pause failure would only confuse.
    expect(pause({ paused: true, since: "x", failed: "pause" })).not.toContain("role=\"alert\"");
    expect(pause({ paused: false, failed: "resume" })).not.toContain("role=\"alert\"");
  });

  it("while the request runs the button says so and is disabled", () => {
    const pausing = buttons(pause({ pending: "pause" }));
    expect(pausing).toHaveLength(1);
    expect(pausing[0]).toContain("Pausando…");
    expect(pausing[0]).toContain('disabled=""');
    expect(pausing[0]).toContain('type="button"');
    const resuming = buttons(pause({ paused: true, since: "x", pending: "resume" }));
    expect(resuming[0]).toContain("Reanudando…");
    expect(resuming[0]).toContain('disabled=""');
    // Idle: the plain names, enabled.
    expect(buttons(pause())[0]).not.toContain("disabled");
    expect(buttons(pause())[0]).toContain(">Pausar todo<");
    expect(buttons(pause({ paused: true, since: "x" }))[0]).toContain(">Reanudar<");
    // Busy with something else: disabled, but still its own name.
    expect(buttons(pause({ busy: true }))[0]).toContain('disabled=""');
    expect(buttons(pause({ busy: true }))[0]).toContain(">Pausar todo<");
  });

  it("says all of it in English too", () => {
    expect(pause({ failed: "pause" }, "en")).toContain("Could not pause. Try again.");
    expect(pause({ paused: true, since: "x", failed: "resume" }, "en")).toContain("Could not resume. Try again.");
    expect(buttons(pause({ pending: "pause" }, "en"))[0]).toContain("Pausing…");
    expect(buttons(pause({ paused: true, since: "x", pending: "resume" }, "en"))[0]).toContain("Resuming…");
  });

  describe("pauseAll and resumeAll", () => {
    it("pauseAll sends nothing when the owner does not confirm", async () => {
      const act = vi.fn(async () => true);
      const confirm = vi.fn(() => false);
      expect(await pauseAll(act, confirm)).toBe("cancelled");
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(act).not.toHaveBeenCalled();
    });

    it("pauseAll sends pause_all once the owner confirms: ok when it went through, failed when it did not", async () => {
      const ok = vi.fn(async () => true);
      expect(await pauseAll(ok, () => true)).toBe("ok");
      expect(ok).toHaveBeenCalledTimes(1);
      expect(ok).toHaveBeenCalledWith({ action: "pause_all" });
      const no = vi.fn(async () => false);
      expect(await pauseAll(no, () => true)).toBe("failed");
      expect(no).toHaveBeenCalledWith({ action: "pause_all" });
    });

    it("resumeAll asks nothing and sends resume_all", async () => {
      const ok = vi.fn(async () => true);
      expect(await resumeAll(ok)).toBe("ok");
      expect(ok).toHaveBeenCalledWith({ action: "resume_all" });
      expect(await resumeAll(async () => false)).toBe("failed");
    });

    it("a request that throws is a failure, not an unhandled rejection", async () => {
      const boom = async () => {
        throw new Error("sin red");
      };
      expect(await pauseAll(boom, () => true)).toBe("failed");
      expect(await resumeAll(boom)).toBe("failed");
    });
  });
});

describe("Modo equipo en inglés", () => {
  it("shows every fixed text in English when the app is in English", () => {
    const html = render({ server: { tickAt: null } }, { lang: "en" });
    for (const text of [
      "Team mode",
      "The Director builds a plan every morning and hands the pieces out to the agents.",
      "The every-minute call is not active. Without it no step moves forward and the morning plan does not arrive.",
      "Morning plan time",
      "7:00 AM",
      "Publish on social media",
      "Publish articles on the website",
      "Default model",
      "after you save",
      "Ready",
      "Pause everything",
    ])
      expect(html, text).toContain(text);
    for (const text of ["Modo equipo", "Hora del plan", "Publicar en redes", "Modelo por defecto", "después de guardar", "Listo", "llamado de cada minuto"])
      expect(html, text).not.toContain(text);
  });
});

describe("Centro MATYA: la configuración", () => {
  const form = (over: Over = {}, props: { busy?: boolean } = {}) => {
    const { data } = fixture(over);
    return renderToStaticMarkup(
      <AgentSettings data={data} busy={props.busy ?? false} save={async () => true} act={async () => true} saveError="" saveNotice="" />,
    );
  };

  it("puts the Modo equipo section after the switches of today and before the sources, inside the form", () => {
    for (const teamMode of [true, false]) {
      const html = form({ settings: { teamMode } });
      const at = ["Activar radar periódico", "Modo equipo</h2>", "Pausar todo", "Fuentes de la industria"].map((text) => html.indexOf(text));
      expect(at.every((i) => i >= 0), String(at)).toBe(true);
      expect(at).toEqual([...at].sort((a, b) => a - b));
      // The pause button is inside the form but does not submit it.
      expect(html.indexOf("<form")).toBeLessThan(html.indexOf("Pausar todo"));
      expect(html.indexOf("Pausar todo")).toBeLessThan(html.indexOf("</form>"));
    }
  });

  it("keeps a single Guardar button, and it is the one that submits", () => {
    const html = form();
    const submits = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).filter((b) => b.includes('type="submit"'));
    expect(submits).toHaveLength(1);
  });
});

describe("Guardar muestra lo que lo bloquea", () => {
  const button = (props: { busy?: boolean; blocked?: boolean }, lang: "es" | "en" = "es") =>
    renderToStaticMarkup(
      <I18nProvider lang={lang}>
        <SaveButton busy={props.busy ?? false} blocked={props.blocked ?? false} />
      </I18nProvider>,
    );
  // A real `disabled` attribute, not the one inside `aria-disabled`.
  const disabled = (html: string) => /\sdisabled=""/.test(html);

  it("with a field to fix, Save is aria-disabled but not disabled, so a click or Enter still reaches the form", () => {
    const html = button({ blocked: true });
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-disabled="true"');
    expect(disabled(html)).toBe(false);
    expect(html).toContain("Guardar configuración");
  });

  it("while a request runs it is really disabled, and says it is saving", () => {
    for (const blocked of [false, true]) {
      const html = button({ busy: true, blocked });
      expect(disabled(html)).toBe(true);
      expect(html).toContain("Guardando…");
      expect(html).toContain('type="submit"');
    }
  });

  it("with nothing to fix it is a plain, enabled submit button", () => {
    const html = button({});
    expect(html).toContain('type="submit"');
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("aria-disabled");
  });

  it("says it in English too", () => {
    expect(button({ blocked: true }, "en")).toContain("Save settings");
    expect(button({ busy: true }, "en")).toContain("Saving…");
  });

  it("the form starts with its Save button enabled", () => {
    const { data } = fixture();
    const html = renderToStaticMarkup(<AgentSettings data={data} busy={false} save={async () => true} act={async () => true} saveError="" saveNotice="" />);
    const save = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).filter((b) => b.includes('type="submit"'));
    expect(save).toHaveLength(1);
    expect(save[0]).not.toContain("disabled");
  });

  describe("what the form does when the owner submits (click or Enter)", () => {
    const sent = (extra: Partial<Parameters<typeof submitSettings>[1]> = {}) => {
      const event = { preventDefault: vi.fn() };
      const save = vi.fn(async () => true);
      const reveal = vi.fn();
      const value: Settings = {
        ...DEFAULT_SETTINGS,
        agentModels: { copy: { provider: "claude", model: "sonnet" } },
        modelPrices: { "claude:sonnet": { input: 3, output: 15 }, "claude:old": { input: 1, output: 2 } },
      };
      const ctx = { invalid: [] as string[], busy: false, value, save, reveal, ...extra };
      return { event, save, reveal, value, run: () => submitSettings(event, ctx) };
    };

    it("never calls save while a field is marked, and reveals every error instead", async () => {
      const call = sent({ invalid: ["price:claude:sonnet:output"] });
      await call.run();
      expect(call.event.preventDefault).toHaveBeenCalledTimes(1);
      expect(call.save).not.toHaveBeenCalled();
      expect(call.reveal).toHaveBeenCalledTimes(1);
    });

    it("saves what is in the form, without the prices of models nobody uses", async () => {
      const call = sent();
      await call.run();
      expect(call.event.preventDefault).toHaveBeenCalledTimes(1);
      expect(call.reveal).not.toHaveBeenCalled();
      expect(call.save).toHaveBeenCalledTimes(1);
      expect(call.save).toHaveBeenCalledWith({ ...call.value, modelPrices: { "claude:sonnet": { input: 3, output: 15 } } });
    });

    it("keeps the price of the default model the agents without a model of their own use", async () => {
      const call = sent({ defaults: ["claude:old"] });
      await call.run();
      expect(call.save).toHaveBeenCalledWith({ ...call.value, modelPrices: call.value.modelPrices });
    });

    it("does nothing while a request is running", async () => {
      for (const invalid of [[], ["radarHours"]]) {
        const call = sent({ busy: true, invalid });
        await call.run();
        expect(call.event.preventDefault).toHaveBeenCalledTimes(1);
        expect(call.save).not.toHaveBeenCalled();
        expect(call.reveal).not.toHaveBeenCalled();
      }
    });
  });

  describe("focus on the first field to fix", () => {
    it("looks for the first marked field in the form and focuses it", () => {
      const focus = vi.fn();
      const querySelector = vi.fn(() => ({ focus }));
      focusFirstInvalid({ querySelector });
      expect(querySelector).toHaveBeenCalledWith('[aria-invalid="true"]');
      expect(focus).toHaveBeenCalledTimes(1);
    });

    it("does nothing when there is no form yet or nothing is marked", () => {
      expect(() => focusFirstInvalid(null)).not.toThrow();
      expect(() => focusFirstInvalid({ querySelector: () => null })).not.toThrow();
    });
  });
});

describe("la configuración sigue en su lugar cuando se pausa", () => {
  it("«Pausar todo» moves the revision, but the form keeps what the owner typed", () => {
    const start = { key: 4, revision: 4, paused: false };
    // The pause: the revision moves and the pause time appears.
    const paused = nextFormKey(start, 5, true);
    expect(paused).toEqual({ key: 4, revision: 5, paused: true });
    // Nothing moved (a polling refresh): the same object, so nothing re-renders.
    expect(nextFormKey(paused, 5, true)).toBe(paused);
    // Reanudar does not move the revision, and the form stays.
    expect(nextFormKey(paused, 5, false)).toEqual({ key: 4, revision: 5, paused: false });
  });

  it("a save, or a change that is not a pause, does start the form over from the saved settings", () => {
    const start = { key: 4, revision: 4, paused: false };
    expect(nextFormKey(start, 5, false)).toEqual({ key: 5, revision: 5, paused: false });
    // Saved while paused: the new revision is the form's new start.
    expect(nextFormKey({ key: 4, revision: 5, paused: true }, 6, true)).toEqual({ key: 6, revision: 6, paused: true });
  });
});

describe("las IA del equipo", () => {
  it("are the agents that make AI calls, with the names the server gives them", async () => {
    const { AGENTS: REGISTRY } = await import("@/lib/agent/agents");
    const usesModel = Object.values(REGISTRY)
      .filter((a) => a.usesModel)
      .map((a) => a.key);
    expect(AI_AGENTS.map((a) => a.key).sort()).toEqual([...usesModel].sort());
    for (const a of AI_AGENTS) expect(REGISTRY[a.key].label).toEqual({ es: a.es, en: a.en });
  });
});

describe("TeamSettings in the Team.module.css", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const TEAM = read("src/components/agent/Team.module.css");
  const CENTER = read("src/components/agent/AgentCenter.module.css");
  const section = TEAM.slice(TEAM.indexOf("/* Configuración del modo equipo"));

  it("styles the section with the theme tokens only, so the night theme needs no colours of its own", () => {
    expect(section.length).toBeGreaterThan(0);
    expect(section).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(section).not.toMatch(/\b(rgb|hsl)a?\(/i);
  });

  it("lets long model ids wrap and stacks the fields on phones", () => {
    // The rule whose selector list names the class.
    const rule = (name: string) => [...section.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1].split(",").some((sel) => sel.trim() === name))?.[2] ?? "";
    for (const name of [".aiRow", ".priceRow", ".pauseBlock", ".pauseText", ".aiFields", ".priceFields"]) expect(rule(name), name).toContain("min-width: 0");
    expect(section).toContain("overflow-wrap: anywhere");
    // The grids give the fields a minimum that never exceeds the width of the column.
    for (const grid of section.matchAll(/grid-template-columns:\s*repeat\([^;]*\)/g)) expect(grid[0]).toContain("min(100%");
  });

  const GLOBALS = read("src/app/globals.css");
  const block = (css: string, head: string) => {
    const at = css.indexOf(head);
    expect(at, head).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };
  const hex = (css: string, name: string) => {
    const found = new RegExp(`(?<![\\w-])${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1];
    expect(found, name).toBeDefined();
    return found!;
  };
  const luminance = (color: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("styles Save with a field to fix as disabled, without any colour of its own and without the hover of an enabled button", () => {
    const rule = (head: string) => {
      const at = CENTER.indexOf(head);
      expect(at, head).toBeGreaterThanOrEqual(0);
      return CENTER.slice(at, CENTER.indexOf("}", at));
    };
    const dim = rule('.settings > button:global(.btn)[aria-disabled="true"] {');
    expect(dim).toContain("opacity: 0.5");
    expect(dim).toContain("cursor: not-allowed");
    const hover = rule('.settings > button:global(.btn):global(.on)[aria-disabled="true"]:hover {');
    expect(hover).toContain("background: var(--primary)");
    expect(hover).toContain("border-color: var(--primary)");
    expect(hover).toContain("color: var(--primary-ink)");
    expect(dim + hover).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("gives the field errors and the marked fields a colour that reads in the night theme, at 4.5:1 for the text and 3:1 for the border", () => {
    const nightError = block(CENTER, ':global([data-theme="noche"]) .fieldError,');
    const nightBorder = block(CENTER, ':global([data-theme="noche"]) .settings input[aria-invalid="true"]');
    const dayError = hex(block(CENTER, ".fieldError {"), "color");
    const dayBorder = hex(block(CENTER, '.settings input[aria-invalid="true"] {'), "border-color");
    const day = block(GLOBALS, ":root {");
    const night = block(GLOBALS, 'html[data-theme="noche"] {');
    const nightColor = hex(nightError, "color");
    const pairs: [string, string, string, number][] = [
      ["day error on the page", dayError, hex(day, "--ground"), 4.5],
      ["day error on a card", dayError, hex(day, "--surface"), 4.5],
      ["night error on the page", nightColor, hex(night, "--ground"), 4.5],
      ["night error on a card", nightColor, hex(night, "--surface"), 4.5],
      ["night error on the column", nightColor, hex(night, "--surface-2"), 4.5],
      ["day border", dayBorder, hex(day, "--field-bg"), 3],
      ["night border", hex(nightBorder, "border-color"), hex(night, "--field-bg"), 3],
    ];
    for (const [name, text, background, least] of pairs) expect(contrast(text, background), `${name}: ${text} on ${background}`).toBeGreaterThanOrEqual(least);
  });
});
