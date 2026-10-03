import { deleteBusiness, updateBusiness } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { db } from "@/lib/db";

export default async function NegocioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  return (
    <>
      <PageHead business={b} prefix="Ajustes de" title="Ajustes del negocio" />
      <div className="grid-2">
        <form action={updateBusiness.bind(null, id)} className="card">
          <h2>Datos</h2>
          <div className="stack"><label className="lbl" htmlFor="name">Nombre</label><input id="name" name="name" className="field" defaultValue={b.name} required /></div>
          <div className="stack"><label className="lbl" htmlFor="website">Sitio web</label><input id="website" name="website" type="url" className="field" defaultValue={b.website} placeholder="https://" /></div>
          <div className="stack"><label className="lbl" htmlFor="color">Color</label><input id="color" name="color" type="color" defaultValue={b.color} style={{ width: 80, height: 44, border: 0, padding: 0, background: "none" }} /></div>
          <div><button className="btn on" type="submit">Guardar</button></div>
        </form>
        <form action={deleteBusiness.bind(null, id)} className="card">
          <h2>Borrar negocio</h2>
          <p className="small muted">Se borran sus conexiones, contactos e historial en esta app. No se borra nada de Facebook, Instagram ni de tus otras cuentas.</p>
          <div className="stack">
            <label className="small" style={{ fontWeight: 500 }} htmlFor="confirm">Escribe &quot;{b.name}&quot; para confirmar</label>
            <input id="confirm" name="confirm" className="field" autoComplete="off" />
          </div>
          <div><button className="btn danger" type="submit">Borrar negocio</button></div>
        </form>
      </div>
    </>
  );
}
