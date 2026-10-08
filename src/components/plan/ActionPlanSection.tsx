// El plan de acción único, arriba del Diagnóstico (pestaña Resumen): junta lo que encontraron todas las herramientas
// en una lista de tareas con prioridad. Solo lee la base de datos; si hay un reporte más nuevo que el plan, lo
// vuelve a armar antes de mostrarlo (gratis).
import Link from "next/link";
import { ensureFreshPlan, latestPlanSummary, loadPlanTasks } from "@/lib/action-plan";
import { getT } from "@/lib/i18n-server";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { PlanBoard } from "./PlanBoard";
import s from "./Plan.module.css";

export async function ActionPlanSection({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const { hasReports } = await ensureFreshPlan(businessId);
  const [tasks, summary] = await Promise.all([loadPlanTasks(businessId, lang), latestPlanSummary(businessId)]);

  if (!hasReports && tasks.length === 0) {
    return (
      <section className={`card ${s.root}`} id="plan" aria-labelledby="plan-title">
        <h2 id="plan-title">{t("Tu plan de acción", "Your action plan")}</h2>
        <div className={s.empty}>
          <p>
            {t(
              "Todavía no hay estudios para armar tu plan. Haz el diagnóstico guiado y aquí verás qué hacer primero.",
              "There are no checks yet to build your plan. Run the guided diagnosis and you'll see here what to do first.",
            )}
          </p>
          <Link href={`/b/${businessId}/diagnostico`} className="btn on">
            {t("Diagnóstico guiado", "Guided diagnosis")} →
          </Link>
        </div>
      </section>
    );
  }

  const doneLabels: Record<string, string> = {};
  for (const x of tasks) if (x.status === "done" && x.doneAt) doneLabels[x.id] = fmtDate(x.doneAt, lang);
  return (
    <section className={`card ${s.root}`} id="plan" aria-label={t("Tu plan de acción", "Your action plan")}>
      <PlanBoard businessId={businessId} tasks={tasks} updated={summary ? fmtDateTime(summary.at, lang) : null} doneLabels={doneLabels} />
    </section>
  );
}
