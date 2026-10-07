import s from "./Dashboard.module.css";

/**
 * Mini gráfica de línea (SVG, sin librerías) con la historia de un número, del más viejo al más nuevo.
 * invert: cuando más bajo es mejor (posición en Google), la línea sube al mejorar.
 * Con menos de 2 puntos no dibuja nada (deja el mismo alto para que las tarjetas no salten).
 */
export function Sparkline({ values, invert = false, label }: { values: number[]; invert?: boolean; label?: string }) {
  const W = 100;
  const H = 28;
  if (values.length < 2) return <span className={s.spark} aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const t = (v - min) / span;
    const y = 3 + (invert ? t : 1 - t) * (H - 6);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  return (
    <svg className={s.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <polygon className={s.sparkArea} points={area} />
      <polyline className={s.sparkLine} points={line} />
    </svg>
  );
}
