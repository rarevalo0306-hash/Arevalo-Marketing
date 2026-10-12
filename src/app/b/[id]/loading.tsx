export default function Loading() {
  return <section aria-busy="true" aria-label="Cargando / Loading" className="stack" style={{ gap: 20 }}>
    <div className="card"><h1>MATYA</h1><p role="status">Cargando tu espacio… / Loading your workspace…</p></div>
    <div className="card" style={{ minHeight: 220 }} />
  </section>;
}
