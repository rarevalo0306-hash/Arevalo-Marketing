"use client";

// Tu link de reseñas de Google: copiar, código QR y tarjeta para imprimir (A6 o tamaño tarjeta de presentación).
import { markReviewShared } from "@/app/actions-directories";
import { useT } from "@/components/I18n";
import { CopyButton } from "./CopyButton";
import s from "./Directories.module.css";

export function ReviewLink({ businessId, link, qrSvg }: { businessId: string; link: string; qrSvg: string }) {
  const { lang, t } = useT();
  const base = `/b/${businessId}/directorios/tarjeta`;
  const shared = (how: "copy" | "qr" | "card") => {
    void markReviewShared(businessId, how).catch(() => undefined);
  };
  return (
    <div className={s.reviewLink}>
      {/* El SVG lo arma el servidor con src/lib/qr.ts: solo un rectángulo y un trazo, sin texto. */}
      <div className={s.qr} role="img" aria-label={t("Código QR de tu link de reseñas", "QR code for your review link")} dangerouslySetInnerHTML={{ __html: qrSvg }} />
      <div className={s.reviewLinkBody}>
        <label className={s.label} htmlFor="review-link">
          {t("Tu link para que te dejen una reseña en Google", "Your link for people to leave you a Google review")}
        </label>
        <div className={s.linkRow}>
          <input id="review-link" className={`field ${s.linkInput}`} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <CopyButton text={link} label={t("el link de reseñas", "the review link")} onCopied={() => shared("copy")} className="solid" />
        </div>
        <p className="small muted">
          {t(
            "Al abrirlo, sale directo la ventana de Google para poner estrellas y escribir. Mándalo por WhatsApp, ponlo en tu firma de correo o en tu factura.",
            "When opened, Google's window to rate and write shows up right away. Send it by WhatsApp, put it in your email signature or on your invoice.",
          )}
        </p>
        <div className={s.dirActions}>
          <a className="btn" href={`${base}?size=a6&lang=${lang}&download=1`} onClick={() => shared("card")}>
            {t("Tarjeta A6 para imprimir (PNG)", "Printable A6 card (PNG)")}
          </a>
          <a className="btn" href={`${base}?size=card&lang=${lang}&download=1`} onClick={() => shared("card")}>
            {t("Tamaño tarjeta de presentación", "Business-card size")}
          </a>
          <a className="btn" href={`${base}?kind=qr&download=1`} onClick={() => shared("qr")}>
            {t("Solo el QR (SVG)", "QR only (SVG)")}
          </a>
        </div>
        <p className="small">
          <a href={`${base}?size=a6&lang=${lang}`} target="_blank" rel="noopener noreferrer">
            {t("Ver la tarjeta antes de descargar", "Preview the card before downloading")} ↗
          </a>
        </p>
      </div>
    </div>
  );
}
