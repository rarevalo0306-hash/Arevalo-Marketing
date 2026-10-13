import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, wideButton } from "@/components/AuthCard";
import { getT } from "@/lib/i18n-server";

// Pública (sin sesión): «¿Olvidaste tu contraseña?». Manda el correo a /api/auth/olvide, que siempre vuelve con la misma
// respuesta (?enviado=1) para no decir si el correo tiene cuenta.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("Contraseña olvidada · Matya", "Forgot password · Matya") };
}

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ enviado?: string; e?: string }> }) {
  const { enviado, e } = await searchParams;
  const { t } = await getT();
  const error =
    e === "locked"
      ? t("Demasiados pedidos seguidos. Espera 15 minutos y vuelve a probar.", "Too many requests in a row. Wait 15 minutes and try again.")
      : e === "check"
        ? t("No se pudo ahora. Prueba de nuevo en un momento.", "Couldn't do it right now. Try again in a moment.")
        : "";
  const back = (
    <p style={{ textAlign: "center" }}>
      <Link href="/login">{t("Volver a entrar", "Back to sign in")}</Link>
    </p>
  );

  if (enviado === "1") {
    return (
      <AuthCard>
        <h2>{t("Revisa tu correo", "Check your email")}</h2>
        <p className="note ok" role="status">
          {t(
            "Si ese correo tiene cuenta, te llega un enlace en unos minutos. Vence en 1 hora. Revisa también el correo no deseado.",
            "If that email has an account, a link will arrive in a few minutes. It expires in 1 hour. Check your spam folder too.",
          )}
        </p>
        <Link className="btn outline" href="/olvide" style={wideButton}>{t("Pedir otro enlace", "Ask for another link")}</Link>
        {back}
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <div className="stack" style={{ gap: 6 }}>
        <h2>{t("¿Olvidaste tu contraseña?", "Forgot your password?")}</h2>
        <p className="muted">{t("Escribe tu correo y te mandamos un enlace para elegir una contraseña nueva.", "Enter your email and we'll send you a link to choose a new password.")}</p>
      </div>
      <form method="post" action="/api/auth/olvide" className="stack" style={{ gap: 14 }}>
        <div className="stack">
          <label className="lbl" htmlFor="email">{t("Correo", "Email")}</label>
          <input id="email" name="email" type="email" className="field" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required autoFocus />
        </div>
        {error && (
          <p className="note error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit">{t("Mandarme un enlace", "Send me a link")}</button>
      </form>
      {back}
    </AuthCard>
  );
}
