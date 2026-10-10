"use client";

// «Descargar PDF» y «Enviarme este reporte por email» del rango que se está viendo.
import { useActionState } from "react";
import type { ReportActionResult } from "@/app/actions-reports";
import { useT } from "@/components/I18n";
import s from "./reports.module.css";

type Props = {
  pdfHref: string;
  fromDay: string;
  toDay: string;
  sendEmail: (prev: ReportActionResult, f: FormData) => Promise<ReportActionResult>;
  /** A quién llegaría (para decirlo en el botón) o "" si falta el email. */
  recipients: string;
};

export function ReportActions({ pdfHref, fromDay, toDay, sendEmail, recipients }: Props) {
  const { t } = useT();
  const [res, run, pending] = useActionState(sendEmail, null);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className={s.actions}>
        <a className="btn outline" href={pdfHref} download>
          {t("Descargar PDF", "Download PDF")}
        </a>
        <form action={run}>
          <input type="hidden" name="desde" value={fromDay} />
          <input type="hidden" name="hasta" value={toDay} />
          <button type="submit" className="btn" disabled={pending || !recipients}>
            {pending ? t("Enviando…", "Sending…") : t("Enviarme este reporte por email", "Email me this report")}
          </button>
        </form>
      </div>
      {!recipients ? (
        <span className="small muted">{t("Para mandarlo por email, guarda primero un email en «Ajustes del reporte» (abajo).", "To email it, first save an email in \"Report settings\" (below).")}</span>
      ) : (
        !res && <span className="small muted">{t(`Llega a: ${recipients}`, `Goes to: ${recipients}`)}</span>
      )}
      {res && (
        <p className={res.ok ? "note ok" : "note error"} role="status">
          {res.message}
        </p>
      )}
    </div>
  );
}
