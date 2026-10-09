"use client";

// Ajustes del reporte diario: encendido, a quién, zona horaria (con la sugerida por el lugar), días tranquilos,
// idioma del email y el botón para mandar ya el de ayer.
import { startTransition, useActionState, useState } from "react";
import type { ReportActionResult } from "@/app/actions-reports";
import { useT } from "@/components/I18n";
import { COMMON_TZS } from "@/lib/business-tz";
import s from "./reports.module.css";

type Props = {
  save: (prev: ReportActionResult, f: FormData) => Promise<ReportActionResult>;
  test: (prev: ReportActionResult) => Promise<ReportActionResult>;
  initial: { daily: boolean; email: string; timezone: string; quietDays: "send" | "skip"; lang: "es" | "en" };
  ownerEmail: string;
  /** La zona de la app (cuando el negocio no eligió ninguna). */
  appTz: string;
  /** Zona sugerida por el lugar del negocio y de dónde salió ("Nicaragua"). */
  suggestion: { tz: string; place: string } | null;
  /** "11:05 p. m." ahora mismo en cada zona, para ayudar a elegir. */
  nowIn: Record<string, string>;
  sender: { ok: true; from: string } | { ok: false; error: string };
};

export function DailySettings({ save, test, initial, ownerEmail, appTz, suggestion, nowIn, sender }: Props) {
  const { t, lang } = useT();
  const [saved, runSave, saving] = useActionState(save, null);
  const [tested, runTest, testing] = useActionState(test, null);
  const [tz, setTz] = useState(initial.timezone);
  const label = (id: string) => COMMON_TZS.find((z) => z.id === id)?.[lang] ?? id.replace(/_/g, " ");
  const options = COMMON_TZS.some((z) => z.id === initial.timezone) || !initial.timezone ? COMMON_TZS : [{ id: initial.timezone, es: initial.timezone, en: initial.timezone }, ...COMMON_TZS];
  const effective = tz || appTz;

  return (
    <div className={`stack ${s.settings}`}>
      {/* Con onSubmit (y no action) el formulario no se borra después de guardar: si algo está mal, lo escrito sigue ahí. */}
      <form
        className={`stack ${s.settings}`}
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => runSave(data));
        }}
      >
        <label className="check">
          <input type="checkbox" name="daily" defaultChecked={initial.daily} />
          <span>
            <strong>{t("Mandarme el reporte cada día", "Send me the report every day")}</strong>
            <span className="small muted" style={{ display: "block" }}>
              {t(
                "Cierra a la medianoche de tu negocio y te llega con lo que pasó ese día: publicaciones, lo que hizo la IA, anuncios, reseñas y lo que sigue.",
                "It closes at your business's midnight and tells you what happened that day: posts, what the AI did, ads, reviews and what's next.",
              )}
            </span>
          </span>
        </label>

        <div className={s.field}>
          <label className="lbl" htmlFor="rep-email">
            {t("¿A qué email?", "Which email?")}
          </label>
          <input
            id="rep-email"
            name="email"
            type="text"
            inputMode="email"
            autoComplete="email"
            className="field"
            defaultValue={initial.email}
            placeholder={ownerEmail || t("tu@correo.com", "you@email.com")}
          />
          <span className="small muted">
            {ownerEmail
              ? t(
                  `Si lo dejas vacío, llega al email del dueño (${ownerEmail}). Puedes poner hasta 3, separados por comas.`,
                  `If you leave it empty, it goes to the owner's email (${ownerEmail}). You can enter up to 3, separated by commas.`,
                )
              : t("Puedes poner hasta 3, separados por comas.", "You can enter up to 3, separated by commas.")}
          </span>
        </div>

        <div className={s.split}>
          <div className={s.field}>
            <label className="lbl" htmlFor="rep-tz">
              {t("Zona horaria del negocio", "Business time zone")}
            </label>
            <select id="rep-tz" name="timezone" className="field" value={tz} onChange={(e) => setTz(e.target.value)}>
              <option value="">{t(`La de la app (${label(appTz)})`, `The app's (${label(appTz)})`)}</option>
              {options.map((z) => (
                <option key={z.id} value={z.id}>
                  {z[lang]}
                </option>
              ))}
            </select>
            {nowIn[effective] && <span className={s.suggest}>{t(`Hora del negocio ahora: ${nowIn[effective]}`, `Business time now: ${nowIn[effective]}`)}</span>}
            {suggestion && suggestion.tz !== effective && (
              <span className={s.suggest}>
                <>
                  {t(`Por tu ubicación (${suggestion.place}) te sugerimos ${label(suggestion.tz)}.`, `From your location (${suggestion.place}) we suggest ${label(suggestion.tz)}.`)}
                  <button type="button" className="btn link" onClick={() => setTz(suggestion.tz)}>
                    {t("Usar esta", "Use this one")}
                  </button>
                </>
              </span>
            )}
          </div>
          <div className={s.field}>
            <label className="lbl" htmlFor="rep-lang">
              {t("Idioma del email", "Email language")}
            </label>
            <select id="rep-lang" name="lang" className="field" defaultValue={initial.lang}>
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
            <span className="small muted">{t("También el de los avisos de SEO.", "Also used for the SEO alerts.")}</span>
          </div>
        </div>

        <label className="check">
          <input type="checkbox" name="quiet" defaultChecked={initial.quietDays === "send"} />
          <span>
            <strong>{t("Mandarlo también los días tranquilos", "Send it on quiet days too")}</strong>
            <span className="small muted" style={{ display: "block" }}>
              {t(
                "Si un día no pasa nada, te llega uno corto con lo que viene y los próximos pasos (así sabes que todo sigue funcionando). Quita la marca para recibirlo solo cuando pase algo.",
                "If nothing happens one day, you get a short one with what's coming and the next steps (so you know everything is still working). Uncheck it to get it only when something happens.",
              )}
            </span>
          </span>
        </label>

        {sender.ok ? (
          <span className="small muted">
            {t("Los emails salen desde:", "Emails are sent from:")} <strong>{sender.from}</strong>
          </span>
        ) : (
          <p className="note error" role="alert">
            {sender.error}
          </p>
        )}
        {saved && (
          <p className={saved.ok ? "note ok" : "note error"} role="status">
            {saved.message}
          </p>
        )}
        <div>
          <button type="submit" className="btn on" disabled={saving}>
            {saving ? t("Guardando…", "Saving…") : t("Guardar", "Save")}
          </button>
        </div>
      </form>

      <form action={runTest} className="stack" style={{ gap: 8 }}>
        <span className="small muted">
          {t(
            "¿Quieres ver cómo llega? Te mandamos ahora el reporte de ayer (guarda primero si cambiaste algo).",
            "Want to see what it looks like? We'll send yesterday's report now (save first if you changed anything).",
          )}
        </span>
        {tested && (
          <p className={tested.ok ? "note ok" : "note error"} role="status">
            {tested.message}
          </p>
        )}
        <div>
          <button type="submit" className="btn" disabled={testing}>
            {testing ? t("Enviando…", "Sending…") : t("Mandar el de ayer ahora", "Send yesterday's now")}
          </button>
        </div>
      </form>
    </div>
  );
}
