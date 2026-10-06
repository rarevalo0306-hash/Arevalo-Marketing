import styles from "@/components/seo/TrafficPanel.module.css";
import { niceMax } from "@/lib/seo/traffic";

export type ChartSeries = {
  domain: string;
  /** Lo que se muestra en la leyenda ("Tú (fameseg.com)"). */
  label: string;
  /** Posición fija del color (0 = tú). El color sigue al sitio, no a su lugar. */
  slot: number;
  values: (number | null)[];
};

type Props = {
  /** Etiquetas de los meses, del más viejo al más nuevo ("oct 25"). */
  months: string[];
  series: ChartSeries[];
  /** Visitas para leer ("45", "menos de 1"). */
  format: (v: number) => string;
  /** Texto para lectores de pantalla. */
  title: string;
  /** "visitas al mes" / "visits a month". */
  unit: string;
};

const W = 1000;
const H = 400;

/**
 * Gráfica de líneas sin librerías: las líneas en un SVG que se estira (el trazo no se deforma) y los textos, puntos
 * y la leyenda en HTML, para que se lean igual en el teléfono y en la computadora. Cada punto tiene su tooltip.
 */
export function TrafficChart({ months, series, format, title, unit }: Props) {
  const n = months.length;
  if (n < 2 || !series.length) return null;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const x = (i: number) => (i / (n - 1)) * 100;
  const y = (v: number) => (1 - v / max) * 100;
  const ticks = [0, 0.5, 1].map((f) => f * max);
  // Etiquetas del eje: cada 3 meses contando desde el último (siempre se ve el mes más nuevo).
  const shown = months.map((_, i) => (n - 1 - i) % 3 === 0);
  const last = (s: ChartSeries) => [...s.values].reverse().find((v) => v !== null) ?? null;

  return (
    <figure className={styles.chart} aria-label={title}>
      <ul className={styles.legend}>
        {series.map((s) => (
          <li key={s.domain}>
            <span className={styles.swatch} data-slot={s.slot} aria-hidden />
            <span className={styles.legendName}>{s.label}</span>
            <span className="muted">{last(s) === null ? "—" : `${format(last(s) as number)} ${unit}`}</span>
          </li>
        ))}
      </ul>
      <div className={styles.plotArea}>
        <div className={styles.yAxis} aria-hidden>
          {ticks.map((v) => (
            <span key={v} style={{ top: `${y(v)}%` }}>
              {format(v)}
            </span>
          ))}
        </div>
        <div className={styles.plot}>
          {ticks.map((v) => (
            <span key={v} className={styles.grid} style={{ top: `${y(v)}%` }} aria-hidden />
          ))}
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={styles.svg} aria-hidden focusable="false">
            {series.map((s) => {
              // Una línea por tramo con datos (si falta un mes, la línea se corta).
              const segs: string[][] = [[]];
              s.values.forEach((v, i) => {
                if (v === null) segs.push([]);
                else segs[segs.length - 1].push(`${(x(i) / 100) * W},${(y(v) / 100) * H}`);
              });
              return segs
                .filter((p) => p.length > 1)
                .map((p, j) => <polyline key={`${s.domain}-${j}`} points={p.join(" ")} className={styles.line} data-slot={s.slot} vectorEffect="non-scaling-stroke" />);
            })}
          </svg>
          {series.flatMap((s) =>
            s.values.map((v, i) =>
              v === null ? null : (
                <span
                  key={`${s.domain}-${i}`}
                  className={styles.dot}
                  data-slot={s.slot}
                  style={{ left: `${x(i)}%`, top: `${y(v)}%` }}
                  title={`${s.label} · ${months[i]}: ${format(v)} ${unit}`}
                />
              ),
            ),
          )}
        </div>
        <div className={styles.xAxis} aria-hidden>
          {months.map((m, i) =>
            shown[i] ? (
              <span key={m + i} style={{ left: `${x(i)}%` }} className={i === 0 ? styles.first : i === n - 1 ? styles.lastLabel : undefined}>
                {m}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </figure>
  );
}
