"use client";

import { useState } from "react";
import { useT } from "@/components/I18n";
import { type CustomerOption, type IdealCustomer, priorityOf } from "@/lib/study-shape";
import s from "./StudyForm.module.css";

type Props = {
  chosen: IdealCustomer[];
  options: CustomerOption[];
  onChange: (chosen: IdealCustomer[], options: CustomerOption[]) => void;
};

const MAX = 8;

/** Clientes ideales: el dueño elige varios (tocando las sugerencias o escribiendo uno) y los ordena por prioridad. */
export function StudyCustomers({ chosen, options, onChange }: Props) {
  const { t } = useT();
  const [extra, setExtra] = useState("");
  const ranked = (list: { name: string; why: string }[]) => list.map((c, i) => ({ name: c.name, why: c.why, priority: i + 1 }));
  const label = { alta: t("Prioridad alta", "High priority"), media: t("Prioridad media", "Medium priority"), baja: t("Prioridad baja", "Low priority") };

  const add = (c: CustomerOption) => {
    if (chosen.length >= MAX || chosen.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) return;
    onChange(ranked([...chosen, c]), options.filter((o) => o.name !== c.name));
  };
  const remove = (i: number) => {
    const c = chosen[i];
    onChange(ranked(chosen.filter((_, j) => j !== i)), [{ name: c.name, why: c.why }, ...options.filter((o) => o.name.toLowerCase() !== c.name.toLowerCase())]);
  };
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= chosen.length) return;
    const next = [...chosen];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(ranked(next), options);
  };
  const addTyped = () => {
    const name = extra.trim().slice(0, 120);
    if (!name) return;
    add({ name, why: "" });
    setExtra("");
  };

  return (
    <div className={s.customers}>
      <div className="stack" style={{ gap: 2 }}>
        <span className="lbl" id="customers-label">{t("¿Quiénes son tus clientes ideales?", "Who are your ideal customers?")}</span>
        <span className="small muted">
          {t("Elige varios y ponlos en orden: el número 1 es el más importante. Usa las flechas para subir o bajar.", "Pick several and put them in order: number 1 is the most important. Use the arrows to move them up or down.")}
        </span>
      </div>

      {chosen.length ? (
        <ol className={s.chosen} aria-labelledby="customers-label">
          {chosen.map((c, i) => {
            const p = priorityOf(i + 1);
            return (
              <li key={c.name} className={s.chosenItem}>
                <span className={s.rank} aria-hidden>{i + 1}</span>
                <span className={s.chosenText}>
                  <strong>{c.name}</strong>
                  <span className={`${s.prio} ${s[p]}`}>{label[p]}</span>
                  {c.why && <span className="small muted" style={{ display: "block" }}>{c.why}</span>}
                </span>
                <span className={s.moves}>
                  <button type="button" className={s.iconBtn} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${t("Subir", "Move up")}: ${c.name}`}>▲</button>
                  <button type="button" className={s.iconBtn} onClick={() => move(i, 1)} disabled={i === chosen.length - 1} aria-label={`${t("Bajar", "Move down")}: ${c.name}`}>▼</button>
                  <button type="button" className={s.iconBtn} onClick={() => remove(i)} aria-label={`${t("Quitar", "Remove")}: ${c.name}`}>✕</button>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={s.emptyPick}>{t("Todavía no elegiste ninguno. Toca uno de abajo o escribe el tuyo.", "You haven't picked any yet. Tap one below or type your own.")}</p>
      )}

      {options.length > 0 && chosen.length < MAX && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small muted">{t("Otros clientes que sugiere la IA (toca para agregar):", "Other customers the AI suggests (tap to add):")}</span>
          <div className="opts">
            {options.map((o) => (
              <button key={o.name} type="button" className="opt" onClick={() => add(o)} title={o.why || undefined}>
                + {o.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {chosen.length < MAX && (
        <div className={s.addRow}>
          <input
            className="field"
            maxLength={120}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTyped();
              }
            }}
            placeholder={t("Otro tipo de cliente, ej.: Administradoras de edificios", "Another type of customer, e.g.: Property managers")}
            aria-label={t("Agregar otro tipo de cliente", "Add another type of customer")}
          />
          <button type="button" className="btn" onClick={addTyped} disabled={!extra.trim()}>{t("Agregar", "Add")}</button>
        </div>
      )}
    </div>
  );
}
