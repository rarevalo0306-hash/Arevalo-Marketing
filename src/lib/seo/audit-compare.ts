// Comparar dos revisiones del sitio: por cada problema, cuántas páginas se arreglaron y cuántas son nuevas, qué
// problemas desaparecieron del todo y cuánto cambió la nota. Puro: lo usan el panel y las pruebas.
import { ISSUE_IDS, LEGACY_ISSUE_IDS, SEVERITY_RANK, type IssueId, type Severity } from "@/lib/seo/audit-ids";
import type { AuditReport, Issue } from "@/lib/seo/audit";

export type IssueDiff = {
  /** Páginas (o direcciones) que tenían el problema y ya no. */
  fixed: number;
  /** Páginas (o direcciones) que no lo tenían y ahora sí. */
  added: number;
  /** Este problema no se revisaba la vez anterior (la revisión ahora es más completa). */
  newCheck: boolean;
};

export type AuditCompare = {
  prevScore: number;
  scoreDelta: number;
  /** Lo que cambió en cada problema que hay ahora. */
  issues: Partial<Record<IssueId, IssueDiff>>;
  /** Problemas que había la vez anterior y ya no aparecen (arreglados del todo). */
  gone: { id: IssueId; severity: Severity; count: number }[];
  /** Problemas que se revisan ahora y la vez anterior no. */
  newChecks: IssueId[];
  totals: { fixed: number; added: number };
};

/** Qué problemas se revisaron en un reporte (los viejos, versión 1, solo tenían 23). */
export const checksOf = (r: AuditReport): IssueId[] => (r.checks?.length ? r.checks : r.version === 2 ? [...ISSUE_IDS] : [...LEGACY_ISSUE_IDS]);

/** Las direcciones afectadas que se guardaron (los problemas de todo el sitio cuentan como una sola «dirección»). */
function keys(i: Issue): string[] {
  const urls = i.items?.length ? i.items.map((x) => x.url) : i.pages;
  return [...new Set(urls)];
}
/** ¿Se guardaron todas las direcciones afectadas (y no solo las primeras)? */
const complete = (i: Issue, k: string[]) => k.length >= i.count;

export function compareAudits(cur: AuditReport, prev: AuditReport | null): AuditCompare | null {
  if (!prev) return null;
  const before = new Map(prev.issues.map((i) => [i.id, i]));
  const now = new Map(cur.issues.map((i) => [i.id, i]));
  const prevChecks = new Set(checksOf(prev));
  const curChecks = new Set(checksOf(cur));
  const issues: Partial<Record<IssueId, IssueDiff>> = {};
  let fixedTotal = 0;
  let addedTotal = 0;

  for (const i of cur.issues) {
    const p = before.get(i.id);
    if (!p) {
      const newCheck = !prevChecks.has(i.id);
      issues[i.id] = { fixed: 0, added: newCheck ? 0 : i.count, newCheck };
      if (!newCheck) addedTotal += i.count;
      continue;
    }
    const a = keys(i);
    const b = keys(p);
    let fixed: number;
    let added: number;
    if (complete(i, a) && complete(p, b)) {
      const sa = new Set(a);
      const sb = new Set(b);
      fixed = b.filter((u) => !sa.has(u)).length;
      added = a.filter((u) => !sb.has(u)).length;
    } else {
      // Solo se guardaron las primeras direcciones: se compara por cantidad.
      fixed = Math.max(0, p.count - i.count);
      added = Math.max(0, i.count - p.count);
    }
    issues[i.id] = { fixed, added, newCheck: false };
    fixedTotal += fixed;
    addedTotal += added;
  }

  const gone = prev.issues
    .filter((p) => !now.has(p.id) && curChecks.has(p.id))
    .map((p) => ({ id: p.id, severity: p.severity, count: p.count }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count);
  fixedTotal += gone.reduce((s, g) => s + g.count, 0);

  return {
    prevScore: prev.score,
    scoreDelta: cur.score - prev.score,
    issues,
    gone,
    newChecks: [...curChecks].filter((id) => !prevChecks.has(id)),
    totals: { fixed: fixedTotal, added: addedTotal },
  };
}
