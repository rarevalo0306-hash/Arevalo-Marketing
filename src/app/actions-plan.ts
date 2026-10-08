"use server";

// El plan de acción único: volver a armarlo (gratis, solo lee los reportes guardados) y marcar cada tarea como hecha,
// «no aplica» o pendiente otra vez (también sirve para deshacer).
import { revalidatePath } from "next/cache";
import { refreshActionPlan } from "@/lib/action-plan";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";

export type PlanRefreshResult = { ok: boolean; message: string } | null;

const revalidate = (businessId: string) => {
  revalidatePath(`/b/${businessId}/seo`);
  revalidatePath(`/b/${businessId}/inicio`);
};

/** «Actualizar plan»: vuelve a juntar lo último de cada reporte. No llama a ninguna API ni cobra nada. */
export async function refreshPlanAction(businessId: string, _prev: PlanRefreshResult, _f?: FormData): Promise<PlanRefreshResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  try {
    const r = await refreshActionPlan(businessId, lang);
    revalidate(businessId);
    const added = r.added
      ? t(` ${r.added} ${r.added === 1 ? "tarea nueva" : "tareas nuevas"}.`, ` ${r.added} new ${r.added === 1 ? "task" : "tasks"}.`)
      : t(" No hay tareas nuevas.", " No new tasks.");
    const gone = r.gone ? t(` ${r.gone} ya no aparecen en los reportes.`, ` ${r.gone} no longer show up in the reports.`) : "";
    return { ok: true, message: t("Plan al día.", "Plan up to date.") + added + gone };
  } catch (e) {
    console.error("[plan] refresh action", e);
    return { ok: false, message: t("No se pudo actualizar el plan. Intenta de nuevo en un momento.", "Couldn't update the plan. Please try again in a moment.") };
  }
}

export type TaskStatusResult = {
  ok: boolean;
  message: string;
  /** La tarea que cambió y cómo estaba antes (para «Deshacer»). */
  id?: string;
  status?: "todo" | "done" | "dismissed";
  prev?: "todo" | "done" | "dismissed";
  prevDoneAt?: string | null;
  /** Para distinguir dos cambios seguidos de la misma tarea. */
  at?: number;
} | null;

const STATUSES = ["todo", "done", "dismissed"] as const;
type Status = (typeof STATUSES)[number];
const asStatus = (v: unknown): Status | null => (STATUSES.includes(v as Status) ? (v as Status) : null);

/**
 * Marca una tarea: done («✓ Hecha»), dismissed («No aplica») o todo (volver a abrirla / deshacer).
 * Campos del formulario: id, status y, para deshacer, doneAt (la fecha que tenía antes).
 */
export async function setTaskStatus(businessId: string, _prev: TaskStatusResult, f: FormData): Promise<TaskStatusResult> {
  void _prev;
  const { t } = await getT();
  const id = String(f.get("id") ?? "");
  const status = asStatus(f.get("status"));
  if (!id || !status) return { ok: false, message: t("No se pudo guardar el cambio.", "Couldn't save the change.") };
  const task = await db.actionTask.findFirst({ where: { id, businessId }, select: { id: true, status: true, doneAt: true } });
  if (!task) return { ok: false, message: t("Esa tarea ya no existe. Actualiza el plan.", "That task no longer exists. Update the plan.") };
  const prev = asStatus(task.status) ?? "todo";
  // Al deshacer una tarea hecha se recupera su fecha; al marcarla hecha, la fecha es ahora.
  const undoDate = String(f.get("doneAt") ?? "");
  const doneAt = status === "done" ? (undoDate && !isNaN(Date.parse(undoDate)) ? new Date(undoDate) : new Date()) : null;
  await db.actionTask.update({ where: { id }, data: { status, doneAt } });
  revalidate(businessId);
  const message =
    status === "done"
      ? t("¡Bien! Tarea marcada como hecha.", "Nice! Task marked as done.")
      : status === "dismissed"
        ? t("Listo: no volverá a salir en tu plan.", "Done: it won't show up in your plan again.")
        : t("La tarea volvió a tu plan.", "The task is back in your plan.");
  return { ok: true, message, id, status, prev, prevDoneAt: task.doneAt?.toISOString() ?? null, at: Date.now() };
}
