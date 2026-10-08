"use client";

// Historia de Instagram o Facebook: pantalla vertical 9:16 con el nombre arriba y «Enviar mensaje» abajo. Las
// zonas seguras (amarillas) muestran lo que tapan los botones: lo importante de la foto tiene que quedar fuera.
import { useState } from "react";
import { useT } from "@/components/I18n";
import type { PreviewBrand, PreviewMediaInfo } from "./NetworkPreview";
import s from "./preview.module.css";

function Avatar({ brand }: { brand: PreviewBrand }) {
  if (brand.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- logo del negocio
    return <img src={brand.logoUrl} alt="" className={`${s.avatar} ${s.avatarImg}`} />;
  }
  return <span className={s.avatar} style={{ background: brand.color }} aria-hidden="true">{brand.name.trim().charAt(0).toUpperCase()}</span>;
}

const HEART = "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z";
const SEND = "M22 3 11 14M22 3l-7 18-4-7-7-4 18-7z";
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className={s.icon} aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function StoryPreview({ network, brand, media }: { network: "instagram" | "facebook"; brand: PreviewBrand; media: PreviewMediaInfo }) {
  const { t } = useT();
  const [safe, setSafe] = useState(true);
  const [exactFailed, setExactFailed] = useState(false);
  const handle = brand.handle?.replace(/^@/, "") || brand.name;
  const src = media.type === "photo" && media.exactUrl && !exactFailed ? media.exactUrl : media.url;
  const fb = network === "facebook";
  return (
    <>
      <article className={s.st} aria-label={fb ? t("Vista previa de la historia de Facebook", "Facebook story preview") : t("Vista previa de la historia de Instagram", "Instagram story preview")}>
        {media.type === "none" || !media.url ? (
          <div className={s.stEmpty}>{t("Elige una foto o un video para la historia", "Pick a photo or video for the story")}</div>
        ) : media.type === "video" ? (
          <video src={media.url} className={s.stMedia} muted playsInline loop autoPlay preload="metadata" />
        ) : (
          <>
            {/* La foto original desenfocada de fondo, por si la exacta (9:16) todavía no llega. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- fondo de la vista previa */}
            <img src={media.url} alt="" aria-hidden="true" className={`${s.stMedia} ${s.stBlur}`} />
            {/* eslint-disable-next-line @next/next/no-img-element -- la foto de la historia (la exacta 9:16 si se puede) */}
            <img src={src} alt={t("Foto de la historia", "Story photo")} className={s.stMedia} style={src === media.url ? { objectFit: "contain" } : undefined} onError={() => setExactFailed(true)} />
          </>
        )}
        <div className={s.stBars} aria-hidden="true"><span /></div>
        <div className={s.stHead}>
          <Avatar brand={brand} />
          <strong>{fb ? brand.name : handle.toLowerCase().replace(/\s+/g, "")}</strong>
          <span className={s.stTime}>{t("Ahora", "Now")}</span>
        </div>
        <div className={s.stFoot} aria-hidden="true">
          <span className={s.stReply}>{fb ? t("Responder…", "Reply…") : t("Enviar mensaje", "Send message")}</span>
          <Icon d={HEART} />
          <Icon d={SEND} />
        </div>
        {safe && (
          <>
            <div className={`${s.safeZone} ${s.safeZoneTop}`} aria-hidden="true"><span className={s.safeLabel}>{t("Lo tapa el nombre", "Covered by the name")}</span></div>
            <div className={`${s.safeZone} ${s.safeZoneBottom}`} aria-hidden="true"><span className={s.safeLabel}>{t("Lo tapan los botones", "Covered by the buttons")}</span></div>
          </>
        )}
      </article>
      <div className={s.stTools}>
        <label><input type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} /> {t("Mostrar zonas que se tapan", "Show covered areas")}</label>
      </div>
    </>
  );
}
