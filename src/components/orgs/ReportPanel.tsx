"use client";

// «Reporte semanal» de una organización de cliente: a quién le llega, qué día y a qué hora, y cómo le fue al último envío.
// Sin abrir nada se ve una línea con lo programado y otra con el último envío (un fallo no se esconde). Abierto, trae el
// formulario de los ajustes y los botones para mandar una prueba o el reporte ya. Los tres hablan por el mismo aviso.
// Esta pantalla corre en el navegador: de client-org-report.ts y client-orgs-store.ts (que traen la base de datos) solo
// toma tipos, nunca valores.
import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { saveClientOrgReportAction, sendClientOrgNowAction, sendClientOrgTestAction, type OrgResult } from "@/app/actions-client-orgs";
import { failed, focusLost } from "@/components/action-result";
import { useT } from "@/components/I18n";
import { COMMON_TZS, isValidTz, tzName } from "@/lib/business-tz";
import type { ReportSettings } from "@/lib/client-org-report";
import type { LastSend } from "@/lib/client-orgs-store";
import type { T, UiLang } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/time";
import type { Org } from "./ClientOrgs";
import s from "./Orgs.module.css";

/** Lo más largo que acepta el servidor (client-org-report.ts); tests/client-orgs-page.test.tsx revisa que sigan siendo los mismos. */
export const CONTACT_MAX = 120;
export const PHONE_MAX = 40;

/** Un envío que sigue en «sending» pasado este rato ya no está enviando: el proceso que lo hacía se cortó. */
const SENDING_MAX_MS = 30 * 60_000;

const DAYS: Record<UiLang, string[]> = {
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

/** "lunes" (0 = domingo … 6 = sábado). */
export const dayLabel = (day: number, lang: UiLang): string => DAYS[lang][day] ?? String(day);

/** La hora en punto con reloj de 12 horas: 0 → "12:00 a. m.", 13 → "1:00 p. m." (en inglés "12:00 AM", "1:00 PM"). */
export function hourLabel(hour: number, lang: UiLang): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const half = hour < 12 ? (lang === "en" ? "AM" : "a. m.") : lang === "en" ? "PM" : "p. m.";
  return `${h12}:00 ${half}`;
}

/** La pregunta antes de mandar una prueba (se hace con window.confirm). */
export const testQuestion = (t: T) => t("¿Te mandamos una prueba del reporte de la semana pasada a tu email?", "Send a test of last week's report to your email?");

/** La pregunta antes de mandar el reporte ya, con los emails a los que llegaría. */
export const sendNowQuestion = (emails: string, t: T) => t(`¿Mandamos ahora el reporte de la semana pasada a ${emails}?`, `Send last week's report to ${emails} now?`);

/** La línea de abajo del título: "Reporte: lunes 8:00 a. m. a juan@x.com", o que está apagado. */
function scheduleLine(r: ReportSettings, lang: UiLang, t: T): string {
  if (!r.reportOn) return t("Reporte apagado", "Report off");
  const when = `${dayLabel(r.reportDay, lang)} ${hourLabel(r.reportHour, lang)}`;
  const emails = r.reportEmail.trim();
  if (!emails) return t(`Reporte: ${when}, sin email`, `Report: ${when}, no email`);
  return t(`Reporte: ${when} a ${emails}`, `Report: ${when} to ${emails}`);
}

/**
 * El último envío en una línea: cuándo (en la zona de la organización), cómo se disparó, a quién y cómo quedó. Un envío
 * que sigue «enviando» pasados 30 minutos se cuenta como que no salió. `bad` pinta la línea como fallo.
 */
function lastLine(last: LastSend | null, zone: string | undefined, lang: UiLang, t: T, now: number): { text: string; bad: boolean } {
  if (!last) return { text: t("Todavía no se ha mandado.", "Not sent yet."), bad: false };
  const when = fmtDateTime(last.at, lang, zone);
  const how = last.trigger === "test" ? t(" (prueba)", " (test)") : last.trigger === "manual" ? t(" (enviado ahora)", " (sent now)") : "";
  const to = last.to.length ? t(` a ${last.to.join(", ")}`, ` to ${last.to.join(", ")}`) : "";
  const head = t(`Último envío: ${when}${how}${to}`, `Last send: ${when}${how}${to}`);
  if (last.state === "sent") return { text: `${head} · ${t("salió", "sent")}`, bad: false };
  // `at` ilegible: no se puede saber desde cuándo «enviando», así que no se afirma que sigue enviando.
  if (last.state === "sending" && now - Date.parse(last.at) <= SENDING_MAX_MS) return { text: `${head} · ${t("enviando…", "sending…")}`, bad: false };
  const why = last.error.trim() ? `: ${last.error.trim()}` : "";
  return { text: `${head} · ${t("no salió", "didn't go out")}${why}`, bad: true };
}

/** Lo que se le pide al servidor: guardar los ajustes (con el formulario tal como está), mandar una prueba o mandar ya. */
type Job = { kind: "save"; form: FormData } | { kind: "test" } | { kind: "now" };

type Props = {
  accountId: string;
  org: Org;
  /** La zona de la app, para mostrar la hora del último envío y decir cuál es «La de la app» (el navegador no la conoce). */
  appTz: string;
};

export function ReportPanel({ accountId, org, appTz }: Props) {
  const { t, lang } = useT();
  const base = useId();
  const id = (name: string) => `${base}-${name}`;
  const { report, last } = org;
  const [open, setOpen] = useState(false);

  const emails = report.reportEmail.trim();
  const noBusiness = org.businesses.length === 0;
  const needEmail = report.reportOn && emails === "";
  const canSendNow = emails !== "" && !noBusiness;
  const warnings = [needEmail && id("need-email"), noBusiness && id("no-business")].filter(Boolean).join(" ");

  // Guardar, mandar una prueba y mandar ya comparten el resultado, y mientras uno corre los tres esperan.
  const save = saveClientOrgReportAction.bind(null, accountId, org.id);
  const sendTest = sendClientOrgTestAction.bind(null, accountId, org.id);
  const sendNow = sendClientOrgNowAction.bind(null, accountId, org.id);
  const [result, run, busy] = useActionState(async (prev: OrgResult, job: Job): Promise<OrgResult> => {
    try {
      if (job.kind === "save") return await save(prev, job.form);
      return await (job.kind === "test" ? sendTest(prev) : sendNow(prev));
    } catch (e) {
      return failed(e, t);
    }
  }, null);
  const [doing, setDoing] = useState<Job["kind"]>("save");
  const saveButton = useRef<HTMLButtonElement>(null);
  const testButton = useRef<HTMLButtonElement>(null);
  const nowButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // El botón que se tocó estuvo desactivado mientras esperaba: el foco vuelve a él.
    if (result && !busy && focusLost()) ({ save: saveButton, test: testButton, now: nowButton })[doing].current?.focus();
  }, [result, busy, doing]);
  const go = (job: Job) => {
    setDoing(job.kind);
    startTransition(() => run(job));
  };
  // Con onSubmit (y no action) el formulario no se borra al guardar: si hubo un error, lo escrito sigue ahí.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    go({ kind: "save", form: new FormData(e.currentTarget) });
  };
  const askTest = () => {
    if (window.confirm(testQuestion(t))) go({ kind: "test" });
  };
  const askNow = () => {
    if (window.confirm(sendNowQuestion(emails, t))) go({ kind: "now" });
  };

  // La zona de las horas: la de la organización si sirve; si no, la de la app.
  const zone = isValidTz(report.timezone) ? report.timezone : appTz;
  const line = lastLine(last, zone, lang, t, Date.now());
  const zones = !report.timezone || COMMON_TZS.some((z) => z.id === report.timezone) ? COMMON_TZS : [{ id: report.timezone, es: tzName(report.timezone, "es"), en: tzName(report.timezone, "en") }, ...COMMON_TZS];

  return (
    <div className={s.report} role="group" aria-label={t(`Reporte semanal de «${org.name}»`, `Weekly report for "${org.name}"`)}>
      <button type="button" className={open ? `btn on ${s.act}` : `btn ${s.act}`} aria-expanded={open} aria-controls={id("panel")} onClick={() => setOpen((now) => !now)}>
        {t("Reporte semanal", "Weekly report")}
      </button>
      <p className={s.reportLine}>{scheduleLine(report, lang, t)}</p>
      <p className={line.bad ? `${s.lastLine} ${s.lastBad}` : s.lastLine}>{line.text}</p>

      {/* Cerrado sigue en la página (con `hidden`): lo escrito no se pierde al cerrarlo y volver a abrirlo. */}
      <div id={id("panel")} className={s.reportBody} hidden={!open}>
        <form method="post" onSubmit={submit} className={s.reportForm} aria-label={t(`Ajustes del reporte de «${org.name}»`, `Report settings for "${org.name}"`)}>
          <div className={s.pair}>
            <div className={s.fld}>
              <label className="lbl" htmlFor={id("contact")}>
                {t("Contacto", "Contact")}
              </label>
              <input id={id("contact")} name="contactName" className="field" defaultValue={report.contactName} maxLength={CONTACT_MAX} autoComplete="off" />
            </div>
            <div className={s.fld}>
              <label className="lbl" htmlFor={id("phone")}>
                {t("Teléfono", "Phone")}
              </label>
              <input id={id("phone")} name="phone" type="tel" inputMode="tel" className="field" defaultValue={report.phone} maxLength={PHONE_MAX} autoComplete="off" />
            </div>
          </div>

          <div className={s.fld}>
            <label className="lbl" htmlFor={id("email")}>
              {t("Emails para el reporte (hasta 3, separados por comas)", "Report emails (up to 3, separated by commas)")}
            </label>
            <input id={id("email")} name="reportEmail" type="text" inputMode="email" className="field" defaultValue={report.reportEmail} autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </div>

          <div className={s.pair}>
            <div className={s.fld}>
              <label className="lbl" htmlFor={id("lang")}>
                {t("Idioma del reporte", "Report language")}
              </label>
              <select id={id("lang")} name="reportLang" className="field" defaultValue={report.reportLang}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className={s.fld}>
              <label className="lbl" htmlFor={id("tz")}>
                {t("Zona horaria", "Time zone")}
              </label>
              <select id={id("tz")} name="timezone" className="field" defaultValue={report.timezone}>
                <option value="">{t(`La de la app (${tzName(appTz, "es")})`, `The app's (${tzName(appTz, "en")})`)}</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z[lang]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="check">
            <input type="checkbox" name="reportOn" defaultChecked={report.reportOn} aria-describedby={warnings || undefined} />
            <strong>{t("Mandar el reporte cada semana", "Send the report every week")}</strong>
          </label>
          {needEmail && (
            <p id={id("need-email")} className="note">
              {t("Falta un email: sin él no se manda.", "An email is missing: without one it won't be sent.")}
            </p>
          )}
          {noBusiness && (
            <p id={id("no-business")} className="note">
              {t("Sin negocios no hay reporte.", "No businesses, no report.")}
            </p>
          )}

          <div className={`${s.pair} ${s.pairShort}`}>
            <div className={s.fld}>
              <label className="lbl" htmlFor={id("day")}>
                {t("Día", "Day")}
              </label>
              <select id={id("day")} name="reportDay" className="field" defaultValue={report.reportDay}>
                {DAYS[lang].map((name, day) => (
                  <option key={day} value={day}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className={s.fld}>
              <label className="lbl" htmlFor={id("hour")}>
                {t("Hora", "Hour")}
              </label>
              <select id={id("hour")} name="reportHour" className="field" defaultValue={report.reportHour}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour, lang)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="row">
            <button ref={saveButton} type="submit" className="btn on" disabled={busy}>
              {busy && doing === "save" ? t("Guardando…", "Saving…") : t("Guardar", "Save")}
            </button>
          </div>
        </form>

        <div className={s.sendRow}>
          <button ref={testButton} type="button" className="btn" onClick={askTest} disabled={busy}>
            {busy && doing === "test" ? t("Enviando…", "Sending…") : t("Mandarme una prueba", "Send me a test")}
          </button>
          <button ref={nowButton} type="button" className="btn" onClick={askNow} disabled={busy || !canSendNow}>
            {busy && doing === "now" ? t("Enviando…", "Sending…") : t("Mandar ahora", "Send now")}
          </button>
        </div>

        <div role="status" className={s.reportStatus}>
          {result && !busy && <p className={`note ${result.ok ? "ok" : "error"}`}>{result.message}</p>}
        </div>
      </div>
    </div>
  );
}
