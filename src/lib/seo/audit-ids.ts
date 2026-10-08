// Los problemas que busca la auditoría del sitio: un id estable por problema, su gravedad, su grupo (categoría) y en
// qué se cuenta. Puro y sin dependencias: lo usan audit.ts, el panel, el plan de acción y las pruebas.
// Regla: un id nunca cambia de nombre ni de significado (el plan de acción guarda tareas por id).

export type Severity = "error" | "warning" | "notice";

/** Los 23 problemas de la primera versión (reportes viejos, version 1). */
export const LEGACY_ISSUE_IDS = [
  "page-errors",
  "broken-links",
  "missing-title",
  "no-https",
  "no-viewport",
  "http-no-redirect",
  "noindex",
  "duplicate-title",
  "title-too-long",
  "missing-description",
  "duplicate-description",
  "missing-h1",
  "images-no-alt",
  "slow-page",
  "no-sitemap",
  "no-structured-data",
  "title-too-short",
  "description-length",
  "multiple-h1",
  "thin-content",
  "no-og-image",
  "missing-lang",
  "no-robots",
] as const;

/** Los que se agregaron en la versión 2 (revisión más profunda, como el Site Audit de Semrush). */
export const NEW_ISSUE_IDS = [
  "robots-blocks-site",
  "schema-invalid-json",
  "mixed-content",
  "www-mismatch",
  "wp-junk-urls",
  "sitemap-bad-urls",
  "schema-wrong-property",
  "schema-business-incomplete",
  "schema-opening-hours",
  "ai-search-bots-blocked",
  "duplicate-content",
  "broken-images",
  "wp-com-links",
  "hreflang-missing",
  "orphan-pages",
  "deep-pages",
  "single-inlink",
  "ai-training-bots-blocked",
  "llms-txt-missing",
  "llms-txt-invalid",
  "long-paragraphs",
  "weak-semantic-html",
  "schema-org-incomplete",
  "h1-same-as-title",
  "low-text-ratio",
  "too-many-links",
  "large-html",
] as const;

export const ISSUE_IDS = [...LEGACY_ISSUE_IDS, ...NEW_ISSUE_IDS] as const;
export type IssueId = (typeof ISSUE_IDS)[number];
export const isIssueId = (v: unknown): v is IssueId => typeof v === "string" && (ISSUE_IDS as readonly string[]).includes(v);

/** Grupos del panel (Rastreo, Contenido, Meta, Datos estructurados, IA, Rendimiento, Seguridad, Enlaces). */
export const ISSUE_CATEGORIES = ["crawl", "content", "meta", "schema", "ai", "performance", "security", "links"] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<IssueCategory, { es: string; en: string }> = {
  crawl: { es: "Rastreo", en: "Crawling" },
  content: { es: "Contenido", en: "Content" },
  meta: { es: "Meta (títulos y descripciones)", en: "Meta (titles and descriptions)" },
  schema: { es: "Datos estructurados", en: "Structured data" },
  ai: { es: "IA", en: "AI search" },
  performance: { es: "Rendimiento", en: "Performance" },
  security: { es: "Seguridad", en: "Security" },
  links: { es: "Enlaces", en: "Links" },
};

/**
 * En qué se cuenta `count`: páginas, enlaces, direcciones, fotos o todo el sitio. Los de "site" restan el peso completo
 * en la nota (son de todo el sitio).
 */
export type IssueUnit = "pages" | "links" | "urls" | "images" | "site";

export type IssueMeta = { severity: Severity; category: IssueCategory; unit: IssueUnit };

export const ISSUE_META: Record<IssueId, IssueMeta> = {
  // ----- versión 1 -----
  "page-errors": { severity: "error", category: "crawl", unit: "pages" },
  "broken-links": { severity: "error", category: "links", unit: "links" },
  "missing-title": { severity: "error", category: "meta", unit: "pages" },
  "no-https": { severity: "error", category: "security", unit: "pages" },
  "no-viewport": { severity: "error", category: "performance", unit: "pages" },
  "http-no-redirect": { severity: "warning", category: "security", unit: "site" },
  noindex: { severity: "warning", category: "crawl", unit: "pages" },
  "duplicate-title": { severity: "warning", category: "meta", unit: "pages" },
  "title-too-long": { severity: "warning", category: "meta", unit: "pages" },
  "missing-description": { severity: "warning", category: "meta", unit: "pages" },
  "duplicate-description": { severity: "warning", category: "meta", unit: "pages" },
  "missing-h1": { severity: "warning", category: "content", unit: "pages" },
  "images-no-alt": { severity: "warning", category: "content", unit: "pages" },
  "slow-page": { severity: "warning", category: "performance", unit: "pages" },
  "no-sitemap": { severity: "warning", category: "crawl", unit: "site" },
  "no-structured-data": { severity: "warning", category: "schema", unit: "site" },
  "title-too-short": { severity: "notice", category: "meta", unit: "pages" },
  "description-length": { severity: "notice", category: "meta", unit: "pages" },
  "multiple-h1": { severity: "notice", category: "content", unit: "pages" },
  "thin-content": { severity: "notice", category: "content", unit: "pages" },
  "no-og-image": { severity: "notice", category: "meta", unit: "pages" },
  "missing-lang": { severity: "notice", category: "meta", unit: "pages" },
  "no-robots": { severity: "notice", category: "crawl", unit: "site" },
  // ----- versión 2 -----
  "robots-blocks-site": { severity: "error", category: "crawl", unit: "site" },
  "schema-invalid-json": { severity: "error", category: "schema", unit: "pages" },
  "mixed-content": { severity: "warning", category: "security", unit: "pages" },
  "www-mismatch": { severity: "warning", category: "crawl", unit: "site" },
  "wp-junk-urls": { severity: "warning", category: "crawl", unit: "urls" },
  "sitemap-bad-urls": { severity: "warning", category: "crawl", unit: "urls" },
  "schema-wrong-property": { severity: "warning", category: "schema", unit: "pages" },
  "schema-business-incomplete": { severity: "warning", category: "schema", unit: "pages" },
  "schema-opening-hours": { severity: "warning", category: "schema", unit: "pages" },
  "ai-search-bots-blocked": { severity: "warning", category: "ai", unit: "site" },
  "duplicate-content": { severity: "warning", category: "content", unit: "pages" },
  "broken-images": { severity: "warning", category: "content", unit: "images" },
  "wp-com-links": { severity: "warning", category: "links", unit: "pages" },
  "hreflang-missing": { severity: "warning", category: "meta", unit: "pages" },
  "orphan-pages": { severity: "notice", category: "links", unit: "pages" },
  "deep-pages": { severity: "notice", category: "links", unit: "pages" },
  "single-inlink": { severity: "notice", category: "links", unit: "pages" },
  "ai-training-bots-blocked": { severity: "notice", category: "ai", unit: "site" },
  "llms-txt-missing": { severity: "notice", category: "ai", unit: "site" },
  "llms-txt-invalid": { severity: "notice", category: "ai", unit: "site" },
  "long-paragraphs": { severity: "notice", category: "ai", unit: "pages" },
  "weak-semantic-html": { severity: "notice", category: "ai", unit: "pages" },
  "schema-org-incomplete": { severity: "notice", category: "schema", unit: "pages" },
  "h1-same-as-title": { severity: "notice", category: "content", unit: "pages" },
  "low-text-ratio": { severity: "notice", category: "content", unit: "pages" },
  "too-many-links": { severity: "notice", category: "links", unit: "pages" },
  "large-html": { severity: "notice", category: "performance", unit: "pages" },
};

export const ISSUE_SEVERITY = Object.fromEntries(ISSUE_IDS.map((id) => [id, ISSUE_META[id].severity])) as Record<IssueId, Severity>;

/** Problemas de todo el sitio (no de páginas sueltas): restan el peso completo en la nota. */
export const isSiteLevel = (id: string) => isIssueId(id) && ISSUE_META[id].unit === "site";

export const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, notice: 2 };
