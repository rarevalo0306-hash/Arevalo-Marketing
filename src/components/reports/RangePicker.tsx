// Elegir las fechas del reporte: atajos (Ayer, Últimos 7 días, Este mes, Mes pasado) y un rango personalizado.
// Funciona sin JavaScript: los atajos son links y el personalizado es un formulario GET (?desde=…&hasta=…).
import Link from "next/link";
import type { RangePreset } from "@/lib/report-period";
import s from "./reports.module.css";

type Props = {
  base: string;
  preset: RangePreset;
  fromDay: string;
  toDay: string;
  maxDay: string;
  presets: { id: Exclude<RangePreset, "custom">; label: string; href: string }[];
  labels: { custom: string; from: string; to: string; see: string; aria: string };
};

export function RangePicker({ base, preset, fromDay, toDay, maxDay, presets, labels }: Props) {
  return (
    <div className={`stack ${s.picker}`}>
      <nav className={s.presets} aria-label={labels.aria}>
        {presets.map((p) => (
          <Link key={p.id} href={p.href} scroll={false} className={`${s.preset} ${preset === p.id ? s.presetOn : ""}`} aria-current={preset === p.id ? "page" : undefined}>
            {p.label}
          </Link>
        ))}
      </nav>
      <details className={s.custom} open={preset === "custom"}>
        <summary className={`${s.preset} ${preset === "custom" ? s.presetOn : ""}`}>{labels.custom}</summary>
        <form method="get" action={base} className={s.customForm}>
          <label>
            {labels.from}
            <input className="field" type="date" name="desde" defaultValue={fromDay} max={maxDay} required />
          </label>
          <label>
            {labels.to}
            <input className="field" type="date" name="hasta" defaultValue={toDay} max={maxDay} required />
          </label>
          <button type="submit" className="btn on">
            {labels.see}
          </button>
        </form>
      </details>
    </div>
  );
}
