import { describe, expect, it } from "vitest";
import {
  altTextFallback,
  applyGbpLead,
  cleanHashtag,
  firstSentence,
  gbpKeywordHint,
  HASHTAG_MAX,
  hashtagsFor,
  mergeKeywords,
  pickPostKeywords,
  seoSlug,
  tagsIn,
  whatFromText,
  withHashtags,
} from "@/lib/post-keywords";
import { checkPostMedia, postKindFor, readPostMedia } from "@/lib/post-media";
import { seoMediaName, SAFE_MEDIA_NAME } from "@/lib/media";

const KW = ["portones enrollables", "cortinas metálicas", "puertas de seguridad", "reparación de portones"];

describe("palabras clave del post", () => {
  it("elige las que van con el texto (frase completa primero)", () => {
    const k = pickPostKeywords("Instalamos portones enrollables para tu negocio. Reparación de portones en 24 horas.", KW);
    expect(k[0]).toBe("portones enrollables");
    expect(k).toContain("reparación de portones");
    expect(k).not.toContain("puertas de seguridad");
    expect(k.length).toBeLessThanOrEqual(3);
  });
  it("no elige palabras que coinciden a medias", () => {
    expect(pickPostKeywords("Instalamos cortinas metálicas en Managua", ["cortinas metálicas managua", "mantenimiento de cortinas metálicas", "cortinas tubulares managua"])).toEqual(["cortinas metálicas managua"]);
  });
  it("entiende plurales y acentos", () => {
    expect(pickPostKeywords("Nueva cortina metalica instalada", KW)).toEqual(["cortinas metálicas"]);
  });
  it("si nada coincide, usa la primera del negocio", () => {
    expect(pickPostKeywords("Feliz día de la madre", KW)).toEqual(["portones enrollables"]);
    expect(pickPostKeywords("algo", [])).toEqual([]);
  });
  it("une las que sigue en SEO con las del estudio sin repetir", () => {
    expect(mergeKeywords(["Portones Enrollables"], ["portones enrollables", "cortinas"])).toEqual(["Portones Enrollables", "cortinas"]);
  });
  it("máximo 3", () => {
    expect(pickPostKeywords("portones enrollables cortinas metálicas puertas de seguridad reparación de portones", KW, 3)).toHaveLength(3);
  });
});

describe("texto alternativo (plantilla)", () => {
  it("«lo que se ve — palabra en ciudad»", () => {
    expect(altTextFallback("Portón rojo instalado en una tienda", "portones enrollables", "Managua")).toBe("Portón rojo instalado en una tienda — portones enrollables en Managua");
  });
  it("no repite la palabra ni la ciudad", () => {
    expect(altTextFallback("Portones enrollables en Managua.", "portones enrollables", "Managua")).toBe("Portones enrollables en Managua");
    expect(altTextFallback("Equipo instalando portones enrollables", "portones enrollables", "Managua")).toBe("Equipo instalando portones enrollables — Managua");
    expect(altTextFallback("", "portones enrollables", "Managua")).toBe("Portones enrollables en Managua");
  });
  it("en inglés usa «in»", () => {
    expect(altTextFallback("Roof repaired after a storm", "roof repair", "Miami", "en")).toBe("Roof repaired after a storm — roof repair in Miami");
  });
  it("saca lo que se ve de la primera frase del post, sin hashtags ni enlaces", () => {
    expect(whatFromText("¡Nuevo portón instalado! Llámanos hoy #portones https://x.com")).toBe("Nuevo portón instalado");
  });
});

describe("nombre del archivo", () => {
  it("slug sin acentos con palabra y ciudad", () => {
    expect(seoSlug("Portones enrollables", "Managua")).toBe("portones-enrollables-managua");
    expect(seoSlug("Reparación de portones en Managua", "Managua")).toBe("reparacion-de-portones-en-managua");
    expect(seoSlug("Año", undefined)).toBe("ano");
  });
  it("el nombre se puede servir desde /media/ y es único", () => {
    const a = seoMediaName("portones-enrollables-managua", "jpg");
    const b = seoMediaName("portones-enrollables-managua", "jpg");
    expect(a).toMatch(/^portones-enrollables-managua-[a-f0-9]{12}\.jpg$/);
    expect(a).not.toBe(b);
    expect(SAFE_MEDIA_NAME.test(a)).toBe(true);
    expect(seoMediaName("x", "jpg", "abcdef0123456789abcdef01")).toBe("x-abcdef012345.jpg");
    // Sin palabras: el nombre de siempre (24 hex).
    expect(SAFE_MEDIA_NAME.test(seoMediaName("", "jpg"))).toBe(true);
    // Nada raro pasa el filtro.
    expect(SAFE_MEDIA_NAME.test("../etc-abcdef012345.jpg")).toBe(false);
    expect(SAFE_MEDIA_NAME.test("a1b2c3d4e5f6a1b2c3d4e5f6.jpg")).toBe(true);
  });
});

describe("hashtags por red", () => {
  const kws = ["portones enrollables", "cortinas metálicas", "reparación de portones"];
  it("respeta el máximo de cada red y Google no lleva", () => {
    expect(HASHTAG_MAX).toMatchObject({ instagram: 5, tiktok: 5, linkedin: 3, facebook: 3, x: 2, google: 0 });
    expect(hashtagsFor("instagram", kws, "Managua")).toEqual(["#portonesenrollables", "#managua", "#cortinasmetalicas", "#reparacionportones"]);
    // Sin la ciudad dentro (va aparte) y sin hashtags larguísimos.
    expect(hashtagsFor("instagram", ["cortinas metálicas managua", "mantenimiento preventivo de cortinas metálicas"], "Managua")).toEqual(["#cortinasmetalicas", "#managua"]);
    expect(hashtagsFor("x", kws, "Managua")).toEqual(["#portonesenrollables", "#managua"]);
    expect(hashtagsFor("linkedin", kws, "Managua")).toHaveLength(3);
    expect(hashtagsFor("google", kws, "Managua")).toEqual([]);
    expect(hashtagsFor("email", kws, "Managua")).toEqual([]);
  });
  it("cuenta los que ya están en el texto", () => {
    expect(hashtagsFor("x", kws, "Managua", "Hola #Managua")).toEqual(["#portonesenrollables"]);
    expect(hashtagsFor("x", kws, "Managua", "#a #b")).toEqual([]);
  });
  it("los agrega al final sin repetir", () => {
    expect(withHashtags("Hola #Managua", ["#managua", "#portones"])).toBe("Hola #Managua\n\n#portones");
    expect(withHashtags("Hola", [])).toBe("Hola");
    expect(tagsIn("Uno #Portón y #dos")).toEqual(["#porton", "#dos"]);
    expect(cleanHashtag("#Portones Managua")).toBe("#portonesmanagua");
    expect(cleanHashtag("#")).toBe("");
  });
});

describe("Google: palabra clave y ciudad en la primera frase", () => {
  it("avisa si faltan y propone una frase", () => {
    const h = gbpKeywordHint("¡Nueva instalación terminada! Llámanos.", "portones enrollables", "Managua");
    expect(h).toMatchObject({ missing: "both", lead: "Portones enrollables en Managua." });
    expect(applyGbpLead("¡Nueva instalación terminada!", h!)).toBe("Portones enrollables en Managua. ¡Nueva instalación terminada!");
  });
  it("no dice nada si ya están", () => {
    expect(gbpKeywordHint("Instalamos portones enrollables en Managua. Llámanos.", "portones enrollables", "Managua")).toBeNull();
    expect(gbpKeywordHint("Instalamos portón enrollable en Managua.", "portones enrollables", "Managua")).toBeNull();
  });
  it("solo falta la ciudad", () => {
    expect(gbpKeywordHint("Portones enrollables a tu medida. En Managua.", "portones enrollables", "Managua")?.missing).toBe("city");
  });
  it("primera frase", () => {
    expect(firstSentence("Hola mundo. Adiós.")).toBe("Hola mundo.");
    expect(firstSentence("Sin punto")).toBe("Sin punto");
  });
});

describe("fotos de la publicación", () => {
  it("lee Post.media y, si falta, mediaUrl", () => {
    expect(readPostMedia([{ url: "https://a/1.jpg", alt: "uno", focus: { x: 0.2, y: 0.3 } }, { url: "javascript:x" }, { url: "https://a/2.mp4" }])).toEqual([
      { url: "https://a/1.jpg", alt: "uno", type: "photo", focus: { x: 0.2, y: 0.3 } },
      { url: "https://a/2.mp4", alt: "", type: "video" },
    ]);
    expect(readPostMedia(null, { mediaUrl: "/media/a.jpg", mediaType: "photo", altText: "alt" })).toEqual([{ url: "/media/a.jpg", alt: "alt", type: "photo" }]);
    expect(readPostMedia(null, { mediaUrl: "", mediaType: "none" })).toEqual([]);
  });
  it("carrusel de 2 a 10 fotos; historia con una", () => {
    const p = { type: "photo" as const };
    expect(checkPostMedia("carousel", [p])).not.toBeNull();
    expect(checkPostMedia("carousel", [p, p])).toBeNull();
    expect(checkPostMedia("carousel", Array(11).fill(p))).not.toBeNull();
    expect(checkPostMedia("carousel", [p, { type: "video" }])).not.toBeNull();
    expect(checkPostMedia("story", [])).not.toBeNull();
    expect(checkPostMedia("story", [{ type: "video" }])).toBeNull();
    expect(checkPostMedia("post", [])).toBeNull();
  });
  it("el tipo que se guarda", () => {
    expect(postKindFor("carousel", "photo")).toBe("carousel");
    expect(postKindFor("post", "video")).toBe("video");
    expect(postKindFor("", "photo")).toBe("post");
    expect(postKindFor("story", "video")).toBe("story");
  });
});
