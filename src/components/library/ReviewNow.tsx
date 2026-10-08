"use client";

// «Revisar ahora»: trae lo nuevo de la carpeta de Drive y muestra lo que pasó.
import { useActionState } from "react";
import { reviewDriveNow } from "@/app/actions-library";
import type { DriveResult } from "@/app/actions-drive";
import { useT } from "@/components/I18n";
import s from "./Library.module.css";

export function ReviewNow({ businessId }: { businessId: string }) {
  const { t } = useT();
  const [state, action, isPending] = useActionState<DriveResult | null, FormData>(reviewDriveNow.bind(null, businessId), null);
  return (
    <div className={s.review}>
      {isPending && (
        <p className={s.pending} role="status">
          <span className={s.spinner} aria-hidden="true" /> {t("Revisando tu carpeta… puede tardar un minuto", "Checking your folder… it may take a minute")}
        </p>
      )}
      <form action={action} style={isPending ? { display: "none" } : undefined}>
        <button type="submit" className="btn outline">
          {t("Revisar ahora", "Check now")}
        </button>
      </form>
      {state?.message && !isPending && (
        <p className={`note ${state.ok ? "ok" : "error"} ${s.reviewMsg}`} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      )}
    </div>
  );
}
