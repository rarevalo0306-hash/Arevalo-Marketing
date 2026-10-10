import { describe, expect, it } from "vitest";
import { coveredBy, pickTopic, planKeyword, type TopicCandidate } from "@/lib/seo/topic-pick";

const vocab = ["cortin", "metalic", "enrollabl", "porton", "puert"];

describe("¿ya está cubierto?", () => {
  it("si todas sus palabras están en un artículo o página", () => {
    expect(coveredBy("cortinas metálicas", "Cortinas metálicas enrollables en Managua")).toBe(true);
    expect(coveredBy("mantenimiento de cortinas metálicas", "Cortinas metálicas enrollables")).toBe(false);
    expect(coveredBy("portones automáticos precio", "Precio de portones automáticos en Managua")).toBe(true);
  });
});

describe("elegir el tema", () => {
  const base: TopicCandidate[] = [
    { keyword: "gas cerca de mí", source: "gap", volume: 5400, boost: 2 },
    { keyword: "portones corredizos", source: "gap", volume: 320, boost: 1 },
    { keyword: "portones corredizos", source: "plan", volume: null, boost: 1, note: "Crea una página para «portones corredizos»" },
    { keyword: "¿Cuánto dura una cortina metálica?", source: "question", volume: null },
    { keyword: "cortinas metálicas", source: "keywords", volume: 900 },
    { keyword: "Fameseg puertas", source: "keywords", volume: 50 },
    { keyword: "puertas", source: "study", volume: null },
  ];

  it("gana lo que sale en varias fuentes y tiene búsquedas; se quita lo que no tiene que ver y el nombre del negocio", () => {
    const r = pickTopic(base, { written: [], site: [], vocab, brand: "Fameseg" });
    expect(r?.pick.keyword).toBe("portones corredizos");
    expect(r?.pick.sources.sort()).toEqual(["gap", "plan"]);
    expect(r?.pick.reason.es).toMatch(/320 personas/);
    expect(r?.pick.reason.es).toMatch(/competencia/);
    const all = [r!.pick, ...r!.others].map((p) => p.keyword);
    expect(all).not.toContain("gas cerca de mí");
    expect(all).not.toContain("Fameseg puertas");
    expect(all).not.toContain("puertas");
  });

  it("no repite lo que ya tiene artículo, lo que ya está en la web ni lo que el dueño ya vio", () => {
    const r = pickTopic(base, { written: ["portones corredizos en Managua"], site: ["Cortinas metálicas enrollables | Fameseg"], vocab, brand: "Fameseg" });
    expect(r?.pick.keyword).toBe("Cuánto dura una cortina metálica");
    expect(r?.pick.reason.es).toMatch(/pregunta/);
    const next = pickTopic(base, { written: ["portones corredizos"], site: [], vocab, brand: "Fameseg", skip: ["cortinas metálicas", "Cuánto dura una cortina metálica"] });
    expect(next).toBeNull();
  });

  it("singular y plural son el mismo tema (se juntan y «Otro tema» no lo repite)", () => {
    const list: TopicCandidate[] = [
      { keyword: "portones corredizos", source: "gap", volume: 320 },
      { keyword: "portón corredizo", source: "keywords", volume: 210 },
      { keyword: "cortinas metálicas", source: "keywords", volume: 100 },
    ];
    const r = pickTopic(list, { written: [], site: [], vocab });
    expect(r?.pick.sources.sort()).toEqual(["gap", "keywords"]);
    expect(r?.others.map((o) => o.keyword)).toEqual(["cortinas metálicas"]);
    expect(pickTopic(list, { written: [], site: [], vocab, skip: ["portones corredizos"] })?.pick.keyword).toBe("cortinas metálicas");
  });

  it("sin datos: null", () => {
    expect(pickTopic([], { written: [], site: [], vocab })).toBeNull();
  });
});

describe("tareas del plan", () => {
  it("saca la palabra del enlace al escritor", () => {
    expect(planKeyword("/b/x/seo/escribir?kw=port%C3%B3n%20corredizo")).toBe("portón corredizo");
    expect(planKeyword("/b/x/seo?tab=web")).toBe("");
  });
});
