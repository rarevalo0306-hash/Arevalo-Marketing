// Aviso arriba del Diagnóstico («Resumen»): hacer o continuar el diagnóstico guiado, o una línea si ya está hecho.
import Link from "next/link";
import { loadDiagnosis } from "@/components/diagnosis/load";
import { isComplete, progress, shouldRedo } from "@/lib/diagnosis";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { BUSINESS_TZ } from "@/lib/time";
import s from "./DiagnosisBanner.module.css";

export async function DiagnosisBanner({ businessId }: { businessId: string }) {
  const view = await loadDiagnosis(businessId).catch(() => null);
  if (!view) return null;
  const { lang, t } = await getT();
  const href = `/b/${businessId}/diagnostico`;
  const { completedAt, startedAt } = view.state;

  if (completedAt && isComplete(view.steps)) {
    const date = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeZone: BUSINESS_TZ }).format(new Date(completedAt));
    const old = shouldRedo(completedAt);
    return (
      <p className={s.line}>
        <span>✓ {t(`Diagnóstico hecho el ${date}`, `Diagnosis done on ${date}`)}</span>
        {old && <span className={s.old}>{t("· ya pasó más de un mes", "· over a month ago")}</span>}
        <span aria-hidden>·</span>
        <Link href={`${href}?rehacer=1`}>{t("Volver a hacerlo", "Do it again")}</Link>
      </p>
    );
  }

  const step = progress(view.steps).current;
  return (
    <section className={`card ${s.card}`}>
      <div className={s.text}>
        <h2 className={s.title}>{t(`Haz el diagnóstico guiado de ${view.business.name}`, `Do the guided diagnosis of ${view.business.name}`)}</h2>
        <p className="small muted">
          {t(
            "En 10 pasos la IA conoce tu negocio: lee tu web, revisa tu página, tu competencia, Google Maps y las IAs, y te deja un plan de acción. Te dice el costo antes de gastar.",
            "In 10 steps the AI gets to know your business: it reads your website, checks your site, your competitors, Google Maps and AI assistants, and leaves you an action plan. It tells you the cost before spending.",
          )}
        </p>
      </div>
      <Link className="btn primary" href={href}>
        {startedAt ? t(`Continuar — paso ${step}`, `Continue — step ${step}`) : t("Empezar", "Start")}
      </Link>
    </section>
  );
}
