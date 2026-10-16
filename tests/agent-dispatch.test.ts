// El texto que lee el dueño cuando termina el paso `dispatch` (la parte que no toca la base de datos).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { dispatchText } from "@/lib/agent/dispatch";
import type { Piece } from "@/lib/agent/plan";

const piece = (id: string, topic: string, format: Piece["format"] = "post"): Piece => ({
  id,
  topic,
  objective: "",
  channels: ["facebook"],
  format,
  keyword: "",
});
const room = { remainingPosts: 3, channels: ["facebook"] };

describe("dispatchText", () => {
  it("dice cuántas piezas creó, con su tema y su formato, y cuántas descartó y por qué", () => {
    const text = dispatchText(
      [piece("p1", "Goteras en el techo"), piece("p2", "Qué cubre tu póliza", "video")],
      [
        { id: "p3", reason: "sin cupo" },
        { id: "p4", reason: "sin cupo" },
        { id: "p5", reason: "repetido" },
      ],
      room,
      "es",
    );
    expect(text).toBe(
      "Creé 2 piezas: «Goteras en el techo» (publicación), «Qué cubre tu póliza» (video). " +
        "Descarté 3 propuestas: 2 por falta de cupo de publicaciones, 1 por un tema repetido.",
    );
  });

  it("una sola pieza y una sola descartada van en singular", () => {
    expect(
      dispatchText([piece("p1", "Un artículo", "articulo")], [{ id: "p2", reason: "fecha pasada" }], room, "es"),
    ).toBe(
      "Creé 1 pieza: «Un artículo» (artículo). Descarté 1 propuesta: 1 por una fecha que ya pasó.",
    );
  });

  it("sin descartes no menciona descartes", () => {
    expect(dispatchText([piece("p1", "Tema", "carrusel")], [], room, "es")).toBe(
      "Creé 1 pieza: «Tema» (carrusel).",
    );
  });

  it("en inglés usa las mismas palabras llanas", () => {
    expect(
      dispatchText(
        [piece("p1", "Roof leaks", "carrusel")],
        [
          { id: "p2", reason: "sin canal" },
          { id: "p3", reason: "no permitido" },
          { id: "p4", reason: "formato" },
        ],
        room,
        "en",
      ),
    ).toBe(
      "I created 1 piece: «Roof leaks» (carousel). I dropped 3 proposals: 1 for having no connected, allowed channel, " +
        "1 for a kind of content that is not allowed, 1 for an invalid format.",
    );
  });

  it("sin piezas válidas explica por qué se descartó todo", () => {
    expect(
      dispatchText(
        [],
        [
          { id: "p1", reason: "sin canal" },
          { id: "p2", reason: "sin canal" },
          { id: "?", reason: "formato" },
        ],
        room,
        "es",
      ),
    ).toBe(
      "No creé piezas nuevas. Descarté 3 propuestas: 2 por no tener un canal conectado y permitido, 1 por formato no válido.",
    );
  });

  it("un motivo desconocido sale tal cual, sin romper el texto", () => {
    expect(dispatchText([], [{ id: "p1", reason: "otro" }], room, "es")).toContain("1 otro");
  });

  it("sin propuestas dice si faltó cupo, canal o ideas", () => {
    expect(dispatchText([], [], { remainingPosts: 0, channels: ["facebook"] }, "es")).toContain("no hay cupo");
    expect(dispatchText([], [], { remainingPosts: 0, channels: [] }, "es")).toContain("no hay cupo");
    expect(dispatchText([], [], { remainingPosts: 2, channels: [] }, "es")).toContain("canal");
    expect(dispatchText([], [], room, "es")).toBe("La estrategia no propuso piezas nuevas.");
    expect(dispatchText([], [], room, "en")).toBe("The strategy proposed no new pieces.");
    expect(dispatchText([], [], { remainingPosts: 0, channels: [] }, "en")).toContain("no room");
  });

  it("un encargo cancelado lo dice y no habla de piezas", () => {
    expect(dispatchText([], [{ id: "p1", reason: "sin cupo" }], room, "es", true)).toBe(
      "El encargo se canceló: no creé piezas.",
    );
    expect(dispatchText([], [], room, "en", true)).toBe("The job was cancelled: I created no pieces.");
  });
});
