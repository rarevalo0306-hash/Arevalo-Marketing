"use client";

import { useActionState, useEffect, useState } from "react";
import type { ReportResult } from "@/app/actions-seo-report";
import { useT } from "@/components/I18n";
import type { UiLang } from "@/lib/i18n";

type Props = {
  businessId: string;
  send: (prev: ReportResult, f: FormData) => Promise<ReportResult>;
  saveMonthly: (prev: ReportResult, f: FormData) => Promise<ReportResult>;
  /** Los emails guardados en "Avisos por email". */
  recipients: string[];
  monthly: boolean;
  lastMonthly: string | null;
  aiReady: boolean;
  defaultPeriod: "este-mes" | "mes-pasado" | "30-dias";
  defaultLang: UiLang;
};

export function ReportForm({ businessId, send, saveMonthly, recipients, monthly, lastMonthly, aiReady, defaultPeriod, defaultLang }: Props) {
  const { t } = useT();
  const [sent, runSend, sending] = useActionState(send, null);
  const [saved, runSave, saving] = useActionState(saveMonthly, null);
  // Controlados: así no se borran después de mandar el email.
  const [period, setPeriod] = useState<string>(defaultPeriod);
  const [lang, setLang] = useState<string>(defaultLang);
  const [ai, setAi] = useState(aiReady);
  const [mark, setMark] = useState(true);
  const [monthlyOn, setMonthlyOn] = useState(monthly);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (!preparing) return;
    const id = setTimeout(() => setPreparing(false), 12_000);
    return () => clearTimeout(id);
  }, [preparing]);

  const hasEmail = recipients.length > 0;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <form action={`/b/${encodeURIComponent(businessId)}/seo/reporte`} method="get" className="stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
          <div className="stack" style={{ gap: 4, flex: "1 1 160px" }}>
            <label className="lbl" htmlFor="report-period">{t("Periodo", "Period")}</label>
            <select id="report-period" name="periodo" className="field" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="este-mes">{t("Este mes", "This month")}</option>
              <option value="mes-pasado">{t("Mes pasado", "Last month")}</option>
              <option value="30-dias">{t("Últimos 30 días", "Last 30 days")}</option>
            </select>
          </div>
          <div className="stack" style={{ gap: 4, flex: "1 1 140px" }}>
            <label className="lbl" htmlFor="report-lang">{t("Idioma del reporte", "Report language")}</label>
            <select id="report-lang" name="lang" className="field" value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="es">{t("Español", "Spanish")}</option>
              <option value="en">{t("Inglés", "English")}</option>
            </select>
          </div>
        </div>
        <label className="check">
          <input type="hidden" name="ia" value="0" />
          <input type="checkbox" name="ia" value="1" checked={ai} disabled={!aiReady} onChange={(e) => setAi(e.target.checked)} />
          <span>
            <strong>{t("Resumen escrito por la IA", "Summary written by AI")}</strong>
            <span className="small muted" style={{ display: "block" }}>
              {aiReady
                ? t(
                    "La IA explica en palabras sencillas cómo te fue y qué hacer ahora, solo con los números del reporte. Usa unos centavos de IA. Sin marcar, sale un resumen automático.",
                    "The AI explains in plain words how you did and what to do next, using only the report's numbers. It uses a few cents of AI. Unchecked, you get an automatic summary.",
                  )
                : t("No hay una IA conectada en el servidor: el reporte lleva un resumen automático.", "There's no AI connected on the server: the report includes an automatic summary.")}
            </span>
          </span>
        </label>
        <label className="check">
          <input type="hidden" name="marca" value="0" />
          <input type="checkbox" name="marca" value="1" checked={mark} onChange={(e) => setMark(e.target.checked)} />
          <span>
            <strong>{t("Mostrar «Preparado con Matya»", "Show \"Prepared with Matya\"")}</strong>
            <span className="small muted" style={{ display: "block" }}>
              {t("Sin marcar, el pie de cada página lleva solo el nombre de tu negocio.", "Unchecked, each page footer shows only your business name.")}
            </span>
          </span>
        </label>
        {sent && <p className={sent.ok ? "note ok" : "note error"} role="status">{sent.message}</p>}
        {preparing && !sending && (
          <p className="small muted" role="status">
            {t("Preparando el PDF… se descarga solo en unos segundos.", "Preparing the PDF… it will download in a few seconds.")}
          </p>
        )}
        <div className="row" style={{ gap: 10 }}>
          <button type="submit" className="btn on" onClick={() => setPreparing(true)}>
            {t("Descargar PDF", "Download PDF")}
          </button>
          <button type="submit" className="btn" formAction={runSend} disabled={sending || !hasEmail}>
            {sending ? t("Enviando…", "Sending…") : t("Mandar por email", "Send by email")}
          </button>
        </div>
        {hasEmail ? (
          <span className="small muted">
            {t("Se manda a:", "It goes to:")} <strong>{recipients.join(", ")}</strong>
          </span>
        ) : (
          <p className="note" role="status">
            {t("Para mandarlo por email, primero guarda tu email en ", "To send it by email, first save your email in ")}
            <a href="#alertas">{t("Avisos por email", "Email alerts")}</a>.
          </p>
        )}
      </form>
      <form action={runSave} className="stack" style={{ gap: 10 }}>
        <label className="check">
          <input type="checkbox" name="monthly" checked={monthlyOn} onChange={(e) => setMonthlyOn(e.target.checked)} />
          <span>
            <strong>{t("Mandarme el reporte cada mes (el día 1)", "Send me the report every month (on the 1st)")}</strong>
            <span className="small muted" style={{ display: "block" }}>
              {t("Sale el día 1 desde las 8 de la mañana con el mes anterior, al email de los avisos, con el resumen de la IA.", "It goes out on the 1st from 8 a.m. with the previous month, to your alerts email, with the AI summary.")}{" "}
              {lastMonthly
                ? t(`El último se mandó el ${lastMonthly}.`, `The last one was sent on ${lastMonthly}.`)
                : t("Todavía no se ha mandado ninguno.", "None has been sent yet.")}
            </span>
          </span>
        </label>
        {saved && <p className={saved.ok ? "note ok" : "note error"} role="status">{saved.message}</p>}
        <div>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? t("Guardando…", "Saving…") : t("Guardar", "Save")}
          </button>
        </div>
      </form>
    </div>
  );
}
