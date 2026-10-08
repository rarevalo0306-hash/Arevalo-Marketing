import { describe, expect, it } from "vitest";
import { channelOfView, countFor, hasPhone, hashtagsOf, linksOf, mediaFrame, NETWORKS, pieces, previewNotes, truncateForPreview, viewsFor } from "@/lib/preview";

const long = "Tu cortina de acero hace ruido cada mañana y despierta a los vecinos. En Fameseg la revisamos, la lubricamos y cambiamos las piezas gastadas el mismo día, con garantía. Llámanos y te damos el precio sin compromiso.";

describe("dónde corta cada red con «… más»", () => {
  it("Instagram corta a ~125 caracteres sin partir palabras", () => {
    const r = truncateForPreview(long, NETWORKS.instagram);
    expect(r.cut).toBe(true);
    expect(r.shown.length).toBeLessThanOrEqual(125);
    expect(long.startsWith(r.shown)).toBe(true);
    expect(long[r.shown.length]).toMatch(/[\s,.]/);
  });
  it("corta al final de la línea si hay saltos de línea antes", () => {
    const r = truncateForPreview("Línea uno\nLínea dos\nLínea tres", NETWORKS.instagram);
    expect(r).toEqual({ shown: "Línea uno\nLínea dos", cut: true });
  });
  it("un texto corto no se corta", () => {
    expect(truncateForPreview("Hola", NETWORKS.facebook)).toEqual({ shown: "Hola", cut: false });
    expect(truncateForPreview(long, NETWORKS.x).cut).toBe(false);
  });
  it("Facebook muestra más texto que LinkedIn, y LinkedIn más que Instagram", () => {
    const fb = truncateForPreview(long, NETWORKS.facebook).shown.length;
    const li = truncateForPreview(long, NETWORKS.linkedin).shown.length;
    const ig = truncateForPreview(long, NETWORKS.instagram).shown.length;
    expect(fb).toBeGreaterThanOrEqual(li);
    expect(li).toBeGreaterThan(ig);
  });
});

describe("límites de caracteres", () => {
  it("X cuenta cada enlace como 23 caracteres", () => {
    expect(countFor("Mira https://fameseg.com/un/enlace/muy/largo/que/no/importa", NETWORKS.x)).toBe(5 + 23);
    expect(countFor("Hola", NETWORKS.x)).toBe(4);
  });
  it("avisa cuando el texto es muy largo para la red", () => {
    const text = "a".repeat(281);
    const notes = previewNotes(text, NETWORKS.x, "photo");
    expect(notes.find((n) => n.id === "limit")?.level).toBe("error");
    expect(notes.find((n) => n.id === "limit")?.es).toContain("Sobran 1");
    expect(previewNotes("a".repeat(280), NETWORKS.x, "photo").some((n) => n.id === "limit")).toBe(false);
    expect(previewNotes("a".repeat(2201), NETWORKS.instagram, "photo").some((n) => n.id === "limit")).toBe(true);
  });
  it("hashtags: Instagram como mucho 5, en Google no sirven", () => {
    const tags = "Hola #uno #dos #tres #cuatro #cinco #seis";
    expect(hashtagsOf(tags)).toHaveLength(6);
    expect(previewNotes(tags, NETWORKS.instagram, "photo").find((n) => n.id === "tags-max")?.level).toBe("warn");
    expect(previewNotes("Hola #uno", NETWORKS.google, "photo").some((n) => n.id === "tags-useless")).toBe(true);
    expect(previewNotes("Hola #uno", NETWORKS.facebook, "photo")).toHaveLength(0);
  });
  it("enlaces: avisa donde no se pueden tocar", () => {
    expect(linksOf("Visita https://fameseg.com.")).toEqual(["https://fameseg.com"]);
    expect(previewNotes("Visita https://fameseg.com", NETWORKS.instagram, "photo").some((n) => n.id === "links")).toBe(true);
    expect(previewNotes("Visita https://fameseg.com", NETWORKS.facebook, "photo").some((n) => n.id === "links")).toBe(false);
  });
  it("Google puede rechazar posts con teléfono", () => {
    expect(hasPhone("Llámanos al +505 8888 1234")).toBe(true);
    expect(hasPhone("Call (305) 394-8090")).toBe(true);
    expect(hasPhone("Temporada 2025-2026, 10% de descuento")).toBe(false);
    expect(previewNotes("Llámanos al 305-394-8090", NETWORKS.google, "photo").some((n) => n.id === "phone")).toBe(true);
  });
  it("Instagram necesita foto o video; TikTok, video", () => {
    expect(previewNotes("Hola", NETWORKS.instagram, "none").some((n) => n.level === "error")).toBe(true);
    expect(previewNotes("Hola", NETWORKS.tiktok, "photo").some((n) => n.level === "error")).toBe(true);
    expect(previewNotes("Hola", NETWORKS.tiktok, "video")).toHaveLength(0);
  });
});

describe("partes del texto", () => {
  it("separa enlaces, hashtags y saltos de línea", () => {
    expect(pieces("Hola #Managua\n#puertas https://fameseg.com")).toEqual([
      { kind: "text", value: "Hola " },
      { kind: "tag", value: "#Managua" },
      { kind: "break", value: "\n" },
      { kind: "tag", value: "#puertas" },
      { kind: "text", value: " " },
      { kind: "link", value: "https://fameseg.com" },
    ]);
    expect(pieces("Sin nada").map((p) => p.value).join("")).toBe("Sin nada");
    expect(pieces("Precio #1").map((p) => p.value).join("")).toBe("Precio #1");
  });
});

describe("pestañas y forma de la foto", () => {
  it("Instagram con video se ve como reel; email y SMS quedan como pestañas simples", () => {
    expect(viewsFor(["facebook", "instagram", "email"], "photo")).toEqual(["facebook", "instagram", "email"]);
    expect(viewsFor(["instagram"], "video")).toEqual(["instagram-story"]);
    expect(viewsFor(["instagram"], "photo", { stories: true })).toEqual(["instagram", "instagram-story"]);
    expect(channelOfView("instagram-story")).toBe("instagram");
    expect(channelOfView("sms")).toBe("sms");
  });
  it("el cuadro de la foto sigue la regla de publicación de cada red", () => {
    // Un diseño se vuelve a dibujar en la forma de la red.
    expect(mediaFrame(NETWORKS.instagram, 1, { hasText: true, design: true }).ratio).toBeCloseTo(0.8);
    // Foto cuadrada en Instagram: se acepta tal cual.
    expect(mediaFrame(NETWORKS.instagram, 1, { hasText: true })).toEqual({ ratio: 1, fit: "cover" });
    // Foto muy alta con letras en X: se centra sobre un fondo desenfocado.
    expect(mediaFrame(NETWORKS.x, 0.5, { hasText: true }).fit).toBe("blur");
    // Foto sin letras un poco más ancha: se recorta.
    const g = mediaFrame(NETWORKS.google, 1.6, { hasText: false });
    expect(g.fit).toBe("cover");
    expect(g.ratio).toBeCloseTo(4 / 3);
    expect(mediaFrame(NETWORKS["instagram-story"], 9 / 16, { hasText: true }).fit).toBe("cover");
  });
});
