"use client";

// «Invitar a alguien»: correo, papel y empresas. Al invitar llega un correo con el enlace; aquí también queda el enlace
// para copiarlo o mandarlo por WhatsApp, y el formulario vuelve a quedar vacío para invitar a otra persona.
import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { inviteMemberAction, type TeamResult } from "@/app/actions-team";
import { useT } from "@/components/I18n";
import { AccessFields } from "./AccessFields";
import { ShareLink } from "./ShareLink";
import { failed, focusLost, missingBusiness, type LinkLife, type TeamBusiness } from "./types";
import s from "./Team.module.css";

type Props = { orgId: string; orgName: string; businesses: TeamBusiness[]; life: LinkLife };

export function InviteForm({ orgId, orgName, businesses, life }: Props) {
  const { t } = useT();
  const invite = inviteMemberAction.bind(null, orgId);
  const [result, send, sending] = useActionState(async (prev: TeamResult, f: FormData): Promise<TeamResult> => {
    try {
      return await invite(prev, f);
    } catch (e) {
      return failed(e, t);
    }
  }, null);
  // Al salir bien, los campos vuelven a empezar (se montan de nuevo con otra key).
  const [fieldsKey, setFieldsKey] = useState(0);
  const [seen, setSeen] = useState<TeamResult>(null);
  if (result !== seen) {
    setSeen(result);
    if (result?.ok) setFieldsKey((k) => k + 1);
  }
  const [localError, setLocalError] = useState("");
  // El botón estuvo desactivado mientras se mandaba: el foco vuelve al correo (vacío para invitar a otra persona, o
  // con lo que escribió si hubo un error, que se anuncia).
  const email = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (result && !sending && focusLost()) email.current?.focus();
  }, [result, sending]);

  // Se manda a mano (no con action={…}) para que un error no borre lo que la persona escribió.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (missingBusiness(f)) {
      setLocalError(t("Elige al menos una empresa, o marca «Todas las empresas».", 'Choose at least one business, or pick "All businesses".'));
      return;
    }
    setLocalError("");
    startTransition(() => send(f));
  };
  const error = localError || (result && !result.ok && !sending ? result.message : "");

  return (
    <section className={`card ${s.inviteCard}`} aria-labelledby="team-invite-title">
      <h2 id="team-invite-title">{t("Invitar a alguien", "Invite someone")}</h2>
      <p className={`muted ${s.lead}`}>{t(`Le llega un correo con un enlace para entrar a «${orgName}».`, `They get an email with a link to get into "${orgName}".`)}</p>
      <form method="post" onSubmit={submit} className={s.form}>
        <div key={fieldsKey} className={s.form}>
          <div className="stack">
            <label className="lbl" htmlFor="team-invite-email">{t("Correo", "Email")}</label>
            <input
              ref={email}
              id="team-invite-email"
              name="email"
              type="email"
              className="field"
              required
              maxLength={254}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t("nombre@correo.com", "name@email.com")}
            />
          </div>
          <AccessFields businesses={businesses} />
        </div>
        {error && (
          <p className="note error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className={`primary ${s.submit}`} disabled={sending}>
          {sending ? t("Mandando la invitación…", "Sending the invitation…") : t("Mandar invitación", "Send invitation")}
        </button>
      </form>
      <div aria-live="polite" className={s.result}>
        {result?.ok && !sending && (
          <>
            <p className="note ok">{result.message}</p>
            {result.link && (
              <ShareLink
                link={result.link}
                copyLabel={t("Copiar enlace", "Copy link")}
                message={t(
                  `Hola. Te invité a Matya para trabajar en «${orgName}». Entra con este enlace (vence en ${life.inviteDays} días y sirve una sola vez):`,
                  `Hi. I invited you to Matya to work on "${orgName}". Get in with this link (it expires in ${life.inviteDays} days and works only once):`,
                )}
              />
            )}
          </>
        )}
      </div>
      <p className="small muted">{t("Puedes cambiar su papel o quitarle el acceso cuando quieras.", "You can change their role or remove their access whenever you want.")}</p>
    </section>
  );
}
