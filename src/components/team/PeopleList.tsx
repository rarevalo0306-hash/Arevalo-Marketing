"use client";

// La lista del equipo: cada persona (y cada invitación pendiente) con su papel, sus empresas y su último acceso. En una
// pantalla ancha es una tabla; si no cabe (celular), cada persona es una tarjeta. Debajo de cada una van sus acciones.
import { startTransition, useActionState, useEffect, useId, useRef, useState, useTransition, type FormEvent, type MouseEvent } from "react";
import { cancelInviteAction, changeMemberAction, removeMemberAction, resendInviteAction, resetLinkAction, type TeamResult } from "@/app/actions-team";
import { failed, focusLost } from "@/components/action-result";
import { useT } from "@/components/I18n";
import { roleLabel } from "@/lib/roles";
import { AccessFields } from "./AccessFields";
import { ShareLink } from "./ShareLink";
import { missingBusiness, ROLE_TONE, scopeText, type LinkLife, type TeamBusiness, type TeamInvite, type TeamMember } from "./types";
import s from "./Team.module.css";

type Common = { orgId: string; orgName: string; businesses: TeamBusiness[]; life: LinkLife; onNotice: (text: string) => void };

/** El resultado de una acción: el aviso y, si trae un enlace, el enlace para copiar o mandar. */
function Outcome({ result, message, copyLabel }: { result: TeamResult; message: string; copyLabel?: string }) {
  if (!result) return null;
  if (!result.ok)
    return (
      <p className="note error" role="alert">
        {result.message}
      </p>
    );
  return (
    <div className={s.done}>
      <p className="note ok">{result.message}</p>
      {result.link && <ShareLink link={result.link} message={message} copyLabel={copyLabel} />}
    </div>
  );
}

/** Mientras espera, los botones se desactivan y el foco se pierde: al terminar vuelve al botón que se guardó en `back`. */
function useFocusBack(busy: boolean) {
  const back = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (busy || !back.current) return;
    if (focusLost()) back.current.focus();
    back.current = null;
  }, [busy]);
  return back;
}

function MemberRow({ member: m, isMe, orgId, businesses, life, onNotice }: Common & { member: TeamMember; isMe: boolean }) {
  const { t } = useT();
  const panelId = useId();
  const who = m.name || m.email;
  const [mode, setMode] = useState<"idle" | "edit" | "confirm">("idle");
  const [shown, setShown] = useState<TeamResult>(null);
  const [busy, start] = useTransition();
  const back = useFocusBack(busy);
  const changeButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const resetButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);

  // «Cambiar»: papel y empresas. Si sale bien, se cierra el editor y queda «Guardado.».
  const change = changeMemberAction.bind(null, orgId, m.membershipId);
  const [changed, save, saving] = useActionState(async (prev: TeamResult, f: FormData): Promise<TeamResult> => {
    try {
      return await change(prev, f);
    } catch (e) {
      return failed(e, t);
    }
  }, null);
  const [seen, setSeen] = useState<TeamResult>(null);
  if (changed !== seen) {
    setSeen(changed);
    setShown(changed);
    if (changed?.ok) setMode("idle");
  }
  // Al guardar, el editor se cierra: el foco vuelve a «Cambiar» (y «Guardado.» se anuncia abajo). Si hubo un error,
  // vuelve a «Guardar», que estuvo desactivado mientras se mandaba.
  useEffect(() => {
    if (saving || !changed) return;
    if (changed.ok) changeButton.current?.focus();
    else if (focusLost()) saveButton.current?.focus();
  }, [changed, saving]);
  const [localError, setLocalError] = useState("");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (missingBusiness(f)) {
      setLocalError(t("Elige al menos una empresa, o marca «Todas las empresas».", 'Choose at least one business, or pick "All businesses".'));
      return;
    }
    setLocalError("");
    setShown(null);
    startTransition(() => save(f));
  };

  const open = (next: "edit" | "confirm") => {
    setShown(null);
    setLocalError("");
    setMode((now) => (now === next ? "idle" : next));
  };
  const close = (to: HTMLButtonElement | null) => {
    setShown(null);
    setLocalError("");
    setMode("idle");
    to?.focus();
  };

  const remove = () =>
    start(async () => {
      try {
        const r = await removeMemberAction(orgId, m.membershipId);
        setMode("idle");
        // Si sale bien, la fila desaparece: el aviso (y el foco) van arriba de la lista.
        if (r?.ok) return onNotice(t(`${who} ya no tiene acceso.`, `${who} no longer has access.`));
        setShown(r);
      } catch (e) {
        setMode("idle");
        setShown(failed(e, t));
      }
      back.current = removeButton.current;
    });

  const resetLink = () => {
    setMode("idle");
    setShown(null);
    back.current = resetButton.current;
    start(async () => {
      try {
        setShown(await resetLinkAction(orgId, m.membershipId));
      } catch (e) {
        setShown(failed(e, t));
      }
    });
  };
  // Para el texto de WhatsApp: «1 hora» se lee mejor que «60 minutos».
  const hours = life.resetMinutes / 60;
  const resetLife = Number.isInteger(hours)
    ? t(`${hours} ${hours === 1 ? "hora" : "horas"}`, `${hours} ${hours === 1 ? "hour" : "hours"}`)
    : t(`${life.resetMinutes} minutos`, `${life.resetMinutes} minutes`);

  return (
    <tbody>
      <tr>
        <td className={s.person}>
          <span className={s.name}>
            {who}
            {isMe && <span className={s.me}> {t("(tú)", "(you)")}</span>}
          </span>
          {m.name && <span className={`small muted ${s.email}`}>{m.email}</span>}
          {m.owner && <span className={s.badge}>{t("Dueño de Matya", "Matya owner")}</span>}
        </td>
        <td data-label={t("Papel", "Role")}>
          <span className={`pill plain ${ROLE_TONE[m.role]}`}>{roleLabel(m.role, t)}</span>
        </td>
        <td data-label={t("Empresas", "Businesses")}>{scopeText(m.allBusinesses, m.businessIds, businesses, t)}</td>
        <td data-label={t("Último acceso", "Last sign-in")}>{m.lastLogin ?? <span className="muted">{t("Aún no entra", "Hasn't signed in yet")}</span>}</td>
      </tr>
      <tr className={s.acts}>
        <td colSpan={4}>
          <div className={s.actButtons}>
            {!m.fixedAdmin && (
              <button ref={changeButton} type="button" className={`btn ${s.act} ${mode === "edit" ? "on" : ""}`} aria-expanded={mode === "edit"} aria-controls={panelId} onClick={() => open("edit")}>
                {t("Cambiar", "Change")}
                <span className="sr-only">{t(` el papel de ${who}`, ` ${who}'s role`)}</span>
              </button>
            )}
            {!m.fixedAdmin && (
              <button ref={removeButton} type="button" className={`btn danger ${s.act}`} aria-expanded={mode === "confirm"} aria-controls={panelId} onClick={() => open("confirm")} disabled={busy}>
                {t("Quitar acceso", "Remove access")}
                <span className="sr-only">{t(` a ${who}`, ` for ${who}`)}</span>
              </button>
            )}
            {!m.owner && (
              <button ref={resetButton} type="button" className={`btn link ${s.act}`} onClick={resetLink} disabled={busy}>
                {t("Enlace para contraseña nueva", "New password link")}
                <span className="sr-only">{t(` de ${who}`, ` for ${who}`)}</span>
              </button>
            )}
          </div>

          <div id={panelId}>
            {mode === "edit" && (
              <form method="post" onSubmit={submit} className={`${s.panel} ${s.form}`} aria-label={t(`Cambiar el papel de ${who}`, `Change ${who}'s role`)}>
                <AccessFields businesses={businesses} role={m.role} allBusinesses={m.allBusinesses} businessIds={m.businessIds} wide />
                {localError && (
                  <p className="note error" role="alert">
                    {localError}
                  </p>
                )}
                <div className="row">
                  <button ref={saveButton} type="submit" className="btn on" disabled={saving}>
                    {saving ? t("Guardando…", "Saving…") : t("Guardar", "Save")}
                  </button>
                  <button type="button" className="btn" onClick={() => close(changeButton.current)}>
                    {t("Cancelar", "Cancel")}
                  </button>
                </div>
              </form>
            )}
            {mode === "confirm" && (
              <div className={`${s.panel} ${s.confirm}`} role="group" aria-labelledby={`${panelId}-q`}>
                <p id={`${panelId}-q`}>
                  {isMe
                    ? t("¿Quitarte el acceso a ti? Saldrás de Matya ahora mismo y no podrás volver a entrar a esta cuenta.", "Remove your own access? You'll be signed out of Matya right away and won't be able to get back into this account.")
                    : t(`¿Quitarle el acceso a ${who}? Ya no podrá entrar y se cerrará su sesión en todos lados.`, `Remove ${who}'s access? They won't be able to get in, and they'll be signed out everywhere.`)}
                </p>
                <div className="row">
                  <button type="button" className={`btn ${s.confirmYes}`} onClick={remove} disabled={busy}>
                    {busy ? t("Quitando…", "Removing…") : t("Sí, quitar", "Yes, remove")}
                  </button>
                  <button type="button" className="btn" onClick={() => close(removeButton.current)} autoFocus>
                    {t("No, dejarlo", "No, keep it")}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div aria-live="polite" className={s.outcome}>
            {busy && mode !== "confirm" && <p className="small muted">{t("Un momento…", "One moment…")}</p>}
            {!busy && !saving && (
              <Outcome
                result={shown}
                message={t(
                  `Hola. Con este enlace eliges tu contraseña nueva para entrar a Matya (vence en ${resetLife} y sirve una sola vez):`,
                  `Hi. With this link you choose your new password to get into Matya (it expires in ${resetLife} and works only once):`,
                )}
              />
            )}
          </div>
        </td>
      </tr>
    </tbody>
  );
}

function InviteRow({ invite: inv, orgId, orgName, businesses, life, onNotice }: Common & { invite: TeamInvite }) {
  const { t } = useT();
  const [shown, setShown] = useState<TeamResult>(null);
  const [busy, start] = useTransition();
  const back = useFocusBack(busy);

  const resend = (e: MouseEvent<HTMLButtonElement>) => {
    setShown(null);
    back.current = e.currentTarget;
    start(async () => {
      try {
        setShown(await resendInviteAction(orgId, inv.id));
      } catch (err) {
        setShown(failed(err, t));
      }
    });
  };
  const cancel = (e: MouseEvent<HTMLButtonElement>) => {
    setShown(null);
    const button = e.currentTarget;
    start(async () => {
      try {
        const r = await cancelInviteAction(orgId, inv.id);
        // Si sale bien, la fila desaparece: el aviso (y el foco) van arriba de la lista.
        if (r?.ok) return onNotice(t(`Cancelaste la invitación a ${inv.email}: el enlace ya no sirve.`, `You canceled the invitation to ${inv.email}: the link no longer works.`));
        setShown(r);
      } catch (err) {
        setShown(failed(err, t));
      }
      back.current = button;
    });
  };

  return (
    <tbody className={s.pending}>
      <tr>
        <td className={s.person}>
          <span className={s.name}>{inv.email}</span>
          <span className={`pill warn ${s.sent}`}>{t("Invitación enviada", "Invitation sent")}</span>
        </td>
        <td data-label={t("Papel", "Role")}>
          <span className={`pill plain ${ROLE_TONE[inv.role]}`}>{roleLabel(inv.role, t)}</span>
        </td>
        <td data-label={t("Empresas", "Businesses")}>{scopeText(inv.allBusinesses, inv.businessIds, businesses, t)}</td>
        <td className="muted">{t(`Vence el ${inv.expires}`, `Expires ${inv.expires}`)}</td>
      </tr>
      <tr className={s.acts}>
        <td colSpan={4}>
          <div className={s.actButtons}>
            <button type="button" className={`btn ${s.act}`} onClick={resend} disabled={busy}>
              {t("Reenviar", "Resend")}
              <span className="sr-only">{t(` la invitación a ${inv.email}`, ` the invitation to ${inv.email}`)}</span>
            </button>
            <button type="button" className={`btn danger ${s.act}`} onClick={cancel} disabled={busy}>
              {t("Cancelar", "Cancel")}
              <span className="sr-only">{t(` la invitación a ${inv.email}`, ` the invitation to ${inv.email}`)}</span>
            </button>
          </div>
          <div aria-live="polite" className={s.outcome}>
            {busy && <p className="small muted">{t("Un momento…", "One moment…")}</p>}
            {!busy && (
              <Outcome
                result={shown}
                copyLabel={t("Copiar enlace", "Copy link")}
                message={t(
                  `Hola. Te invité a Matya para trabajar en «${orgName}». Entra con este enlace (vence en ${life.inviteDays} días y sirve una sola vez):`,
                  `Hi. I invited you to Matya to work on "${orgName}". Get in with this link (it expires in ${life.inviteDays} days and works only once):`,
                )}
              />
            )}
          </div>
        </td>
      </tr>
    </tbody>
  );
}

type Props = Omit<Common, "onNotice"> & { meId: string; members: TeamMember[]; invitations: TeamInvite[] };

export function PeopleList({ meId, members, invitations, ...common }: Props) {
  const { t } = useT();
  // Aviso de lo que ya no está en la lista (se quitó a alguien o se canceló una invitación). Como su fila desaparece,
  // el foco pasa al título de la lista para no perder el lugar.
  const [notice, setNotice] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  const onNotice = (text: string) => {
    setNotice(text);
    title.current?.focus();
  };
  return (
    <section className={`card ${s.peopleCard}`} aria-labelledby="team-people-title">
      <h2 id="team-people-title" ref={title} tabIndex={-1} className={s.focusTarget}>
        {t("Quién tiene acceso", "Who has access")}
      </h2>
      <div aria-live="polite" className={s.notice}>
        {notice && <p className="note ok">{notice}</p>}
      </div>
      <div className={s.tableBox}>
        <table className={s.table} aria-labelledby="team-people-title">
          <thead>
            <tr>
              <th scope="col">{t("Persona", "Person")}</th>
              <th scope="col">{t("Papel", "Role")}</th>
              <th scope="col">{t("Empresas", "Businesses")}</th>
              <th scope="col">{t("Último acceso", "Last sign-in")}</th>
            </tr>
          </thead>
          {members.map((m) => (
            <MemberRow key={m.membershipId} member={m} isMe={m.userId === meId} onNotice={onNotice} {...common} />
          ))}
          {invitations.map((i) => (
            <InviteRow key={i.id} invite={i} onNotice={onNotice} {...common} />
          ))}
        </table>
      </div>
    </section>
  );
}
