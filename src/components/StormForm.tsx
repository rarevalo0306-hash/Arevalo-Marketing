"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { PlanResult } from "@/app/actions";
import { useT } from "@/components/I18n";
import { STORM_EVENTS } from "@/lib/storm";

type Props = {
  action: (prev: PlanResult, f: FormData) => Promise<PlanResult>;
  channels: { id: string; name: string; connected: boolean }[];
  now: string;
};

function Submit() {
  const { pending } = useFormStatus();
  const { t } = useT();
  return (
    <button className="btn on" type="submit" disabled={pending}>
      {pending ? t("La IA está preparando la campaña… (1-2 minutos)", "The AI is preparing the campaign… (1-2 minutes)") : t("⚡ Crear campaña de tormenta", "⚡ Create storm campaign")}
    </button>
  );
}

export function StormForm({ action, channels, now }: Props) {
  const [result, run] = useActionState(action, null);
  const { t } = useT();
  return (
    <form action={run} className="card">
      <h2>{t("Campaña de tormenta", "Storm campaign")}</h2>
      <p className="small muted">
        {t(
          "Cuando pasa una tormenta, la IA prepara 6 publicaciones con foto. Las primeras ayudan a la gente (seguridad y cómo documentar el daño) y no ofrecen tus servicios. Las que invitan a contactarte salen después de 48 horas, entre 9 am y 7 pm y nunca en domingo, como piden las reglas de Florida para public adjusters.",
          "When a storm hits, the AI prepares 6 posts with photos. The first ones help people (safety and how to document the damage) and don't offer your services. The ones that invite people to contact you go out after 48 hours, between 9 am and 7 pm and never on Sunday, as Florida rules for public adjusters require.",
        )}
      </p>
      <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="event">{t("Qué pasó", "What happened")}</label>
          <select id="event" name="event" className="field" defaultValue="huracan">
            {STORM_EVENTS.map((e) => <option key={e.id} value={e.id}>{t(e.name, e.nameEn)}</option>)}
          </select>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="eventAt">{t("Cuándo pasó", "When it happened")}</label>
          <input id="eventAt" name="eventAt" type="datetime-local" className="field" defaultValue={now} required />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="storm-lang">{t("Idioma", "Language")}</label>
          <select id="storm-lang" name="lang" className="field" defaultValue="both">
            <option value="es">{t("Español", "Spanish")}</option>
            <option value="en">{t("Inglés", "English")}</option>
            <option value="both">{t("Los dos", "Both")}</option>
          </select>
        </div>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <label className="lbl" htmlFor="zone">{t("Zonas afectadas", "Affected areas")}</label>
        <input id="zone" name="zone" className="field" placeholder={t("Ej.: Miami-Dade, Broward y Palm Beach", "E.g.: Miami-Dade, Broward, and Palm Beach")} />
      </div>
      <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0 }}>
        <legend className="lbl">{t("Dónde publicar", "Where to post")}</legend>
        <div className="row" style={{ gap: 14 }}>
          {channels.map((c) => (
            <label key={c.id} className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="channels" value={c.id} defaultChecked={c.connected && c.id !== "sms" && c.id !== "email"} />
              {c.name}{!c.connected && <span className="small muted">{t("(no conectado)", "(not connected)")}</span>}
            </label>
          ))}
        </div>
      </fieldset>
      {result && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
      <div><Submit /></div>
    </form>
  );
}
