import { addContact, deleteContact, importContacts, updateContactConsent } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";

export default async function ContactosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  const contacts = await db.contact.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" } });
  const emailCount = contacts.filter((c) => c.emailOptIn && c.email).length;
  const smsCount = contacts.filter((c) => c.smsOptIn && c.phone).length;
  return (
    <>
      <PageHead
        business={b}
        prefix={t("Contactos de", "Contacts for")}
        title={t("Contactos", "Contacts")}
        subtitle={t(
          `${contacts.length} contactos · ${emailCount} reciben email · ${smsCount} reciben textos`,
          `${contacts.length} contacts · ${emailCount} get email · ${smsCount} get texts`,
        )}
      />
      <div className="grid-2">
        <form action={addContact.bind(null, id)} className="card">
          <h2>{t("Agregar un contacto", "Add a contact")}</h2>
          <div className="stack"><label className="small" style={{ fontWeight: 500 }} htmlFor="c-name">{t("Nombre", "Name")}</label><input id="c-name" name="name" className="field" /></div>
          <div className="stack"><label className="small" style={{ fontWeight: 500 }} htmlFor="c-email">Email</label><input id="c-email" name="email" type="email" className="field" /></div>
          <div className="stack"><label className="small" style={{ fontWeight: 500 }} htmlFor="c-phone">{t("Teléfono", "Phone")}</label><input id="c-phone" name="phone" type="tel" className="field" placeholder="+1 555 123 4567" /></div>
          <label className="row small"><input type="checkbox" name="emailOptIn" defaultChecked /> {t("Aceptó recibir emails", "Agreed to get emails")}</label>
          <label className="row small"><input type="checkbox" name="smsOptIn" /> {t("Aceptó recibir mensajes de texto", "Agreed to get text messages")}</label>
          <div><button className="btn on" type="submit">{t("Agregar", "Add")}</button></div>
        </form>

        <form action={importContacts.bind(null, id)} className="card">
          <h2>{t("Pegar una lista", "Paste a list")}</h2>
          <p className="small muted">{t("Copia las columnas desde Excel o Google Sheets (nombre, email, teléfono) y pégalas aquí. Una persona por línea.", "Copy the columns from Excel or Google Sheets (name, email, phone) and paste them here. One person per line.")}</p>
          <label htmlFor="csv" className="sr-only">{t("Lista de contactos", "Contact list")}</label>
          <textarea id="csv" name="csv" className="field" rows={6} placeholder={t("nombre,email,telefono\nAna López,ana@correo.com,5551234567", "name,email,phone\nAna Lopez,ana@email.com,5551234567")} />
          <label className="row small"><input type="checkbox" name="emailOptIn" defaultChecked /> {t("Todos aceptaron recibir emails", "Everyone agreed to get emails")}</label>
          <label className="row small"><input type="checkbox" name="smsOptIn" /> {t("Todos aceptaron recibir mensajes de texto", "Everyone agreed to get text messages")}</label>
          <div><button className="btn on" type="submit">{t("Importar", "Import")}</button></div>
        </form>
      </div>

      <p className="note">{t("Envía emails y textos solo a personas que te dieron permiso. Para SMS en EE. UU. es obligatorio por ley (TCPA), y cada mensaje incluye \"Responde STOP para no recibir más\".", "Only send emails and texts to people who gave you permission. For SMS in the U.S. it's required by law (TCPA), and every message includes \"Responde STOP para no recibir más\" (Reply STOP to opt out).")}</p>

      <section className="card">
        <h2>{t("Lista", "List")}</h2>
        {contacts.length === 0 ? (
          <p className="empty">{t("Todavía no hay contactos.", "No contacts yet.")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t("Nombre", "Name")}</th><th>Email</th><th>{t("Teléfono", "Phone")}</th><th>Email</th><th>{t("Textos", "Texts")}</th><th><span className="sr-only">{t("Acciones", "Actions")}</span></th></tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name || "—"}</td>
                    <td>{c.email || "—"}</td>
                    <td>{c.phone || "—"}</td>
                    <td>
                      <form action={updateContactConsent.bind(null, id, c.id, "emailOptIn", !c.emailOptIn)}>
                        <button className={c.emailOptIn ? "pill sent" : "pill"} style={{ border: 0, cursor: "pointer", minHeight: 32 }} type="submit" aria-label={c.emailOptIn ? t(`Email para ${c.name || c.email}: sí, cambiar a no`, `Email for ${c.name || c.email}: yes, change to no`) : t(`Email para ${c.name || c.email}: no, cambiar a sí`, `Email for ${c.name || c.email}: no, change to yes`)}>{c.emailOptIn ? t("Sí", "Yes") : "No"}</button>
                      </form>
                    </td>
                    <td>
                      <form action={updateContactConsent.bind(null, id, c.id, "smsOptIn", !c.smsOptIn)}>
                        <button className={c.smsOptIn ? "pill sent" : "pill"} style={{ border: 0, cursor: "pointer", minHeight: 32 }} type="submit" aria-label={c.smsOptIn ? t(`Textos para ${c.name || c.phone}: sí, cambiar a no`, `Texts for ${c.name || c.phone}: yes, change to no`) : t(`Textos para ${c.name || c.phone}: no, cambiar a sí`, `Texts for ${c.name || c.phone}: no, change to yes`)}>{c.smsOptIn ? t("Sí", "Yes") : "No"}</button>
                      </form>
                    </td>
                    <td>
                      <form action={deleteContact.bind(null, id, c.id)}>
                        <button className="btn danger" type="submit" style={{ minHeight: 32 }}>{t("Borrar", "Delete")}</button>
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
