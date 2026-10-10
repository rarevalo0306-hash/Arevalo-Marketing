import { describe, expect, it } from "vitest";
import { layoutsFor, listRoutes, matchScore, parseImports, pickFiles, resolveImport, routeForUrl, siteFiles, siteUrlsIn, topLayouts } from "@/lib/webfix-routes";
import { SITE_FILES, siteTree } from "./fixtures/webfix-site";

const tree = siteTree();
const paths = new Set(tree.map((f) => f.path));
const routes = listRoutes(tree);
const read = async (p: string) => SITE_FILES[p] ?? null;

describe("listRoutes / routeForUrl", () => {
  it("reads App Router pages, ignoring route groups and route handlers", () => {
    const byFile = Object.fromEntries(routes.map((r) => [r.file, r.segments.join("/")]));
    expect(byFile["app/(en)/page.tsx"]).toBe("");
    expect(byFile["app/es/servicios/[slug]/page.tsx"]).toBe("es/servicios/[slug]");
    expect(byFile["app/(en)/services/[slug]/page.tsx"]).toBe("services/[slug]");
    expect(routes.some((r) => r.file.includes("route.ts"))).toBe(false);
  });

  it("maps URLs (full or path-only) to the most specific page and its params", () => {
    expect(routeForUrl("https://ricardopa.com/", routes)?.route.file).toBe("app/(en)/page.tsx");
    expect(routeForUrl("https://ricardopa.com/es", routes)?.route.file).toBe("app/es/page.tsx");
    expect(routeForUrl("/es/servicios", routes)?.route.file).toBe("app/es/servicios/page.tsx");
    const m = routeForUrl("https://ricardopa.com/es/servicios/danos-por-agua?x=1#top", routes);
    expect(m?.route.file).toBe("app/es/servicios/[slug]/page.tsx");
    expect(m?.params).toEqual(["danos-por-agua"]);
    expect(routeForUrl("/services/roof-damage/", routes)?.route.file).toBe("app/(en)/services/[slug]/page.tsx");
    expect(routeForUrl("/no/such/page", routes)).toBeNull();
  });

  it("prefers static segments over dynamic ones and supports catch-alls", () => {
    expect(matchScore(["blog", "new"], ["blog", "new"])).toBeGreaterThan(matchScore(["blog", "new"], ["blog", "[slug]"])!);
    expect(matchScore(["docs", "a", "b"], ["docs", "[...slug]"])).not.toBeNull();
    expect(matchScore(["docs"], ["docs", "[...slug]"])).toBeNull();
    expect(matchScore(["docs"], ["docs", "[[...slug]]"])).not.toBeNull();
  });

  it("finds a page's layouts and the site-wide files", () => {
    const r = routeForUrl("/es/servicios/danos-por-agua", routes)!.route;
    expect(layoutsFor(r, paths)).toEqual(["app/es/layout.tsx"]);
    expect(siteFiles(paths)).toEqual(["app/sitemap.ts", "app/robots.ts"]);
    expect(topLayouts(paths)).toEqual(["app/(en)/layout.tsx", "app/es/layout.tsx"]);
  });

  it("also works for src/app projects", () => {
    const t = [{ path: "src/app/page.tsx", size: 10 }, { path: "src/app/(site)/about/page.tsx", size: 10 }, { path: "src/app/_parts/page.tsx", size: 10 }];
    const rs = listRoutes(t);
    expect(rs.map((r) => r.segments.join("/")).sort()).toEqual(["", "about"]);
    expect(routeForUrl("/about", rs)?.route.file).toBe("src/app/(site)/about/page.tsx");
  });
});

describe("imports", () => {
  it("parses and resolves @/, relative and index imports", () => {
    const imports = parseImports(SITE_FILES["app/es/layout.tsx"]);
    expect(imports).toContain("../../lib/ads-measurement");
    expect(resolveImport("app/es/layout.tsx", "../../lib/ads-measurement", paths)).toBe("lib/ads-measurement.ts");
    expect(resolveImport("app/es/page.tsx", "@/lib/preview-site", paths)).toBe("lib/preview-site.ts");
    expect(resolveImport("app/es/page.tsx", "next/navigation", paths)).toBeNull();
    expect(resolveImport("src/app/page.tsx", "@/lib/x", new Set(["src/lib/x/index.ts"]))).toBe("src/lib/x/index.ts");
  });
});

describe("pickFiles", () => {
  it("picks the [slug] page, the data file with that slug and the metadata helper", async () => {
    const picked = await pickFiles(tree, [{ url: "/es/servicios/danos-por-agua", refs: ["title-too-long"] }], read);
    const ps = picked.map((p) => p.path);
    expect(ps[0]).toBe("app/es/servicios/[slug]/page.tsx");
    expect(ps).toContain("lib/preview-services.ts");
    expect(ps).toContain("lib/preview-site.ts");
    expect(ps).toContain("app/es/layout.tsx");
    // Los cambios se agrupan por la página que los pidió.
    expect(picked.find((p) => p.path === "lib/preview-services.ts")?.pages).toEqual(["/es/servicios/danos-por-agua"]);
    // Nunca lee binarios, configuración ni pruebas.
    expect(ps.some((p) => /package|next\.config|tests\/|\.png$/.test(p))).toBe(false);
  });

  it("adds sitemap, robots and top layouts for site-wide issues", async () => {
    const picked = await pickFiles(tree, [], read, { siteWide: true });
    const ps = picked.map((p) => p.path);
    expect(ps).toEqual(expect.arrayContaining(["app/sitemap.ts", "app/robots.ts", "app/(en)/layout.tsx", "app/es/layout.tsx", "app/(en)/page.tsx", "app/es/page.tsx"]));
  });

  it("respects the size budget and the file limit", async () => {
    const picked = await pickFiles(tree, [{ url: "/es/servicios/danos-por-agua", refs: [] }], read, { budget: 1500, maxFiles: 3 });
    expect(picked.length).toBeLessThanOrEqual(3);
    expect(picked.reduce((s, p) => s + p.content.length, 0)).toBeLessThanOrEqual(1500);
    expect(picked[0].path).toBe("app/es/servicios/[slug]/page.tsx");
  });

  it("skips files larger than maxFile", async () => {
    const picked = await pickFiles(tree, [{ url: "/resources/x", refs: [] }], read, { maxFile: 200 });
    expect(picked.map((p) => p.path)).not.toContain("lib/preview-articles.ts");
  });

  it("uses hints from the instructions (sitemap, schema…)", async () => {
    const picked = await pickFiles(tree, [{ url: "/services", refs: [] }], read, { hints: "Fix the sitemap please" });
    expect(picked.map((p) => p.path)).toContain("app/sitemap.ts");
  });
});

describe("siteUrlsIn", () => {
  it("keeps only the business's own URLs, as paths", () => {
    const text = "Fix https://ricardopa.com/es/servicios/danos-por-agua, and https://www.ricardopa.com/services. Ignore https://other.com/x";
    expect(siteUrlsIn(text, "https://ricardopa.com")).toEqual(["/es/servicios/danos-por-agua", "/services"]);
    expect(siteUrlsIn(text, "")).toEqual([]);
  });
});
