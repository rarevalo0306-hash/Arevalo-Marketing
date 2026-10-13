"use client";

// Avisos legales cortos, en el idioma de la app: al entrar, aceptar una invitación o conectar una cuenta.
import { useT } from "@/components/I18n";
import { GOOGLE_PRIVACY_URL, legalUrl, YOUTUBE_TERMS_URL } from "@/lib/legal";

type LineProps = { className?: string; style?: React.CSSProperties };

/** «Al continuar, aceptas las Condiciones de uso y la Política de privacidad.» */
export function ConsentLine({ className = "small muted", style }: LineProps) {
  const { lang, t } = useT();
  return (
    <p className={className} style={style}>
      {t("Al continuar, aceptas las ", "By continuing, you agree to the ")}
      <a href={legalUrl("condiciones", lang)}>{t("Condiciones de uso", "Terms of Use")}</a>
      {t(" y la ", " and ")}
      <a href={legalUrl("privacidad", lang)}>{t("Política de privacidad", "Privacy Policy")}</a>.
    </p>
  );
}

/** Al conectar YouTube: sus condiciones y la política de privacidad de Google (lo piden las reglas de la API de YouTube). */
export function YoutubeTermsLine({ className = "small muted", style }: LineProps) {
  const { t } = useT();
  return (
    <p className={className} style={style}>
      {t("YouTube: al conectar aceptas las ", "YouTube: by connecting, you agree to the ")}
      <a href={YOUTUBE_TERMS_URL}>{t("Condiciones del servicio de YouTube", "YouTube Terms of Service")}</a>
      {t(" y la ", " and the ")}
      <a href={GOOGLE_PRIVACY_URL}>{t("Política de privacidad de Google", "Google Privacy Policy")}</a>.
    </p>
  );
}

/** Pie de las tarjetas para entrar: Privacidad · Condiciones · Borrado de datos. */
export function LegalLinks() {
  const { lang, t } = useT();
  return (
    <p className="note">
      <a href={legalUrl("privacidad", lang)}>{t("Privacidad", "Privacy")}</a>
      {" · "}
      <a href={legalUrl("condiciones", lang)}>{t("Condiciones", "Terms")}</a>
      {" · "}
      <a href={legalUrl("borrado-de-datos", lang)}>{t("Borrado de datos", "Data deletion")}</a>
    </p>
  );
}
