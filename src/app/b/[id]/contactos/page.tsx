import { PageHead } from "@/components/PageHead";
import { allLists } from "@/lib/contacts";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { ContactsBoard } from "./ContactsBoard";

export default async function ContactosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  const contacts = await db.contact.findMany({
    where: { businessId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, email: true, phone: true, emailOptIn: true, smsOptIn: true, lists: true },
  });
  const emailCount = contacts.filter((c) => c.emailOptIn && c.email).length;
  const smsCount = contacts.filter((c) => c.smsOptIn && c.phone).length;
  return (
    <>
      <PageHead
        business={b}
        prefix={t("Contactos de", "Contacts for")}
        title={t("Contactos", "Contacts")}
        subtitle={t(
          "Tus clientes y posibles clientes, ordenados en listas, para mandarles correos y mensajes de texto (solo a quienes te dieron permiso).",
          "Your customers and potential customers, sorted into lists, so you can send them emails and text messages (only to those who gave you permission).",
        )}
      />
      <p className="small muted" style={{ marginTop: -8 }}>
        {t(
          `${contacts.length} contactos · ${emailCount} reciben email · ${smsCount} reciben textos`,
          `${contacts.length} contacts · ${emailCount} get email · ${smsCount} get texts`,
        )}
      </p>
      <ContactsBoard businessId={id} contacts={contacts} lists={allLists(contacts)} />
      <p className="note">
        {t(
          "Envía emails y textos solo a personas que te dieron permiso. Para SMS en EE. UU. es obligatorio por ley (TCPA), y cada mensaje incluye \"Responde STOP para no recibir más\".",
          "Only send emails and texts to people who gave you permission. For SMS in the U.S. it's required by law (TCPA), and every message includes \"Responde STOP para no recibir más\" (Reply STOP to opt out).",
        )}
      </p>
    </>
  );
}
