// Campos de números del Centro MATYA (límites en dólares, publicaciones al día, horas): leer lo que escribe el dueño.
import { describe, expect, it } from "vitest";
import { formatUsd, readCount, readUsd } from "@/lib/agent/settings-input";

describe("límites en dólares", () => {
  it("lee dólares con punto, con coma decimal o con el signo", () => {
    expect(readUsd("5")).toBe(500);
    expect(readUsd("1.50")).toBe(150);
    expect(readUsd("2,5")).toBe(250);
    expect(readUsd("0,75")).toBe(75);
    expect(readUsd(" $12.50 ")).toBe(1250);
    expect(readUsd("1,000")).toBe(100000);
    expect(readUsd("0")).toBe(0);
  });
  it("vacío o con letras no es un número (no se convierte en cero)", () => {
    expect(readUsd("")).toBeNull();
    expect(readUsd("  ")).toBeNull();
    expect(readUsd("abc")).toBeNull();
    expect(readUsd("1.234")).toBeNull();
    expect(readUsd("-5")).toBeNull();
  });
  it("se muestra con dos decimales", () => {
    expect(formatUsd(0)).toBe("0.00");
    expect(formatUsd(500)).toBe("5.00");
    expect(formatUsd(150)).toBe("1.50");
    expect(formatUsd(100000)).toBe("1000.00");
  });
});

describe("cantidades enteras", () => {
  it("lee números enteros", () => {
    expect(readCount("4")).toBe(4);
    expect(readCount(" 12 ")).toBe(12);
    expect(readCount("03")).toBe(3);
  });
  it("vacío, decimales o letras no son un número", () => {
    expect(readCount("")).toBeNull();
    expect(readCount("2.5")).toBeNull();
    expect(readCount("tres")).toBeNull();
    expect(readCount("-1")).toBeNull();
  });
});
