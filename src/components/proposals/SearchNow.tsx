"use client";

import { useActionState } from "react";
import { proposeNowAction, type ProposalActionState } from "@/app/actions-proposals";
import { useT } from "@/components/I18n";
import s from "./proposals.module.css";

/** «Buscar mejoras ahora»: revisa los resultados ya y deja las propuestas nuevas (la IA cuesta unos centavos). */
export function SearchNow({ businessId, costText }: { businessId: string; costText: string }) {
  const { t } = useT();
  const [state, action, isPending] = useActionState<ProposalActionState, FormData>(proposeNowAction, null);
  return (
    <div className={s.searchNow}>
      <form action={action} style={isPending ? { display: "none" } : undefined}>
        <input type="hidden" name="businessId" value={businessId} />
        <button type="submit" className="btn ai">
          {t("Buscar mejoras ahora", "Look for improvements now")}
        </button>
      </form>
      {isPending && (
        <p className={s.pending} role="status" aria-live="polite">
          <span className={s.spinner} aria-hidden="true" />
          {t("Revisando tus resultados…", "Reviewing your results…")}
        </p>
      )}
      <p className={s.cost}>{costText}</p>
      {state && !isPending && (
        <p className={`note ${state.ok ? "ok" : "error"} ${s.searchMsg}`} role="status" aria-live="polite">
          {state.message}
        </p>
      )}
    </div>
  );
}
