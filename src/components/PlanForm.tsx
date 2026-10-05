"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { PlanResult } from "@/app/actions";

type Props = {
  action: (prev: PlanResult, f: FormData) => Promise<PlanResult>;
  channels: { id: string; name: string; connected: boolean }[];
  today: string;
  autopublish: boolean;
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn on" type="submit" disabled={pending}>
      {pending ? "La IA está escribiendo… (puede tardar 1-2 minutos)" : "✦ Crear plan de la semana"}
    </button>
  );
}

export function PlanForm({ action, channels, today, autopublish }: Props) {
  const [result, run] = useActionState(action, null);
  return (
    <form action={run} className="card">
      <h2>Plan de la semana con IA</h2>
      <p className="small muted">
        La IA escribe varias publicaciones, cada una adaptada a cada red, y les pone día y hora.{" "}
        {autopublish ? "Este negocio tiene la publicación automática ENCENDIDA: saldrán solas." : "Quedan como borradores para que las revises y apruebes."}
      </p>
      <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="startDate">Empieza el</label>
          <input id="startDate" name="startDate" type="date" className="field" defaultValue={today} min={today} required />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="count">Cuántas</label>
          <select id="count" name="count" className="field" defaultValue="5">
            {[3, 4, 5, 7, 10, 14].map((n) => <option key={n} value={n}>{n} publicaciones</option>)}
          </select>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="lang">Idioma</label>
          <select id="lang" name="lang" className="field" defaultValue="es">
            <option value="es">Español</option>
            <option value="en">Inglés</option>
            <option value="both">Los dos</option>
          </select>
        </div>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <label className="lbl" htmlFor="themes">Temas que quieres (opcional)</label>
        <textarea id="themes" name="themes" className="field" style={{ minHeight: 80 }} placeholder="Ej.: temporada de huracanes, qué hacer si tienes una filtración, cómo funciona un reclamo" />
      </div>
      <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0 }}>
        <legend className="lbl">Dónde publicar</legend>
        <div className="row" style={{ gap: 14 }}>
          {channels.map((c) => (
            <label key={c.id} className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="channels" value={c.id} defaultChecked={c.connected} />
              {c.name}{!c.connected && <span className="small muted">(no conectado)</span>}
            </label>
          ))}
        </div>
      </fieldset>
      {result && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
      <div><Submit /></div>
    </form>
  );
}
