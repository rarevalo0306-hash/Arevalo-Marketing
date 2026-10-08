import { describe, expect, it } from "vitest";
import { ownerFields } from "@/lib/owner";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("dueño o representante", () => {
  it("limpia nombre, correo y teléfono", () => {
    expect(ownerFields(form({ ownerName: "  Ricardo   Arévalo ", ownerEmail: " Ricardo@Ejemplo.COM ", ownerPhone: "+1 (305) 555-0100 ext" }))).toEqual({
      ownerName: "Ricardo Arévalo",
      ownerEmail: "ricardo@ejemplo.com",
      ownerPhone: "+1 (305) 555-0100",
    });
  });
  it("vacío está bien; un correo mal escrito no", () => {
    expect(ownerFields(form({}))).toEqual({ ownerName: "", ownerEmail: "", ownerPhone: "" });
    expect(ownerFields(form({ ownerEmail: "ricardo@" })).ownerEmail).toBeNull();
  });
});
