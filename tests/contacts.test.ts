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
