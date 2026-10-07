import { describe, expect, it } from "vitest";
import { MOBILE_TABS, NAV_GROUPS, SEO_TAB_IDS, isGroupOn, isItemOn, itemHref, seoTabFrom, type NavHere } from "@/components/nav/model";

const ID = "biz1";
const here = (pathname: string, tab: string | null = null, mapa: string | null = null): NavHere => ({ pathname, tab, mapa });
const item = (key: string) => {
  const x = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === key);
  if (!x) throw new Error(key);
  return x;
};
const onKeys = (h: NavHere) =>
  NAV_GROUPS.flatMap((g) => g.items)
    .filter((x) => isItemOn(ID, x, h))
    .map((x) => x.key);

describe("menú por herramientas", () => {
  it("cada enlace apunta a una ruta del negocio o a una pestaña que existe", () => {
    const keys = new Set<string>();
    for (const x of NAV_GROUPS.flatMap((g) => g.items)) {
      expect(keys.has(x.key)).toBe(false);
      keys.add(x.key);
      if (x.soon) continue;
      expect(itemHref(ID, x)).toMatch(/^\/b\/biz1\/[a-z/]+(\?tab=[a-z]+)?(#[a-z-]+)?$/);
      if (x.tab) expect(SEO_TAB_IDS).toContain(x.tab);
    }
    expect(itemHref(ID, item("seo-palabras"))).toBe("/b/biz1/seo?tab=google#palabras");
    expect(itemHref(ID, item("seo-enlaces"))).toBe("/b/biz1/seo?tab=competencia#enlaces");
    expect(itemHref(ID, item("anuncios"))).toBe("");
  });

  it("la pestaña de SEO: ?tab= válido, ?mapa= abre Local, si no Resumen", () => {
    expect(seoTabFrom("web")).toBe("web");
    expect(seoTabFrom("nada")).toBe("resumen");
    expect(seoTabFrom(null, "m1")).toBe("local");
    expect(seoTabFrom("ia", "m1")).toBe("ia");
  });

  it("marca un solo enlace según la ruta y la pestaña", () => {
    expect(onKeys(here("/b/biz1/inicio"))).toEqual(["inicio"]);
    expect(onKeys(here("/b/biz1/seo"))).toEqual(["seo-resumen"]);
    expect(onKeys(here("/b/biz1/seo", "google"))).toEqual(["seo-google"]);
    expect(onKeys(here("/b/biz1/seo", null, "abc"))).toEqual(["local-mapa"]);
    expect(onKeys(here("/b/biz1/seo", "ajustes"))).toEqual(["seo-ajustes"]);
    expect(onKeys(here("/b/biz1/seo/escribir", "google"))).toEqual(["escribir"]);
    expect(onKeys(here("/b/biz1/publicar"))).toEqual(["publicar"]);
    expect(onKeys(here("/b/biz1/negocio/"))).toEqual(["negocio"]);
    expect(onKeys(here("/b/otro/inicio"))).toEqual([]);
  });

  it("grupos y barra del celular", () => {
    const seo = NAV_GROUPS.find((g) => g.key === "seo")!;
    expect(isGroupOn(ID, seo, here("/b/biz1/seo", "web"))).toBe(true);
    expect(isGroupOn(ID, seo, here("/b/biz1/seo", "ia"))).toBe(false);
    const on = (h: NavHere) => MOBILE_TABS.filter((x) => x.on(h, "/b/biz1/")).map((x) => x.key);
    expect(on(here("/b/biz1/seo", "local"))).toEqual(["seo"]);
    expect(on(here("/b/biz1/seo/escribir"))).toEqual(["contenido"]);
    expect(on(here("/b/biz1/plan"))).toEqual(["contenido"]);
    expect(on(here("/b/biz1/marca"))).toEqual([]);
  });
});
