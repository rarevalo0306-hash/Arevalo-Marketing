import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, wideButton } from "@/components/AuthCard";
import { NewPasswordForm } from "@/components/NewPasswordForm";
import { getT } from "@/lib/i18n-server";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/password";
import { readReset } from "@/lib/team";

// Pública (sin sesión): el enlace para elegir una contraseña nueva («¿Olvidaste tu contraseña?» o el que mandó el
// Administrador). Sirve una vez y vence en 1 hora. Se guarda en /api/auth/clave, que cierra las demás sesiones.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  // El enlace lleva el token: que no se indexe ni viaje a otras páginas.
  return { title: t("Contraseña nueva · Matya", "New password · Matya"), robots: { index: false, follow: false }, referrer: "same-origin" };
}

export default async function NewPasswordPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ e?: string }> }) {
  const { token } = await params;
  const { e } = await searchParams;
  const { t } = await getT();
  const reset = await readReset(token);

  if (!reset) {
    return (
      <AuthCard>
        <div className="stack" style={{ gap: 10 }}>
          <h2>{t("Este enlace ya no sirve", "This link no longer works")}</h2>
          <p className="muted">{t("Venció o ya se usó. Pide uno nuevo y te llega en unos minutos.", "It expired or was already used. Ask for a new one and it will arrive in a few minutes.")}</p>
        </div>
        <Link className="btn on" href="/olvide" style={wideButton}>{t("Pedir otro enlace", "Ask for another link")}</Link>
        <p style={{ textAlign: "center" }}>
          <Link href="/login">{t("Volver a entrar", "Back to sign in")}</Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <h2>{t("Elige tu contraseña nueva", "Choose your new password")}</h2>
      <NewPasswordForm kind="clave" token={token} email={reset.email} error={e} min={PASSWORD_MIN} max={PASSWORD_MAX} />
      <p className="note info">{t("Al cambiarla, se cierra tu sesión en los otros aparatos.", "Changing it signs you out on your other devices.")}</p>
    </AuthCard>
  );
}
