"use client";

import { useActionState, useState } from "react";
import type { AlertsResult } from "@/app/actions-seo-alerts";
import { useT } from "@/components/I18n";

type Props = {
  save: (prev: AlertsResult, f: FormData) => Promise<AlertsResult>;
  test: (prev: AlertsResult) => Promise<AlertsResult>;
  initial: { email: string; alerts: boolean; weekly: boolean };
  /** La revisión diaria de posiciones está encendida (y DataForSEO conectado). */
  daily: boolean;
  sender: { ok: true; from: string } | { ok: false; error: string };
  lastWeekly: string | null;
};

export function AlertsForm({ save, test, initial, daily, sender, lastWeekly }: Props) {
  const { t } = useT();
  const [saved, runSave, saving] = useActionState(save, null);
  const [tested, runTest, testing] = useActionState(test, null);
  const [alerts, setAlerts] = useState(initial.alerts);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <form action={runSave} className="stack" style={{ gap: 14 }}>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="alerts-email">{t("Tu email", "Your email")}</label>
          <input
            id="alerts-email"
            name="email"
            type="text"
            inputMode="email"
            autoComplete="email"
            className="field"
            defaultValue={initial.email}
            placeholder={t("tu@correo.com", "you@email.com")}
          />
          <span className="small muted">{t("Puedes poner hasta 3, separados por comas.", "You can enter up to 3, separated by commas.")}</span>
        </div>
        <label className="check">
          <input type="checkbox" name="alerts" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} />
          <span>
            <strong>{t("Avisarme por email si bajo en Google", "Email me if I drop on Google")}</strong>
            <span className="small muted" style={{ display: "block" }}>
              {t(
                "Después de la revisión automática de cada día: si bajas 3 lugares o más, sales de la primera página o del mapa, o un competidor nuevo entra al top 3. También te contamos las buenas noticias.",
                "After the automatic daily check: if you drop 3 or more places, fall off the first page or the map, or a new competitor enters the top 3. We'll share the good news too.",
              )}
            </span>
          </span>
        </label>
        {alerts && !daily && (
          <p className="note" role="status">
            {t(
              "Para recibir estos avisos tiene que estar encendido \"Revisar mis posiciones cada día\".",
              "To get these alerts, \"Check my rankings every day\" has to be on.",
            )}{" "}
            <a href="#dataforseo">{t("Ir a los ajustes de Google", "Go to the Google settings")}</a>
          </p>
        )}
        <label className="check">
          <input type="checkbox" name="weekly" defaultChecked={initial.weekly} />
          <span>
            <strong>{t("Mandarme un resumen cada lunes", "Send me a summary every Monday")}</strong>
            <span className="small muted" style={{ display: "block" }}>
              {lastWeekly
                ? t(`Sale los lunes a partir de las 8 de la mañana. El último se mandó el ${lastWeekly}.`, `It goes out on Mondays from 8 a.m. The last one was sent on ${lastWeekly}.`)
                : t("Sale los lunes a partir de las 8 de la mañana. Todavía no se ha mandado ninguno.", "It goes out on Mondays from 8 a.m. None has been sent yet.")}
            </span>
          </span>
        </label>
        {sender.ok ? (
          <span className="small muted">
            {t("Los emails salen desde:", "Emails are sent from:")} <strong>{sender.from}</strong>
          </span>
        ) : (
          <p className="note error" role="alert">{sender.error}</p>
        )}
        {saved && <p className={saved.ok ? "note ok" : "note error"} role="status">{saved.message}</p>}
        <div>
          <button type="submit" className="btn on" disabled={saving}>
            {saving ? t("Guardando…", "Saving…") : t("Guardar", "Save")}
          </button>
        </div>
      </form>
      <form action={runTest} className="stack" style={{ gap: 10 }}>
        <span className="small muted">
          {t(
            "¿Quieres ver cómo llega? Te mandamos ahora el resumen de la semana al email guardado (guarda primero si lo cambiaste).",
            "Want to see what it looks like? We'll send this week's summary now to the saved email (save first if you changed it).",
          )}
        </span>
        {tested && <p className={tested.ok ? "note ok" : "note error"} role="status">{tested.message}</p>}
        <div>
          <button type="submit" className="btn" disabled={testing || !sender.ok}>
            {testing ? t("Enviando…", "Sending…") : t("Enviar un email de prueba", "Send a test email")}
          </button>
        </div>
      </form>
    </div>
  );
}
