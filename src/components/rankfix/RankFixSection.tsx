import Link from "next/link";
import { RankFix } from "@/components/rankfix/RankFix";
import styles from "@/components/rankfix/RankFix.module.css";
import { getT } from "@/lib/i18n-server";
import { fixHref, loadRankFixState } from "@/lib/rankfix";
import type { RankReport } from "@/lib/seo/rank";

/**
 * «✨ Que la IA mejore mis posiciones» en «Tus posiciones en Google»: un solo botón para toda la sección. Solo con la
 * web conectada (Conexiones → Sitio web) y una IA; si falta algo, una nota corta con lo que hace falta.
 */
export async function RankFixSection({ businessId, report }: { businessId: string; report: RankReport | null }) {
  const { lang, t } = await getT();
  const state = await loadRankFixState(businessId, lang, report);
  if (!state.searches && !state.job) return null;
  if (!state.connected || !state.ai)
    return (
      <p className={styles.gate}>
        <span aria-hidden="true">✨ </span>
        {!state.connected ? (
          <>
            {t(
              "La IA puede mejorar estas posiciones por ti (escribir artículos y reforzar tus páginas) si conectas tu página web. ",
              "The AI can improve these rankings for you (write articles and strengthen your pages) if you connect your website. ",
            )}
            <Link href={`/b/${businessId}/conexiones`}>{t("Conectar mi web", "Connect my website")}</Link>
          </>
        ) : (
          t(
            "Para que la IA mejore tus posiciones hace falta la clave de una IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en el servidor.",
            "For the AI to improve your rankings, an AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is needed on the server.",
          )
        )}
      </p>
    );
  return <RankFix key={state.job?.id ?? "plan"} businessId={businessId} plan={state.plan} initialJob={state.job} initialFix={state.fix} fixHref={fixHref(businessId)} />;
}
