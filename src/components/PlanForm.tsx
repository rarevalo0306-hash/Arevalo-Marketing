"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { PlanResult } from "@/app/actions";
import { useT } from "@/components/I18n";

type Props = {
  action: (prev: PlanResult, f: FormData) => Promise<PlanResult>;
  channels: { id: string; name: string; connected: boolean }[];
  today: string;
  autopublish: boolean;
};

const COUNTS = [
  [3, "3 publicaciones", "3 posts"],
  [5, "5 publicaciones", "5 posts"],
  [7, "7: una al día", "7: one a day"],
  [10, "10 publicaciones", "10 posts"],
  [14, "14: dos al día (agresivo)", "14: two a day (aggressive)"],
] as const;

function Submit() {
  const { pending } = useFormStatus();
  const { t } = useT();
  return (
    <button className="btn on" type="submit" disabled={pending}>
      {pending ? t("La IA está escribiendo… (puede tardar 1-2 minutos)", "The AI is writing… (it can take 1-2 minutes)") : t("✦ Crear plan de la semana", "✦ Create weekly plan")}
    </button>
  );
}

export function PlanForm({ action, channels, today, autopublish }: Props) {
  const [result, run] = useActionState(action, null);
  const { t } = useT();
  return (
    <form action={run} className="card">
      <h2>{t("Plan de la semana con IA", "AI weekly plan")}</h2>
      <p className="small muted">
        {t("La IA escribe varias publicaciones, cada una adaptada a cada red, y les pone día y hora.", "The AI writes several posts, each one adapted to each network, and sets a day and time.")}{" "}
        {autopublish
          ? t("Este negocio tiene la publicación automática ENCENDIDA: saldrán solas.", "This business has automatic posting turned ON: they'll go out on their own.")
          : t("Quedan como borradores para que las revises y apruebes.", "They're saved as drafts for you to review and approve.")}
      </p>
      <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="startDate">{t("Empieza el", "Starts on")}</label>
          <input id="startDate" name="startDate" type="date" className="field" defaultValue={today} min={today} required />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="count">{t("Cuántas", "How many")}</label>
          <select id="count" name="count" className="field" defaultValue="7">
            {COUNTS.map(([n, es, en]) => <option key={n} value={n}>{t(es, en)}</option>)}
          </select>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="lang">{t("Idioma", "Language")}</label>
          <select id="lang" name="lang" className="field" defaultValue="es">
            <option value="es">{t("Español", "Spanish")}</option>
            <option value="en">{t("Inglés", "English")}</option>
            <option value="both">{t("Los dos", "Both")}</option>
          </select>
        </div>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <label className="lbl" htmlFor="themes">{t("Temas que quieres (opcional)", "Topics you want (optional)")}</label>
        <textarea id="themes" name="themes" className="field" style={{ minHeight: 80 }} placeholder={t("Ej.: temporada de huracanes, qué hacer si tienes una filtración, cómo funciona un reclamo", "E.g.: hurricane season, what to do if you have a leak, how a claim works")} />
      </div>
      <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0 }}>
        <legend className="lbl">{t("Dónde publicar", "Where to post")}</legend>
        <div className="row" style={{ gap: 14 }}>
          {channels.map((c) => (
            <label key={c.id} className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="channels" value={c.id} defaultChecked={c.connected} />
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
