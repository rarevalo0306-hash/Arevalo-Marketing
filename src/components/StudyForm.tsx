"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { StudyResult } from "@/app/actions";
import { GOALS, type StudyInput } from "@/lib/study-shape";

type Props = {
  action: (prev: StudyResult, f: FormData) => Promise<StudyResult>;
  input: StudyInput;
  /** Qué IA investiga en internet, o null si ninguna puede. */
  researcher: string | null;
  has: boolean;
};

function Submit({ has }: { has: boolean }) {
  const { pending } = useFormStatus();
  return (
    <>
      <div>
        <button type="submit" className="btn ai" disabled={pending}>
          {pending ? "La IA está estudiando tu negocio…" : has ? "✦ Actualizar estudio" : "✦ Generar estudio"}
        </button>
      </div>
      {pending && (
        <ul className="magic-steps" aria-live="polite">
          <li className="now">Leyendo tu negocio y tu página web, investigando tu mercado y buscando las palabras clave. Puede tardar 1 a 3 minutos; no cierres esta página.</li>
        </ul>
      )}
    </>
  );
}

export function StudyForm({ action, input, researcher, has }: Props) {
  const [result, run] = useActionState(action, null);
  return (
    <form action={run} className="ai-box glow stack" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 4 }}>
        <strong className="ai-title">{has ? "Actualizar el estudio" : "Cuéntale a la IA sobre tu negocio"}</strong>
        <p className="small muted">Contesta lo que sepas; lo demás lo investiga la IA. Mientras más le cuentes, mejor entiende qué anunciar.</p>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <label className="lbl" htmlFor="services">¿Qué vendes o qué servicios das?</label>
        <textarea id="services" name="services" className="field" style={{ minHeight: 90 }} maxLength={2000} defaultValue={input.services} placeholder="Ej.: Ajustadores públicos. Reclamos de seguro por huracán, agua, fuego, techo y moho, para casas y negocios. Evaluación inicial gratis." />
      </div>
      <div className="grid-2" style={{ gap: 14 }}>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="zone">¿Dónde trabajas?</label>
          <input id="zone" name="zone" className="field" maxLength={300} defaultValue={input.zone} placeholder="Ej.: Miami-Dade, Broward y Palm Beach, Florida" />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="customers">¿Quién es tu cliente ideal?</label>
          <input id="customers" name="customers" className="field" maxLength={1000} defaultValue={input.customers} placeholder="Ej.: Dueños de casa hispanos con un reclamo negado" />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="different">¿Qué te hace diferente? <span className="small muted">(opcional)</span></label>
          <input id="different" name="different" className="field" maxLength={1000} defaultValue={input.different} placeholder="Ej.: Atendemos en español, visitamos la casa el mismo día" />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="competitors">Competidores <span className="small muted">(opcional)</span></label>
          <input id="competitors" name="competitors" className="field" maxLength={600} defaultValue={input.competitors} placeholder="Nombres o páginas web" />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="goal">¿Qué quieres lograr?</label>
          <select id="goal" name="goal" className="field" defaultValue={input.goal}>
            {GOALS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor="study-lang">Tus clientes hablan</label>
          <select id="study-lang" name="lang" className="field" defaultValue={input.lang}>
            <option value="es">Español</option>
            <option value="en">Inglés</option>
            <option value="both">Los dos</option>
          </select>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" name="research" defaultChecked={!!researcher} disabled={!researcher} />
        <span>
          <strong>Investigar en internet</strong>
          <span className="small muted" style={{ display: "block" }}>
            {researcher
              ? `${researcher} busca en Google a tus competidores, cómo te busca la gente en tu zona y las temporadas de tu mercado.`
              : "Para investigar en internet hace falta la clave de Gemini o de Claude. Sin ella, la IA usa lo que ya sabe."}
          </span>
        </span>
      </label>
      {result && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
      <Submit has={has} />
    </form>
  );
}
