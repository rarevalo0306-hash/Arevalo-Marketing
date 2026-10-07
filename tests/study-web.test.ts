import { describe, expect, it } from "vitest";
import {
  audiencesByPriority,
  customersText,
  EMPTY_INPUT,
  idealCustomersOf,
  inputFromWebProfile,
  jsonSafe,
  readDeleted,
  readInput,
  readStudy,
  type Study,
  type WebProfile,
} from "@/lib/study-shape";
import { pageHint, pickPages } from "@/lib/study-web";

const study: Study = {
  summary: "Ajustadores públicos en Miami.",
  suggestedProfile: "Somos ajustadores públicos.",
  services: [{ name: "Reclamos por huracán", description: "Ayuda con el reclamo." }],
  audiences: [
    { name: "Contratistas", description: "Refieren clientes.", pains: ["x"], channels: "LinkedIn", priority: "baja" },
    { name: "Dueños de casa", description: "Tienen un reclamo.", pains: ["reclamo negado"], channels: "Facebook", priority: "alta" },
  ],
  differentiators: ["Atendemos en español"],
  objections: [],
  market: { area: "Miami-Dade.", places: ["Hialeah"], seasonality: [], competitors: [], opportunities: [] },
  keywords: [],
  ads: { metaAudience: "", googleKeywords: [], negativeKeywords: [], budgetTip: "" },
  pillars: [],
  campaigns: [],
  visualStyle: "",
  avoid: [],
  caveats: "",
};

const web: WebProfile = {
  found: true,
  services: "Ajustadores públicos con licencia en Florida.",
  zone: "Miami-Dade, Broward y Palm Beach",
  customers: [
    { name: "Administradoras de propiedades", why: "Manejan muchos edificios", priority: "media" },
    { name: "Dueños de casa", why: "Tienen reclamos de seguro", priority: "alta" },
    { name: "Dueños de negocios", why: "Daños en locales", priority: "alta" },
    { name: "Contratistas", why: "Refieren clientes", priority: "baja" },
    { name: "dueños de casa", why: "repetido", priority: "baja" },
  ],
  lang: "both",
  goal: "citas",
  different: "Licencia W319359",
  profile: "Perfil",
};

describe("clientes ideales", () => {
  it("los estudios viejos con un solo texto se vuelven una lista en orden", () => {
    const list = idealCustomersOf({ customers: "Dueños de casa, negocios y administradoras de propiedades" });
    expect(list.map((c) => c.name)).toEqual(["Dueños de casa", "negocios", "administradoras de propiedades"]);
    expect(list.map((c) => c.priority)).toEqual([1, 2, 3]);
  });
  it("respeta el orden elegido por el dueño", () => {
    const list = idealCustomersOf({ customers: "", idealCustomers: [{ name: "B", why: "", priority: 2 }, { name: "A", why: "", priority: 1 }] });
    expect(list.map((c) => c.name)).toEqual(["A", "B"]);
    expect(customersText({ customers: "", idealCustomers: list })).toContain("1. A (alta priority)");
  });
  it("las respuestas viejas se siguen leyendo sin la lista", () => {
    const old = { services: "Cortinas", customers: "Dueños de casa", zone: "Managua", competitors: "", different: "", goal: "llamadas", lang: "es" };
    expect(readInput(old)?.idealCustomers).toEqual([]);
  });
});

describe("información de la web", () => {
  it("llena el paso 1: los más importantes elegidos y el resto como opciones, sin repetidos", () => {
    const input = inputFromWebProfile(web, EMPTY_INPUT);
    expect(input.zone).toBe("Miami-Dade, Broward y Palm Beach");
    expect(input.lang).toBe("both");
    expect(input.idealCustomers.map((c) => c.name)).toEqual(["Dueños de casa", "Dueños de negocios", "Administradoras de propiedades"]);
    expect(input.customerOptions.map((c) => c.name)).toEqual(["Contratistas"]);
    expect(input.customers).toBe("Dueños de casa, Dueños de negocios, Administradoras de propiedades");
  });
  it("no cambia los clientes que el dueño ya eligió ni lo que ya escribió como diferencia", () => {
    const prev = { ...EMPTY_INPUT, different: "Mi diferencia", idealCustomers: [{ name: "Condominios", why: "", priority: 1 }] };
    const input = inputFromWebProfile(web, prev);
    expect(input.idealCustomers.map((c) => c.name)).toEqual(["Condominios"]);
    expect(input.customerOptions.length).toBe(4);
    expect(input.different).toBe("Mi diferencia");
  });
  it("si la web no dice la zona, se queda la que había", () => {
    expect(inputFromWebProfile({ ...web, zone: "" }, { ...EMPTY_INPUT, zone: "Miami" }).zone).toBe("Miami");
  });
});

describe("estudio guardado", () => {
  it("ordena los clientes por prioridad", () => {
    expect(audiencesByPriority(study).map((a) => a.name)).toEqual(["Dueños de casa", "Contratistas"]);
  });
  it("lee estudios viejos sin prioridad", () => {
    const old = { ...study, audiences: study.audiences.map(({ priority: _p, ...a }) => a) };
    expect(readStudy(old)?.audiences[0].priority).toBeUndefined();
  });
  it("un estudio borrado no se lee como estudio, pero se puede recuperar", () => {
    const deleted = { deleted: { at: "2026-10-07T04:10:00.000Z", study, studyInput: EMPTY_INPUT, studyAt: "2026-10-06T14:55:00.000Z" } };
    expect(readStudy(deleted)).toBeNull();
    expect(readDeleted(deleted)?.study.summary).toBe(study.summary);
    expect(readDeleted(deleted)?.studyAt).toBe("2026-10-06T14:55:00.000Z");
    expect(readDeleted(study)).toBeNull();
    expect(readDeleted(null)).toBeNull();
  });
  it("quita el carácter nulo que Postgres no acepta", () => {
    expect(jsonSafe({ a: "x\u0000y", b: ["\u0000z"], c: 1 })).toEqual({ a: "xy", b: ["z"], c: 1 });
  });
});

describe("páginas para leer de la web", () => {
  it("prefiere servicios, zonas, nosotros y contacto, y salta el blog y lo legal", () => {
    const links = [
      "https://ricardopa.com/blog/huracanes-2025",
      "https://ricardopa.com/privacy-policy",
      "https://ricardopa.com/contacto",
      "https://ricardopa.com/servicios",
      "https://ricardopa.com/nosotros",
      "https://ricardopa.com/areas-de-servicio",
      "https://ricardopa.com/logo.png",
      "https://ricardopa.com/",
    ];
    expect(pickPages(links, "https://ricardopa.com/", 3)).toEqual(["https://ricardopa.com/areas-de-servicio", "https://ricardopa.com/servicios", "https://ricardopa.com/nosotros"]);
    expect(pickPages(links, "https://ricardopa.com/", 10)).toContain("https://ricardopa.com/contacto");
    expect(pageHint("https://ricardopa.com/blog/huracanes-2025")).toBe(0);
    expect(pageHint("https://ricardopa.com/logo.png")).toBe(0);
  });
});
