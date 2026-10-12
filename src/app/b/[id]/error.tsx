"use client";
import { useT } from "@/components/I18n";
export default function ErrorView({ reset }: { error: Error; reset: () => void }) {
  const { t } = useT();
  return <section className="card stack" role="alert">
    <h1>{t("No pudimos cargar esta sección", "We couldn't load this section")}</h1>
    <p>{t("Inténtalo de nuevo. Tus datos guardados siguen disponibles.", "Try again. Your saved data is still available.")}</p>
    <button className="btn on" onClick={reset}>{t("Reintentar", "Try again")}</button>
  </section>;
}
