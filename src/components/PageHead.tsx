import Link from "next/link";

/** «SEO de», «Cuentas para», «Publishing as»… → «SEO», «Cuentas», «Publishing» (para la ruta «Negocio › Sección»). */
const CRUMB: Record<string, string> = { "Publicando como": "Publicar", "Publishing as": "Publish" };
function sectionFromPrefix(prefix: string) {
  const p = prefix.trim();
  return CRUMB[p] ?? p.replace(/\s+(de|del|para|como|of|for|as)$/i, "").trim();
}

/**
 * Encabezado de cada página: ruta «Negocio › Sección», título, explicación corta y,
 * a la derecha, botones de la página (opcional).
 * - `prefix` (de siempre) da la sección de la ruta; `section` la reemplaza si se quiere otro texto.
 * - `aside` y `actions` son lo mismo: lo que va a la derecha del título.
 */
export function PageHead({
  business,
  prefix,
  section,
  title,
  subtitle,
  aside,
  actions,
}: {
  business: { name: string; color: string; id?: string };
  prefix: string;
  section?: string;
  title: string;
  subtitle?: React.ReactNode;
  aside?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const crumb = section ?? sectionFromPrefix(prefix);
  const right = aside || actions ? <div className="page-actions">{aside}{actions}</div> : null;
  return (
    <header className="page-head">
      <div>
        <div className="crumbs">
          <i style={{ background: business.color }} aria-hidden="true" />
          {business.id ? <Link href={`/b/${business.id}/inicio`} className="crumb-biz">{business.name}</Link> : <span>{business.name}</span>}
          {crumb && crumb !== business.name && (
            <>
              <span className="sep" aria-hidden="true">›</span>
              <span aria-current="page">{crumb}</span>
            </>
          )}
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}
