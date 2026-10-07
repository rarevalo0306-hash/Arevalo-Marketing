"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { deleteContact, updateContactConsent } from "@/app/actions";
import { addContactWithLists, bulkContactsList, deleteContactList, importContactsToList, setContactLists, type ContactResult } from "@/app/actions-contacts";
import { useT } from "@/components/I18n";
import { DEFAULT_LISTS, listLabel } from "@/lib/contacts";
import s from "./contactos.module.css";

export type ContactItem = { id: string; name: string; email: string; phone: string; emailOptIn: boolean; smsOptIn: boolean; lists: string[] };

const NONE = "__none";
const ALL = "__all";

/** Casillas para elegir listas en los formularios (name="lists") y una lista nueva escrita a mano (name="newList"). */
function ListPicker({ lists, preset, idPrefix }: { lists: string[]; preset: string[]; idPrefix: string }) {
  const { lang, t } = useT();
  return (
    <fieldset className={s.picker}>
      <legend className={s.legend}>{t("¿En qué lista va?", "Which list does it go in?")}</legend>
      <div className={s.chips}>
        {lists.map((l) => (
          <label key={l} className={s.chipCheck}>
            <input type="checkbox" name="lists" value={l} defaultChecked={preset.includes(l)} />
            <span>{listLabel(l, lang)}</span>
          </label>
        ))}
      </div>
      <label className="sr-only" htmlFor={`${idPrefix}-new`}>{t("Otra lista nueva", "Another new list")}</label>
      <input id={`${idPrefix}-new`} name="newList" className="field" maxLength={40} placeholder={t("¿Otra lista? Escribe su nombre (ej.: Constructoras)", "Another list? Type its name (e.g.: Builders)")} />
    </fieldset>
  );
}

function ContactRow({ businessId, c, lists, selected, onSelect }: { businessId: string; c: ContactItem; lists: string[]; selected: boolean; onSelect: (v: boolean) => void }) {
  const { lang, t } = useT();
  const [editing, setEditing] = useState(false);
  const [mine, setMine] = useState(c.lists);
  const [extra, setExtra] = useState("");
  const [pending, start] = useTransition();
  const who = c.name || c.email || c.phone;
  const save = (next: string[]) => {
    setMine(next);
    start(() => setContactLists(businessId, c.id, next));
  };
  const toggle = (l: string) => save(mine.includes(l) ? mine.filter((x) => x !== l) : [...mine, l]);
  const options = [...new Set([...lists, ...mine])];
  return (
    <li className={`${s.row}${selected ? ` ${s.rowOn}` : ""}`}>
      <label className={s.select}>
        <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} />
        <span className="sr-only">{t(`Seleccionar a ${who}`, `Select ${who}`)}</span>
      </label>
      <div className={s.who}>
        <strong>{c.name || t("Sin nombre", "No name")}</strong>
        {c.email && <span className={s.meta}>{c.email}</span>}
        {c.phone && <span className={s.meta}>{c.phone}</span>}
      </div>
      <div className={s.lists}>
        {mine.length === 0 && !editing && <span className={s.meta}>{t("Sin lista", "No list")}</span>}
        {!editing && mine.map((l) => <span key={l} className={s.tag}>{listLabel(l, lang)}</span>)}
        {editing && (
          <div className={s.editor} role="group" aria-label={t(`Listas de ${who}`, `Lists for ${who}`)}>
            {options.map((l) => (
              <button key={l} type="button" className={mine.includes(l) ? `${s.toggle} ${s.toggleOn}` : s.toggle} aria-pressed={mine.includes(l)} onClick={() => toggle(l)}>
                {mine.includes(l) ? "✓ " : "+ "}
                {listLabel(l, lang)}
              </button>
            ))}
            <form
              className={s.addList}
              onSubmit={(e) => {
                e.preventDefault();
                if (extra.trim()) save([...mine, extra.trim()]);
                setExtra("");
              }}
            >
              <label className="sr-only" htmlFor={`nl-${c.id}`}>{t("Lista nueva", "New list")}</label>
              <input id={`nl-${c.id}`} className="field" value={extra} maxLength={40} onChange={(e) => setExtra(e.target.value)} placeholder={t("Lista nueva…", "New list…")} />
              <button className="btn" type="submit" disabled={!extra.trim()}>{t("Agregar", "Add")}</button>
            </form>
          </div>
        )}
        <button type="button" className={`btn link ${s.edit}`} onClick={() => setEditing(!editing)} aria-expanded={editing}>
          {editing ? t("Listo", "Done") : t("Cambiar listas", "Change lists")}
        </button>
        {pending && <span className={s.meta}>{t("Guardando…", "Saving…")}</span>}
      </div>
      <div className={s.consent}>
        <button
          type="button"
          className={c.emailOptIn ? "pill sent" : "pill"}
          onClick={() => start(() => updateContactConsent(businessId, c.id, "emailOptIn", !c.emailOptIn))}
          aria-label={c.emailOptIn ? t(`Email para ${who}: sí, cambiar a no`, `Email for ${who}: yes, change to no`) : t(`Email para ${who}: no, cambiar a sí`, `Email for ${who}: no, change to yes`)}
        >
          Email: {c.emailOptIn ? t("sí", "yes") : "no"}
        </button>
        <button
          type="button"
          className={c.smsOptIn ? "pill sent" : "pill"}
          onClick={() => start(() => updateContactConsent(businessId, c.id, "smsOptIn", !c.smsOptIn))}
          aria-label={c.smsOptIn ? t(`Textos para ${who}: sí, cambiar a no`, `Texts for ${who}: yes, change to no`) : t(`Textos para ${who}: no, cambiar a sí`, `Texts for ${who}: no, change to yes`)}
        >
          {t("Textos", "Texts")}: {c.smsOptIn ? t("sí", "yes") : "no"}
        </button>
      </div>
      <button
        type="button"
        className={`btn danger ${s.del}`}
        onClick={() => {
          if (confirm(t(`¿Borrar a ${who}?`, `Delete ${who}?`))) start(() => deleteContact(businessId, c.id));
        }}
      >
        {t("Borrar", "Delete")}
      </button>
    </li>
  );
}

export function ContactsBoard({ businessId, contacts, lists }: { businessId: string; contacts: ContactItem[]; lists: string[] }) {
  const { lang, t } = useT();
  const [tab, setTab] = useState(ALL);
  const [q, setQ] = useState("");
  const [panel, setPanel] = useState<"" | "add" | "import">(contacts.length ? "" : "import");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkList, setBulkList] = useState(lists[0] ?? "lead");
  const [bulkPending, startBulk] = useTransition();
  const [addState, addAction, addPending] = useActionState<ContactResult, FormData>(addContactWithLists.bind(null, businessId), null);
  const [importState, importAction, importPending] = useActionState<ContactResult, FormData>(importContactsToList.bind(null, businessId), null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contacts) for (const l of c.lists) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  }, [contacts]);
  const noList = contacts.filter((c) => c.lists.length === 0).length;
  const query = q.trim().toLowerCase();
  const shown = contacts.filter(
    (c) =>
      (tab === ALL || (tab === NONE ? c.lists.length === 0 : c.lists.includes(tab))) &&
      (!query || `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(query)),
  );
  const preset = tab !== ALL && tab !== NONE ? [tab] : [];
  const help = DEFAULT_LISTS.find((d) => d.id === tab);
  const isCustom = tab !== ALL && tab !== NONE && !help;
  const allPicked = shown.length > 0 && shown.every((c) => picked.has(c.id));

  const tabs: [string, string, number][] = [
    [ALL, t("Todos", "All"), contacts.length],
    ...lists.map((l): [string, string, number] => [l, listLabel(l, lang), counts.get(l) ?? 0]),
    [NONE, t("Sin lista", "No list"), noList],
  ];

  return (
    <>
      <div className={s.actionsBar}>
        <button type="button" className={panel === "add" ? "btn on" : "btn outline"} aria-expanded={panel === "add"} onClick={() => setPanel(panel === "add" ? "" : "add")}>
          {t("+ Agregar un contacto", "+ Add a contact")}
        </button>
        <button type="button" className={panel === "import" ? "btn on" : "btn outline"} aria-expanded={panel === "import"} onClick={() => setPanel(panel === "import" ? "" : "import")}>
          {t("Pegar una lista (Excel)", "Paste a list (Excel)")}
        </button>
      </div>

      {panel === "add" && (
        <form key={addState?.ok ? addState.message : "add"} action={addAction} className={`card ${s.panel}`}>
          <h2>{t("Agregar un contacto", "Add a contact")}</h2>
          <div className={s.fields}>
            <div className="stack" style={{ gap: 4 }}><label className="lbl" htmlFor="c-name">{t("Nombre", "Name")}</label><input id="c-name" name="name" className="field" autoComplete="off" /></div>
            <div className="stack" style={{ gap: 4 }}><label className="lbl" htmlFor="c-email">Email</label><input id="c-email" name="email" type="email" className="field" autoComplete="off" /></div>
            <div className="stack" style={{ gap: 4 }}><label className="lbl" htmlFor="c-phone">{t("Teléfono", "Phone")}</label><input id="c-phone" name="phone" type="tel" className="field" placeholder="+505 8888 1234" autoComplete="off" /></div>
          </div>
          <ListPicker lists={lists} preset={preset} idPrefix="add" />
          <div className={s.optins}>
            <label className="check"><input type="checkbox" name="emailOptIn" defaultChecked /><span>{t("Aceptó recibir emails", "Agreed to get emails")}</span></label>
            <label className="check"><input type="checkbox" name="smsOptIn" /><span>{t("Aceptó recibir mensajes de texto", "Agreed to get text messages")}</span></label>
          </div>
          <div className="row">
            <button className="btn on" type="submit" disabled={addPending}>{addPending ? t("Agregando…", "Adding…") : t("Agregar", "Add")}</button>
          </div>
          {addState && <p className={addState.ok ? "note ok" : "note error"} role="status">{addState.message}</p>}
        </form>
      )}

      {panel === "import" && (
        <form key={importState?.ok ? importState.message : "import"} action={importAction} className={`card ${s.panel}`}>
          <h2>{t("Pegar una lista", "Paste a list")}</h2>
          <p className="small muted">
            {t(
              "Copia las columnas desde Excel o Google Sheets (nombre, email, teléfono) y pégalas aquí. Una persona por línea. Si alguien ya está en tus contactos, no se repite: solo se le agrega la lista.",
              "Copy the columns from Excel or Google Sheets (name, email, phone) and paste them here. One person per line. If someone is already in your contacts, they aren't duplicated: they just get added to the list.",
            )}
          </p>
          <label htmlFor="csv" className="sr-only">{t("Lista de contactos", "Contact list")}</label>
          <textarea id="csv" name="csv" className="field" rows={6} required placeholder={t("nombre,email,telefono\nAna López,ana@correo.com,+50588881234", "name,email,phone\nAna Lopez,ana@email.com,5551234567")} />
          <ListPicker lists={lists} preset={preset} idPrefix="imp" />
          <div className={s.optins}>
            <label className="check"><input type="checkbox" name="emailOptIn" defaultChecked /><span>{t("Todos aceptaron recibir emails", "Everyone agreed to get emails")}</span></label>
            <label className="check"><input type="checkbox" name="smsOptIn" /><span>{t("Todos aceptaron recibir mensajes de texto", "Everyone agreed to get text messages")}</span></label>
          </div>
          <div className="row">
            <button className="btn on" type="submit" disabled={importPending}>{importPending ? t("Importando…", "Importing…") : t("Importar", "Import")}</button>
          </div>
          {importState && <p className={importState.ok ? "note ok" : "note error"} role="status">{importState.message}</p>}
        </form>
      )}

      <section className={`card ${s.board}`}>
        <div className={s.boardHead}>
          <h2>{t("Tus listas", "Your lists")}</h2>
          <label className="sr-only" htmlFor="c-search">{t("Buscar contacto", "Search contacts")}</label>
          <input id="c-search" type="search" className={`field ${s.search}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Buscar por nombre, email o teléfono", "Search by name, email or phone")} />
        </div>
        <div className={`tabs ${s.tabs}`} role="tablist" aria-label={t("Listas", "Lists")}>
          {tabs.map(([id, label, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "tab on" : "tab"} onClick={() => { setTab(id); setPicked(new Set()); }}>
              {label} <span className={s.count}>{n}</span>
            </button>
          ))}
        </div>
        {help && <p className={s.help}>{t(help.helpEs, help.helpEn)}</p>}
        {isCustom && (
          <p className={s.help}>
            {t("Una lista tuya.", "One of your lists.")}{" "}
            <button
              type="button"
              className="btn link"
              style={{ color: "var(--err-text)", minHeight: 32 }}
              onClick={() => {
                if (confirm(t(`¿Borrar la lista "${tab}"? Los contactos se quedan.`, `Delete the list "${tab}"? The contacts stay.`))) startBulk(async () => { await deleteContactList(businessId, tab); setTab(ALL); });
              }}
            >
              {t("Borrar esta lista", "Delete this list")}
            </button>
          </p>
        )}

        {shown.length > 0 && (
          <div className={s.bulk}>
            <label className={s.selectAll}>
              <input type="checkbox" checked={allPicked} onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((c) => c.id)) : new Set())} />
              <span>{picked.size ? t(`${picked.size} seleccionados`, `${picked.size} selected`) : t("Seleccionar todos", "Select all")}</span>
            </label>
            {picked.size > 0 && (
              <div className={s.bulkActions}>
                <label className="sr-only" htmlFor="bulk-list">{t("Lista", "List")}</label>
                <select id="bulk-list" className="field" value={bulkList} onChange={(e) => setBulkList(e.target.value)}>
                  {lists.map((l) => <option key={l} value={l}>{listLabel(l, lang)}</option>)}
                </select>
                <button type="button" className="btn on" disabled={bulkPending} onClick={() => startBulk(async () => { await bulkContactsList(businessId, [...picked], bulkList, true); setPicked(new Set()); })}>
                  {t("Agregar a la lista", "Add to list")}
                </button>
                <button type="button" className="btn" disabled={bulkPending} onClick={() => startBulk(async () => { await bulkContactsList(businessId, [...picked], bulkList, false); setPicked(new Set()); })}>
                  {t("Quitar de la lista", "Remove from list")}
                </button>
              </div>
            )}
          </div>
        )}

        {contacts.length === 0 ? (
          <p className="empty">{t("Todavía no hay contactos. Pega tu lista de clientes desde Excel o agrégalos uno por uno.", "No contacts yet. Paste your customer list from Excel or add them one by one.")}</p>
        ) : shown.length === 0 ? (
          <p className="empty">{query ? t("Nadie coincide con esa búsqueda.", "No one matches that search.") : t("Nadie en esta lista todavía. Agrégalos con «Cambiar listas» en cada contacto, o selecciónalos en «Todos».", "No one in this list yet. Add people with \"Change lists\" on each contact, or select them under \"All\".")}</p>
        ) : (
          <ul className={s.list}>
            {shown.map((c) => (
              <ContactRow
                key={c.id}
                businessId={businessId}
                c={c}
                lists={lists}
                selected={picked.has(c.id)}
                onSelect={(v) => setPicked((p) => { const n = new Set(p); if (v) n.add(c.id); else n.delete(c.id); return n; })}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
