import styles from "@/components/seo/SeoHelp.module.css";

/**
 * Un desplegable corto de ayuda ("Cómo leer esto") para los paneles de SEO. Sin estado: sirve en componentes del
 * servidor y del cliente. El título ya viene traducido.
 */
export function HowToRead({ title, children, open = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className={styles.help} open={open}>
      <summary>{title}</summary>
      <div className={styles.helpBody}>{children}</div>
    </details>
  );
}
