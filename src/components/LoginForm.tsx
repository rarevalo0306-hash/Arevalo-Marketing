"use client";

import { useState } from "react";
import { useT } from "@/components/I18n";

/** Envía la contraseña a /api/auth/login (una ruta normal, no una acción de servidor). El error llega ya traducido. */
export function LoginForm({ error }: { error: string }) {
  const [pending, setPending] = useState(false);
  const { t } = useT();
  return (
    <form method="post" action="/api/auth/login" onSubmit={() => setPending(true)} className="stack" style={{ gap: 14 }}>
      <div className="stack">
        <label className="lbl" htmlFor="password">{t("Contraseña", "Password")}</label>
        <input id="password" name="password" type="password" className="field" autoComplete="current-password" required autoFocus />
      </div>
      {error && <p className="note error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={pending}>{pending ? t("Entrando…", "Logging in…") : t("Entrar", "Log in")}</button>
    </form>
  );
}
