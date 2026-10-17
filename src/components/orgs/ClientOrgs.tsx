"use client";

// «Organizaciones»: las organizaciones de cliente de una cuenta y sus negocios. Cada una se puede renombrar, darle un
// negocio nuevo o (si está vacía) borrar; cada negocio se puede pasar a otra organización. Abajo, «Nueva organización».
// Los formularios se mandan a mano (no con action={…}) para que un error no borre lo que la persona escribió.
// El reporte semanal de cada organización (a quién le llega, cuándo, y cómo le fue al último) está en ReportPanel.tsx.
import Link from "next/link";
import { startTransition, useActionState, useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { createClientOrgAction, deleteClientOrgAction, moveBusinessAction, renameClientOrgAction, type OrgResult } from "@/app/actions-client-orgs";
import { failed, focusLost } from "@/components/action-result";
import { useT } from "@/components/I18n";
import type { ReportSettings } from "@/lib/client-org-report";
import { ORG_NAME_MAX } from "@/lib/client-orgs";
import type { LastSend } from "@/lib/client-orgs-store";
import type { T } from "@/lib/i18n";
import s from "./Orgs.module.css";
import { ReportPanel } from "./ReportPanel";

type Biz = { id: string; name: string; color: string };
export type Org = { id: string; name: string; businesses: Biz[]; report: ReportSettings; last: LastSend | null };
type Target = { id: string; name: string };

/** La pregunta antes de borrar una organización (se hace con window.confirm). */
export const deleteQuestion = (name: string, t: T) => t(`¿Borrar «${name}»? No tiene negocios.`, `Delete "${name}"? It has no businesses.`);

const countText = (n: number, t: T) => t(`${n} ${n === 1 ? "negocio" : "negocios"}`, `${n} ${n === 1 ? "business" : "businesses"}`);

/** El resultado junto al formulario que lo mandó. El aviso va en un lugar que ya existe, para que se anuncie al llegar. */
function Status({ result, busy }: { result: OrgResult; busy?: boolean }) {
  return (
    <div role="status" className={s.result}>
      {result && !busy && <p className={`note ${result.ok ? "ok" : "error"}`}>{result.message}</p>}
    </div>
  );
}

/** Pasa un negocio a otra organización de la cuenta: «Mover a…», la lista de las otras y «Mover». */
function MoveForm({ accountId, business, others, onMoved }: { accountId: string; business: Biz; others: Target[]; onMoved: (text: string) => void }) {
  const { t } = useT();
  const selectId = useId();
  const move = moveBusinessAction.bind(null, accountId, business.id);
  const [result, send, sending] = useActionState(async (prev: OrgResult, f: FormData): Promise<OrgResult> => {
    try {
      const r = await move(prev, f);
      // Si sale bien, el negocio cambia de tarjeta y esta fila desaparece: el aviso va arriba de la lista.
      if (r?.ok) {
        const target = others.find((o) => o.id === f.get("clientOrgId"));
        onMoved(target ? t(`«${business.name}» ahora está en «${target.name}».`, `"${business.name}" is now in "${target.name}".`) : r.message);
      }
      return r;
    } catch (e) {
      return failed(e, t);
    }
  }, null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (result && !sending && focusLost()) button.current?.focus();
  }, [result, sending]);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    startTransition(() => send(f));
  };

  return (
    <>
      <form method="post" onSubmit={submit} className={s.move} aria-label={t(`Mover «${business.name}»`, `Move "${business.name}"`)}>
        <label className={s.moveLabel} htmlFor={selectId}>
          {t("Mover a…", "Move to…")}
        </label>
        <select id={selectId} name="clientOrgId" className={`field ${s.moveSelect}`} defaultValue={others[0]?.id} disabled={sending}>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <button ref={button} type="submit" className={`btn ${s.act}`} disabled={sending}>
          {sending ? t("Moviendo…", "Moving…") : t("Mover", "Move")}
          <span className="sr-only">{t(` «${business.name}»`, ` "${business.name}"`)}</span>
        </button>
      </form>
      <Status result={result} busy={sending} />
    </>
  );
}

function OrgCard({ accountId, org, others, appTz, onNotice }: { accountId: string; org: Org; others: Target[]; appTz: string; onNotice: (text: string) => void }) {
  const { t } = useT();
  const titleId = useId();
  const nameId = useId();
  const empty = org.businesses.length === 0;
  const [editing, setEditing] = useState(false);
  // Lo que se muestra debajo de las acciones: el resultado de renombrar o de borrar.
  const [shown, setShown] = useState<OrgResult>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);

  // «Editar nombre»: si sale bien, se cierra el editor y queda «Listo.».
  const rename = renameClientOrgAction.bind(null, accountId, org.id);
  const [renamed, saveName, saving] = useActionState(async (prev: OrgResult, f: FormData): Promise<OrgResult> => {
    try {
      return await rename(prev, f);
    } catch (e) {
      return failed(e, t);
    }
  }, null);
  const [seen, setSeen] = useState<OrgResult>(null);
  if (renamed !== seen) {
    setSeen(renamed);
    setShown(renamed);
    if (renamed?.ok) setEditing(false);
  }
  useEffect(() => {
    if (saving || !renamed) return;
    // Al guardar, el editor se cierra: el foco vuelve a «Editar nombre». Si hubo un error, a «Guardar», que estuvo desactivado.
    if (renamed.ok) editButton.current?.focus();
    else if (focusLost()) saveButton.current?.focus();
  }, [renamed, saving]);
  useEffect(() => {
    if (editing) nameInput.current?.focus();
  }, [editing]);

  const submitName = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setShown(null);
    startTransition(() => saveName(f));
  };
  const toggleEdit = () => {
    setShown(null);
    setEditing((now) => !now);
  };
  const cancelEdit = () => {
    setShown(null);
    setEditing(false);
    editButton.current?.focus();
  };

  // «Borrar organización»: solo si está vacía y después de preguntar.
  const [deleting, startDelete] = useTransition();
  const remove = () => {
    if (!window.confirm(deleteQuestion(org.name, t))) return;
    setShown(null);
    startDelete(async () => {
      try {
        const r = await deleteClientOrgAction(accountId, org.id);
        // Si sale bien, la tarjeta desaparece: el aviso (y el foco) van arriba de la lista.
        if (r?.ok) return onNotice(t(`Borraste «${org.name}».`, `You deleted "${org.name}".`));
        setShown(r);
      } catch (e) {
        setShown(failed(e, t));
      }
    });
  };

  return (
    <section className="card" data-org={org.id} aria-labelledby={titleId}>
      <div className={s.head}>
        <h2 id={titleId} className={s.title}>
          {org.name}
        </h2>
        <span className="pill neutral">{countText(org.businesses.length, t)}</span>
      </div>

      <div className={s.actions}>
        <button ref={editButton} type="button" className={editing ? `btn on ${s.act}` : `btn ${s.act}`} aria-expanded={editing} onClick={toggleEdit}>
          {t("Editar nombre", "Rename")}
          <span className="sr-only">{t(` de «${org.name}»`, ` "${org.name}"`)}</span>
        </button>
        <Link href={`/negocios/nuevo?organizacion=${encodeURIComponent(org.id)}`} className={`btn ${s.act}`}>
          {t("Agregar negocio", "Add business")}
          <span className="sr-only">{t(` a «${org.name}»`, ` to "${org.name}"`)}</span>
        </Link>
        {empty && (
          <button type="button" className={`btn danger ${s.act}`} onClick={remove} disabled={deleting}>
            {deleting ? t("Borrando…", "Deleting…") : t("Borrar organización", "Delete organization")}
            <span className="sr-only">{t(` «${org.name}»`, ` "${org.name}"`)}</span>
          </button>
        )}
      </div>

      {editing && (
        <form method="post" onSubmit={submitName} className={s.panel} aria-label={t(`Cambiar el nombre de «${org.name}»`, `Rename "${org.name}"`)}>
          <div className="stack">
            <label className="lbl" htmlFor={nameId}>
              {t("Nombre", "Name")}
            </label>
            <input ref={nameInput} id={nameId} name="name" className="field" defaultValue={org.name} required maxLength={ORG_NAME_MAX} autoComplete="off" />
          </div>
          <div className="row">
            <button ref={saveButton} type="submit" className="btn on" disabled={saving}>
              {saving ? t("Guardando…", "Saving…") : t("Guardar", "Save")}
            </button>
            <button type="button" className="btn" onClick={cancelEdit}>
              {t("Cancelar", "Cancel")}
            </button>
          </div>
        </form>
      )}
      <Status result={shown} busy={saving || deleting} />

      {!empty && (
        <ul className={s.bizList}>
          {org.businesses.map((b) => (
            <li key={b.id} className={s.biz}>
              <span className={s.bizName}>
                <span className={s.dot} style={{ background: b.color }} aria-hidden="true" />
                <Link href={`/b/${b.id}/inicio`}>{b.name}</Link>
              </span>
              {others.length > 0 && <MoveForm accountId={accountId} business={b} others={others} onMoved={onNotice} />}
            </li>
          ))}
        </ul>
      )}

      <ReportPanel accountId={accountId} org={org} appTz={appTz} />
    </section>
  );
}

/** «Nueva organización»: el nombre y «Crear». Al salir bien el campo vuelve a quedar vacío. */
function NewOrg({ accountId }: { accountId: string }) {
  const { t } = useT();
  const nameId = useId();
  const create = createClientOrgAction.bind(null, accountId);
  const [result, send, sending] = useActionState(async (prev: OrgResult, f: FormData): Promise<OrgResult> => {
    try {
      return await create(prev, f);
    } catch (e) {
      return failed(e, t);
    }
  }, null);
  // Al salir bien, el campo vuelve a empezar (se monta de nuevo con otra key).
  const [fieldKey, setFieldKey] = useState(0);
  const [seen, setSeen] = useState<OrgResult>(null);
  if (result !== seen) {
    setSeen(result);
    if (result?.ok) setFieldKey((k) => k + 1);
  }
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // El botón estuvo desactivado mientras se mandaba: el foco vuelve al nombre (vacío, o con lo que escribió si hubo error).
    if (result && !sending && focusLost()) input.current?.focus();
  }, [result, sending]);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    startTransition(() => send(f));
  };

  return (
    <section className="card" aria-labelledby={`${nameId}-title`}>
      <h2 id={`${nameId}-title`}>{t("Nueva organización", "New organization")}</h2>
      <p className="muted small">{t("Junta los negocios de un mismo cliente.", "Put one client's businesses together.")}</p>
      <form method="post" onSubmit={submit} className={s.newForm}>
        <div key={fieldKey} className="stack">
          <label className="lbl" htmlFor={nameId}>
            {t("Nombre de la organización", "Organization name")}
          </label>
          <input ref={input} id={nameId} name="name" className="field" required maxLength={ORG_NAME_MAX} autoComplete="off" placeholder={t("Ej.: Juan Pérez", "e.g. Juan Pérez")} />
        </div>
        <button type="submit" className={`primary ${s.submit}`} disabled={sending}>
          {sending ? t("Creando…", "Creating…") : t("Crear", "Create")}
        </button>
      </form>
      <Status result={result} busy={sending} />
    </section>
  );
}

type Props = {
  accountId: string;
  accountName: string;
  orgs: Org[];
  /** La zona de la app: la hora de los reportes de una organización sin zona propia se cuenta en ella. */
  appTz: string;
  /** Arriba del título: las pestañas de las cuentas que administra la persona, si son varias. */
  children?: ReactNode;
};

export function ClientOrgs({ accountId, accountName, orgs, appTz, children }: Props) {
  const { t } = useT();
  // Aviso de lo que ya no está donde estaba (un negocio que cambió de tarjeta, una organización borrada). Como su fila
  // desaparece, el foco pasa al título para no perder el lugar.
  const [notice, setNotice] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  const onNotice = (text: string) => {
    setNotice(text);
    title.current?.focus();
  };

  return (
    <>
      <header className="page-head">
        <div>
          {children}
          <h1 ref={title} tabIndex={-1} className={s.focusTarget}>
            {t("Organizaciones", "Organizations")}
          </h1>
          <p className="page-sub">{t(`Los clientes de «${accountName}» y sus negocios`, `The clients of "${accountName}" and their businesses`)}</p>
        </div>
      </header>
      <div className={s.wrap}>
        <div role="status" className={s.notice}>
          {notice && <p className="note ok">{notice}</p>}
        </div>
        <div className={s.board}>
          <div className={s.list}>
            {orgs.length === 0 && (
              <div className="card">
                <p>{t("Todavía no hay organizaciones. Crea la primera para juntar los negocios de un cliente.", "There are no organizations yet. Create the first one to put a client's businesses together.")}</p>
              </div>
            )}
            {orgs.map((o) => (
              <OrgCard key={o.id} accountId={accountId} org={o} others={orgs.filter((x) => x.id !== o.id).map(({ id, name }) => ({ id, name }))} appTz={appTz} onNotice={onNotice} />
            ))}
          </div>
          <NewOrg accountId={accountId} />
        </div>
      </div>
    </>
  );
}
