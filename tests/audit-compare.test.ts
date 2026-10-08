import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AuditReport, type Issue, issueView, readAuditReport, scoreFor } from "@/lib/seo/audit";
import { checksOf, compareAudits } from "@/lib/seo/audit-compare";
import { ISSUE_IDS, LEGACY_ISSUE_IDS } from "@/lib/seo/audit-ids";
import { auditGroupPrompt, auditPromptItems, issueCountLabel } from "@/lib/seo/audit-prompt";
import type { PromptContext } from "@/lib/seo/prompt-core";
import { auditPrompt } from "@/lib/seo/prompts";

/** Un reporte real guardado con la primera versión de la auditoría (ricardopa.com, 30 páginas). */
const OLD = JSON.parse(readFileSync(new URL("./fixtures/audit-v1-report.json", import.meta.url), "utf8")) as unknown;

const issue = (id: Issue["id"], urls: string[], over: Partial<Issue> = {}): Issue => ({
  id,
  severity: "warning",
  count: urls.length,
  pages: urls.slice(0, 10),
  items: urls.map((url) => ({ url })),
  ...over,
});

const report = (issues: Issue[], over: Partial<AuditReport> = {}): AuditReport => ({
  version: 2,
  website: "https://x.com/",
  startedAt: "",
  finishedAt: "",
  pages: [],
  site: { home: "https://x.com/", robots: true, sitemap: true, sitemapUrls: 0, https: true, httpRedirects: true, localBusinessSchema: true, brokenLinks: [], checkedLinks: 0, stoppedEarly: false },
  pagespeed: { error: "—" },
  issues,
  score: 80,
  checks: [...ISSUE_IDS],
  ...over,
});

describe("reportes viejos (versión 1)", () => {
  const r = readAuditReport(OLD)!;

  it("se siguen leyendo y mostrando igual", () => {
    expect(r).not.toBeNull();
    expect(r.version).toBe(1);
    expect(r.score).toBe(95);
    expect(r.pages).toHaveLength(30);
    expect(r.issues.map((i) => i.id)).toEqual(["title-too-long", "noindex", "description-length"]);
    // Las páginas viejas no inventan campos nuevos.
    expect(r.pages[0].hasMain).toBeUndefined();
    expect(r.pages[0].schemaFindings).toBeUndefined();
    expect(r.site.robotsAi).toBeUndefined();
    expect(r.site.llms).toBeUndefined();
    expect(r.checks).toBeUndefined();
  });

  it("cada problema viejo recibe su grupo y sus direcciones como lista", () => {
    const t = r.issues[0];
    expect(t.category).toBe("meta");
    expect(t.count).toBe(12);
    expect(t.pages).toHaveLength(10);
    expect(t.items!.map((x) => x.url)).toEqual(t.pages);
    const v = issueView(t);
    expect(v.title.es).toBe("Títulos muy largos");
    expect(v.categoryLabel.en).toBe("Meta (titles and descriptions)");
    expect(v.unit).toBe("pages");
    expect(v.items).toHaveLength(10);
  });

  it("solo se revisaban los 23 problemas de la versión 1", () => {
    expect(checksOf(r)).toEqual([...LEGACY_ISSUE_IDS]);
  });

  it("la nota guardada coincide con la cuenta", () => {
    expect(scoreFor(r.issues, r.pages.length)).toBe(r.score);
  });

  it("las instrucciones para la IA funcionan con un reporte viejo", () => {
    const ctx: PromptContext = { name: "Ricardo Public Adjusters", website: "https://ricardopa.com", area: "Miami", sells: [], about: "", repo: "", branch: "" };
    const p = auditPrompt(ctx, r, "en");
    expect(p).toContain("[Warning] Titles too long (12 pages)");
    expect(p).toContain("…and 2 more");
  });

  it("guardado y vuelto a leer, un reporte nuevo queda igual", () => {
    const now = report([issue("title-too-long", ["https://x.com/a"], { category: "meta", items: [{ url: "https://x.com/a", value: "Un título larguísimo", detail: { es: "72 letras", en: "72 characters" } }] })]);
    expect(readAuditReport(JSON.parse(JSON.stringify(now)))).toEqual(now);
  });
});

describe("comparar revisiones", () => {
  it("por problema: cuántas se arreglaron y cuántas son nuevas, y la nota", () => {
    const prev = report([issue("title-too-long", ["https://x.com/a", "https://x.com/b", "https://x.com/c"]), issue("noindex", ["https://x.com/p"])], { score: 70 });
    const cur = report([issue("title-too-long", ["https://x.com/c", "https://x.com/d"])], { score: 85 });
    const c = compareAudits(cur, prev)!;
    expect(c.scoreDelta).toBe(15);
    expect(c.prevScore).toBe(70);
    expect(c.issues["title-too-long"]).toEqual({ fixed: 2, added: 1, newCheck: false });
    expect(c.gone).toEqual([{ id: "noindex", severity: "warning", count: 1 }]);
    expect(c.totals).toEqual({ fixed: 3, added: 1 });
    expect(c.newChecks).toEqual([]);
  });

  it("un problema que no existía: nuevas = todas", () => {
    const c = compareAudits(report([issue("thin-content", ["https://x.com/a", "https://x.com/b"])]), report([]))!;
    expect(c.issues["thin-content"]).toEqual({ fixed: 0, added: 2, newCheck: false });
  });

  it("si solo se guardaron las primeras direcciones, se compara por cantidad", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `https://x.com/p${i}`);
    const prev = report([{ ...issue("title-too-long", many(12)), items: undefined, pages: many(10) }]);
    const cur = report([{ ...issue("title-too-long", many(8)), items: undefined, pages: many(8) }]);
    expect(compareAudits(cur, prev)!.issues["title-too-long"]).toEqual({ fixed: 4, added: 0, newCheck: false });
  });

  it("contra un reporte viejo: lo que antes no se revisaba es «revisión nueva», no un problema nuevo", () => {
    const old = readAuditReport(OLD)!;
    const cur = report(
      [
        issue("title-too-long", old.issues[0].pages.slice(0, 5)),
        issue("schema-wrong-property", ["https://ricardopa.com/", "https://ricardopa.com/es"]),
        issue("llms-txt-missing", ["https://ricardopa.com/llms.txt"]),
      ],
      { score: 89 },
    );
    const c = compareAudits(cur, old)!;
    expect(c.issues["schema-wrong-property"]).toEqual({ fixed: 0, added: 0, newCheck: true });
    expect(c.issues["llms-txt-missing"]!.newCheck).toBe(true);
    // El viejo guardó 10 de 12: se compara por cantidad.
    expect(c.issues["title-too-long"]).toEqual({ fixed: 7, added: 0, newCheck: false });
    expect(c.gone.map((g) => g.id)).toEqual(["noindex", "description-length"]);
    expect(c.newChecks).toHaveLength(ISSUE_IDS.length - LEGACY_ISSUE_IDS.length);
    expect(c.scoreDelta).toBe(-6);
  });

  it("lo que no se pudo revisar esta vez no cuenta como arreglado", () => {
    const prev = report([issue("llms-txt-missing", ["https://x.com/llms.txt"])]);
    const cur = report([], { checks: ISSUE_IDS.filter((id) => id !== "llms-txt-missing") });
    expect(compareAudits(cur, prev)!.gone).toEqual([]);
  });

  it("sin revisión anterior no hay comparación", () => {
    expect(compareAudits(report([]), null)).toBeNull();
  });
});

describe("instrucciones para la IA por grupo", () => {
  const ctx: PromptContext = { name: "Techos Pérez", website: "https://x.com", area: "Miami", sells: ["Techos"], about: "", repo: "", branch: "" };
  const r = report([
    issue("schema-wrong-property", ["https://x.com/"], { items: [{ url: "https://x.com/", value: "LocalBusiness.availableLanguage → contactPoint (ContactPoint)" }] }),
    issue("llms-txt-missing", ["https://x.com/llms.txt"], { severity: "notice", items: [{ url: "https://x.com/llms.txt", detail: { es: "No existe (no encontrada)", en: "Doesn't exist (not found)" } }] }),
    issue("wp-com-links", ["https://x.com/a", "https://x.com/b"], { total: 695 }),
  ]);

  it("lleva el valor exacto, la dirección completa y cómo arreglarlo", () => {
    const p = auditGroupPrompt(ctx, r, [r.issues[0]], "es", "Datos estructurados");
    expect(p).toContain("Datos estructurados");
    expect(p).toContain("[Advertencia] Datos para Google en el lugar equivocado (1 página)");
    expect(p).toContain("https://x.com/ → «LocalBusiness.availableLanguage → contactPoint (ContactPoint)»");
    expect(p).toContain("contactPoint");
  });

  it("dice en qué se cuenta cada problema", () => {
    expect(issueCountLabel(r.issues[1], "es")).toBe("todo el sitio");
    expect(issueCountLabel(r.issues[2], "en")).toBe("695 links on 2 pages");
    const items = auditPromptItems([r.issues[1]], r, "https://x.com", "en");
    expect(items[0].detail).toEqual(["https://x.com/llms.txt (Doesn't exist (not found))"]);
  });

  it("sin problemas no hay texto", () => {
    expect(auditGroupPrompt(ctx, r, [], "es", "IA")).toBe("");
  });
});
