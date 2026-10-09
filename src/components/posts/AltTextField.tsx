"use client";

// Texto alternativo de la foto: lo que la foto muestra, con una palabra clave y la ciudad. Lo leen Google, los
// lectores de pantalla, Facebook, Instagram, LinkedIn y X. Se llena solo (plantilla) y la IA lo puede mejorar.
import { useT } from "@/components/I18n";
import s from "./posts.module.css";

type Props = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** «✦ Escribir con IA» (null = sin IA). */
  onAi: (() => void) | null;
  busy: boolean;
  note?: string;
  label?: string;
};

export function AltTextField({ id, value, onChange, onAi, busy, note, label }: Props) {
  const { t } = useT();
  return (
    <div className={s.alt}>
      <div className={s.altHead}>
        <label htmlFor={id} className={s.altLbl}>{label ?? t("Descripción de la foto (texto alternativo)", "Photo description (alt text)")}</label>
        {onAi && (
          <button type="button" className="btn small" onClick={onAi} disabled={busy}>
            ✦ {busy ? t("Escribiendo…", "Writing…") : t("Escribir con IA", "Write with AI")}
          </button>
        )}
      </div>
      <textarea id={id} className="field" rows={3} maxLength={250} value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("Ej.: Portón enrollable instalado en una tienda — portones enrollables en Managua", "E.g., Roll-up door installed at a store — roll-up doors in Managua")} />
      <p className={s.altHelp}>
        {t(
          "Google y las personas que usan lectores de pantalla leen esta frase. Lleva una de tus palabras clave y tu ciudad.",
          "Google and people using screen readers read this sentence. It includes one of your keywords and your city.",
        )}
      </p>
      {note && <p className="note" role="status">{note}</p>}
    </div>
  );
}
