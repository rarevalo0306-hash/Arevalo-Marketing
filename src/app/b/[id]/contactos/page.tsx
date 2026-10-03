import { addContact, deleteContact, importContacts, updateContactConsent } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { db } from "@/lib/db";

export default async function ContactosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  const contacts = await db.contact.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" } });
  const emailCount = contacts.filter((c) => c.emailOptIn && c.email).length;
  const smsCount = contacts.filter((c) => c.smsOptIn && c.phone).length;
  return (
    <>
      <PageHead
        business={b}
        prefix="Contactos de"
        title="Contactos"
        subtitle={`${contacts.length} contactos · ${emailCount} reciben email · ${smsCount} reciben textos`}
      />
      <div className="grid-2">
        <form action={addContact.bind(null, id)} className="card">
          <h2>Agregar un contacto</h2>
          <div className="stack"><label className="small" style={{ fontWeight: 500 }} htmlFor="c-name">Nombre</label><input id="c-name" name="name" className="field" /></div>
          <div className="stack"><label className="small" style={{ fontWeight: 500 }} htmlFor="c-email">Email</label><input id="c-email" name="email" type="email" className="field" /></div>
          <div className="stack"><label className="small" style={{ fontWeight: 500 }} htmlFor="c-phone">Teléfono</label><input id="c-phone" name="phone" type="tel" className="field" placeholder="+1 555 123 4567" /></div>
          <label className="row small"><input type="checkbox" name="emailOptIn" defaultChecked /> Aceptó recibir emails</label>
          <label className="row small"><input type="checkbox" name="smsOptIn" /> Aceptó recibir mensajes de texto</label>
          <div><button className="btn on" type="submit">Agregar</button></div>
        </form>

        <form action={importContacts.bind(null, id)} className="card">
          <h2>Pegar una lista</h2>
          <p className="small muted">Copia las columnas desde Excel o Google Sheets (nombre, email, teléfono) y pégalas aquí. Una persona por línea.</p>
          <label htmlFor="csv" className="sr-only">Lista de contactos</label>
          <textarea id="csv" name="csv" className="field" rows={6} placeholder={"nombre,email,telefono\nAna López,ana@correo.com,5551234567"} />
          <label className="row small"><input type="checkbox" name="emailOptIn" defaultChecked /> Todos aceptaron recibir emails</label>
          <label className="row small"><input type="checkbox" name="smsOptIn" /> Todos aceptaron recibir mensajes de texto</label>
          <div><button className="btn on" type="submit">Importar</button></div>
        </form>
      </div>

      <p className="note">Envía emails y textos solo a personas que te dieron permiso. Para SMS en EE. UU. es obligatorio por ley (TCPA), y cada mensaje incluye &quot;Responde STOP para no recibir más&quot;.</p>

      <section className="card">
        <h2>Lista</h2>
        {contacts.length === 0 ? (
          <p className="empty">Todavía no hay contactos.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Email</th><th>Textos</th><th><span className="sr-only">Acciones</span></th></tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name || "—"}</td>
                    <td>{c.email || "—"}</td>
                    <td>{c.phone || "—"}</td>
                    <td>
                      <form action={updateContactConsent.bind(null, id, c.id, "emailOptIn", !c.emailOptIn)}>
                        <button className={c.emailOptIn ? "pill sent" : "pill"} style={{ border: 0, cursor: "pointer", minHeight: 32 }} type="submit" aria-label={`Email para ${c.name || c.email}: ${c.emailOptIn ? "sí, cambiar a no" : "no, cambiar a sí"}`}>{c.emailOptIn ? "Sí" : "No"}</button>
                      </form>
                    </td>
                    <td>
                      <form action={updateContactConsent.bind(null, id, c.id, "smsOptIn", !c.smsOptIn)}>
                        <button className={c.smsOptIn ? "pill sent" : "pill"} style={{ border: 0, cursor: "pointer", minHeight: 32 }} type="submit" aria-label={`Textos para ${c.name || c.phone}: ${c.smsOptIn ? "sí, cambiar a no" : "no, cambiar a sí"}`}>{c.smsOptIn ? "Sí" : "No"}</button>
                      </form>
                    </td>
                    <td>
                      <form action={deleteContact.bind(null, id, c.id)}>
                        <button className="btn danger" type="submit" style={{ minHeight: 32 }}>Borrar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
