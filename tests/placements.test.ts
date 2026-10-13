import sharp from "sharp";
import { describe, expect, it } from "vitest";
import raw from "@/data/formatos.json";
import { renderDesign } from "@/lib/design";
import { BUILTIN_TEMPLATES, nearestShape } from "@/lib/design-shapes";
import { PLACEMENTS, placementById, placementGroups, placementPlan, previewSize, readPlacements, renderable, safeInsets, sizeText } from "@/lib/placements";

const plan = (id: string) => placementPlan(placementById(id)!);

describe("catálogo de formatos por red", () => {
  it("se valida entero y sin formatos repetidos", () => {
    expect(PLACEMENTS).toHaveLength(108);
    expect(() => readPlacements([...(raw as unknown[]), (raw as unknown[])[0]])).toThrow(/repetido/);
    expect(() => readPlacements([{ id: "x" }])).toThrow();
  });

  it("dice qué se hace con plantillas y qué no", () => {
    expect(plan("instagram.feed_portrait")).toBe("design");
    expect(plan("pinterest.standard_pin")).toBe("design");
    expect(plan("google_business.post_update")).toBe("design");
    // Google Ads responsivo: solo la foto; el texto va en el anuncio.
    expect(plan("google_ads.pmax_square")).toBe("photo");
    // Banners terminados y portadas muy anchas: requieren su propio diseño, no se declaran listos.
    expect(plan("google_ads.display_728x90")).toBe("adapt");
    expect(plan("google_ads.display_300x250")).toBe("adapt");
    expect(plan("linkedin.personal_cover")).toBe("adapt");
    // Lo que ya hace el kit de marca, lo que se hace en Videos y lo pendiente.
    expect(plan("facebook.page_cover")).toBe("kit");
    expect(plan("instagram.profile")).toBe("kit");
    expect(plan("tiktok.video")).toBe("video");
    expect(plan("email.campaign_600")).toBe("pending");
    expect(plan("linkedin.document_carousel")).toBe("pending");
    expect(renderable(placementById("x.post_landscape")!)).toBe(true);
    expect(renderable(placementById("youtube.video")!)).toBe(false);
  });

  it("agrupa por red, con Facebook primero y sin los formatos de otros países", () => {
    const groups = placementGroups();
    expect(groups[0].platform).toBe("facebook");
    expect(groups.map((g) => g.platform)).toEqual(expect.arrayContaining(["instagram", "tiktok", "youtube", "linkedin", "x", "pinterest", "google_business", "google_ads", "email"]));
    const all = groups.flatMap((g) => g.items.map((x) => x.id));
    expect(all).not.toContain("google_ads.display_580x400");
    expect(all).toContain("google_ads.display_728x90");
  });

  it("medidas para mostrar y zona segura", () => {
    expect(previewSize(placementById("youtube.thumbnail")!)).toEqual({ w: 1080, h: 608 });
    expect(previewSize(placementById("pinterest.standard_pin")!, 360)).toEqual({ w: 240, h: 360 });
    expect(sizeText(placementById("instagram.feed_portrait")!)).toBe("1080 × 1350 · 4:5");
    expect(sizeText(placementById("email.campaign_600")!)).toBe("600 px");
    // El banner de YouTube trae un rectángulo centrado (lo que se ve en todos los aparatos): se pasa a márgenes.
    const yt = safeInsets(placementById("youtube.channel_banner")!)!;
    expect(yt.left).toBeCloseTo((1 - 1235 / 2048) / 2, 5);
    expect(yt.top).toBeCloseTo((1 - 338 / 1152) / 2, 5);
    expect(safeInsets(placementById("email.campaign_600")!)).toBeNull();
  });

  it("la forma más parecida para las reglas del diseño", () => {
    expect(nearestShape(1080, 1350)).toBe("portrait");
    expect(nearestShape(1440, 1800)).toBe("portrait");
    expect(nearestShape(1080, 1920)).toBe("story");
    expect(nearestShape(1600, 900)).toBe("wide");
    expect(nearestShape(1200, 900)).toBe("google");
  });
});

describe("una plantilla en la medida de otra red", () => {
  it("sale exacta y reacomodada (no estirada)", async () => {
    const solid = BUILTIN_TEMPLATES.find((x) => x.layout === "color-solido")!;
    const jpg = await renderDesign({ brand: { name: "Ricardo", color: "#1569bb" }, template: solid, headline: "Revisa tu casa después de la tormenta", size: { w: 1000, h: 1500 } });
    const m = await sharp(jpg).metadata();
    expect([m.width, m.height]).toEqual([1000, 1500]);
  }, 30000);
});
