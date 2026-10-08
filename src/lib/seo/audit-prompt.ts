// Los problemas de la auditoría como instrucciones para la IA que maneja la página web: cada problema con su gravedad,
// cómo arreglarlo (versión técnica), las direcciones completas y el valor exacto (ej. el título largo). Lo usan
// prompts.ts (todo el reporte) y el panel (un grupo de problemas). Puro: se prueba en tests/audit-*.test.ts.
import type { AuditReport, Issue } from "@/lib/seo/audit";
import { ISSUE_META, type Severity } from "@/lib/seo/audit-ids";
import { AUDIT_AI_FIX, ISSUE_TEXT } from "@/lib/seo/audit-text";
import { absUrl, renderPrompt, type PromptContext, type PromptItem, type PromptLang } from "@/lib/seo/prompt-core";

const L = (lang: PromptLang) => (es: string, en: string) => (lang === "en" ? en : es);
const TAG: Record<Severity, [string, string]> = { error: ["Error", "Error"], warning: ["Advertencia", "Warning"], notice: ["Sugerencia", "Notice"] };
/** Cuántas direcciones (con su valor) se listan por problema. */
const MAX_LINES = 15;

/** «(3 páginas)», «(1 enlace)», «(todo el sitio)»… */
export function issueCountLabel(i: Pick<Issue, "id" | "count" | "total">, lang: PromptLang): string {
  const t = L(lang);
  const n = i.count;
  switch (ISSUE_META[i.id].unit) {
    case "site":
      return t("todo el sitio", "whole site");
    case "links":
      return t(`${n} ${n === 1 ? "enlace" : "enlaces"}`, `${n} ${n === 1 ? "link" : "links"}`);
    case "urls":
      return t(`${n} ${n === 1 ? "dirección" : "direcciones"}`, `${n} ${n === 1 ? "address" : "addresses"}`);
    case "images":
      return t(`${n} ${n === 1 ? "foto" : "fotos"}`, `${n} ${n === 1 ? "image" : "images"}`);
    default: {
      const pages = t(`${n} ${n === 1 ? "página" : "páginas"}`, `${n} ${n === 1 ? "page" : "pages"}`);
      // Hoy solo «wp-com-links» trae total: enlaces o fotos repartidos en varias páginas.
      return i.total ? t(`${i.total} enlaces en ${pages}`, `${i.total} links on ${pages}`) : pages;
    }
  }
}

export function auditPromptItems(issues: Issue[], report: AuditReport, website: string, lang: PromptLang): PromptItem[] {
  const t = L(lang);
  return issues.map((i) => {
    const item: PromptItem = { tag: t(...TAG[i.severity]), title: `${ISSUE_TEXT[i.id][lang].title} (${issueCountLabel(i, lang)})`, how: [AUDIT_AI_FIX[i.id][lang]] };
    const withValues = (i.items ?? []).filter((x) => x.value || x.detail);
    if (i.id === "broken-links" && report.site.brokenLinks.length) {
      const list = report.site.brokenLinks.slice(0, MAX_LINES);
      item.detail = list.map((b) =>
        t(
          `Roto: ${b.url} (responde ${b.status})${b.from.length ? ` · está en: ${b.from.map((f) => absUrl(f, website)).join(", ")}` : ""}`,
          `Broken: ${b.url} (returns ${b.status})${b.from.length ? ` · found on: ${b.from.map((f) => absUrl(f, website)).join(", ")}` : ""}`,
        ),
      );
      if (i.count > list.length) item.moreUrls = i.count - list.length;
    } else if (withValues.length) {
      const list = withValues.slice(0, MAX_LINES);
      item.detail = list.map((x) => {
        const parts = [absUrl(x.url, website)];
        if (x.value) parts.push(`«${x.value}»`);
        if (x.detail) parts.push(`(${x.detail[lang]})`);
        return parts.join(" → ").replace(" → (", " (");
      });
      if (i.count > list.length) item.moreUrls = i.count - list.length;
    } else if (i.pages.length) {
      item.urls = i.pages.map((u) => absUrl(u, website));
      if (i.count > i.pages.length) item.moreUrls = i.count - i.pages.length;
    }
    return item;
  });
}

/** Instrucciones para la IA solo de un grupo de problemas (ej. «Datos estructurados»). Vacío si no hay problemas. */
export function auditGroupPrompt(ctx: PromptContext, report: AuditReport, issues: Issue[], lang: PromptLang, group: string): string {
  if (!issues.length) return "";
  const t = L(lang);
  return renderPrompt({
    ctx,
    lang,
    task: t(
      `Revisamos la página como lo hace Google (nota: ${report.score} de 100). Arregla estos problemas (${group.toLowerCase()}), en este orden.`,
      `We checked the website the way Google does (score: ${report.score} out of 100). Fix these problems (${group.toLowerCase()}), in this order.`,
    ),
    sections: [{ title: group, items: auditPromptItems(issues, report, ctx.website, lang) }],
  });
}
