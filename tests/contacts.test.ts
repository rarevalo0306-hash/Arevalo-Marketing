import { describe, expect, it } from "vitest";
import { normalizePhone, parseContactsCsv } from "@/lib/contacts";

const consent = { emailOptIn: true, smsOptIn: false };

describe("importar contactos", () => {
  it("lee encabezados en español", () => {
    const rows = parseContactsCsv("nombre,email,telefono\nAna López,ana@correo.com,(555) 123-4567", consent);
    expect(rows).toEqual([{ name: "Ana López", email: "ana@correo.com", phone: "+15551234567", emailOptIn: true, smsOptIn: false }]);
  });
  it("detecta columnas sin encabezados y pegado desde Excel (tabs)", () => {
    const rows = parseContactsCsv("Luis\t+52 55 1234 5678\tluis@x.com", consent);
    expect(rows[0]).toMatchObject({ name: "Luis", email: "luis@x.com", phone: "+525512345678" });
  });
  it("respeta comillas y descarta filas sin email ni teléfono", () => {
    const rows = parseContactsCsv('name,email\n"Pérez, Juan",juan@x.com\nSolo nombre,', consent);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Pérez, Juan");
  });
  it("normaliza teléfonos de EE. UU.", () => {
    expect(normalizePhone("555-123-4567")).toBe("+15551234567");
    expect(normalizePhone("1 555 123 4567")).toBe("+15551234567");
    expect(normalizePhone("")).toBe("");
  });
});

describe("listas de contactos", () => {
  it("limpia, quita repetidas y reconoce las listas de fábrica por su nombre", async () => {
    const { cleanLists } = await import("@/lib/contacts");
    expect(cleanLists(["client", " Clientes actuales ", "", "Constructoras", "constructoras", "Past clients"])).toEqual(["client", "Constructoras", "past-client"]);
  });
  it("junta las listas de fábrica y las propias", async () => {
    const { allLists, listLabel } = await import("@/lib/contacts");
    expect(allLists([{ lists: ["Zeta", "lead"] }, { lists: ["Alfa"] }])).toEqual(["lead", "prospect", "client", "past-client", "Alfa", "Zeta"]);
    expect(listLabel("past-client", "en")).toBe("Past clients");
    expect(listLabel("Alfa")).toBe("Alfa");
  });
});

describe("importar sin encabezados", () => {
  it("no confunde la primera persona con un encabezado aunque su email diga correo o gmail", () => {
    const rows = parseContactsCsv("Ana López,ana@correo.com\nPedro,pedro@gmail.com", consent);
    expect(rows.map((r) => r.name)).toEqual(["Ana López", "Pedro"]);
  });
});
