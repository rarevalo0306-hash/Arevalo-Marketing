"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { PlanResult } from "@/app/actions";
import { STORM_EVENTS } from "@/lib/storm";

type Props = {
  action: (prev: PlanResult, f: FormData) => Promise<PlanResult>;
  channels: { id: string; name: string; connected: boolean }[];
  now: string;
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn on" type="submit" disabled={pending}>
      {pending ? "La IA está preparando la campaña… (1-2 minutos)" : "⚡ Crear campaña de tormenta"}
    </button>
  );
}

export function StormForm({ action, channels, now }: Props) {
  const [result, run] = useActionState(action, null);
  return (
    <form action={run} className="card">
      <h2>Campaña de tormenta</h2>
      <p className="small muted">
        Cuando pasa una tormenta, la IA prepara 6 publicaciones con foto. Las primeras ayudan a la gente (seguridad y cómo documentar el daño) y no
        ofrecen tus servicios. Las que invitan a contactarte salen después de 48 horas, entre 9 am y 7 pm y nunca en domingo, como piden las reglas de
        Florida para public adjusters.
      </p>
      <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="event">Qué pasó</label>
          <select id="event" name="event" className="field" defaultValue="huracan">
            {STORM_EVENTS.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="eventAt">Cuándo pasó</label>
          <input id="eventAt" name="eventAt" type="datetime-local" className="field" defaultValue={now} required />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="storm-lang">Idioma</label>
          <select id="storm-lang" name="lang" className="field" defaultValue="both">
            <option value="es">Español</option>
            <option value="en">Inglés</option>
            <option value="both">Los dos</option>
          </select>
        </div>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <label className="lbl" htmlFor="zone">Zonas afectadas</label>
        <input id="zone" name="zone" className="field" placeholder="Ej.: Miami-Dade, Broward y Palm Beach" />
      </div>
      <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0 }}>
        <legend className="lbl">Dónde publicar</legend>
        <div className="row" style={{ gap: 14 }}>
          {channels.map((c) => (
            <label key={c.id} className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="channels" value={c.id} defaultChecked={c.connected && c.id !== "sms" && c.id !== "email"} />
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
