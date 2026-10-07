import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: Record<string, unknown>[] = [];
const updates: unknown[] = [];
vi.mock("@/lib/db", () => ({
  db: {
    libraryItem: {
      findMany: vi.fn(async () => rows),
      updateMany: vi.fn(async (args: unknown) => {
        updates.push(args);
        return { count: 1 };
      }),
    },
  },
}));

import { cardMatches, fmtDuration, isPromo, MIN_RELEVANCE, qualityWord, rankLibrary, scoreItem, stem, terms, type MatchItem } from "@/lib/library-match";
import { matchesFilter, pickLibraryPhotos } from "@/lib/library";

const now = new Date("2026-10-07T12:00:00Z");

function item(id: string, over: Partial<MatchItem> & { es?: string; en?: string; scene?: string; topics?: string[] } = {}): MatchItem {
  const { es = "", en = "", scene = "done", topics = [], ...rest } = over;
  return {
    id,
    kind: "photo",
    url: `/media/${id}.jpg`,
    status: "ready",
    usable: true,
    quality: 4,
    privacy: [],
    choice: "",
    tags: [],
    folderPath: "",
    description: { es, en, scene, topics },
    width: 1200,
    height: 1200,
    usedCount: 0,
    lastUsedAt: null,
    ...rest,
  };
}

const door = item("door", {
  es: "Cortina metálica enrollable instalada en un local comercial.",
  en: "Metal roll-up door installed on a storefront.",
  topics: ["cortinas metálicas", "instalación"],
  tags: ["cortina", "local comercial"],
});
const motor = item("motor", {
  es: "Motor eléctrico para portón en un taller.",
  en: "Electric motor for a gate in a workshop.",
  scene: "product",
  topics: ["motores", "automatización"],
  tags: ["motor"],
});
const roof = item("roof", {
  es: "Techo dañado por la tormenta.",
  en: "Roof damaged by the storm.",
  scene: "damage",
  topics: ["techo", "daño por tormenta"],
  tags: ["roof", "storm"],
});

describe("palabras", () => {
  it("quita acentos, mayúsculas y plurales", () => {
    expect(stem("Puertas")).toBe(stem("puerta"));
    expect(stem("metálicas")).toBe(stem("metalica"));
    expect(stem("portones")).toBe(stem("portón"));
    expect(stem("houses")).toBe(stem("house"));
    expect(stem("doors")).toBe("door");
    expect(stem("reparaciones")).toBe(stem("reparación"));
  });

  it("deja solo las palabras con sentido", () => {
    expect(terms("La foto de las cortinas en el local, realistic photo with soft light")).toEqual(["cortina", "local"]);
    expect(terms("")).toEqual([]);
  });

  it("sabe cuándo la publicación vende algo", () => {
    expect(isPromo("¡Oferta! 20% de descuento en cortinas")).toBe(true);
    expect(isPromo("Get a free quote today")).toBe(true);
    expect(isPromo("Consejos para cuidar tu cortina")).toBe(false);
  });
});

describe("elegir la foto real", () => {
  it("elige la que va con el tema, por etiquetas, temas o descripción (en los dos idiomas)", () => {
    expect(rankLibrary([door, motor, roof], { text: "Instalamos cortinas metálicas para tu negocio" }, now)?.id).toBe("door");
    expect(rankLibrary([door, motor, roof], { text: "Automatiza tu portón con un motor eléctrico" }, now)?.id).toBe("motor");
    expect(rankLibrary([door, motor, roof], { text: "Storm damage on your roof? We help with the claim." }, now)?.id).toBe("roof");
  });

  it("si ninguna se parece lo suficiente, no elige (la IA crea una)", () => {
    expect(rankLibrary([door, motor], { text: "Feliz día de las madres" }, now)).toBeNull();
    expect(scoreItem(door, { text: "Feliz día de las madres" }, now).relevance).toBeLessThan(MIN_RELEVANCE);
  });

  it("no usa las que no se pueden: No usar, avisos de privacidad, mala calidad, sin copia, videos, con error", () => {
    const text = "cortinas metálicas para local comercial";
    for (const bad of [
      item("a", { ...door, choice: "skip" }),
      item("b", { ...door, privacy: ["faces"] }),
      item("c", { ...door, quality: 2 }),
      item("d", { ...door, url: "" }),
      item("e", { ...door, kind: "video" }),
      item("f", { ...door, status: "error" }),
      item("g", { ...door, usable: false }),
    ]) {
      expect(rankLibrary([bad], { text }, now)).toBeNull();
    }
    // Con avisos pero aprobada por el dueño: sí.
    expect(rankLibrary([item("h", { ...door, id: "h", privacy: ["faces"], choice: "use" })], { text }, now)?.id).toBe("h");
  });

  it("prefiere la de mejor calidad y la menos usada; la usada hace poco pierde", () => {
    const text = "cortinas metálicas para local comercial";
    const a = { ...door, id: "a", quality: 3 };
    const b = { ...door, id: "b", quality: 5 };
    expect(rankLibrary([a, b], { text }, now)?.id).toBe("b");
    const used = { ...door, id: "used", usedCount: 4 };
    const fresh = { ...door, id: "fresh" };
    expect(rankLibrary([used, fresh], { text }, now)?.id).toBe("fresh");
    const recent = { ...door, id: "recent", quality: 5, lastUsedAt: new Date("2026-10-01T00:00:00Z") };
    const old = { ...door, id: "old", quality: 4, lastUsedAt: new Date("2026-06-01T00:00:00Z") };
    expect(rankLibrary([recent, old], { text }, now)?.id).toBe("old");
  });

  it("para vender prefiere trabajo terminado o «después»", () => {
    const before = { ...door, id: "before", quality: 5, description: { ...(door.description as object), scene: "before" } };
    const after = { ...door, id: "after", quality: 4, description: { ...(door.description as object), scene: "after" } };
    expect(rankLibrary([before, after], { text: "Oferta en cortinas metálicas para tu local comercial" }, now)?.id).toBe("after");
    expect(rankLibrary([before, after], { text: "Cortinas metálicas para tu local comercial" }, now)?.id).toBe("before");
  });

  it("no repite las excluidas", () => {
    const other = { ...door, id: "door2", quality: 3 };
    expect(rankLibrary([door, other], { text: "cortinas metálicas", exclude: ["door"] }, now)?.id).toBe("door2");
  });
});

describe("pickLibraryPhotos", () => {
  beforeEach(() => {
    rows.length = 0;
    updates.length = 0;
  });

  it("en un mismo plan no elige la misma foto dos veces y marca las usadas", async () => {
    rows.push(door, { ...door, id: "door2", quality: 3 }, motor);
    const out = await pickLibraryPhotos("biz", [
      { text: "Cortinas metálicas para tu local" },
      { text: "Más cortinas metálicas para tu local comercial" },
      { text: "Cortinas metálicas, otra vez" },
      { text: "Feliz navidad" },
    ]);
    expect(out.map((x) => x?.id ?? null)).toEqual(["door", "door2", null, null]);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ where: { businessId: "biz", id: { in: ["door", "door2"] } }, data: { usedCount: { increment: 1 } } });
  });

  it("sin fotos, todo queda para la IA", async () => {
    expect(await pickLibraryPhotos("biz", [{ text: "Cortinas" }])).toEqual([null]);
    expect(updates).toHaveLength(0);
  });
});

describe("para mostrar", () => {
  it("calidad, duración y buscador", () => {
    expect(qualityWord(5).es).toBe("Buena");
    expect(qualityWord(3).en).toBe("Fair");
    expect(qualityWord(1).tone).toBe("bad");
    expect(qualityWord(0).es).toBe("Sin revisar");
    expect(fmtDuration(75)).toBe("1:15");
    expect(fmtDuration(9.6)).toBe("0:10");
    const c = { description: { es: "Cortina metálica en un local", en: "Metal door on a store", scene: "done" as const, topics: ["instalación"] }, tags: ["cortina"], name: "IMG_1.jpg", folderPath: "Trabajos/Casa Pérez" };
    expect(cardMatches(c, "cortinas")).toBe(true);
    expect(cardMatches(c, "metal door")).toBe(true);
    expect(cardMatches(c, "pérez")).toBe(true);
    expect(cardMatches(c, "insta")).toBe(true);
    expect(cardMatches(c, "techo")).toBe(false);
    expect(cardMatches(c, "")).toBe(true);
  });

  it("filtros: listas = se pueden usar; revisar = buenas con avisos sin decidir", () => {
    expect(matchesFilter(door, "listas")).toBe(true);
    expect(matchesFilter({ ...door, quality: 2 }, "listas")).toBe(false);
    expect(matchesFilter({ ...door, privacy: ["plate"] }, "revisar")).toBe(true);
    expect(matchesFilter({ ...door, privacy: ["plate"], choice: "use" }, "revisar")).toBe(false);
  });
});
