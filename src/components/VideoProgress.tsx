"use client";

// Avance honesto mientras la IA hace el video: barra según el tiempo típico del modelo y cuánto falta.
import { useEffect, useState } from "react";
import { useT } from "@/components/I18n";
import s from "./VideoProgress.module.css";

export function VideoProgress({ startedAt, etaSec }: { startedAt: number; etaSec: number }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const eta = Math.max(15, etaSec);
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  // Hasta el tiempo típico avanza parejo; después se acerca al final sin llegar (nunca dice "listo" antes de tiempo).
  const pct = elapsed <= eta ? (elapsed / eta) * 85 : 85 + 13 * (1 - Math.exp(-(elapsed - eta) / eta));
  const left = Math.ceil(eta - elapsed);
  const msg =
    left > 60
      ? t(`Creando el video… faltan unos ${Math.round(left / 60)} minutos`, `Creating the video… about ${Math.round(left / 60)} minutes left`)
      : left > 5
        ? t(`Creando el video… faltan unos ${left} segundos`, `Creating the video… about ${left} seconds left`)
        : t("Casi listo… a veces tarda un poco más. No cierres esta página.", "Almost done… sometimes it takes a bit longer. Don't close this page.");
  return (
    <div className={s.wrap} role="status" aria-live="polite">
      <div className={s.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={t("Avance del video", "Video progress")}>
        <div className={s.bar} style={{ width: `${pct.toFixed(1)}%` }} />
      </div>
      <span className="small muted">{msg}</span>
    </div>
  );
}
