import styles from "@/components/seo/Fold.module.css";

/** La clase para lo que queda escondido dentro de un <ShowMore> hasta tocar «Ver todas». */
export const extra = styles.extra;
/** Pone la clase `extra` a los elementos que pasan del tope. */
export const capClass = (i: number, limit: number) => (i >= limit ? styles.extra : undefined);

/**
 * Un desplegable para lo secundario de un panel. Sin estado: sirve en componentes del servidor y del cliente.
 * `summary` dice qué hay adentro y cuántos (ya traducido). `inline` = versión enlace, para tablas y tarjetas.
 */
export function Fold({
  summary,
  note,
  children,
  open = false,
  inline = false,
  id,
  className,
}: {
  summary: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  inline?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <details className={`${inline ? styles.inline : styles.fold}${className ? ` ${className}` : ""}`} open={open} id={id}>
      <summary>
        {inline ? (
          summary
        ) : (
          <span className={styles.sumText}>
            <span>{summary}</span>
            {note && <span className={styles.sumNote}>{note}</span>}
          </span>
        )}
      </summary>
      {inline ? children : <div className={styles.body}>{children}</div>}
    </details>
  );
}
