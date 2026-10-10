// Las partes del «Resumen de resultados» (componentes de servidor, sin JavaScript en el navegador).
import Link from "next/link";
import type { UiLang } from "@/lib/i18n";
import type { ResultsSummary } from "@/lib/results";
import type { Kpi, RankedPost } from "@/lib/results-shape";
import { HBars, Line, VBars } from "./Charts";
import { channelLabel, compact, dayLabel, dayShort, formatLabel, hourLabel, num, pct, shortDate, usd } from "./fmt";
import s from "./Results.module.css";

type Tr = (es: string, en: string) => string;
const tr = (lang: UiLang): Tr => (es, en) => (lang === "en" ? en : es);

// ---------- Números de arriba ----------

function Delta({ k, lang, days, lowerIsBetter = false }: { k: Kpi; lang: UiLang; days: number; lowerIsBetter?: boolean }) {
  const t = tr(lang);
  if (k.now === null) return null;
  if (k.prev === null) return <span className={s.delta}>{t("Sin datos para comparar", "Nothing to compare yet")}</span>;
  if (k.change === null) return <span className={s.delta}>{t(`Antes: ${num(k.prev, lang)}`, `Before: ${num(k.prev, lang)}`)}</span>;
  const good = lowerIsBetter ? k.change < 0 : k.change > 0;
  const cls = k.change === 0 ? s.delta : `${s.delta} ${good ? s.up : s.down}`;
  const arrow = k.change > 0 ? "▲" : k.change < 0 ? "▼" : "＝";
  return (
    <span className={cls}>
      {arrow} {num(Math.abs(k.change), lang)} % {t(`vs. ${days} días antes`, `vs. previous ${days} days`)}
    </span>
  );
}

function Tile({ label, value, sub, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className={s.kpi}>
      <span className={s.kpiLabel}>{label}</span>
      {value}
      {children}
      {sub && <span className={s.kpiSub}>{sub}</span>}
    </div>
  );
}

export function KpiGrid({ data, lang, days, bizId }: { data: ResultsSummary; lang: UiLang; days: number; bizId: string }) {
  const t = tr(lang);
  const k = data.kpis;
  const val = (v: number | null, fmt = (x: number) => num(x, lang)) => (v === null ? <span className={s.kpiEmpty}>—</span> : <span className={s.kpiValue}>{fmt(v)}</span>);
  const noSocial = data.channels.measured.length === 0;
  const ga4Sub = (r: { start: string; end: string }) => t(`Google Analytics, ${shortDate(r.start, lang, "UTC")} – ${shortDate(r.end, lang, "UTC")}`, `Google Analytics, ${shortDate(r.start, lang, "UTC")} – ${shortDate(r.end, lang, "UTC")}`);
  return (
    <section className={s.kpis} aria-label={t("Números principales", "Main numbers")}>
      <Tile label={t("Personas alcanzadas", "People reached")} value={val(k.reach.now)} sub={noSocial ? <Link href={`/b/${bizId}/conexiones`}>{t("Conecta Facebook o Instagram", "Connect Facebook or Instagram")}</Link> : undefined}>
        <Delta k={k.reach} lang={lang} days={days} />
      </Tile>
      <Tile label={t("Interacciones", "Interactions")} value={val(k.interactions.now)} sub={t("Me gusta, comentarios, compartidos y guardados", "Likes, comments, shares and saves")}>
        <Delta k={k.interactions} lang={lang} days={days} />
      </Tile>
      <Tile label={t("Clics", "Clicks")} value={val(k.clicks.now)}>
        <Delta k={k.clicks} lang={lang} days={days} />
      </Tile>
      <Tile
        label={t("Visitas a tu web", "Website visits")}
        value={val(k.webVisits?.now ?? null)}
        sub={k.webVisits ? ga4Sub(k.webVisits.range) : <Link href={`/b/${bizId}/seo`}>{t("Conecta Google Analytics", "Connect Google Analytics")}</Link>}
      >
        {k.webVisits && <Delta k={k.webVisits} lang={lang} days={28} />}
      </Tile>
      <Tile
        label={t("Llamadas y acciones en tu web", "Calls and actions on your site")}
        value={val(k.keyEvents?.now ?? null)}
        sub={k.keyEvents ? t("Acciones importantes de Google Analytics (28 días)", "Key events from Google Analytics (28 days)") : t("Necesita Google Analytics", "Needs Google Analytics")}
      >
        {k.keyEvents && <Delta k={k.keyEvents} lang={lang} days={28} />}
      </Tile>
      <Tile
        label={t("Reseñas nuevas", "New reviews")}
        value={val(k.reviews?.new.now ?? null)}
        sub={
          k.reviews ? (
            k.reviews.rating !== null ? t(`Nota en Google: ${num(k.reviews.rating, lang, 1)} ★ (${num(k.reviews.total ?? 0, lang)} reseñas)`, `Google rating: ${num(k.reviews.rating, lang, 1)} ★ (${num(k.reviews.total ?? 0, lang)} reviews)`) : undefined
          ) : (
            <Link href={`/b/${bizId}/seo`}>{t("Revisa tus reseñas de Google", "Check your Google reviews")}</Link>
          )
        }
      >
        {k.reviews && <Delta k={k.reviews.new} lang={lang} days={days} />}
      </Tile>
      <Tile
        label={t("Gasto en anuncios", "Ad spend")}
        value={val(k.adsSpentCents, (c) => usd(c, lang))}
        sub={
          k.adsSpentCents === null ? (
            <Link href={`/b/${bizId}/anuncios`}>{t("Sin anuncios pagados", "No paid ads")}</Link>
          ) : k.adsCostPerResultCents !== null ? (
            t(`${usd(k.adsCostPerResultCents, lang)} por resultado`, `${usd(k.adsCostPerResultCents, lang)} per result`)
          ) : (
            t("Todavía sin resultados", "No results yet")
          )
        }
      />
      <Tile label={t("Publicaciones hechas", "Posts made")} value={val(k.posts.now)} sub={k.posts.now === 0 ? <Link href={`/b/${bizId}/publicar`}>{t("Haz tu primera publicación", "Make your first post")}</Link> : undefined}>
        <Delta k={k.posts} lang={lang} days={days} />
      </Tile>
    </section>
  );
}

// ---------- Semana a semana ----------

export function TrendPanel({ data, lang }: { data: ResultsSummary; lang: UiLang }) {
  const t = tr(lang);
  const { unit, items } = data.series;
  const many = items.length > 8;
  const label = (day: string) => shortDate(`${day}T12:00:00Z`, lang, "UTC");
  const bars = (key: "reach" | "interactions") =>
    items.map((b, i) => ({
      label: unit === "week" ? t(`Semana del ${label(b.start)}`, `Week of ${label(b.start)}`) : label(b.start),
      tick: many && i % 2 === 1 ? "" : label(b.start),
      value: b[key],
      tip: `${label(b.start)}: ${num(b[key], lang)} · ${t(`${b.posts} publ.`, `${b.posts} posts`)}`,
    }));
  const x = unit === "week" ? t("Semana (por la fecha en que se publicó)", "Week (by the date it was posted)") : t("Día en que se publicó", "Day it was posted");
  const table = t("Ver como tabla", "View as table");
  const axisNum = (v: number) => (v >= 10000 ? compact(v, lang) : num(v, lang));
  const when = unit === "week" ? t("Semana", "Week") : t("Día", "Day");
  return (
    <section className="card">
      <div className="stack">
        <h2 className={s.sectionTitle}>{unit === "week" ? t("Cómo te fue semana a semana", "How you did week by week") : t("Cómo te fue día a día", "How you did day by day")}</h2>
        <p className={s.sectionSub}>
          {unit === "week"
            ? t("Lo que lograron las publicaciones de cada semana. Las más nuevas siguen sumando unos días.", "What each week's posts achieved. The newest ones keep adding up for a few days.")
            : t("Lo que lograron las publicaciones de cada día. Las más nuevas siguen sumando unos días.", "What each day's posts achieved. The newest ones keep adding up for a few days.")}
        </p>
      </div>
      {items.some((b) => b.reach || b.interactions) ? (
        <div className={s.grid2}>
          <VBars items={bars("reach")} minMax={4} title={t("Personas alcanzadas", "People reached")} yLabel={t("Personas", "People")} xLabel={x} fmt={axisNum} tableHead={[when, t("Personas", "People")]} tableLabel={table} />
          <VBars items={bars("interactions")} minMax={4} tone="b" title={t("Interacciones", "Interactions")} yLabel={t("Interacciones", "Interactions")} xLabel={x} fmt={axisNum} tableHead={[when, t("Interacciones", "Interactions")]} tableLabel={table} />
        </div>
      ) : (
        <p className="muted small">
          {items.some((b) => b.posts)
            ? t("Tus publicaciones de este periodo todavía no tienen resultados. Se leen 1 hora después de publicar.", "Your posts in this period have no results yet. They're read 1 hour after posting.")
            : t("No hubo publicaciones en este periodo.", "There were no posts in this period.")}
        </p>
      )}
    </section>
  );
}

// ---------- Por canal, formato y campaña ----------

export function ChannelPanel({ data, lang }: { data: ResultsSummary; lang: UiLang }) {
  const t = tr(lang);
  const rows = data.byChannel;
  return (
    <section className="card">
      <h2 className={s.sectionTitle}>{t("Por red", "By channel")}</h2>
      {rows.length === 0 ? (
        <p className="muted small">{t("Todavía no hay publicaciones en este periodo.", "No posts in this period yet.")}</p>
      ) : (
        <HBars
          ariaLabel={t("Personas alcanzadas por red", "People reached by channel")}
          items={rows.map((g) => {
            const measured = data.channels.measured.includes(g.key);
            return {
              key: g.key,
              label: channelLabel(g.key, lang),
              value: g.reach,
              valueText: measured && g.measured ? t(`${num(g.reach, lang)} personas`, `${num(g.reach, lang)} people`) : t(`${g.posts} publ.`, `${g.posts} ${g.posts === 1 ? "post" : "posts"}`),
              sub: measured
                ? g.measured
                  ? t(`${g.posts} ${g.posts === 1 ? "publicación" : "publicaciones"} · ${num(g.interactions, lang)} interacciones · ${pct(g.rate, lang)} interactúa`, `${g.posts} ${g.posts === 1 ? "post" : "posts"} · ${num(g.interactions, lang)} interactions · ${pct(g.rate, lang)} engage`)
                  : t(`${g.posts} ${g.posts === 1 ? "publicación" : "publicaciones"} · resultados en camino (se leen 1 h después de publicar)`, `${g.posts} ${g.posts === 1 ? "post" : "posts"} · results on the way (read 1 h after posting)`)
                : t(`${g.posts} ${g.posts === 1 ? "publicación" : "publicaciones"} · esta red no da resultados a la app`, `${g.posts} ${g.posts === 1 ? "post" : "posts"} · this channel doesn't give results to the app`),
            };
          })}
        />
      )}
    </section>
  );
}

export function GroupPanel({ data, lang, kind }: { data: ResultsSummary; lang: UiLang; kind: "format" | "campaign" }) {
  const t = tr(lang);
  const rows = kind === "format" ? data.byFormat : data.byCampaign;
  const title = kind === "format" ? t("Por formato", "By format") : t("Por campaña", "By campaign");
  const ads = new Map<string, number>();
  for (const a of data.ads?.items ?? []) ads.set(a.campaignId, (ads.get(a.campaignId) ?? 0) + a.spentCents);
  return (
    <section className="card">
      <h2 className={s.sectionTitle}>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted small">
          {kind === "format"
            ? t("Faltan publicaciones con resultados para comparar formatos.", "Not enough posts with results to compare formats.")
            : t("Ninguna publicación de este periodo es de una campaña.", "No post in this period belongs to a campaign.")}
        </p>
      ) : (
        <HBars
          tone="b"
          ariaLabel={kind === "format" ? t("Tasa de interacción por formato", "Engagement rate by format") : t("Personas alcanzadas por campaña", "People reached by campaign")}
          items={rows.map((g) => ({
            key: g.key,
            label: kind === "format" ? formatLabel(g.key, lang) : g.label || t("Campaña", "Campaign"),
            value: kind === "format" ? (g.rate ?? 0) : g.reach,
            valueText: kind === "format" ? t(`${pct(g.rate, lang)} interactúa`, `${pct(g.rate, lang)} engage`) : t(`${num(g.reach, lang)} personas`, `${num(g.reach, lang)} people`),
            sub:
              kind === "format"
                ? t(`${g.posts} ${g.posts === 1 ? "publicación" : "publicaciones"} · ${num(g.reach, lang)} personas`, `${g.posts} ${g.posts === 1 ? "post" : "posts"} · ${num(g.reach, lang)} people`)
                : [t(`${g.posts} ${g.posts === 1 ? "publicación" : "publicaciones"} · ${num(g.interactions, lang)} interacciones`, `${g.posts} ${g.posts === 1 ? "post" : "posts"} · ${num(g.interactions, lang)} interactions`), ads.get(g.key) ? t(`anuncios: ${usd(ads.get(g.key)!, lang)}`, `ads: ${usd(ads.get(g.key)!, lang)}`) : ""]
                    .filter(Boolean)
                    .join(" · "),
          }))}
        />
      )}
    </section>
  );
}

// ---------- Mejores y peores ----------

/** Lo que se ve en lugar de la foto cuando no hay (video sin portada, solo texto…). */
const THUMB_MARK: Record<string, string> = { text: "Aa", video: "▶", story: "9:16", carousel: "▦" };

function PostItem({ p, i, lang, tz }: { p: RankedPost; i: number; lang: UiLang; tz: string }) {
  const t = tr(lang);
  return (
    <li className={s.post}>
      {p.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={s.thumb} src={p.thumb} alt="" loading="lazy" />
      ) : (
        <span className={s.thumb} aria-hidden="true">
          {THUMB_MARK[p.format] ?? formatLabel(p.format, lang)}
        </span>
      )}
      <div className={s.postBody}>
        <span className={s.postText}>
          <span className={s.rank}>{i + 1}. </span>
          {p.text || t("(sin texto)", "(no text)")}
        </span>
        <span className={s.postMeta}>
          <span>{channelLabel(p.channel, lang)}</span>
          <span>{formatLabel(p.format, lang)}</span>
          <span>{shortDate(p.sentAt, lang, tz)}</span>
          {p.url && (
            <a href={p.url} target="_blank" rel="noopener noreferrer">
              {t("Ver publicación", "View post")}
            </a>
          )}
        </span>
        <span className={s.postStats}>
          <span>
            <b>{pct(p.rate, lang)}</b> {t("interactúa", "engage")}
          </span>
          <span>{t(`${num(p.reach, lang)} personas`, `${num(p.reach, lang)} people`)}</span>
          <span>{t(`${num(p.interactions, lang)} interacciones`, `${num(p.interactions, lang)} interactions`)}</span>
          {p.clicks > 0 && <span>{t(`${num(p.clicks, lang)} clics`, `${num(p.clicks, lang)} clicks`)}</span>}
        </span>
      </div>
    </li>
  );
}

export function PostsPanel({ data, lang }: { data: ResultsSummary; lang: UiLang }) {
  const t = tr(lang);
  return (
    <div className={s.grid2}>
      <section className="card">
        <div className="stack">
          <h2 className={s.sectionTitle}>{t("Lo que mejor funcionó", "What worked best")}</h2>
          <p className={s.sectionSub}>{t("Las 5 publicaciones donde más gente interactuó (de cada 100 personas que la vieron).", "The 5 posts where the most people interacted (out of every 100 who saw it).")}</p>
        </div>
        {data.best.length ? (
          <ol className={s.posts}>
            {data.best.map((p, i) => (
              <PostItem key={p.targetId} p={p} i={i} lang={lang} tz={data.tz} />
            ))}
          </ol>
        ) : (
          <p className="muted small">{t("Todavía no hay publicaciones con resultados (al menos 10 personas alcanzadas).", "No posts with results yet (at least 10 people reached).")}</p>
        )}
      </section>
      <section className="card">
        <div className="stack">
          <h2 className={s.sectionTitle}>{t("Lo que menos funcionó", "What worked least")}</h2>
          <p className={s.sectionSub}>{t("Para aprender: qué tema, foto u hora no conectó.", "To learn from: which topic, photo or time didn't connect.")}</p>
        </div>
        {data.worst.length ? (
          <ol className={s.posts}>
            {data.worst.map((p, i) => (
              <PostItem key={p.targetId} p={p} i={i} lang={lang} tz={data.tz} />
            ))}
          </ol>
        ) : (
          <p className="muted small">{t("Se muestra cuando hay más de 5 publicaciones con resultados.", "Shown once there are more than 5 posts with results.")}</p>
        )}
      </section>
    </div>
  );
}

// ---------- Mejor día y hora ----------

export function TimingPanel({ data, lang }: { data: ResultsSummary; lang: UiLang }) {
  const t = tr(lang);
  const tm = data.timing;
  const table = t("Ver como tabla", "View as table");
  return (
    <section className="card">
      <div className="stack">
        <h2 className={s.sectionTitle}>{t("Mejor día y hora para publicar", "Best day and time to post")}</h2>
        <p className={s.sectionSub}>{t("Según cuánta gente interactuó con lo que publicaste a esa hora (hora de tu negocio).", "Based on how many people interacted with what you posted at that time (your business's time).")}</p>
      </div>
      {!tm.enough ? (
        <p className="note info">
          {t(
            `Faltan datos: hacen falta al menos 10 publicaciones con resultados en este periodo (hay ${tm.measured}). Prueba con 90 días o sigue publicando.`,
            `Not enough data yet: at least 10 posts with results are needed in this period (there are ${tm.measured}). Try 90 days or keep posting.`,
          )}
        </p>
      ) : (
        <>
          <div className={s.verdict}>
            <div>
              <span className="small muted">{t("Mejor día", "Best day")}</span>
              <b>{tm.bestDay !== null ? dayLabel(tm.bestDay, lang) : t("Faltan datos", "Not enough data")}</b>
            </div>
            <div>
              <span className="small muted">{t("Mejor hora", "Best time")}</span>
              <b>{tm.bestHour !== null ? hourLabel(tm.bestHour, lang) : t("Faltan datos", "Not enough data")}</b>
            </div>
          </div>
          <div className={s.grid2}>
            <VBars
              title={t("Interacción promedio por día", "Average engagement by day")}
              yLabel={t("% que interactúa", "% who engage")}
              xLabel={t("Día de la semana", "Day of the week")}
              fmt={(v) => `${num(v * 100, lang, 1)}%`}
              tableHead={[t("Día", "Day"), t("% que interactúa", "% who engage")]}
              tableLabel={table}
              items={[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const slot = tm.days[d];
                return {
                  label: dayLabel(d, lang),
                  tick: dayShort(d, lang),
                  value: slot.rate ?? 0,
                  tip: `${dayLabel(d, lang)}: ${pct(slot.rate, lang)} · ${t(`${slot.posts} publ.`, `${slot.posts} posts`)}`,
                };
              })}
            />
            <VBars
              tone="b"
              title={t("Interacción promedio por hora", "Average engagement by time")}
              yLabel={t("% que interactúa", "% who engage")}
              xLabel={t("Hora en que se publicó (solo las horas con publicaciones)", "Time it was posted (only times with posts)")}
              fmt={(v) => `${num(v * 100, lang, 1)}%`}
              tableHead={[t("Hora", "Time"), t("% que interactúa", "% who engage")]}
              tableLabel={table}
              items={tm.hours
                .filter((h) => h.posts > 0)
                .map((h) => ({ label: hourLabel(h.key, lang), value: h.rate ?? 0, tip: `${hourLabel(h.key, lang)}: ${pct(h.rate, lang)} · ${t(`${h.posts} publ.`, `${h.posts} posts`)}` }))}
            />
          </div>
        </>
      )}
    </section>
  );
}

// ---------- Anuncios ----------

const GOAL: Record<string, [string, string]> = {
  awareness: ["Que te conozcan", "Awareness"],
  traffic: ["Visitas a la web", "Website visits"],
  engagement: ["Interacción", "Engagement"],
  messages: ["Mensajes", "Messages"],
  calls: ["Llamadas", "Calls"],
};

export function AdsPanel({ data, lang, bizId }: { data: ResultsSummary; lang: UiLang; bizId: string }) {
  const t = tr(lang);
  const a = data.ads;
  return (
    <section className="card">
      <div className="row between">
        <h2 className={s.sectionTitle}>{t("Anuncios pagados", "Paid ads")}</h2>
        <Link className="btn link" href={`/b/${bizId}/anuncios`}>
          {t("Ver anuncios", "See ads")}
        </Link>
      </div>
      {!a || a.count === 0 ? (
        <p className="muted small">{t("No tuviste anuncios pagados en este periodo. Tus publicaciones gratis siguen contando arriba.", "You had no paid ads in this period. Your free posts still count above.")}</p>
      ) : (
        <>
          <p className="small muted">{t("Lo gastado y los resultados son desde que empezó cada anuncio (así lo da Meta).", "Spend and results are since each ad started (that's how Meta reports them).")}</p>
          <div className={s.verdict}>
            <div>
              <span className="small muted">{t("Gastado", "Spent")}</span>
              <b>{usd(a.spentCents, lang)}</b>
            </div>
            <div>
              <span className="small muted">{t("Resultados", "Results")}</span>
              <b>{num(a.results, lang)}</b>
            </div>
            <div>
              <span className="small muted">{t("Costo por resultado", "Cost per result")}</span>
              <b>{a.costPerResultCents !== null ? usd(a.costPerResultCents, lang) : "—"}</b>
            </div>
            <div>
              <span className="small muted">{t("Personas alcanzadas", "People reached")}</span>
              <b>{num(a.reach, lang)}</b>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Anuncio", "Ad")}</th>
                  <th>{t("Objetivo", "Goal")}</th>
                  <th>{t("Gastado", "Spent")}</th>
                  <th>{t("Resultados", "Results")}</th>
                  <th>{t("Por resultado", "Per result")}</th>
                </tr>
              </thead>
              <tbody>
                {a.items.slice(0, 8).map((x, i) => (
                  <tr key={i}>
                    <td>
                      {x.name}
                      <div className="small muted">{x.campaign}</div>
                    </td>
                    <td>{GOAL[x.goal] ? GOAL[x.goal][lang === "en" ? 1 : 0] : x.goal}</td>
                    <td>{usd(x.spentCents, lang)}</td>
                    <td>{num(x.results, lang)}</td>
                    <td>{x.costPerResultCents !== null ? usd(x.costPerResultCents, lang) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

// ---------- Google ----------

export function GooglePanel({ data, lang, bizId }: { data: ResultsSummary; lang: UiLang; bizId: string }) {
  const t = tr(lang);
  const r = data.google.rank;
  const o = data.google.organic;
  const pos = (p: number | null) => (p === null ? t("fuera del top 20", "not in top 20") : `#${p}`);
  return (
    <div className={s.grid2}>
      <section className="card">
        <div className="row between">
          <h2 className={s.sectionTitle}>{t("Tu lugar en Google", "Your spot on Google")}</h2>
          <Link className="btn link" href={`/b/${bizId}/seo`}>
            {t("Ver SEO", "See SEO")}
          </Link>
        </div>
        {!r ? (
          <p className="muted small">{t("Todavía no hay revisiones de tus posiciones en Google. Agrega tus palabras clave en SEO.", "No checks of your Google positions yet. Add your keywords in SEO.")}</p>
        ) : (
          <>
            <div className={s.verdict}>
              <div>
                <span className="small muted">{t("Posición promedio", "Average position")}</span>
                <b>{r.now.avgPosition !== null ? `#${num(r.now.avgPosition, lang, 1)}` : "—"}</b>
              </div>
              <div>
                <span className="small muted">{t("En los 3 primeros", "In the top 3")}</span>
                <b>{num(r.now.inTop3, lang)}</b>
              </div>
              <div>
                <span className="small muted">{t("En la primera página", "On page one")}</span>
                <b>{num(r.now.inTop10, lang)}</b>
              </div>
            </div>
            <p className="small muted">
              {r.prev
                ? t(`Revisión del ${shortDate(r.now.at, lang, data.tz)} comparada con la del ${shortDate(r.prev.at, lang, data.tz)}.`, `Check of ${shortDate(r.now.at, lang, data.tz)} compared with ${shortDate(r.prev.at, lang, data.tz)}.`)
                : t(`Revisión del ${shortDate(r.now.at, lang, data.tz)} (todavía no hay una anterior para comparar).`, `Check of ${shortDate(r.now.at, lang, data.tz)} (no earlier check to compare yet).`)}
            </p>
            <ul className={s.moves}>
              {r.moves.slice(0, 6).map((m) => (
                <li key={m.keyword} className={s.move}>
                  <span>{m.keyword}</span>
                  <span className={m.moved ? (m.moved > 0 ? s.up : s.down) : undefined}>
                    {pos(m.now)}
                    {m.moved ? ` ${m.moved > 0 ? "▲" : "▼"} ${Math.abs(m.moved)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="card">
        <h2 className={s.sectionTitle}>{t("Visitas desde Google (gratis)", "Visits from Google (free)")}</h2>
        {!o ? (
          <p className="muted small">{t("Conecta Google Analytics en SEO para ver cuánta gente llega a tu web desde Google.", "Connect Google Analytics in SEO to see how many people reach your site from Google.")}</p>
        ) : (
          <>
            <p className="small muted">{t(`${num(o.total, lang)} visitas en los últimos 28 días guardados.`, `${num(o.total, lang)} visits in the last 28 saved days.`)}</p>
            <Line
              title={t("Visitas por día desde la búsqueda de Google", "Visits per day from Google search")}
              yLabel={t("Visitas", "Visits")}
              fmt={(v) => num(v, lang)}
              first={o.days[0] ? shortDate(`${o.days[0].date}T12:00:00Z`, lang, "UTC") : ""}
              last={o.days.length ? shortDate(`${o.days[o.days.length - 1].date}T12:00:00Z`, lang, "UTC") : ""}
              points={o.days.map((d) => ({ label: shortDate(`${d.date}T12:00:00Z`, lang, "UTC"), value: d.sessions }))}
              tableHead={[t("Día", "Day"), t("Visitas", "Visits")]}
              tableLabel={t("Ver como tabla", "View as table")}
            />
          </>
        )}
      </section>
    </div>
  );
}
