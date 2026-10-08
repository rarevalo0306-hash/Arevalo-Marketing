// Lo más urgente del plan de acción, en Inicio: las 3 tareas abiertas con más puntaje y el enlace al plan completo.
// Sin tareas no muestra nada.
import Link from "next/link";
import { AREA_LABEL } from "@/lib/action-plan-shape";
import { ensureFreshPlan, loadPlanTasks } from "@/lib/action-plan";
import { getT } from "@/lib/i18n-server";
import s from "./Plan.module.css";

const IMPACT = {
  3: { pill: "bad", es: "Urgente", en: "Urgent" },
  2: { pill: "warn", es: "Importante", en: "Important" },
  1: { pill: "info", es: "Mejora", en: "Nice to have" },
} as const;

export async function ActionPlanToday({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  await ensureFreshPlan(businessId);
  const open = await loadPlanTasks(businessId, lang, { status: "todo" });
  if (!open.length) return null;
  const top = open.slice(0, 3);
  const L = (b: { es: string; en: string }) => (lang === "en" ? b.en : b.es);
  return (
    <section className={`card ${s.today}`} aria-labelledby="plan-today">
      <div className={s.todayHead}>
        <h2 id="plan-today">{t("Tu plan: empieza por aquí", "Your plan: start here")}</h2>
        <span className="small muted">
          {open.length === 1 ? t("1 tarea pendiente", "1 pending task") : t(`${open.length} tareas pendientes`, `${open.length} pending tasks`)}
        </span>
      </div>
      <ol className={s.todayList}>
        {top.map((x) => (
          <li key={x.id} className={s.todayItem}>
            <span className={s.todayText}>
              <span className="row" style={{ gap: 8 }}>
                <span className={`pill ${IMPACT[x.impact].pill}`}>{L(IMPACT[x.impact])}</span>
                <span className="small muted">{L(AREA_LABEL[x.area] ?? AREA_LABEL.web)}</span>
              </span>
              <span className={s.title}>{x.title}</span>
            </span>
            {x.href && (
              <Link href={x.href} className={`btn ${s.todayGo}`}>
                {t("Ir", "Go")} →
              </Link>
            )}
          </li>
        ))}
      </ol>
      <Link href={`/b/${businessId}/seo?tab=resumen#plan`} className={`btn link ${s.seeAll}`}>
        {t("Ver todo el plan", "See the whole plan")} →
      </Link>
    </section>
  );
}
