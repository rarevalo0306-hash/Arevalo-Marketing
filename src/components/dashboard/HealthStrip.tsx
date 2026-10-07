import Link from "next/link";
import { loadSeoBits, loadSocialBits } from "@/lib/dashboard";
import type { T, UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { pctText } from "@/lib/seo/sov";
import { SCORE_LEVELS, scoreLevel } from "@/lib/seo/verdict";
import { compact, n, when } from "./fmt";
import { Sparkline } from "./Sparkline";
import s from "./Dashboard.module.css";

type Delta = { text: string; dir: "up" | "down" | "flat" };

type Tile = {
  key: string;
  label: string;
  href: string;
  /** null = todavía no se revisa. */
  value: React.ReactNode | null;
  note?: React.ReactNode;
  delta?: Delta | null;
  history?: number[];
  invert?: boolean;
  at?: Date | null;
  /** Qué hacer si falta: a dónde ir y qué dice el enlace. */
  empty: string;
  go?: string;
};

/** Cambio frente a la revisión anterior. better: si subir es bueno (true) o malo (false, como la posición). */
function delta(now: number | null, prev: number | null, t: T, lang: UiLang, opts: { better: "higher" | "lower"; unit?: string; digits?: number }): Delta | null {
  if (now === null || prev === null) return null;
  const d = Math.round((now - prev) * 10) / 10;
  if (d === 0) return { text: t("= igual", "= same"), dir: "flat" };
  const good = opts.better === "higher" ? d > 0 : d < 0;
  // La flecha dice si mejoró (▲) o empeoró (▼), también en la posición (bajar de #9 a #7 es subir).
  const arrow = good ? "▲" : "▼";
  return { text: `${arrow} ${n(Math.abs(d), lang, opts.digits ?? 1)}${opts.unit ?? ""}`, dir: good ? "up" : "down" };
}

/**
 * "Salud del proyecto": 6 números de un vistazo, cada uno con su cambio frente a la revisión anterior y una mini
 * gráfica cuando hay historia. Cada uno lleva a su sección. Sin datos: "Sin revisar" y a dónde ir.
 */
export async function HealthStrip({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const [seo, social] = await Promise.all([loadSeoBits(businessId), loadSocialBits(businessId)]);
  if (!seo) return null;
  const base = `/b/${businessId}`;
  const seoUrl = `${base}/seo`;

  const audit = seo.audit;
  const level = audit.now !== null ? scoreLevel(audit.now) : null;
  const rank = seo.rank;
  const ai = seo.ai;
  const map = seo.map;
  const links = seo.links;

  const tiles: Tile[] = [
    {
      key: "audit",
      label: t("Salud de tu página web", "Website health"),
      href: `${seoUrl}#auditoria`,
      value:
        audit.now === null ? null : (
          <>
            {audit.now}
            <small>/100</small>
          </>
        ),
      note: level ? <span className={`${s.level} ${s[level]}`}>{lang === "en" ? SCORE_LEVELS[level].en : SCORE_LEVELS[level].es}</span> : null,
      delta: delta(audit.now, audit.prev, t, lang, { better: "higher", digits: 0 }),
      history: audit.history,
      at: audit.at,
      empty: seo.website.trim() ? `${seoUrl}#auditoria` : `${base}/negocio`,
      go: seo.website.trim() ? t("Revisar mi página →", "Check my site →") : t("Agregar mi página →", "Add my site →"),
    },
    {
      key: "rank",
      label: t("Lugar promedio en Google", "Average Google position"),
      href: `${seoUrl}#posiciones`,
      value: rank.now === null ? null : <>#{n(rank.now, lang)}</>,
      note: seo.rankLatest ? t(`${seo.rankLatest.report.inTop10} de ${seo.rankLatest.ok} en la 1.ª página`, `${seo.rankLatest.report.inTop10} of ${seo.rankLatest.ok} on page 1`) : null,
      delta: delta(rank.now, rank.prev, t, lang, { better: "lower" }),
      history: rank.history,
      invert: true,
      at: rank.at,
      empty: seo.tracked.length ? `${seoUrl}#posiciones` : `${seoUrl}?tab=ajustes`,
      go: seo.tracked.length ? t("Revisar posiciones →", "Check rankings →") : t("Elegir palabras →", "Pick keywords →"),
    },
    {
      key: "map",
      label: t("Tu parte del mapa", "Your share of the map"),
      href: `${seoUrl}#mapa`,
      value: map.share === null ? null : pctText(map.share),
      note:
        map.bestRank !== null
          ? t(`mejor lugar promedio: ${n(map.bestRank, lang)}`, `best average spot: ${n(map.bestRank, lang)}`)
          : t("sales en el top 3", "you're in the top 3"),
      delta: map.delta === null ? null : delta(map.delta, 0, t, lang, { better: "higher", unit: " pts", digits: 0 }),
      at: map.at,
      empty: `${seoUrl}#mapa`,
      go: t("Ver el mapa →", "See the map →"),
    },
    {
      key: "ai",
      label: t("Te mencionan las IAs", "AIs mention you"),
      href: `${seoUrl}#ia`,
      value: ai.now === null ? null : `${Math.round(ai.now)}%`,
      note: ai.total ? t(`${ai.mentioned} de ${ai.total} respuestas`, `${ai.mentioned} of ${ai.total} answers`) : null,
      delta: delta(ai.now, ai.prev, t, lang, { better: "higher", unit: " pts", digits: 0 }),
      history: ai.history,
      at: ai.at,
      empty: `${seoUrl}#ia`,
      go: t("Preguntar a las IAs →", "Ask the AIs →"),
    },
    {
      key: "links",
      label: t("Sitios que te enlazan", "Sites linking to you"),
      href: `${seoUrl}#enlaces`,
      value: links.now === null ? null : compact(links.now, lang),
      note: links.delta !== null ? t("en el último mes", "in the last month") : null,
      delta: links.delta === null ? null : delta(links.delta, 0, t, lang, { better: "higher", digits: 0 }),
      history: links.history,
      at: links.at,
      empty: `${seoUrl}#enlaces`,
      go: t("Ver mis enlaces →", "See my links →"),
    },
    {
      key: "posts",
      label: t("Publicaciones esta semana", "Posts this week"),
      href: `${base}/historial`,
      // Publicar no se "revisa": siempre hay número (aunque sea 0).
      value: social.thisWeek,
      note: social.next ? t(`próxima: ${when(social.next, lang)}`, `next: ${when(social.next, lang)}`) : t("en los últimos 7 días", "in the last 7 days"),
      delta: social.hasPosts ? delta(social.thisWeek, social.lastWeek, t, lang, { better: "higher", digits: 0 }) : null,
      history: social.hasPosts ? social.weeks : [],
      empty: `${base}/publicar`,
    },
  ];

  return (
    <section className={s.health} aria-labelledby="dash-health">
      <div className={s.sectionHead}>
        <h2 id="dash-health">{t("Salud de tu negocio en internet", "Your online health")}</h2>
        <span className={s.sectionHint}>{t("Comparado con la revisión anterior", "Compared with the previous check")}</span>
      </div>
      <div className={s.tiles}>
        {tiles.map((x) =>
          x.value === null ? (
            <Link key={x.key} href={x.empty} className={s.tile}>
              <span className={s.tileLabel}>{x.label}</span>
              <span className={s.tileEmpty}>{t("Sin revisar", "Not checked")}</span>
              <span className={s.tileNote}>{t("Todavía no hay datos.", "No data yet.")}</span>
              <span className={s.tileGo}>{x.go ?? t("Revisar →", "Check →")}</span>
            </Link>
          ) : (
            <Link key={x.key} href={x.href} className={s.tile} title={x.at ? t(`Revisado: ${when(x.at, lang)}`, `Checked: ${when(x.at, lang)}`) : undefined}>
              <span className={s.tileLabel}>{x.label}</span>
              <span className={s.tileRow}>
                <span className={s.tileValue}>{x.value}</span>
                {x.delta && <span className={`${s.delta} ${s[x.delta.dir]}`}>{x.delta.text}</span>}
              </span>
              <Sparkline values={x.history ?? []} invert={x.invert} />
              {x.note && <span className={s.tileNote}>{x.note}</span>}
            </Link>
          ),
        )}
      </div>
    </section>
  );
}

export async function HealthStripSkeleton() {
  const { t } = await getT();
  return (
    <section className={s.health} aria-busy="true">
      <div className={s.sectionHead}>
        <h2>{t("Salud de tu negocio en internet", "Your online health")}</h2>
      </div>
      <div className={s.tiles}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`${s.skel} ${s.skelTile}`} />
        ))}
      </div>
    </section>
  );
}
