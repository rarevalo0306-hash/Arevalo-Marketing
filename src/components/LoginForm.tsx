"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/I18n";

/** Envía el correo y la contraseña a /api/auth/login (una ruta normal, no una acción de servidor). El error llega ya traducido.
 *  `next`: a dónde volver después de entrar (solo una invitación; la ruta lo revisa con safeNext). */
export function LoginForm({ error, next }: { error: string; next?: string }) {
  const [pending, setPending] = useState(false);
  const { t } = useT();
  return (
    <form method="post" action="/api/auth/login" onSubmit={() => setPending(true)} className="stack" style={{ gap: 14 }}>
      {next && <input type="hidden" name="next" value={next} />}
      <div className="stack">
        <label className="lbl" htmlFor="email">{t("Correo", "Email")}</label>
        <input id="email" name="email" type="email" className="field" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required autoFocus />
      </div>
      <div className="stack">
        <div className="row between">
          <label className="lbl" htmlFor="password">{t("Contraseña", "Password")}</label>
          <Link className="small" href="/olvide" style={{ padding: "4px 0" }}>{t("¿Olvidaste tu contraseña?", "Forgot your password?")}</Link>
        </div>
        <input id="password" name="password" type="password" className="field" autoComplete="current-password" required />
      </div>
      {error && <p className="note error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={pending}>{pending ? t("Entrando…", "Logging in…") : t("Entrar", "Log in")}</button>
    </form>
  );
}
