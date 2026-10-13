import type { Metadata } from "next";
import Link from "next/link";
import { signOutForInvitation } from "@/app/actions-team";
import { AuthCard, GoogleButton, wideButton, wrapAnywhere } from "@/components/AuthCard";
import { NewPasswordForm } from "@/components/NewPasswordForm";
import { normalizeEmail } from "@/lib/accounts";
import { getSessionUser } from "@/lib/auth";
import { appBase, googleLoginEnabled } from "@/lib/google-login";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/password";
import { roleLabel } from "@/lib/roles";
import { readInvitation, type InvitationView } from "@/lib/team";
import { AcceptInvitation } from "./AcceptInvitation";

// Pública (sin sesión): el enlace de la invitación que manda el Administrador. Según quién la abre: crear la cuenta con
// una contraseña (o con Google), entrar con la cuenta que ya tiene, o aceptarla si ya entró con ese correo.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  // El enlace lleva el token: que no se indexe ni viaje a otras páginas.
  return { title: t("Invitación · Matya", "Invitation · Matya"), robots: { index: false, follow: false }, referrer: "same-origin" };
}

/** A qué organización, con qué papel y a qué empresas lo invitaron. */
function Summary({ view, t }: { view: InvitationView; t: T }) {
  const names = view.businessNames;
  const scope =
    names === null
      ? t("Todas las empresas", "All businesses")
      : names.length === 0
        ? t("Sin empresas por ahora", "No businesses yet")
        : names.length === 1
          ? t("1 empresa", "1 business")
          : t(`${names.length} empresas`, `${names.length} businesses`);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <h2 style={wrapAnywhere}>{t(`Te invitaron a «${view.organizationName}»`, `You're invited to "${view.organizationName}"`)}</h2>
      {view.inviterName && <p className="small muted" style={wrapAnywhere}>{t(`De parte de ${view.inviterName}.`, `From ${view.inviterName}.`)}</p>}
      <div className="row" style={{ gap: 8 }}>
        <span className="pill info plain">
          <span className="sr-only">{t("Tu papel: ", "Your role: ")}</span>
          {roleLabel(view.role, t)}
        </span>
        <span className="pill neutral plain">
          <span className="sr-only">{t("Empresas: ", "Businesses: ")}</span>
          {scope}
        </span>
      </div>
      {names && names.length > 0 && <p className="small muted" style={wrapAnywhere}>{names.join(" · ")}</p>}
    </div>
  );
}

export default async function InvitationPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ e?: string }> }) {
  const { token } = await params;
  const { e } = await searchParams;
  const { t } = await getT();
  const [view, me] = await Promise.all([readInvitation(token), getSessionUser()]);

  // (a) Venció, ya se usó o la cancelaron.
  if (!view) {
    return (
      <AuthCard>
        <div className="stack" style={{ gap: 10 }}>
          <h2>{t("Este enlace ya no sirve", "This link no longer works")}</h2>
          <p className="muted">{t("Venció, ya se usó o lo cancelaron. Pídele al Administrador una invitación nueva.", "It expired, was already used or was canceled. Ask the Administrator for a new invitation.")}</p>
        </div>
        {me ? (
          <Link className="btn on" href="/" style={wideButton}>{t("Ir a Matya", "Go to Matya")}</Link>
        ) : (
          <Link className="btn on" href="/login" style={wideButton}>{t("Entrar", "Sign in")}</Link>
        )}
      </AuthCard>
    );
  }

  // (b) Ya entró con el correo invitado: solo falta aceptar.
  if (me && normalizeEmail(me.email) === view.email) {
    return (
      <AuthCard>
        <Summary view={view} t={t} />
        <div className="stack" style={{ gap: 10 }}>
          <p className="small muted" style={wrapAnywhere}>{t(`Entraste como ${me.email}.`, `You're signed in as ${me.email}.`)}</p>
          <AcceptInvitation token={token} />
        </div>
      </AuthCard>
    );
  }

  // (c) Entró con otra cuenta: que salga y vuelva con la correcta.
  if (me) {
    return (
      <AuthCard>
        <Summary view={view} t={t} />
        <p className="note" style={wrapAnywhere}>
          {t(`Esta invitación es para ${view.email} y entraste como ${me.email}.`, `This invitation is for ${view.email} and you're signed in as ${me.email}.`)}{" "}
          {t("Sal de esta cuenta y entra con la correcta: volverás a esta invitación.", "Sign out of this account and sign in with the right one: you'll come back to this invitation.")}
        </p>
        <form action={signOutForInvitation.bind(null, token)} className="stack">
          <button className="primary" type="submit">{t("Salir de esta cuenta", "Sign out of this account")}</button>
        </form>
      </AuthCard>
    );
  }

  const withGoogle = googleLoginEnabled();
  // Siempre en la dirección principal: ahí vuelve Google y ahí queda la cookie del intento (con la invitación).
  const googleHref = `${appBase()}/api/auth/google/start?invitacion=${encodeURIComponent(token)}`;

  // (d) Ya tiene cuenta con ese correo: entra con ella (nunca se le pone contraseña desde el enlace).
  if (view.existingUser || e === "existing") {
    return (
      <AuthCard>
        <Summary view={view} t={t} />
        <p className="note info" style={wrapAnywhere}>{t(`Ya tienes una cuenta con ${view.email}: entra con ella para aceptar.`, `You already have an account with ${view.email}: sign in with it to accept.`)}</p>
        {withGoogle && (
          <>
            <GoogleButton href={googleHref} label={t("Entrar con Google", "Sign in with Google")} />
            <p className="login-or">{t("o con tu correo y contraseña", "or with your email and password")}</p>
          </>
        )}
        <Link className="btn on" href={`/login?next=${encodeURIComponent(`/invitacion/${token}`)}`} style={wideButton}>
          {t("Entrar con mi correo", "Sign in with my email")}
        </Link>
      </AuthCard>
    );
  }

  // (e) Cuenta nueva: con Google o eligiendo una contraseña.
  return (
    <AuthCard>
      <Summary view={view} t={t} />
      {withGoogle && (
        <>
          <div className="stack" style={{ gap: 8 }}>
            <GoogleButton href={googleHref} label={t("Entrar con Google", "Sign in with Google")} />
            <p className="small muted" style={{ ...wrapAnywhere, textAlign: "center" }}>{t(`Con la cuenta de Google de ${view.email}.`, `With the Google account for ${view.email}.`)}</p>
          </div>
          <p className="login-or">{t("o crea tu contraseña", "or create your password")}</p>
        </>
      )}
      <NewPasswordForm kind="invitacion" token={token} email={view.email} error={e} min={PASSWORD_MIN} max={PASSWORD_MAX} />
      <p className="note info">
        {withGoogle
          ? t("La próxima vez entras con tu correo y esta contraseña, o con Google.", "Next time, sign in with your email and this password, or with Google.")
          : t("La próxima vez entras con tu correo y esta contraseña.", "Next time, sign in with your email and this password.")}
      </p>
    </AuthCard>
  );
}
