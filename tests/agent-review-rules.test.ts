// Las reglas de la revisión editorial que no usan IA (reviewRules): puras, sin base de datos ni proveedor.
import { describe, expect, it } from "vitest";
import { reviewRules } from "@/lib/agent/review-rules";
import type { Copy } from "@/lib/agent/schema";

const COPY: Copy = {
  title: "Goteras",
  headline: "¿Tienes una gotera?",
  summary: "Cómo detectar una gotera a tiempo",
  variants: {
    facebook: "Revisa tu techo antes de la lluvia.",
    instagram: "Revisa tu techo antes de la lluvia.",
    google: "",
    linkedin: "",
    x: "",
    seo: "",
  },
  script: "",
  alt: "Techo con la marca",
};

type Input = Parameters<typeof reviewRules>[0];
const base = (over: Partial<Omit<Input, "copy">> & { copy?: Partial<Copy>; variants?: Partial<Copy["variants"]> } = {}): Input => {
  const { copy, variants, ...rest } = over;
  return {
    channels: ["facebook", "instagram"],
    copy: { ...COPY, ...copy, variants: { ...COPY.variants, ...variants } },
    mediaType: "photo",
    business: { phone: "305-555-0100", website: "https://mio.com" },
    knownFacts: [],
    recentTopics: [],
    topic: "Cómo detectar una gotera a tiempo",
    ...rest,
  };
};
const kinds = (input: Input) => reviewRules(input).map((p) => p.kind);

describe("reglas de la revisión editorial", () => {
  it("una pieza correcta no da problemas", () => {
    expect(reviewRules(base())).toEqual([]);
  });

  describe("canal", () => {
    it("el texto de facebook vacío da un problema canal hacia copy", () => {
      const problems = reviewRules(base({ channels: ["facebook"], variants: { facebook: "  " } }));
      expect(problems).toEqual([{ kind: "canal", detail: "Falta el texto de Facebook.", sendBackTo: "copy" }]);
    });

    it("un texto más largo que el límite del canal también es canal; los avisos que no bloquean no cuentan", () => {
      const problems = reviewRules(base({ channels: ["x"], variants: { x: "a".repeat(2300) } }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ kind: "canal", sendBackTo: "copy" });
      expect(problems[0].detail).toContain("Muy largo");
      // A short article warns ("shortArticle") but does not block.
      expect(reviewRules(base({ channels: ["seo"], variants: { seo: "Un artículo muy corto." } }))).toEqual([]);
    });

    it("solo se revisan los canales de la pieza", () => {
      expect(kinds(base({ channels: ["facebook"], variants: { instagram: "" } }))).toEqual([]);
      expect(kinds(base({ channels: ["facebook", "instagram"], variants: { instagram: "" } }))).toEqual(["canal"]);
    });

    it("un canal que no tiene texto propio usa el texto base de la pieza", () => {
      // No TikTok variant exists: the Facebook text is the base text. TikTok still needs a video.
      expect(kinds(base({ channels: ["tiktok"], mediaType: "video" }))).toEqual([]);
      // The writer only wrote Instagram: that text is the base.
      expect(kinds(base({ channels: ["instagram", "tiktok"], mediaType: "video", variants: { facebook: "" } }))).toEqual([]);
      expect(kinds(base({ channels: ["tiktok"], mediaType: "video", variants: { facebook: "", instagram: "" } }))).toEqual(["canal"]);
    });

    it("un canal desconocido no hace fallar la revisión", () => {
      expect(kinds(base({ channels: ["facebook", "mastodon"] }))).toEqual([]);
    });
  });

  describe("falta-imagen", () => {
    it("sin imagen ni video, instagram da falta-imagen hacia design", () => {
      const problems = reviewRules(base({ channels: ["instagram"], mediaType: "none" }));
      expect(problems).toEqual([
        { kind: "falta-imagen", detail: "Instagram necesita una foto o un video.", sendBackTo: "design" },
      ]);
    });

    it("facebook no necesita imagen; con foto o video instagram pasa", () => {
      expect(kinds(base({ channels: ["facebook"], mediaType: "none" }))).toEqual([]);
      expect(kinds(base({ channels: ["instagram"], mediaType: "photo" }))).toEqual([]);
      expect(kinds(base({ channels: ["instagram"], mediaType: "video" }))).toEqual([]);
    });

    it("tiktok necesita un video: con una foto da falta-imagen hacia design", () => {
      expect(reviewRules(base({ channels: ["tiktok"], mediaType: "photo" }))).toEqual([
        { kind: "falta-imagen", detail: "TikTok necesita un video para publicar.", sendBackTo: "design" },
      ]);
      expect(kinds(base({ channels: ["tiktok"], mediaType: "video" }))).toEqual([]);
    });
  });

  describe("telefono", () => {
    it('"Llama al 305-000-0000" cuando el teléfono del negocio es otro da telefono hacia copy', () => {
      const problems = reviewRules(base({ variants: { facebook: "Llama al 305-000-0000" } }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ kind: "telefono", sendBackTo: "copy" });
      expect(problems[0].detail).toContain("305-000-0000");
      expect(problems[0].detail).toContain("305-555-0100");
    });

    it.each([
      "Llama al 305-555-0100",
      "Llama al (305) 555-0100",
      "Llama al 305 555 0100",
      "Llama al 305.555.0100",
      "Llama al 3055550100",
      "Llama al +1 305-555-0100.",
      "Llama al +1 (305) 555-0100, te atendemos",
      "Desde 1998 305-555-0100",
    ])("acepta el mismo número escrito de otra forma: %s", (text) => {
      expect(kinds(base({ variants: { facebook: text } }))).toEqual([]);
    });

    it("compara con el teléfono del negocio sin importar cómo esté guardado", () => {
      const text = "Llama al 305-555-0100";
      expect(kinds(base({ business: { phone: "+1 (305) 555-0100", website: "https://mio.com" }, variants: { facebook: text } }))).toEqual([]);
      expect(kinds(base({ business: { phone: "3055550100", website: "https://mio.com" }, variants: { facebook: text } }))).toEqual([]);
      expect(kinds(base({ business: { phone: "305-555-0199", website: "https://mio.com" }, variants: { facebook: text } }))).toEqual(["telefono"]);
    });

    it("un teléfono que aparece entre los hechos conocidos no es un error", () => {
      const input = base({ variants: { facebook: "Urgencias: 786-555-0111" }, knownFacts: ["Línea de urgencias 786-555-0111"] });
      expect(kinds(input)).toEqual([]);
      expect(kinds({ ...input, knownFacts: [] })).toEqual(["telefono"]);
    });

    it("si el negocio no tiene teléfono, cualquier número del texto es un problema", () => {
      const problems = reviewRules(base({ business: { phone: "", website: "https://mio.com" }, variants: { facebook: "Llama al 305-555-0100" } }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ kind: "telefono", sendBackTo: "copy" });
    });

    it("busca el teléfono en el titular, en el guion y en los canales de la pieza, pero no en los demás", () => {
      expect(kinds(base({ copy: { headline: "Llama 305-000-0000" } }))).toEqual(["telefono"]);
      expect(kinds(base({ copy: { script: "Llama al 305-000-0000" } }))).toEqual(["telefono"]);
      expect(kinds(base({ channels: ["facebook"], variants: { linkedin: "Llama al 305-000-0000" } }))).toEqual([]);
    });

    it("fechas, años, precios y cifras sueltas no se toman por teléfonos", () => {
      const text = "Desde el 2026-10-16 hasta el 10-16-2026, campaña 2025-2026, desde $1.500.000, 5,000 clientes, abierto 24/7, de 9 a 5, 12345";
      expect(kinds(base({ variants: { facebook: text } }))).toEqual([]);
    });

    describe("huecos del detector de teléfonos", () => {
      const phoneDetail = (text: string) => reviewRules(base({ variants: { facebook: text } })).find((p) => p.kind === "telefono")?.detail;

      it.each([
        ["guion que no corta (U+2011)", "Llama al 305\u2011000\u20110000"],
        ["guion (U+2010)", "Llama al 305\u2010000\u20100000"],
        ["guion de cifras (U+2012)", "Llama al 305\u2012000\u20120000"],
        ["raya corta (U+2013)", "Llama al 305\u2013000\u20130000"],
        ["raya larga (U+2014)", "Llama al 305\u2014000\u20140000"],
        ["barra horizontal (U+2015)", "Llama al 305\u2015000\u20150000"],
        ["signo menos (U+2212)", "Llama al 305\u2212000\u22120000"],
        ["espacio que no corta (U+00A0)", "Llama al 305\u00a0000\u00a00000"],
        ["espacio fino que no corta (U+202F)", "Llama al 305\u202f000\u202f0000"],
        ["espacio fino (U+2009)", "Llama al 305\u2009000\u20090000"],
        ["punto medio (·)", "Llama al 305·000·0000"],
      ])("un número con %s se detecta", (_name, text) => {
        expect(phoneDetail(text)).toContain("305-000-0000".slice(0, 3));
        expect(kinds(base({ variants: { facebook: text } }))).toEqual(["telefono"]);
      });

      it.each([
        "Llama al 305\u2013555\u20130100",
        "Llama al 305\u2212555\u22120100",
        "Llama al 305\u00a0555\u00a00100",
        "Llama al (305)\u202f555\u20110100",
        "Llama al 305·555·0100",
      ])("el número del negocio con otros guiones o espacios no es un error: %s", (text) => {
        expect(kinds(base({ variants: { facebook: text } }))).toEqual([]);
      });

      it.each(["Tel.305-000-0000", "WhatsApp/305-000-0000", "Cel-305-000-0000", "Teléfono.305.000.0000", "Llámanos—305-000-0000"])(
        "un número pegado a una palabra con punto, guion o barra se detecta: %s",
        (text) => {
          expect(kinds(base({ variants: { facebook: text } }))).toEqual(["telefono"]);
          expect(phoneDetail(text)).toMatch(/305.000.0000/);
        },
      );

      it.each(["Tel.305-555-0100", "WhatsApp/305-555-0100", "Cel-(305) 555-0100"])(
        "el número del negocio pegado a una palabra no es un error: %s",
        (text) => {
          expect(kinds(base({ variants: { facebook: text } }))).toEqual([]);
        },
      );

      it("dos números unidos por un espacio se separan en lugar de saltárselos", () => {
        // 20 digits together: before, too many to be one phone and the wrong one slipped through.
        const detail = phoneDetail("Llama al 305-555-0100 786-000-0000");
        expect(detail).toContain("«786-000-0000»");
        expect(detail).not.toContain("«305-555-0100");
        expect(phoneDetail("Llama al 305 555 0100 786 000 0000")).toContain("«786 000 0000»");
        expect(phoneDetail("Llama al +1 786 000 0000 +1 305 555 0100")).toContain("«+1 786 000 0000»");
        // A year written right before a number is not part of it.
        const year = phoneDetail("Desde 1998 786-000-0000");
        expect(year).toContain("«786-000-0000»");
        expect(year).not.toContain("1998");
        // Both are the business's: nothing wrong.
        expect(kinds(base({ variants: { facebook: "Llama al 305-555-0100 305 555 0100" } }))).toEqual([]);
        // A number written in groups is still one number.
        expect(kinds(base({ variants: { facebook: "Llama al +1 305 555 0100 o al (305) 555 0100" } }))).toEqual([]);
      });

      it.each([
        "Licencia de ajustador público W-1234567",
        "Lic. W123456",
        "License #W123456",
        "Licencia P-123456789",
        "Lic.W-1234567",
        // Even an ID as long as a phone: a lone letter (with or without a separator) before the digits is an ID's prefix.
        "Licencia W-1234567890",
        "Licencia W.1234567890",
        "Licencia W/1234567890",
        "Lic.W-1234567890",
        "License #W1234567890",
      ])("un número de licencia no es un teléfono (R43): %s", (text) => {
        expect(kinds(base({ variants: { facebook: `Ajustador con licencia en Florida. ${text}` } }))).toEqual([]);
      });

      it.each(["Llama al 555-0199", "Llama al 2222-3333", "Oficina 12-345-678", "Pedido 53050000000", "Ref. 230-500-000-00"])(
        "un número que no tiene 10 cifras (u 11 empezando por 1) no es un teléfono (R43): %s",
        (text) => {
          expect(kinds(base({ variants: { facebook: text } }))).toEqual([]);
        },
      );

      it.each(["Llama al +1 305-000-0000", "Llama al 1-305-000-0000", "Llama al 1 (305) 000-0000", "Llama al 3050000000"])(
        "10 cifras, u 11 empezando por 1, sí son un teléfono (R43): %s",
        (text) => {
          expect(kinds(base({ variants: { facebook: text } }))).toEqual(["telefono"]);
        },
      );

      it("el titular (el primer texto revisado) sigue la misma regla estricta que los canales (R43)", () => {
        expect(kinds(base({ copy: { headline: "Licencia W-1234567" } }))).toEqual([]);
        expect(kinds(base({ copy: { headline: "Llama al 555-0199" } }))).toEqual([]);
        expect(kinds(base({ copy: { headline: "Llama al 305-000-0000" } }))).toEqual(["telefono"]);
      });

      it("una licencia junto a un teléfono ajeno: solo el teléfono es un problema (R43)", () => {
        const detail = phoneDetail("Licencia W-1234567. Tel.305-000-0000");
        expect(detail).toContain("«305-000-0000»");
        expect(detail).not.toContain("1234567");
      });

      it("un código postal con sus cuatro cifras (ZIP+4) no es un teléfono", () => {
        expect(kinds(base({ variants: { facebook: "Visítanos en Miami, FL 33101-1234." } }))).toEqual([]);
        expect(kinds(base({ variants: { facebook: "Miami, FL 33101-1234 305-555-0100" } }))).toEqual([]);
        const detail = phoneDetail("Miami, FL 33101-1234 786-000-0000");
        expect(detail).toContain("«786-000-0000»");
        expect(detail).not.toContain("33101");
      });
    });

    it("un solo problema por tipo aunque el número se repita", () => {
      const problems = reviewRules(
        base({ variants: { facebook: "Llama al 305-000-0000", instagram: "Llama al 305-000-0000" } }),
      );
      expect(problems.filter((p) => p.kind === "telefono")).toHaveLength(1);
    });
  });

  describe("web", () => {
    it("otro dominio en el texto da web hacia copy", () => {
      const problems = reviewRules(base({ variants: { facebook: "Visita https://otra-empresa.com/ofertas hoy" } }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ kind: "web", sendBackTo: "copy" });
      expect(problems[0].detail).toContain("otra-empresa.com");
      expect(problems[0].detail).toContain("mio.com");
    });

    it.each([
      "Visita https://mio.com",
      "Visita www.mio.com",
      "Visita mio.com/techos?x=1",
      "Visita http://WWW.MIO.COM/",
      "Visita https://reservas.mio.com/cita",
    ])("acepta la web del negocio escrita de otra forma: %s", (text) => {
      expect(kinds(base({ variants: { facebook: text } }))).toEqual([]);
    });

    it("compara con la web del negocio sin importar cómo esté guardada", () => {
      for (const website of ["mio.com", "www.mio.com", "https://www.mio.com/es/", "HTTPS://Mio.com:443"])
        expect(kinds(base({ business: { phone: "305-555-0100", website }, variants: { facebook: "Visita mio.com" } }))).toEqual([]);
    });

    it("un correo no es una web; una web de los hechos conocidos tampoco es un error", () => {
      expect(kinds(base({ variants: { facebook: "Escríbenos a info@gmail.com" } }))).toEqual([]);
      const input = base({ variants: { facebook: "Reserva en https://citas.ejemplo.org" }, knownFacts: ["Reservas en citas.ejemplo.org"] });
      expect(kinds(input)).toEqual([]);
      expect(kinds({ ...input, knownFacts: [] })).toEqual(["web"]);
    });

    it("el negocio sin web no tiene dominio propio", () => {
      expect(kinds(base({ business: { phone: "305-555-0100", website: "" }, variants: { facebook: "Visita mio.com" } }))).toEqual(["web"]);
    });

    it("no toma por web un punto sin espacio ni un nombre de archivo cualquiera", () => {
      expect(kinds(base({ variants: { facebook: "Cuida tu techo.Llama hoy. Tel.Fax. S.A. e.g. foto.jpg" } }))).toEqual([]);
      // A sentence missing its space after the period, and words in the path of the business's own link.
      expect(kinds(base({ variants: { facebook: "Revisa tu techo.Es hora de hacerlo" } }))).toEqual([]);
      expect(kinds(base({ variants: { facebook: "Mira https://mio.com/ofertas.net y mio.com/guia.org?x=ayuda.com" } }))).toEqual([]);
    });

    it("las mayúsculas no esconden una web ajena", () => {
      expect(kinds(base({ variants: { facebook: "VISITA OTRA.COM HOY" } }))).toEqual(["web"]);
      expect(kinds(base({ variants: { facebook: "VISITA MIO.COM HOY" } }))).toEqual([]);
    });

    it("un artículo (canal seo) puede enlazar a otras fuentes", () => {
      const article = "Fuente: https://www.fema.gov/ayuda. ".repeat(10);
      expect(kinds(base({ channels: ["seo"], variants: { seo: article } }))).toEqual([]);
      expect(kinds(base({ channels: ["facebook"], variants: { facebook: article } }))).toEqual(["web"]);
    });
  });

  describe("dato-inventado", () => {
    it('"20% de descuento" sin un hecho conocido que lo diga da dato-inventado hacia copy', () => {
      const problems = reviewRules(base({ variants: { facebook: "20% de descuento en tu revisión" } }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ kind: "dato-inventado", sendBackTo: "copy" });
      expect(problems[0].detail).toContain("20%");
    });

    it.each(["Inspección gratis", "Garantizamos tu satisfacción", "Hasta 50 % menos", "Descuentos de temporada", "Ahorra 7,5%"])(
      "marca %s",
      (text) => {
        expect(kinds(base({ variants: { facebook: text } }))).toEqual(["dato-inventado"]);
      },
    );

    it("un hecho conocido que dice el 20% y el descuento lo permite", () => {
      const input = base({ variants: { facebook: "20% de descuento en tu revisión" }, knownFacts: ["Descuento del 20% para clientes nuevos hasta fin de mes"] });
      expect(kinds(input)).toEqual([]);
      expect(kinds({ ...input, knownFacts: [] })).toEqual(["dato-inventado"]);
    });

    it("el hecho debe decir esa cifra: un 10% no permite un 50%, ni un 120% un 20%", () => {
      const text = "50% de descuento";
      expect(kinds(base({ variants: { facebook: text }, knownFacts: ["10% de descuento a clientes nuevos"] }))).toEqual(["dato-inventado"]);
      expect(kinds(base({ variants: { facebook: "20% de descuento" }, knownFacts: ["Crecimos 120% de descuento"] }))).toEqual(["dato-inventado"]);
      expect(kinds(base({ variants: { facebook: "20 % de descuento" }, knownFacts: ["Promo: 20% de descuento"] }))).toEqual([]);
    });

    it("los acentos y las mayúsculas no importan", () => {
      expect(kinds(base({ variants: { facebook: "GARANTIZAMOS un año" }, knownFacts: ["Garantizamos un año de trabajo"] }))).toEqual([]);
      expect(kinds(base({ variants: { facebook: "Estimado GRATIS" }, knownFacts: ["Estimado gratis en Miami"] }))).toEqual([]);
    });

    it("revisa el titular, el guion y los canales de la pieza", () => {
      expect(kinds(base({ copy: { headline: "¡Gratis hoy!" } }))).toEqual(["dato-inventado"]);
      expect(kinds(base({ copy: { script: "Hoy 30% de descuento" } }))).toEqual(["dato-inventado"]);
      expect(kinds(base({ channels: ["facebook"], variants: { google: "Gratis" } }))).toEqual([]);
    });

    it("un solo problema que nombra cada afirmación", () => {
      const problems = reviewRules(base({ variants: { facebook: "20% de descuento y envío gratis. Garantizamos todo." } }));
      expect(problems).toHaveLength(1);
      for (const word of ["20%", "descuento", "gratis", "garantiz"])
        expect(problems[0].detail.toLowerCase()).toContain(word);
      expect(problems[0].detail.length).toBeLessThanOrEqual(300);
    });
  });

  describe("repetido", () => {
    it("un tema que ya está en recentTopics da repetido hacia copy", () => {
      const problems = reviewRules(base({ recentTopics: ["Otro tema", "Cómo detectar una gotera a tiempo"] }));
      expect(problems).toEqual([
        { kind: "repetido", detail: expect.stringContaining("Cómo detectar una gotera a tiempo"), sendBackTo: "copy" },
      ]);
    });

    it("compara sin acentos, mayúsculas ni espacios de más", () => {
      expect(kinds(base({ topic: "  COMO detectar   una gotera a tiempo ", recentTopics: ["Cómo detectar una gotera a tiempo"] }))).toEqual(["repetido"]);
    });

    it("un tema distinto o una lista vacía pasan; un tema parecido no es el mismo", () => {
      expect(kinds(base({ recentTopics: [] }))).toEqual([]);
      expect(kinds(base({ recentTopics: ["Cómo detectar una gotera"] }))).toEqual([]);
    });
  });

  it("junta los problemas de varias reglas, cada tipo una vez y con el texto en español", () => {
    const problems = reviewRules(
      base({
        channels: ["instagram"],
        mediaType: "none",
        variants: { instagram: "Gratis. Llama al 305-000-0000 o visita otra.com" },
        recentTopics: ["Cómo detectar una gotera a tiempo"],
      }),
    );
    expect(problems.map((p) => p.kind).sort()).toEqual(["dato-inventado", "falta-imagen", "repetido", "telefono", "web"]);
    for (const p of problems) {
      expect(p.kind.length).toBeLessThanOrEqual(40);
      expect(p.detail.length).toBeGreaterThan(0);
      expect(p.detail.length).toBeLessThanOrEqual(300);
      expect(["copy", "design"]).toContain(p.sendBackTo);
    }
    expect(problems.find((p) => p.kind === "falta-imagen")?.sendBackTo).toBe("design");
  });

  it("no cambia lo que recibe", () => {
    const input = base({ variants: { facebook: "Llama al 305-000-0000" }, recentTopics: ["x"] });
    const before = JSON.stringify(input);
    reviewRules(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
