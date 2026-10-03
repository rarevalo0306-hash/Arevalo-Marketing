"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";

export function LoginForm() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="stack" style={{ gap: 14 }}>
      <div className="stack">
        <label className="lbl" htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" className="field" autoComplete="current-password" required autoFocus />
      </div>
      {error && <p className="note error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}
