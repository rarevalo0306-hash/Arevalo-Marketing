import { createBusiness } from "@/app/actions";
import { Sidebar } from "@/components/Sidebar";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function NewBusiness() {
  const count = await db.business.count();
  return (
    <div className="shell">
      <Sidebar />
      <main className="content">
        <div className="page-head">
          <div>
            <h1>{count ? "Agregar negocio" : "Bienvenido. Agrega tu primer negocio"}</h1>
            <p className="muted">Cada negocio tiene su color, sus cuentas conectadas y sus contactos.</p>
          </div>
        </div>
        <form action={createBusiness} className="card" style={{ maxWidth: 560 }}>
          <div className="stack">
            <label className="lbl" htmlFor="name">Nombre del negocio</label>
            <input id="name" name="name" className="field" required placeholder="Ej.: Ricardo Public Adjusters" />
          </div>
          <div className="stack">
            <label className="lbl" htmlFor="website">Sitio web (opcional)</label>
            <input id="website" name="website" type="url" className="field" placeholder="https://" />
          </div>
          <div className="stack">
            <label className="lbl" htmlFor="color">Color del negocio</label>
            <input id="color" name="color" type="color" defaultValue="#126BBC" style={{ width: 80, height: 44, border: 0, padding: 0, background: "none" }} />
          </div>
          <div>
            <button className="primary" type="submit">Crear negocio</button>
          </div>
        </form>
      </main>
    </div>
  );
}
