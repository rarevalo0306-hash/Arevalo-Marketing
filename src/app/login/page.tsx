import { LangPicker } from "@/components/I18n";
import { LoginForm } from "@/components/LoginForm";
import { safeNext } from "@/lib/access";
import { appBase, googleLoginEnabled } from "@/lib/google-login";
import { getT } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ google?: string; e?: string; m?: string; next?: string }> }) {
  const { google, e, m, next } = await searchParams;
  const { t } = await getT();
  const withGoogle = googleLoginEnabled();
  // Viene de una invitación (?next=/invitacion/…): después de entrar vuelve ahí para aceptarla. Con Google se acepta al volver.
  const invitePath = safeNext(typeof next === "string" ? next : "");
  const inviteToken = invitePath === "/" ? "" : invitePath.slice("/invitacion/".length);
  const googleError =
    google === "cancel"
      ? t("Cancelaste la entrada con Google.", "You canceled signing in with Google.")
      : google === "expired"
        ? t("La entrada con Google venció. Vuelve a intentarlo.", "Signing in with Google expired. Please try again.")
        : google === "notallowed"
          ? t("Esa cuenta de Google no tiene permiso para entrar a Matya.", "That Google account isn't allowed into Matya.")
          : google
            ? t("No se pudo entrar con Google. Vuelve a intentarlo o usa tu contraseña.", "Couldn't sign in with Google. Try again or use your password.")
            : "";
  const mins = Math.min(60, Math.max(1, Number(m) || 15));
  const passwordError =
    e === "wrong"
      ? t("Correo o contraseña incorrectos.", "Wrong email or password.")
      : e === "locked"
        ? t(`Demasiados intentos. Espera ${mins} min y vuelve a probar.`, `Too many attempts. Wait ${mins} min and try again.`)
        : e === "check"
          ? t("No se pudo comprobar ahora. Prueba de nuevo en un momento.", "Couldn't check right now. Try again in a moment.")
          : e === "setup"
            ? t("Falta APP_PASSWORD, APP_SECRET o LOGIN_EMAILS en el servidor.", "APP_PASSWORD, APP_SECRET or LOGIN_EMAILS is missing on the server.")
            : "";
  return (
    <main className="center-page">
      <div className="card">
        <h1 className="login-name">Matya</h1>
        {inviteToken && <p className="note info">{t("Entra con tu cuenta para aceptar la invitación.", "Sign in with your account to accept the invitation.")}</p>}
        {withGoogle && (
          <>
            {/* Siempre en la dirección principal: ahí vuelve Google y ahí queda la cookie del intento. */}
            <a className="btn google-login" href={`${appBase()}/api/auth/google/start${inviteToken ? `?invitacion=${inviteToken}` : ""}`}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-4 7-9.9 7-17.1z" />
                <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
                <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
              </svg>
              {t("Entrar con Google", "Sign in with Google")}
            </a>
            {googleError && (
              <p className="note error" role="alert">
                {googleError}
              </p>
            )}
            <p className="login-or">{t("o con tu correo y contraseña", "or with your email and password")}</p>
          </>
        )}
        <LoginForm error={passwordError} next={inviteToken ? invitePath : undefined} />
        <LangPicker />
        <p className="note"><a href="https://matya.app/privacidad/">Privacidad / Privacy</a>{" · "}<a href="https://matya.app/condiciones/">Condiciones / Terms</a>{" · "}<a href="https://matya.app/borrado-de-datos/">Borrado de datos / Data deletion</a></p>
      </div>
    </main>
  );
}
