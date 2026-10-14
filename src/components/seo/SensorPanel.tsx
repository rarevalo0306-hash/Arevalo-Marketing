import { HowToRead } from "@/components/seo/HowToRead";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readZones, zoneLabel } from "@/lib/seo/dataforseo";
import { compareRuns, readRankReport } from "@/lib/seo/rank";
import { latestReports } from "@/lib/seo/reports";
import { SENSOR_LABEL, sensorAdvice, sensorLevel, sensorPoints, type SensorPoint } from "@/lib/seo/sensor";
import { groupByZone } from "@/lib/seo/zones";
import { BUSINESS_TZ } from "@/lib/time";

/** Barras de las últimas revisiones (0 a 10). */
function Bars({ points, label }: { points: SensorPoint[]; label: string }) {
  const W = 14;
  const GAP = 6;
  const H = 48;
  const width = points.length * (W + GAP) - GAP;
  return (
    <svg className="sensor-bars" width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={label}>
      <title>{label}</title>
      {points.map((p, i) => {
        const h = Math.max(3, (p.score / 10) * H);
        return <rect key={p.at} x={i * (W + GAP)} y={H - h} width={W} height={h} rx={3} className={`sensor-${sensorLevel(p.score)}`} />;
      })}
    </svg>
  );
}

/** «¿Se movió Google?»: cuánto cambiaron los 5 primeros de tus búsquedas entre revisiones (gratis). */
export async function SensorPanel({ businessId }: { businessId: string }) {
  if (!dataForSeoEnabled()) return null;
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { seoLocations: true, seoLocationCode: true, seoLocationName: true } });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  if (!zones.length) return null;
  const saved = await latestReports(businessId, "rank", 11 * zones.length);
  const main = groupByZone(
    saved.map((r) => readRankReport(r.data)),
    zones,
  ).get(zones[0].code) ?? [];
  const points = sensorPoints(main.slice(0, 11));
  if (!points.length) return null;
  const last = points[points.length - 1];
  const level = sensorLevel(last.score);
  const [pill, es, en] = SENSOR_LABEL[level];
  const changes = main.length > 1 ? compareRuns(main[0], main[1]) : {};
  const dropped = Object.values(changes).some((c) => c.kind === "down" || c.kind === "lost");
  const advice = sensorAdvice(last, dropped);
  const short = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeZone: BUSINESS_TZ });
  const one = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });
  const where = zoneLabel(zones[0].name) || t("tu zona", "your area");
  const chart = points
    .map((p) => `${short.format(new Date(p.at))}: ${one.format(p.score)}`)
    .join(", ");

  return (
    <section className="card" id="sensor">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("¿Se movió Google?", "Did Google move?")}</h2>
        <p className="small muted">
          {t(
            `Cuánto cambiaron los 5 primeros de Google en tus búsquedas (${where}) entre tus últimas revisiones, de 0 a 10. Sirve para saber si una bajada es tuya o un cambio de Google para todos. Gratis.`,
            `How much Google's top 5 changed on your searches (${where}) between your last checks, from 0 to 10. It tells you whether a drop is yours or a Google change for everyone. Free.`,
          )}
        </p>
      </div>
      <div className="sensor-now">
        <div className="stack" style={{ gap: 2 }}>
          <span className="sensor-score">
            {one.format(last.score)}
            <small>/10</small>
          </span>
          <span className={`pill ${pill}`}>{t(es, en)}</span>
        </div>
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <Bars points={points} label={t(`Movimiento por revisión: ${chart}`, `Movement per check: ${chart}`)} />
          <span className="small muted">
            {t(
              `Última: ${short.format(new Date(last.at))}, ${last.days === 1 ? "1 día" : `${last.days} días`} después de la anterior · ${last.keywords} ${last.keywords === 1 ? "búsqueda comparada" : "búsquedas comparadas"}`,
              `Last: ${short.format(new Date(last.at))}, ${last.days === 1 ? "1 day" : `${last.days} days`} after the previous one · ${last.keywords} ${last.keywords === 1 ? "search compared" : "searches compared"}`,
            )}
          </span>
        </div>
      </div>
      <p className={level === "high" || level === "very-high" ? "note" : "note info"}>{lang === "en" ? advice.en : advice.es}</p>
      {last.moved.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="lbl">{t("Lo que más se movió", "What moved the most")}</span>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {last.moved.map((m) => (
              <li key={m.keyword}>
                <strong>{m.keyword}</strong> ({one.format(m.score)}/10)
                {m.entered.length > 0 && t(` · entró: ${m.entered.join(", ")}`, ` · came in: ${m.entered.join(", ")}`)}
                {m.left.length > 0 && t(` · salió: ${m.left.join(", ")}`, ` · dropped out: ${m.left.join(", ")}`)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <HowToRead title={t("Cómo leer el movimiento", "How to read the movement")}>
        <ul>
          <li>{t("0 a 2: tranquilo · 2 a 5: normal · 5 a 8: movido · 8 a 10: muy movido.", "0 to 2: calm · 2 to 5: normal · 5 to 8: shaky · 8 to 10: very shaky.")}</li>
          <li>
            {t(
              "Mide solo tus búsquedas, no todo Google. Entre más días pasan entre revisiones, más normal es que cambie: con la revisión automática de cada día se ve mejor.",
              "It only measures your searches, not all of Google. The more days between checks, the more normal it is to change: with the daily automatic check it shows best.",
            )}
          </li>
        </ul>
      </HowToRead>
    </section>
  );
}
