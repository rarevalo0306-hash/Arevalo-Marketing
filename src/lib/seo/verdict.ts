// Qué quiere decir una nota de 0 a 100 (auditoría, revisión de tus páginas, Perfil de Google) y cómo se calcula la de
// la auditoría, en palabras simples. Puro: lo usan los paneles y las pruebas.
import type { Issue, Severity } from "@/lib/seo/audit";
import { isSiteLevel } from "@/lib/seo/audit-ids";

export type ScoreLevel = "excellent" | "good" | "fair" | "urgent";

/** 90 o más: excelente · 70 a 89: bien · 50 a 69: regular · menos de 50: urgente. */
export function scoreLevel(score: number): ScoreLevel {
  return score >= 90 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "fair" : "urgent";
}

/** La palabra, la píldora (estilos globales) y qué hacer, para cada nivel. */
export const SCORE_LEVELS: Record<ScoreLevel, { pill: string; es: string; en: string; hintEs: string; hintEn: string }> = {
  excellent: { pill: "done", es: "Excelente", en: "Excellent", hintEs: "Solo detalles: mantenla así.", hintEn: "Only details left: keep it this way." },
  good: { pill: "scheduled", es: "Bien", en: "Good", hintEs: "Hay algunas cosas que mejorar.", hintEn: "A few things to improve." },
  fair: { pill: "partial", es: "Regular", en: "Fair", hintEs: "Le falta bastante: arregla primero lo rojo.", hintEn: "It's missing quite a bit: fix the red items first." },
  urgent: { pill: "failed", es: "Urgente", en: "Urgent", hintEs: "Hay problemas importantes: arréglalos pronto.", hintEn: "There are important problems: fix them soon." },
};

/** La escala para mostrar debajo de la nota. */
export const SCORE_SCALE: { level: ScoreLevel; range: string }[] = [
  { level: "excellent", range: "90–100" },
  { level: "good", range: "70–89" },
  { level: "fair", range: "50–69" },
  { level: "urgent", range: "0–49" },
];

/** Lo que resta cada tipo de problema de la auditoría (el mismo peso que scoreFor en audit.ts). */
export const AUDIT_WEIGHT: Record<Severity, number> = { error: 12, warning: 4, notice: 1 };

/**
 * Cuántos puntos le quitó cada problema a la nota de la auditoría: peso × (0,5 + 0,5 × parte de las páginas), como
 * scoreFor en audit.ts. Sin redondear (la nota sí se redondea). De mayor a menor.
 */
export function auditDeductions(issues: Pick<Issue, "id" | "severity" | "count">[], pageCount: number): { id: Issue["id"]; severity: Severity; points: number }[] {
  return issues
    .map((i) => {
      const share = isSiteLevel(i.id) || pageCount <= 0 ? 1 : Math.min(1, Math.max(0, i.count) / pageCount);
      return { id: i.id, severity: i.severity, points: (AUDIT_WEIGHT[i.severity] ?? 0) * (0.5 + 0.5 * share) };
    })
    .sort((a, b) => b.points - a.points);
}
