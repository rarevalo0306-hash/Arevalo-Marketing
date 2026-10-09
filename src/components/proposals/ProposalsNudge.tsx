import Link from "next/link";
import { getT } from "@/lib/i18n-server";
import { openProposalCount } from "@/lib/proposals";
import s from "./proposals.module.css";

/** Tarjeta pequeña del Inicio: «La IA tiene N propuestas para ti» (no se ve si no hay ninguna). */
export async function ProposalsNudge({ businessId }: { businessId: string }) {
  const n = await openProposalCount(businessId).catch(() => 0);
  if (!n) return null;
  const { t } = await getT();
  return (
    <Link href={`/b/${businessId}/propuestas`} className={s.nudge}>
      <span className={s.nudgeIcon} aria-hidden="true">
        ✦
      </span>
      <span className={s.nudgeText}>
        <strong>{n === 1 ? t("La IA tiene 1 propuesta para ti", "The AI has 1 proposal for you") : t(`La IA tiene ${n} propuestas para ti`, `The AI has ${n} proposals for you`)}</strong>
        <span>{t("Mejoras con tus resultados: tú decides si se aplican.", "Improvements from your results: you decide if they're applied.")}</span>
      </span>
      <span className={s.nudgeGo} aria-hidden="true">
        →
      </span>
    </Link>
  );
}
