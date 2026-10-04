export function PageHead({
  business,
  prefix,
  title,
  subtitle,
  aside,
}: {
  business: { name: string; color: string };
  prefix: string;
  title: string;
  subtitle?: string;
  aside?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <div className="who">
          <i style={{ background: business.color }} />
          <span>{prefix} <strong style={{ color: "var(--ink)" }}>{business.name}</strong></span>
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="muted" style={{ marginTop: 6 }}>{subtitle}</p>}
      </div>
      {aside}
    </header>
  );
}
