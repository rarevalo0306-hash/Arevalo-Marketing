import Link from "next/link";
import { logout } from "@/app/actions";
import { db } from "@/lib/db";
import { NavLinks } from "./NavLinks";

export async function Sidebar({ activeId }: { activeId?: string }) {
  const businesses = await db.business.findMany({ orderBy: { createdAt: "asc" } });
  return (
    <nav className="sidebar" aria-label="Menú principal">
      <Link href="/" className="brandmark"><span className="logo">A</span>Arevalo Marketing</Link>

      <div className="stack" style={{ gap: 2 }}>
        <div className="side-label">Mis negocios</div>
        {businesses.map((b) => (
          <Link
            key={b.id}
            href={`/b/${b.id}/inicio`}
            className={b.id === activeId ? "biz on" : "biz"}
            aria-current={b.id === activeId ? "true" : undefined}
          >
            <span className="dot" style={{ background: b.color }}>{b.name.trim().charAt(0).toUpperCase()}</span>
            <span style={{ flexGrow: 1 }}>{b.name}</span>
          </Link>
        ))}
        <Link href="/negocios/nuevo" className="biz">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ margin: "0 3px" }}><path d="M12 5v14M5 12h14" /></svg>
          Agregar negocio
        </Link>
      </div>

      {activeId && (
        <>
          <div className="side-sep" />
          <NavLinks businessId={activeId} />
        </>
      )}

      <form action={logout} style={{ marginTop: "auto" }}>
        <button type="submit" className="navlink" style={{ width: "100%", background: "none", border: 0, cursor: "pointer", font: "inherit" }}>
          Salir
        </button>
      </form>
    </nav>
  );
}
