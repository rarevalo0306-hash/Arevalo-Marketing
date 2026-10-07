import { Fold } from "@/components/seo/Fold";
import { HowToRead } from "@/components/seo/HowToRead";
import styles from "@/components/seo/SharePanel.module.css";
import type { TextProvider } from "@/lib/ai";
import { db } from "@/lib/db";
import { intlLocale, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readZones } from "@/lib/seo/dataforseo";
import { readKeywordsReport } from "@/lib/seo/keywords";
import { MAP_KEEP, readMapReport } from "@/lib/seo/maprank";
import { readRankReport, type RankReport } from "@/lib/seo/rank";
import { latestReports } from "@/lib/seo/reports";
import { aiVerdict, groupNewestFirst, mapGroups, mapVerdict, marketSummary, organicVerdict, pctText } from "@/lib/seo/sov";
import { readVisibilityReport } from "@/lib/seo/visibility";
import { BUSINESS_TZ } from "@/lib/time";

const SHORT: Record<TextProvider, string> = { gemini: "Gemini", claude: "Claude", openai: "ChatGPT" };
/** Grises para los competidores: el color de marca queda solo para el negocio. */
const COMP_COLORS = ["#4f5f78", "#6f8099", "#8e9db3", "#aab6c8", "#c3ccd9"];

type Segment = { key: string; label: string; share: number; color?: string; className?: string; you?: boolean };

function LegendItem({ s }: { s: Segment }) {
  return (
    <li className={`${styles.item} ${s.you ? styles.you : ""}`}>
      <span className={`${styles.dot} ${s.className ?? ""}`} style={s.color ? { background: s.color } : undefined} aria-hidden />
      <span className={styles.name}>{s.label}</span>
      <span className={styles.val}>{pctText(s.share)}</span>
    </li>
  );
}

/** Barra apilada (suma 100 %) y su leyenda: tu parte a la vista, la de los demás en un desplegable (`rest` dice cuántos). */
function StackBar({ segments, label, rest }: { segments: Segment[]; label: string; rest: (n: number) => string }) {
  const shown = segments.filter((s) => s.share > 0);
  const others = segments.filter((s) => !s.you);
  return (
    <>
      <div className={styles.bar} role="img" aria-label={label}>
        {shown.map((s) => (
          <span
            key={s.key}
            className={`${styles.seg} ${s.className ?? ""}`}
            style={{ width: `${(s.share * 100).toFixed(2)}%`, ...(s.color ? { background: s.color } : {}) }}
            title={`${s.label}: ${pctText(s.share)}`}
          />
        ))}
      </div>
      <ul className={styles.legend}>
        {segments.filter((s) => s.you).map((s) => <LegendItem key={s.key} s={s} />)}
      </ul>
      {others.length > 0 && (
        <Fold inline summary={rest(others.length)}>
          <ul className={styles.legend}>
            {others.map((s) => <LegendItem key={s.key} s={s} />)}
          </ul>
        </Fold>
      )}
    </>
  );
}

/** ▲ subió / ▼ bajó / = igual, en puntos porcentuales frente a la revisión anterior. */
function Change({ delta, t, locale }: { delta: number | null; t: T; locale: string }) {
  if (delta === null) return null;
  const n = Math.abs(delta).toLocaleString(locale, { maximumFractionDigits: 1 });
  const title = t("Frente a la revisión anterior (puntos porcentuales)", "Compared with the previous check (percentage points)");
  if (delta > 0) return <span className={`${styles.change} ${styles.up}`} title={title}>▲ +{n} {t("pts", "pts")}</span>;
  if (delta < 0) return <span className={`${styles.change} ${styles.down}`} title={title}>▼ −{n} {t("pts", "pts")}</span>;
  return <span className={`${styles.change} ${styles.same}`} title={title}>= {t("igual", "same")}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

export async function SharePanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, color: true, website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true },
  });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const n = Math.max(1, zones.length);
  const [rankRows, kwRows, mapRows, aiRows] = await Promise.all([
    latestReports(businessId, "rank", 4 * n).catch(() => []),
    latestReports(businessId, "keywords", 2 * n).catch(() => []),
    latestReports(businessId, "maprank", MAP_KEEP).catch(() => []),
    latestReports(businessId, "ai", 2).catch(() => []),
  ]);
  const brand = /^#[0-9a-f]{3,8}$/i.test(b.color ?? "") ? b.color : "var(--brand-2)";
  const dfs = dataForSeoEnabled();
  const day = new Intl.DateTimeFormat(intlLocale(lang), { day: "numeric", month: "short", year: "numeric", timeZone: BUSINESS_TZ });
  const pick = (x: { es: string; en: string }) => (lang === "en" ? x.en : x.es);
  const youLabel = t(`Tú (${b.name})`, `You (${b.name})`);
  const rest = (n: number) => t(`Quién se lleva el resto (${n})`, `Who gets the rest (${n})`);

  // ---- Google: el último reporte de posiciones de cada zona (y el anterior para el cambio). ----
  const main = zones[0]?.code ?? 0;
  const zoneCodes = new Set(zones.map((z) => z.code));
  const ranks = rankRows.flatMap((r) => {
    const report = readRankReport(r.data);
    if (!report) return [];
    const code = report.locationCode > 0 ? report.locationCode : main;
    return zoneCodes.size && !zoneCodes.has(code) ? [] : [{ ...report, locationCode: code, savedAt: r.createdAt }];
  });
  const rankByZone = [...groupNewestFirst<RankReport & { savedAt: Date }>(ranks, (r) => r.locationCode).values()];
  const kwLatest = [...groupNewestFirst(kwRows.map((r) => readKeywordsReport(r.data)), (k) => (k.locationCode > 0 ? k.locationCode : main)).values()]
    .map((l) => l[0])
    .sort((a, b2) => Number(b2.locationCode === main) - Number(a.locationCode === main));
  const rankAt = rankByZone.map((l) => l[0]).reduce<Date | null>((a, r) => (!a || r.savedAt > a ? r.savedAt : a), null);

  // ---- Google Maps: el último mapa de cada búsqueda. ----
  const maps = mapRows.flatMap((r) => {
    const m = readMapReport(r.data);
    return m ? [{ ...m, savedAt: r.createdAt }] : [];
  });
  const mapAt = maps[0]?.savedAt ?? null;

  // ---- IAs: la última revisión y la anterior. ----
  const ais = aiRows.flatMap((r) => {
    const v = readVisibilityReport(r.data);
    return v ? [{ report: v, at: r.createdAt }] : [];
  });

  // Cada parte se compara con la revisión anterior (la de cada zona, cada búsqueda del mapa y las IAs).
  const { organic, organicDelta, map, mapDelta, ai, aiDelta } = marketSummary({
    website: b.website,
    rankByZone,
    keywords: kwLatest,
    maps: mapGroups(maps),
    ai: ais.map((x) => x.report),
  });

  const go = (href: string, text: string) => (
    <a href={href} style={{ fontWeight: 700 }}>
      {text}
    </a>
  );

  return (
    <section className="card" id="mercado">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Tu parte del mercado", "Your share of the market")}</h2>
        <p className="small muted">
          {t(
            "De todo lo que se reparten tus búsquedas en Google, el mapa y las IAs, cuánto te llevas tú y cuánto tus competidores. Se calcula con tus últimas revisiones guardadas: no cuesta nada.",
            "Of everything your Google searches, the map and the AIs hand out, how much goes to you and how much to your competitors. It's calculated from your latest saved checks: it costs nothing.",
          )}
        </p>
      </div>

      <div className={styles.blocks}>
        {/* ---------- Google ---------- */}
        <div className={styles.block}>
          <div className={styles.head}>
            <span className="lbl">{t("Google (resultados normales)", "Google (regular results)")}</span>
            {organic && <Change delta={organicDelta} t={t} locale={intlLocale(lang)} />}
          </div>
          {!b.website ? (
            <Empty>{t("Agrega la dirección de tu página web en los ajustes del negocio para poder calcular tu parte en Google.", "Add your website address in the business settings so we can calculate your share on Google.")}</Empty>
          ) : !organic ? (
            <Empty>
              {dfs ? (
                <>
                  {t("Todavía no hay datos. Primero pulsa «Revisar mis posiciones» en ", "No data yet. First press “Check my rankings” in ")}
                  {go("#posiciones", t("Tus posiciones en Google", "Your Google rankings"))}.
                </>
              ) : (
                <>
                  {t("Para esto primero elige tus zonas y palabras clave en ", "For this, first pick your zones and keywords in ")}
                  {go("#dataforseo", t("la pestaña «⚙ Ajustes»", "the “⚙ Settings” tab"))}
                  {t(" y luego revisa tus posiciones.", ", then check your rankings.")}
                </>
              )}
            </Empty>
          ) : (
            <>
              <div className={styles.big}>
                <strong>{pctText(organic.you)}</strong>
                <span className="small muted">{t("de los clics posibles", "of the possible clicks")}</span>
              </div>
              <StackBar
                rest={rest}
                label={t(`Tu parte de los clics: ${pctText(organic.you)}`, `Your share of clicks: ${pctText(organic.you)}`)}
                segments={[
                  { key: "you", label: youLabel, share: organic.you, color: brand, you: true },
                  ...organic.competitors.map((c, i) => ({ key: c.key, label: c.label, share: c.share, color: COMP_COLORS[i] })),
                  {
                    key: "dirs",
                    label: t("Directorios y redes", "Directories and social media") + (organic.directoryNames.length ? ` (${organic.directoryNames.join(", ")})` : ""),
                    share: organic.directories,
                    className: styles.dirs,
                  },
                  { key: "others", label: t("Otros (resultados 6 al 20 y sitios más chicos)", "Others (results 6 to 20 and smaller sites)"), share: organic.others, className: styles.others },
                ]}
              />
              <p className={styles.verdict}>{pick(organicVerdict(organic))}</p>
              <p className={styles.basis}>
                {organic.weighting === "volume"
                  ? t(`${organic.keywords} búsquedas, pesadas por cuánta gente las busca al mes`, `${organic.keywords} searches, weighted by how many people search them each month`)
                  : t(`${organic.keywords} búsquedas, todas con el mismo peso (revisa tus palabras clave para pesarlas por búsquedas al mes)`, `${organic.keywords} searches, all weighted the same (check your keywords to weight them by monthly searches)`)}
                {rankAt ? ` · ${t("datos del", "data from")} ${day.format(rankAt)}` : ""}
              </p>
            </>
          )}
        </div>

        {/* ---------- Google Maps ---------- */}
        <div className={styles.block}>
          <div className={styles.head}>
            <span className="lbl">{t("Google Maps (los 3 primeros)", "Google Maps (top 3)")}</span>
            {map && <Change delta={mapDelta} t={t} locale={intlLocale(lang)} />}
          </div>
          {!map ? (
            <Empty>
              {dfs ? (
                <>
                  {t("Todavía no hay datos. Primero pulsa «Hacer mi mapa» en ", "No data yet. First press “Make my map” in ")}
                  {go("#mapa", t("Mapa de calor en Google Maps", "Google Maps heatmap"))}.
                </>
              ) : (
                <>
                  {t("Para esto primero elige tus zonas y palabras clave en ", "For this, first pick your zones and keywords in ")}
                  {go("#dataforseo", t("la pestaña «⚙ Ajustes»", "the “⚙ Settings” tab"))}
                  {t(" y luego hacer tu mapa.", " connected, then a map.")}
                </>
              )}
            </Empty>
          ) : (
            <>
              <div className={styles.big}>
                <strong>{pctText(map.you)}</strong>
                <span className="small muted">{t("del mapa te tiene en el top 3", "of the map has you in the top 3")}</span>
              </div>
              <ul className={styles.bars}>
                {[
                  { key: "you", label: youLabel, share: map.you, points: map.youPoints, color: brand, you: true },
                  ...map.competitors.map((c, i) => ({ ...c, color: COMP_COLORS[i], you: false })),
                ].map((c) => (
                  <li key={c.key} className={`${styles.barItem} ${c.you ? styles.you : ""}`}>
                    <span className={styles.barLabel}>
                      <span className={styles.name} style={c.you ? { fontWeight: 800 } : undefined}>{c.label}</span>
                      <span className={styles.val}>{pctText(c.share)}</span>
                    </span>
                    <span className={styles.track} aria-hidden>
                      <span className={styles.fill} style={{ width: `${(c.share * 100).toFixed(1)}%`, background: c.color }} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className={styles.verdict}>{pick(mapVerdict(map))}</p>
              <p className={styles.basis}>
                {t(
                  `${map.points} puntos del mapa en ${map.keywords.length} búsqueda${map.keywords.length === 1 ? "" : "s"} (${map.keywords.join(", ")})`,
                  `${map.points} map points across ${map.keywords.length} search${map.keywords.length === 1 ? "" : "es"} (${map.keywords.join(", ")})`,
                )}
                {mapAt ? ` · ${t("datos del", "data from")} ${day.format(mapAt)}` : ""}
              </p>
            </>
          )}
        </div>

        {/* ---------- IAs ---------- */}
        <div className={styles.block}>
          <div className={styles.head}>
            <span className="lbl">{t("IAs (ChatGPT, Gemini, Claude)", "AIs (ChatGPT, Gemini, Claude)")}</span>
            {ai && <Change delta={aiDelta} t={t} locale={intlLocale(lang)} />}
          </div>
          {!ai ? (
            <Empty>
              {t("Todavía no hay datos. Primero pulsa «Revisar si las IAs me recomiendan» en ", "No data yet. First press “Check if AIs recommend me” in ")}
              {go("#ia", t("Visibilidad en IA", "AI visibility"))}.
            </Empty>
          ) : (
            <>
              <div className={styles.big}>
                <strong>{pctText(ai.you)}</strong>
                <span className="small muted">{t("de las menciones de negocios", "of the business mentions")}</span>
              </div>
              {ai.mentions > 0 && (
                <StackBar
                  rest={rest}
                  label={t(`Tu parte de las menciones: ${pctText(ai.you)}`, `Your share of mentions: ${pctText(ai.you)}`)}
                  segments={[
                    { key: "you", label: youLabel, share: ai.you, color: brand, you: true },
                    ...ai.competitors.map((c, i) => ({ key: c.key, label: c.label, share: c.share, color: COMP_COLORS[i] })),
                    { key: "others", label: t("Otros negocios", "Other businesses"), share: ai.others, className: styles.others },
                  ]}
                />
              )}
              <p className={styles.verdict}>{pick(aiVerdict(ai))}</p>
              {ai.byProvider.length > 1 && (
                <div className={styles.providers}>
                  {ai.byProvider.map((p) => (
                    <span key={p.provider} className="tag">
                      {SHORT[p.provider]}: {p.you === null ? "—" : pctText(p.you)}
                    </span>
                  ))}
                </div>
              )}
              <p className={styles.basis}>
                {t(
                  `Te nombran en ${ai.youMentions} de ${ai.answers} respuestas; en total nombran negocios ${ai.mentions} veces`,
                  `They name you in ${ai.youMentions} of ${ai.answers} answers; in total they name businesses ${ai.mentions} times`,
                )}
                {ais[0] ? ` · ${t("datos del", "data from")} ${day.format(ais[0].at)}` : ""}
              </p>
            </>
          )}
        </div>
      </div>

      <HowToRead title={t("Cómo leer esto", "How to read this")}>
        <p>
          {t(
            "Es una estimación, no un conteo exacto. Google: de cada 100 clics que se reparten tus búsquedas, cuántos te tocan a ti. Usamos lo que se sabe de cuánta gente hace clic en cada lugar (el 1.º se lleva cerca del 28 %, el 2.º el 15 %, el 3.º el 11 %… y del 11 al 20 casi nada), y las búsquedas con más gente pesan más.",
            "It's an estimate, not an exact count. Google: out of every 100 clicks your searches hand out, how many go to you. We use what's known about how many people click each spot (1st gets about 28%, 2nd 15%, 3rd 11%… and 11 to 20 almost nothing), and searches with more people weigh more.",
          )}
        </p>
        <p>
          {t(
            "«Directorios y redes» junta Facebook, Instagram, Páginas Amarillas y sitios parecidos: ahí también puede estar la página de un competidor. «Otros» son los resultados del 6 al 20, de los que no guardamos el nombre.",
            "“Directories and social media” groups Facebook, Instagram, Yellow Pages and similar sites: a competitor's page may be in there too. “Others” are results 6 to 20, whose names we don't save.",
          )}
        </p>
        <p>
          {t(
            "Mapa: en qué parte del mapa sale cada negocio entre los 3 primeros (como en cada punto salen 3, no suma 100 %). IAs: de cada 100 veces que ChatGPT, Gemini o Claude nombran un negocio, cuántas eres tú.",
            "Map: in what part of the map each business shows up in the top 3 (each point shows 3, so it doesn't add up to 100%). AIs: out of every 100 times ChatGPT, Gemini or Claude name a business, how many are you.",
          )}
        </p>
        <p>
          {t(
            "▲ o ▼ es cuánto subiste o bajaste (en puntos) frente a la revisión anterior. Para subir tu parte: mejora tus posiciones en las búsquedas con más gente, pide reseñas en Google para el mapa y aparece en los sitios que citan las IAs.",
            "▲ or ▼ is how much you went up or down (in points) since the previous check. To grow your share: improve your rankings on the searches with the most people, ask for Google reviews for the map, and get listed on the sites the AIs cite.",
          )}
        </p>
      </HowToRead>
    </section>
  );
}
