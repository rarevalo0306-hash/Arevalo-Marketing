"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";
import { useT } from "@/components/I18n";

export function LoginForm() {
  const [error, action, pending] = useActionState(login, null);
  const { t } = useT();
  return (
    <form action={action} className="stack" style={{ gap: 14 }}>
      <div className="stack">
        <label className="lbl" htmlFor="password">{t("Contraseña", "Password")}</label>
        <input id="password" name="password" type="password" className="field" autoComplete="current-password" required autoFocus />
      </div>
      {error && <p className="note error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={pending}>{pending ? t("Entrando…", "Logging in…") : t("Entrar", "Log in")}</button>
    </form>
  );
}
