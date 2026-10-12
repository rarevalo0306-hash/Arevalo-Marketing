import Link from "next/link";
import type { ApprovalItem } from "@/lib/approvals-shape";
import { getT } from "@/lib/i18n-server";
import s from "./Dashboard.module.css";

/**
 * «Listo para tu aprobación»: la franja oscura del Inicio (turquesa en Noche) con lo que la IA dejó preparado. Una
 * tarjeta por origen (posiciones, arreglos de la web, propuestas, artículos, campañas) con su enlace. Sin nada: no se ve.
 */
export async function ApprovalBand({ items }: { items: ApprovalItem[] }) {
  if (!items.length) return null;
  const { lang, t } = await getT();
  const L = (b: { es: string; en: string }) => (lang === "en" ? b.en : b.es);
  return (
    <section className={s.band} aria-labelledby="dash-approve">
      <div className={s.bandHead}>
        <h2 id="dash-approve">{t("Listo para tu aprobación", "Ready for your approval")}</h2>
        <span className={s.bandHint}>{t("Estas tareas esperan tu revisión", "These tasks await your review")}</span>
      </div>
      <ul className={s.bandCards}>
        {items.map((x) => (
          <li key={x.key} className={s.bandCard}>
            <span className={s.bandSource}>{L(x.source)}</span>
            <span className={s.bandSummary}>{L(x.summary)}</span>
            <Link href={x.href} className={s.bandGo}>
              {L(x.cta)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
