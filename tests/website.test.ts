import { describe, expect, it } from "vitest";
import { addArticle, slugify, type GeneratedArticle, type SiteArticle } from "@/lib/publishers/website";

const copy = (slug: string) => ({
  slug,
  seoTitle: "T",
  title: "Título",
  description: "D",
  category: "Novedades",
  sections: [{ title: "Uno", text: "Texto" }, { title: " ", text: "vacía" }],
});
const gen = (es: string, en: string): GeneratedArticle => ({ photo: "storm", es: copy(es), en: copy(en) });

describe("artículos para el sitio", () => {
  it("convierte títulos en slugs limpios", () => {
    expect(slugify("¿Qué hacer después de un huracán?")).toBe("que-hacer-despues-de-un-huracan");
    expect(slugify("!!!")).toBe("articulo");
  });
  it("agrega el artículo primero, con id y sin secciones vacías", () => {
    const { list, article } = addArticle([], gen("hola", "hello"), "post-1");
    expect(list[0]).toBe(article);
    expect(article.id).toBe("post-1");
    expect(article.es.sections).toHaveLength(1);
  });
  it("no repite slugs que ya existen", () => {
    const first = addArticle([], gen("huracan", "hurricane"), "a").list;
    const { article } = addArticle(first as SiteArticle[], gen("Huracán", "hurricane"), "b");
    expect(article.es.slug).toBe("huracan-2");
    expect(article.en.slug).toBe("hurricane-2");
  });
});
