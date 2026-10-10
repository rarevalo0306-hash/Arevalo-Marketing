"use client";

import { useActionState } from "react";
import { setAutoApplyAction, type ProposalActionState } from "@/app/actions-proposals";
import { useT } from "@/components/I18n";
import s from "./proposals.module.css";

/** Permiso de una campaña 100% IA: «La IA puede aplicar sola las propuestas de bajo riesgo (horarios, formatos)». */
export function AutoApplyToggle({ businessId, campaignId, name, on }: { businessId: string; campaignId: string; name: string; on: boolean }) {
  const { t } = useT();
  const [state, action, isPending] = useActionState<ProposalActionState, FormData>(setAutoApplyAction, null);
  return (
    <form action={action} className={s.toggleRow}>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="on" value={on ? "0" : "1"} />
      <div className={s.toggleText}>
        <strong>{name}</strong>
        <span className={s.status}>
          {on ? t("La IA aplica sola los horarios y formatos.", "The AI applies times and formats on its own.") : t("La IA te pide permiso para todo.", "The AI asks your permission for everything.")}
        </span>
        {state && !isPending && (
          <span className={state.ok ? s.okText : s.badText} role="status">
            {state.message}
          </span>
        )}
      </div>
      <button type="submit" className={`btn ${on ? "" : "outline"}`} disabled={isPending} aria-pressed={on}>
        {isPending ? t("Guardando…", "Saving…") : on ? t("Apagar", "Turn off") : t("Permitir", "Allow")}
      </button>
    </form>
  );
}
