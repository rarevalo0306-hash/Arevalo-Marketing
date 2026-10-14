"use client";

// «El estilo de tus diseños»: cada negocio tiene su actitud. La app elige el estilo por el tipo de negocio y lo dice;
// el dueño ve los cuatro con su propia marca y cambia si quiere. Se guarda apenas se elige.
import { useState, useTransition } from "react";
import { useT } from "@/components/I18n";
import { DESIGN_STYLES, STYLE_INFO, type DesignStyle } from "@/lib/design-style";
import s from "./Style.module.css";

type Props = {
  businessId: string;
  style: DesignStyle;
  /** Quién lo decidió: la app (por el tipo de negocio) o el dueño. */
  by: "app" | "owner";
  /** Cambia cuando cambia la marca, para que las vistas previas se vuelvan a dibujar. */
  version: string;
  save: (style: string) => Promise<{ ok: boolean; message: string }>;
};

export function StylePick({ businessId, style, by, version, save }: Props) {
  const { lang, t } = useT();
  const L = lang === "en" ? "en" : "es";
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  const info = STYLE_INFO[style];
  const pick = (next: DesignStyle | "") =>
    start(async () => {
      setError("");
      const r = await save(next);
      if (!r.ok) setError(r.message);
      else setOpen(false);
    });
  return (
    <div className={s.box}>
      <div className={s.now}>
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <span className="lbl">{t("El estilo de tus diseños", "Your design style")}</span>
          <strong className={s.name}>{info.name[L]}</strong>
          <span className="small">{info.what[L]}</span>
          <span className="small muted">
            {by === "app" ? t(`La app lo eligió por tu tipo de negocio. Va con: ${info.fits.es}`, `The app picked it for your type of business. It suits: ${info.fits.en}`) : t("Lo elegiste tú.", "You chose it.")}
          </span>
        </div>
        <button type="button" className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? t("Cerrar", "Close") : t("Ver los 4 estilos", "See the 4 styles")}
        </button>
      </div>
      {open && (
        <>
          <div className={s.grid} role="radiogroup" aria-label={t("Estilo de tus diseños", "Design style")}>
            {DESIGN_STYLES.map((x) => (
              <button key={x} type="button" role="radio" aria-checked={x === style} className={x === style ? `${s.card} ${s.on}` : s.card} disabled={busy} onClick={() => pick(x)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/plantilla?${new URLSearchParams({ b: businessId, t: "builtin-0", estilo: x, v: version })}`} alt={t(`Ejemplo del estilo ${STYLE_INFO[x].name.es}`, `${STYLE_INFO[x].name.en} style example`)} loading="lazy" width={360} height={360} />
                <span className={s.cardText}>
                  <strong>{STYLE_INFO[x].name[L]}</strong>
                  <span className="small">{STYLE_INFO[x].what[L]}</span>
                  <span className="small muted">{t("Para:", "For:")} {STYLE_INFO[x].fits[L]}</span>
                </span>
              </button>
            ))}
          </div>
          {by === "owner" && (
            <button type="button" className="btn link" disabled={busy} onClick={() => pick("")} style={{ alignSelf: "flex-start" }}>
              {t("Volver al que va con mi tipo de negocio", "Go back to the one for my type of business")}
            </button>
          )}
        </>
      )}
      {busy && <span className="small muted">{t("Guardando…", "Saving…")}</span>}
      {error && <p className="note error">{error}</p>}
    </div>
  );
}
