"use client";
// Fuera de un negocio (entrar, invitación, contraseña, equipo): si algo falla al cargar, un aviso en los dos idiomas.
import { useT } from "@/components/I18n";
export default function ErrorView({ reset }: { error: Error; reset: () => void }) {
  const { t } = useT();
  return (
    <main className="center-page">
      <section className="card stack" role="alert">
        <h1>{t("No se pudo cargar ahora", "Couldn't load right now")}</h1>
        <p>{t("Prueba de nuevo en un momento. Tus datos guardados siguen disponibles.", "Try again in a moment. Your saved data is still available.")}</p>
        <button className="btn on" type="button" onClick={reset}>{t("Reintentar", "Try again")}</button>
      </section>
    </main>
  );
}
