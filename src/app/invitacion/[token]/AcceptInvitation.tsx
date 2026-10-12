"use client";

import { useActionState } from "react";
import { acceptInvitationAction, type TeamResult } from "@/app/actions-team";
import { useT } from "@/components/I18n";

/** «Aceptar» para quien ya entró con el correo invitado. Si sale bien, la acción lo lleva al inicio; si no, dice por qué. */
export function AcceptInvitation({ token }: { token: string }) {
  const { t } = useT();
  const [result, run, pending] = useActionState(async (): Promise<TeamResult> => acceptInvitationAction(token), null);
  return (
    <form action={run} className="stack" style={{ gap: 10 }}>
      <button className="primary" type="submit" disabled={pending}>
        {pending ? t("Aceptando…", "Accepting…") : t("Aceptar", "Accept")}
      </button>
      {!pending && result && !result.ok && (
        <p className="note error" role="alert">
          {result.message}
        </p>
      )}
    </form>
  );
}
