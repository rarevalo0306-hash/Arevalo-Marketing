import styles from "@/components/seo/ScoreVerdict.module.css";
import { translator, type UiLang } from "@/lib/i18n";
import { SCORE_LEVELS, SCORE_SCALE, scoreLevel } from "@/lib/seo/verdict";

/**
 * "94 de 100: Excelente" con la escala debajo (90–100 Excelente · 70–89 Bien · 50–69 Regular · 0–49 Urgente).
 * Sin estado: sirve en componentes del servidor y del cliente.
 */
export function ScoreVerdict({ score, lang, what }: { score: number; lang: UiLang; what?: string }) {
  const t = translator(lang);
  const level = scoreLevel(score);
  const v = SCORE_LEVELS[level];
  return (
    <div className={styles.verdict}>
      <div className={styles.head}>
        <span className={`pill ${v.pill}`}>{t(v.es, v.en)}</span>
        <span>
          {what ? `${what}: ` : ""}
          <strong>{t(`${score} de 100`, `${score} out of 100`)}</strong>. {t(v.hintEs, v.hintEn)}
        </span>
      </div>
      <ul className={styles.scale} aria-label={t("Escala de la nota", "Score scale")}>
        {SCORE_SCALE.map((s) => (
          <li key={s.level} className={s.level === level ? styles.on : undefined}>
            <b>{s.range}</b> {t(SCORE_LEVELS[s.level].es, SCORE_LEVELS[s.level].en)}
          </li>
        ))}
      </ul>
    </div>
  );
}
