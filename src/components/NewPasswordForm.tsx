"use client";

import { useState } from "react";
import { useT } from "@/components/I18n";

/**
 * Elegir una contraseña con un enlace de un solo uso: aceptar una invitación (/api/auth/invitacion) o guardar una
 * contraseña nueva (/api/auth/clave). Es un formulario normal (no una acción de servidor): la ruta revisa todo de nuevo y
 * vuelve a la página con ?e=… si algo falla. El correo solo se muestra (y ayuda al gestor de contraseñas): no se envía,
 * la ruta usa el del enlace.
 */
export function NewPasswordForm({ kind, token, email, error, min, max }: { kind: "invitacion" | "clave"; token: string; email: string; error?: string; min: number; max: number }) {
  const { t } = useT();
  const [pending, setPending] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const code = mismatch ? "mismatch" : error;
  const message =
    code === "short"
      ? t(`La contraseña necesita al menos ${min} letras o números.`, `The password needs at least ${min} letters or numbers.`)
      : code === "long"
        ? t(`La contraseña es muy larga: usa ${max} letras o números como máximo.`, `The password is too long: use ${max} letters or numbers at most.`)
        : code === "mismatch"
          ? t("Las dos contraseñas no son iguales.", "The two passwords don't match.")
          : code === "expired"
            ? t("Este enlace ya no sirve: venció o ya se usó.", "This link no longer works: it expired or was already used.")
            : code === "check"
              ? t("No se pudo ahora. Prueba de nuevo en un momento.", "Couldn't do it right now. Try again in a moment.")
              : "";
  const describedBy = message ? "np-help np-error" : "np-help";
  return (
    <form
      method="post"
      action={`/api/auth/${kind}`}
      className="stack"
      style={{ gap: 14 }}
      onSubmit={(e) => {
        // Aviso inmediato si no coinciden (la ruta lo revisa igual).
        const f = new FormData(e.currentTarget);
        if (f.get("password") !== f.get("password2")) {
          e.preventDefault();
          setMismatch(true);
          return;
        }
        setPending(true);
      }}
    >
      <input type="hidden" name="token" value={token} />
      <div className="stack">
        <label className="lbl" htmlFor="np-email">{t("Correo", "Email")}</label>
        <input id="np-email" type="email" className="field" value={email} readOnly autoComplete="username" style={{ background: "var(--surface-2)", color: "var(--muted)" }} />
      </div>
      <div className="stack">
        <label className="lbl" htmlFor="np-password">{kind === "clave" ? t("Contraseña nueva", "New password") : t("Contraseña", "Password")}</label>
        <input
          id="np-password"
          name="password"
          type="password"
          className="field"
          autoComplete="new-password"
          minLength={min}
          maxLength={max}
          required
          // Con un error de la ruta, el foco va aquí y el lector de pantalla lee el aviso (aria-describedby).
          autoFocus={kind === "clave" || Boolean(message)}
          aria-describedby={describedBy}
          aria-invalid={code === "short" || code === "long" || undefined}
          onChange={() => setMismatch(false)}
        />
        <span id="np-help" className="small muted">{t(`Mínimo ${min} letras o números.`, `At least ${min} letters or numbers.`)}</span>
      </div>
      <div className="stack">
        <label className="lbl" htmlFor="np-password2">{t("Repite la contraseña", "Repeat the password")}</label>
        <input
          id="np-password2"
          name="password2"
          type="password"
          className="field"
          autoComplete="new-password"
          minLength={min}
          maxLength={max}
          required
          aria-describedby={message ? "np-error" : undefined}
          aria-invalid={code === "mismatch" || undefined}
          onChange={() => setMismatch(false)}
        />
      </div>
      {message && (
        <p id="np-error" className="note error" role="alert">
          {message}
        </p>
      )}
      <button className="primary" type="submit" disabled={pending}>
        {kind === "clave"
          ? pending
            ? t("Guardando…", "Saving…")
            : t("Guardar y entrar", "Save and sign in")
          : pending
            ? t("Aceptando…", "Accepting…")
            : t("Aceptar y entrar", "Accept and sign in")}
      </button>
    </form>
  );
}
