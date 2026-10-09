// Gráficas simples sin librerías: barras verticales (con eje y etiquetas), barras horizontales y una línea.
// Un solo eje por gráfica, un solo color por serie, cuadrícula suave, valor al pasar el dedo o el mouse (y al enfocar
// con el teclado) y una tabla con los mismos datos para quien no ve la gráfica.
import s from "./Results.module.css";

/** Un tope «redondo» para el eje: 1, 2, 2.5, 5 × 10^k. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

export type BarItem = { label: string; value: number; tip: string; /** etiqueta debajo de la barra (vacía = se omite para que no se encimen) */ tick?: string };

export function VBars({
  items,
  title,
  yLabel,
  xLabel,
  tone = "a",
  fmt,
  tableHead,
  tableLabel,
  minMax = 0,
}: {
  items: BarItem[];
  title: string;
  yLabel: string;
  xLabel: string;
  tone?: "a" | "b";
  fmt: (v: number) => string;
  tableHead: [string, string];
  tableLabel: string;
  /** Tope mínimo del eje (para conteos: así no salen marcas como 0,5 personas). */
  minMax?: number;
}) {
  const max = niceMax(Math.max(minMax, ...items.map((i) => i.value)));
  return (
    <figure className={s.chart}>
      <figcaption className={s.chartTitle}>{title}</figcaption>
      <div className={s.yLabel} aria-hidden="true">
        {yLabel}
      </div>
      <div className={s.plot} role="img" aria-label={`${title}: ${items.map((i) => `${i.label} ${fmt(i.value)}`).join(", ")}`}>
        <div className={s.yAxis} aria-hidden="true">
          <span>{fmt(max)}</span>
          <span>{fmt(max / 2)}</span>
          <span>0</span>
        </div>
        <div className={s.bars} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          <i className={s.gridTop} aria-hidden="true" />
          <i className={s.gridMid} aria-hidden="true" />
          {items.map((it, i) => (
            <div key={i} className={s.barCol} tabIndex={0} aria-label={it.tip}>
              <span className={`${s.bar} ${tone === "b" ? s.toneB : s.toneA}`} style={{ height: `${it.value > 0 ? Math.max(2, (it.value / max) * 100) : 0}%` }} />
              <span className={s.tip} role="tooltip">
                {it.tip}
              </span>
            </div>
          ))}
        </div>
        <div aria-hidden="true" />
        <div className={s.xTicks} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} aria-hidden="true">
          {items.map((it, i) => (
            <span key={i}>{it.tick ?? it.label}</span>
          ))}
        </div>
      </div>
      <div className={s.xLabel} aria-hidden="true">
        {xLabel}
      </div>
      <DataTable head={tableHead} label={tableLabel} rows={items.map((i) => [i.label, fmt(i.value)])} />
    </figure>
  );
}

export type HBarItem = { key: string; label: string; value: number; valueText: string; sub?: string };

/** Barras horizontales (una por canal, formato o campaña), con el nombre y el número escritos al lado. */
export function HBars({ items, ariaLabel, tone = "a" }: { items: HBarItem[]; ariaLabel: string; tone?: "a" | "b" }) {
  const max = Math.max(0, ...items.map((i) => i.value)) || 1;
  return (
    <ul className={s.hbars} aria-label={ariaLabel}>
      {items.map((it) => (
        <li key={it.key} className={s.hrow}>
          <div className={s.hhead}>
            <span className={s.hname}>{it.label}</span>
            <span className={s.hval}>{it.valueText}</span>
          </div>
          <span className={s.htrack} aria-hidden="true">
            <span className={`${s.hfill} ${tone === "b" ? s.toneB : s.toneA}`} style={{ width: `${it.value > 0 ? Math.max(1.5, (it.value / max) * 100) : 0}%` }} />
          </span>
          {it.sub && <span className={s.hsub}>{it.sub}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Línea de una serie por día (visitas desde Google), con el tope del eje y la primera y última fecha. */
export function Line({ points, title, yLabel, fmt, first, last, tableHead, tableLabel }: { points: { label: string; value: number }[]; title: string; yLabel: string; fmt: (v: number) => string; first: string; last: string; tableHead: [string, string]; tableLabel: string }) {
  const W = 300;
  const H = 110;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const step = points.length > 1 ? W / (points.length - 1) : W;
  const xy = points.map((p, i) => [Math.round(i * step * 10) / 10, Math.round((H - (p.value / max) * (H - 6) - 3) * 10) / 10] as const);
  return (
    <figure className={s.chart}>
      <figcaption className={s.chartTitle}>{title}</figcaption>
      <div className={s.yLabel} aria-hidden="true">
        {yLabel}
      </div>
      <div className={s.plot}>
        <div className={s.yAxis} aria-hidden="true">
          <span>{fmt(max)}</span>
          <span>{fmt(max / 2)}</span>
          <span>0</span>
        </div>
        <div className={s.lineBox}>
          <i className={s.gridTop} aria-hidden="true" />
          <i className={s.gridMid} aria-hidden="true" />
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={s.lineSvg} role="img" aria-label={`${title}: ${points.map((p) => `${p.label} ${fmt(p.value)}`).join(", ")}`}>
            {xy.length > 1 && <polyline className={s.linePath} points={xy.map(([x, y]) => `${x},${y}`).join(" ")} vectorEffect="non-scaling-stroke" />}
            {points.map((p, i) => (
              <rect key={i} x={Math.max(0, xy[i][0] - step / 2)} y={0} width={step} height={H} className={s.lineHit}>
                <title>{`${p.label}: ${fmt(p.value)}`}</title>
              </rect>
            ))}
          </svg>
        </div>
        <div aria-hidden="true" />
        <div className={s.lineTicks} aria-hidden="true">
          <span>{first}</span>
          <span>{last}</span>
        </div>
      </div>
      <DataTable head={tableHead} label={tableLabel} rows={points.map((p) => [p.label, fmt(p.value)])} />
    </figure>
  );
}

export function DataTable({ head, rows, label }: { head: [string, string]; rows: string[][]; label: string }) {
  return (
    <details className={s.tableView}>
      <summary className="small">{label}</summary>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{head[0]}</th>
              <th>{head[1]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
