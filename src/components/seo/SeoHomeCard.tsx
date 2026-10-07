import Link from "next/link";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { loadPlainSummary, seoHref, topLines } from "@/lib/seo/plain-load";
import { pctText } from "@/lib/seo/sov";
import styles from "./SeoHomeCard.module.css";

/** Cuántas frases del resumen se muestran en Inicio. */
const SHOW = 3;

/**
 * Inicio: "Tu SEO esta semana". Las 2-3 frases más importantes del resumen de SEO en palabras simples (las mismas,
 * con su ícono y tono; lo urgente primero), unos pocos números si ya están y un botón a la página de SEO.
 * Solo lee lo guardado (sin API ni IA). Sin datos: una línea y a dónde ir; sin DataForSEO y sin datos, nada.
 */
export async function SeoHomeCard({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const data = await loadPlainSummary(businessId).catch(() => null);
  if (!data) return null;
  if (!data.hasData && !data.canRank) return null;
  const seo = `/b/${businessId}/seo`;
  const pick = (x: { es: string; en: string }) => (lang === "en" ? x.en : x.es);
  const title = <h2 id="seo-home-title">{t("Tu SEO esta semana", "Your SEO this week")}</h2>;

  if (!data.hasData || data.lines.length === 0) {
    const setup = data.tracked.length === 0;
    return (
      <section className={`card ${styles.card}`} aria-labelledby="seo-home-title">
        {title}
        <div className={styles.empty}>
          <p className="muted">
            {data.hasData
              ? t("Todavía no hay nada importante que contarte de tu SEO.", "Nothing important to tell you about your SEO yet.")
              : t("Todavía no revisamos tu SEO.", "We haven't checked your SEO yet.")}
          </p>
          <Link href={setup ? `${seo}?tab=ajustes` : seo} className="btn on">
            {setup ? t("Elegir mis palabras clave →", "Pick my keywords →") : t("Ir a SEO →", "Go to SEO →")}
          </Link>
        </div>
      </section>
    );
  }

  const lines = topLines(data.lines, SHOW);
  const more = data.lines.length - lines.length;

  // Números que ya están calculados (sin buscar nada más): posición promedio, cuántas en la primera página y tu parte
  // de los clics (o del mapa).
  const num = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });
  const nums: { key: string; value: React.ReactNode; label: string }[] = [];
  const rank = data.rank;
  if (rank?.avgPosition != null) {
    nums.push({ key: "avg", value: num.format(rank.avgPosition), label: t("tu lugar promedio en Google (1 = el primero)", "your average spot on Google (1 = first)") });
  }
  const rankRows = rank ? rank.rows.filter((r) => !r.error).length : 0;
  if (rank && rankRows > 0) {
    nums.push({
      key: "top10",
      value: (
        <>
          {rank.inTop10}
          <small> / {rankRows}</small>
        </>
      ),
      label: t("palabras clave en la primera página", "keywords on page one"),
    });
  }
  const { organic, map } = data.market;
  if (organic) {
    nums.push({ key: "share", value: pctText(organic.you), label: t("de los clics en tus búsquedas", "of the clicks on your searches") });
  } else if (map) {
    nums.push({ key: "map", value: pctText(map.you), label: t("del mapa de Google donde sales arriba", "of Google's map where you show up on top") });
  }

  return (
    <section className={`card ${styles.card}`} aria-labelledby="seo-home-title">
      <div className={styles.head}>
        {title}
        <p className="small muted">{t("Lo más importante de tus últimas revisiones de Google.", "The most important things from your latest Google checks.")}</p>
      </div>

      <ul className={styles.lines}>
        {lines.map((l) => (
          <li key={l.id} className={`${styles.line} ${styles[l.tone]}`}>
            <span className={styles.icon} aria-hidden="true">
              {l.icon}
            </span>
            <span className={styles.text}>
              {pick(l.text)}{" "}
              {l.action && (
                <>
                  <Link href={seoHref(businessId, l.action.href)}>{pick(l.action.label)} →</Link>
                  {" · "}
                </>
              )}
              <Link href={seoHref(businessId, l.link.href)}>{pick(l.link.label)} →</Link>
            </span>
          </li>
        ))}
      </ul>

      {nums.length > 0 && (
        <div className={styles.nums}>
          {nums.map((n) => (
            <div key={n.key} className={styles.num}>
              <span className={styles.numValue}>{n.value}</span>
              <span className={styles.numLabel}>{n.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.foot}>
        <span className={styles.more}>
          {more > 0 ? t(`Y ${more} cosa${more === 1 ? "" : "s"} más en tu resumen de SEO.`, `And ${more} more thing${more === 1 ? "" : "s"} in your SEO summary.`) : ""}
        </span>
        <Link href={seo} className="btn">
          {t("Ver todo en SEO →", "See all in SEO →")}
        </Link>
      </div>
    </section>
  );
}

/** Mientras se leen los reportes: el mismo marco, para que Inicio no salte. */
export async function SeoHomeCardSkeleton() {
  const { t } = await getT();
  return (
    <section className={`card ${styles.card}`} aria-busy="true">
      <h2>{t("Tu SEO esta semana", "Your SEO this week")}</h2>
      <div className={styles.skeleton} aria-hidden="true">
        <span />
        <span />
      </div>
    </section>
  );
}
