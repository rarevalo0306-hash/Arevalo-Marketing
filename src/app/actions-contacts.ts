"use server";

import { revalidatePath } from "next/cache";
import { cleanLists, normalizePhone, parseContactsCsv } from "@/lib/contacts";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";

export type ContactResult = { ok: boolean; message: string } | null;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function exists(businessId: string) {
  return Boolean(await db.business.findUnique({ where: { id: businessId }, select: { id: true } }));
}

/** Las listas marcadas en el formulario (casillas "lists") más una lista nueva escrita a mano ("newList"). */
function listsFrom(f: FormData): string[] {
  return cleanLists([...f.getAll("lists").map(String), str(f, "newList")]);
}

/** Agrega un contacto con sus listas. Si ya existe (mismo email o teléfono), solo le suma las listas. */
export async function addContactWithLists(businessId: string, _prev: ContactResult, f: FormData): Promise<ContactResult> {
  void _prev;
  const { t } = await getT();
  if (!(await exists(businessId))) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const email = str(f, "email");
  const phone = normalizePhone(str(f, "phone"));
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: t("Ese email no parece válido.", "That email doesn't look valid.") };
  if (!email && !phone) return { ok: false, message: t("Escribe un email o un teléfono.", "Enter an email or a phone number.") };
  const lists = listsFrom(f);
  const name = str(f, "name").slice(0, 120);
  const existing = await db.contact.findFirst({
    where: { businessId, OR: [...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []), ...(phone ? [{ phone }] : [])] },
  });
  if (existing) {
    await db.contact.update({ where: { id: existing.id }, data: { lists: cleanLists([...existing.lists, ...lists]), ...(name && !existing.name && { name }) } });
    revalidatePath(`/b/${businessId}/contactos`);
    return { ok: true, message: t(`${existing.name || email || phone} ya estaba en tus contactos: le agregamos las listas.`, `${existing.name || email || phone} was already in your contacts: we added the lists.`) };
  }
  await db.contact.create({
    data: { businessId, name, email, phone, lists, emailOptIn: f.get("emailOptIn") === "on", smsOptIn: f.get("smsOptIn") === "on" },
  });
  revalidatePath(`/b/${businessId}/contactos`);
  return { ok: true, message: t(`Listo: agregamos a ${name || email || phone}.`, `Done: we added ${name || email || phone}.`) };
}

/** Importa una lista pegada (Excel o CSV) a una lista. Los que ya existen no se repiten: solo se les suma la lista. */
export async function importContactsToList(businessId: string, _prev: ContactResult, f: FormData): Promise<ContactResult> {
  void _prev;
  const { t } = await getT();
  if (!(await exists(businessId))) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const rows = parseContactsCsv(str(f, "csv"), { emailOptIn: f.get("emailOptIn") === "on", smsOptIn: f.get("smsOptIn") === "on" });
  if (!rows.length)
    return {
      ok: false,
      message: t("No encontramos ningún email ni teléfono. Pega una persona por línea: nombre, email, teléfono.", "We didn't find any email or phone. Paste one person per line: name, email, phone."),
    };
  const lists = listsFrom(f);
  const current = await db.contact.findMany({ where: { businessId }, select: { id: true, email: true, phone: true, lists: true } });
  const byEmail = new Map(current.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c]));
  const byPhone = new Map(current.filter((c) => c.phone).map((c) => [c.phone, c]));
  const fresh: typeof rows = [];
  const seen = new Set<string>();
  let updated = 0;
  for (const r of rows) {
    const key = (r.email || r.phone).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const old = (r.email && byEmail.get(r.email.toLowerCase())) || (r.phone && byPhone.get(r.phone));
    if (old) {
      if (lists.length) {
        await db.contact.update({ where: { id: old.id }, data: { lists: cleanLists([...old.lists, ...lists]) } });
        updated++;
      }
    } else fresh.push(r);
  }
  if (fresh.length) await db.contact.createMany({ data: fresh.map((r) => ({ ...r, businessId, lists })) });
  revalidatePath(`/b/${businessId}/contactos`);
  const skipped = rows.length - fresh.length - updated;
  return {
    ok: true,
    message: t(
      `Listo: ${fresh.length} contactos nuevos${updated ? `, ${updated} que ya tenías quedaron en la lista` : ""}${skipped ? `, ${skipped} repetidos sin cambios` : ""}.`,
      `Done: ${fresh.length} new contacts${updated ? `, ${updated} you already had were added to the list` : ""}${skipped ? `, ${skipped} duplicates unchanged` : ""}.`,
    ),
  };
}

/** Cambia las listas de un contacto (las casillas de cada contacto). */
export async function setContactLists(businessId: string, contactId: string, lists: string[]): Promise<void> {
  await db.contact.updateMany({ where: { id: contactId, businessId }, data: { lists: cleanLists(lists) } });
  revalidatePath(`/b/${businessId}/contactos`);
}

/** Agrega o quita una lista a varios contactos a la vez. */
export async function bulkContactsList(businessId: string, contactIds: string[], list: string, add: boolean): Promise<void> {
  const [name] = cleanLists([list]);
  if (!name || !contactIds.length) return;
  const rows = await db.contact.findMany({ where: { businessId, id: { in: contactIds.slice(0, 1000) } }, select: { id: true, lists: true } });
  for (const r of rows) {
    const next = add ? cleanLists([...r.lists, name]) : r.lists.filter((l) => l !== name);
    if (next.join("\n") !== r.lists.join("\n")) await db.contact.update({ where: { id: r.id }, data: { lists: next } });
  }
  revalidatePath(`/b/${businessId}/contactos`);
}

/** Borra una lista propia: los contactos se quedan, solo pierden esa lista. */
export async function deleteContactList(businessId: string, list: string): Promise<void> {
  const rows = await db.contact.findMany({ where: { businessId, lists: { has: list } }, select: { id: true, lists: true } });
  for (const r of rows) await db.contact.update({ where: { id: r.id }, data: { lists: r.lists.filter((l) => l !== list) } });
  revalidatePath(`/b/${businessId}/contactos`);
}
