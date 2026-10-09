// El reporte de un periodo convertido en secciones para mostrar (títulos, números, listas y tablas en un idioma).
// Las tres salidas usan esto mismo: el email diario, la pantalla /b/<id>/reportes y el PDF, así dicen lo mismo.
// También están «Lo más importante» sin IA (3 frases) y los datos que se le pasan a la IA para escribirlas.
import { money } from "@/lib/ads-shape";
import { modeLabel, statusLabel } from "@/lib/campaign-shape";
import type { RankAlert } from "@/lib/seo/alerts";
import { fmtDateTime, fmtTime } from "@/lib/time";
import { channelLabel, isQuiet, isSingleDay, periodText, prevText, type PeriodReport } from "@/lib/report-period";

type Lang = "es" | "en";
export type ViewTone = "good" | "bad" | "neutral";
export type ViewStat = { label: string; value: string; sub?: string; tone?: ViewTone };
/** `href`: link de la app ("/b/…", el email le pone la dirección completa) o de afuera ("https://…"). */
export type ViewItem = { text: string; tone?: ViewTone; href?: string; linkText?: string; meta?: string };
export type ViewTable = { head: string[]; rows: string[][]; links?: (string | null)[] };
export type ViewSection = {
  id: string;
  title: string;
  note?: string;
  stats?: ViewStat[];
  items?: ViewItem[];
  table?: ViewTable;
  /** "y 12 más en la app". */
  more?: string;
  /** Dónde verlo en la app. */
  href?: string;
  hrefText?: string;
};

const tr = (lang: Lang) => (es: string, en: string) => (lang === "en" ? en : es);
const nf = (lang: Lang) => new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { maximumFractionDigits: 1 });
const quote = (s: string, lang: Lang) => (lang === "en" ? `"${s}"` : `«${s}»`);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "antes 3" / "igual que antes" / "before: 3": la comparación con el periodo anterior. */
function vsText(now: number, before: number | null | undefined, lang: Lang, fmt: (n: number) => string = String): string | undefined {
  if (before === null || before === undefined) return undefined;
  const t = tr(lang);
  if (now === before) return t("igual que antes", "same as before");
  return t(`antes: ${fmt(before)}`, `before: ${fmt(before)}`);
}
const toneOf = (now: number, before: number | null | undefined, lowerIsBetter = false): ViewTone => {
  if (before === null || before === undefined || now === before) return "neutral";
  return (now > before) !== lowerIsBetter ? "good" : "bad";
};

/** Hora (un solo día) o fecha y hora (un periodo) en la hora del negocio. */
const whenFn = (r: PeriodReport, lang: Lang) => (s: string) => (isSingleDay(r.period) ? fmtTime(s, lang, r.period.tz) : fmtDateTime(s, lang, r.period.tz));

export function describeRank(a: RankAlert & { zone?: string }, lang: Lang, many = false): string {
  const t = tr(lang);
  const kw = quote(a.keyword, lang);
  const where = many && a.zone ? ` (${a.zone})` : "";
  const fromTo = a.to === null ? t(`del lugar ${a.from} a fuera de los primeros 20`, `from #${a.from} to outside the top 20`) : t(`del lugar ${a.from} al ${a.to}`, `from #${a.from} to #${a.to}`);
  switch (a.kind) {
    case "page1-exit":
      return t(`${kw}: saliste de la primera página de Google (${fromTo})${where}.`, `${kw}: you dropped off Google's first page (${fromTo})${where}.`);
    case "drop":
      return t(`${kw}: bajaste ${fromTo}${where}.`, `${kw}: you dropped ${fromTo}${where}.`);
    case "map-exit":
      return t(`${kw}: ya no sales entre los 3 negocios del mapa${where}.`, `${kw}: you're no longer in the map's top 3${where}.`);
    case "new-competitor":
      return t(`${kw}: ${a.domain} entró al top 3 (lugar ${a.to}), por encima de ti${where}.`, `${kw}: ${a.domain} entered the top 3 (#${a.to}), above you${where}.`);
    case "top3-enter":
      return t(`${kw}: ¡entraste al top 3! Ahora estás en el lugar ${a.to}${where}.`, `${kw}: you made the top 3! You're now #${a.to}${where}.`);
    case "climb":
      return a.from === null
        ? t(`${kw}: ahora sales en el lugar ${a.to} (antes no salías en los primeros 20)${where}.`, `${kw}: you now show at #${a.to} (you weren't in the top 20 before)${where}.`)
        : t(`${kw}: subiste del lugar ${a.from} al ${a.to}${where}.`, `${kw}: you climbed from #${a.from} to #${a.to}${where}.`);
    case "map-enter":
      return t(`${kw}: ahora sales entre los 3 del mapa (lugar ${a.to})${where}.`, `${kw}: you're now in the map's top 3 (#${a.to})${where}.`);
  }
}

const stars = (n: number | null) => (n ? "★".repeat(Math.max(1, Math.min(5, Math.round(n)))) : "");

/** Todas las secciones con datos, en el orden en que se muestran. */
export function reportSections(r: PeriodReport, lang: Lang): ViewSection[] {
  const t = tr(lang);
  const n = nf(lang);
  const when = whenFn(r, lang);
  const base = `/b/${r.business.id}`;
  const prev = prevText(r.period, lang);
  const out: ViewSection[] = [];

  if (r.alerts) {
    out.push({
      id: "alerts",
      title: t("Necesita tu atención", "Needs your attention"),
      items: r.alerts.items.map((a) => ({ text: a.text[lang], tone: a.tone, href: a.href, linkText: t("Ver", "View"), meta: when(a.at) })),
    });
  }

  if (r.posts) {
    const p = r.posts;
    const statusText = (s: string) => (s === "sent" ? t("Publicado", "Posted") : s === "failed" ? t("No salió", "Didn't go out") : t("Se saltó", "Skipped"));
    out.push({
      id: "posts",
      title: t("Publicaciones", "Posts"),
      stats: [
        { label: t("Publicadas", "Posted"), value: n.format(p.sent), sub: vsText(p.sent, p.prevSent, lang), tone: toneOf(p.sent, p.prevSent) },
        ...(p.failed ? [{ label: t("No salieron", "Didn't go out"), value: n.format(p.failed), tone: "bad" as const }] : []),
        ...(p.skipped ? [{ label: t("Se saltaron", "Skipped"), value: n.format(p.skipped) }] : []),
      ],
      items: p.items.map((i) => ({
        text: `${channelLabel(i.channel, lang)}: ${i.title || t("(sin texto)", "(no text)")}`,
        tone: i.status === "sent" ? "good" : i.status === "failed" ? "bad" : "neutral",
        href: i.url || undefined,
        linkText: i.url ? t("Ver publicación", "View post") : undefined,
        meta: [statusText(i.status), when(i.at), i.detail].filter(Boolean).join(" · "),
      })),
      note: p.skipped
        ? t("«Se saltó» no es un error: el canal no está conectado o no aplica (por ejemplo, fotos en TikTok).", "\"Skipped\" isn't an error: the channel isn't connected or doesn't apply (for example, photos on TikTok).")
        : undefined,
      more: p.sent + p.failed + p.skipped > p.items.length ? t(`y ${p.sent + p.failed + p.skipped - p.items.length} más en el historial`, `and ${p.sent + p.failed + p.skipped - p.items.length} more in the history`) : undefined,
      href: `${base}/historial`,
      hrefText: t("Ver el historial", "See the history"),
    });
  }

  if (r.results) {
    const x = r.results;
    out.push({
      id: "results",
      title: t("Cómo les fue a tus publicaciones", "How your posts did"),
      note: x.last7
        ? t("De tus publicaciones de los últimos 7 días (los números siguen subiendo los primeros días).", "From your posts in the last 7 days (the numbers keep growing for the first few days).")
        : t("El último dato de cada publicación del periodo.", "The latest numbers for each post in the period."),
      stats: [
        { label: t("Personas alcanzadas", "People reached"), value: n.format(x.totals.reach) },
        { label: t("Interacciones", "Interactions"), value: n.format(x.totals.interactions), sub: t("me gusta, comentarios, compartidos y guardados", "likes, comments, shares and saves") },
        ...(x.totals.clicks ? [{ label: t("Clics", "Clicks"), value: n.format(x.totals.clicks) }] : []),
        ...(x.totals.videoViews ? [{ label: t("Vistas de video", "Video views"), value: n.format(x.totals.videoViews) }] : []),
      ],
      table: {
        head: [t("Publicación", "Post"), t("Alcance", "Reach"), t("Interacciones", "Interactions"), t("Clics", "Clicks")],
        rows: x.rows.map((row) => [`${channelLabel(row.channel, lang)}: ${row.title}`, n.format(row.reach), n.format(row.interactions), n.format(row.clicks)]),
        links: x.rows.map((row) => row.url || null),
      },
      href: `${base}/resultados`,
      hrefText: t("Ver todos los resultados", "See all results"),
    });
  }

  if (r.campaigns) {
    const items: ViewItem[] = [];
    for (const c of r.campaigns.items) {
      const parts = [
        c.published ? t(`${c.published} ${plural(c.published, "publicada", "publicadas")}`, `${c.published} posted`) : "",
        c.prepared ? t(`${c.prepared} ${plural(c.prepared, "preparada", "preparadas")} por la IA`, `${c.prepared} prepared by the AI`) : "",
        c.limits ? t(`${c.limits} ${plural(c.limits, "vez", "veces")} frenada por sus límites`, `held back by its limits ${c.limits} ${plural(c.limits, "time", "times")}`) : "",
      ].filter(Boolean);
      items.push({
        text: `${c.name} — ${statusLabel(c.status, lang)}, ${modeLabel(c.mode, lang)}${parts.length ? `: ${parts.join(", ")}` : `: ${t("sin movimiento en este periodo", "no activity in this period")}`}.`,
        tone: c.status === "active" ? "good" : c.status === "paused" || c.status === "stopped" ? "bad" : "neutral",
        href: `${base}/campanas/${c.id}`,
        linkText: t("Abrir", "Open"),
      });
      for (const e of c.events) items.push({ text: e.summary[lang], meta: when(e.at), tone: e.kind === "campaign.paused" || e.kind === "campaign.stopped" ? "bad" : "neutral" });
    }
    out.push({ id: "campaigns", title: t("Campañas", "Campaigns"), items });
  }

  if (r.ai) {
    const a = r.ai;
    out.push({
      id: "ai",
      title: t("Lo que hizo la IA sola", "What the AI did on its own"),
      stats: [
        { label: t("Acciones", "Actions"), value: n.format(a.total), sub: vsText(a.total, a.prevTotal, lang) },
        { label: t("Costo", "Cost"), value: money(a.costCents) },
        ...(a.approved ? [{ label: t("Aprobadas por ti", "Approved by you"), value: n.format(a.approved) }] : []),
      ],
      items: a.items.map((i) => ({
        text: i.summary[lang],
        meta: [when(i.at), i.campaign, i.costCents ? money(i.costCents) : ""].filter(Boolean).join(" · "),
      })),
      more: a.total > a.items.length ? t(`y ${a.total - a.items.length} más en el registro`, `and ${a.total - a.items.length} more in the log`) : undefined,
      href: `${base}/registro`,
      hrefText: t("Ver el registro completo", "See the full log"),
    });
  }

  if (r.ads) {
    const a = r.ads;
    const cumulative = a.rows.some((x) => x.cumulative);
    const acc = t(" (acumulado)", " (to date)");
    out.push({
      id: "ads",
      title: t("Anuncios pagados", "Paid ads"),
      stats: [
        ...(a.rows.some((x) => !x.cumulative)
          ? [
              { label: t("Gastado", "Spent"), value: money(a.spentCents) },
              { label: t("Resultados", "Results"), value: n.format(a.results), sub: t("llamadas, mensajes, clics… según el objetivo", "calls, messages, clicks… depending on the goal") },
            ]
          : []),
        ...(cumulative ? [{ label: t("Gastado (acumulado)", "Spent (to date)"), value: money(a.cumulativeCents) }] : []),
      ],
      table: {
        head: [t("Anuncio", "Ad"), t("Gastado", "Spent"), t("Resultados", "Results"), t("Alcance", "Reach")],
        rows: a.rows.map((x) => [`${x.name} (${x.campaign})`, `${money(x.spentCents)}${x.cumulative ? acc : ""}`, `${n.format(x.results)} ${x.resultLabel[lang]}`, n.format(x.reach)]),
      },
      note: [
        cumulative
          ? t(
              "«Acumulado» = desde que empezó el anuncio: Meta solo da el total y todavía no hay un reporte diario anterior con qué restar para saber solo lo de este periodo.",
              "\"To date\" = since the ad started: Meta only gives the total and there's no earlier daily report yet to subtract and get just this period.",
            )
          : "",
        a.readAt ? t(`Números de Meta leídos el ${fmtDateTime(a.readAt, lang, r.period.tz)}.`, `Meta numbers read on ${fmtDateTime(a.readAt, lang, r.period.tz)}.`) : "",
      ]
        .filter(Boolean)
        .join(" "),
      href: `${base}/anuncios`,
      hrefText: t("Ver los anuncios", "See the ads"),
    });
  }

  if (r.reviews) {
    const v = r.reviews;
    out.push({
      id: "reviews",
      title: t("Reseñas en Google", "Google reviews"),
      stats: [
        ...(v.newCount !== null ? [{ label: t("Reseñas nuevas", "New reviews"), value: n.format(v.newCount), tone: v.newCount ? ("good" as const) : undefined }] : []),
        ...(v.rating !== null ? [{ label: t("Calificación", "Rating"), value: `${n.format(v.rating)} ★` }] : []),
        ...(v.total !== null ? [{ label: t("Reseñas en total", "Total reviews"), value: n.format(v.total) }] : []),
      ],
      items: v.items.map((i) => ({
        text: `${stars(i.rating)} ${i.name}${i.text ? `: ${i.text}` : ""}`.trim(),
        tone: i.rating !== null && i.rating <= 2 ? "bad" : i.rating !== null && i.rating >= 4 ? "good" : "neutral",
        meta: [when(i.at), i.answered ? t("respondida", "answered") : t("sin responder", "not answered yet")].join(" · "),
        href: i.url || undefined,
        linkText: i.url ? t("Ver", "View") : undefined,
      })),
      note: v.stale
        ? t(`Revisadas por última vez el ${fmtDateTime(v.checkedAt, lang, r.period.tz)}: puede haber reseñas más nuevas.`, `Last checked on ${fmtDateTime(v.checkedAt, lang, r.period.tz)}: there may be newer reviews.`)
        : undefined,
      href: `${base}/seo?tab=local#perfil`,
      hrefText: t("Responder reseñas", "Reply to reviews"),
    });
  }

  if (r.web) {
    const w = r.web;
    const fmtDay = (d: string) => new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
    out.push({
      id: "web",
      title: t("Visitas a tu página web", "Visits to your website"),
      stats: [
        ...(w.organic !== null
          ? [{ label: t("Visitas desde Google (gratis)", "Visits from Google (free)"), value: n.format(w.organic), sub: vsText(w.organic, w.prevOrganic, lang), tone: toneOf(w.organic, w.prevOrganic) }]
          : []),
        { label: t(`Visitas (${fmtDay(w.window.start)} – ${fmtDay(w.window.end)})`, `Visits (${fmtDay(w.window.start)} – ${fmtDay(w.window.end)})`), value: n.format(w.window.sessions), sub: vsText(w.window.sessions, w.window.prevSessions, lang), tone: toneOf(w.window.sessions, w.window.prevSessions) },
        { label: t("Personas", "People"), value: n.format(w.window.users) },
        ...(w.window.keyEvents ? [{ label: t("Acciones importantes", "Key actions"), value: n.format(w.window.keyEvents), sub: t("llamadas, formularios…", "calls, forms…") }] : []),
      ],
      note:
        w.organic !== null
          ? t(
              `Las visitas desde Google son de estos días. El resto es de los 28 días que da Google Analytics (${fmtDay(w.window.start)} al ${fmtDay(w.window.end)}).`,
              `Visits from Google are for these days. The rest covers the 28 days Google Analytics gives (${fmtDay(w.window.start)} to ${fmtDay(w.window.end)}).`,
            )
          : t(
              `Google Analytics da los números de 28 días: estos son del ${fmtDay(w.window.start)} al ${fmtDay(w.window.end)}, no solo de este periodo.`,
              `Google Analytics gives 28-day numbers: these are from ${fmtDay(w.window.start)} to ${fmtDay(w.window.end)}, not just this period.`,
            ),
      href: `${base}/seo?tab=web#ga4`,
      hrefText: t("Ver las visitas", "See the visits"),
    });
  }

  if (r.rankings) {
    const k = r.rankings;
    const many = k.zones.length > 1;
    out.push({
      id: "rankings",
      title: t("Tus posiciones en Google", "Your Google rankings"),
      stats: k.zones.flatMap((z) => [
        {
          label: many ? t(`Posición promedio · ${z.label}`, `Average position · ${z.label}`) : t("Posición promedio", "Average position"),
          value: z.avgPosition === null ? "—" : n.format(z.avgPosition),
          sub: z.avgPosition !== null && z.prevAvg !== null ? vsText(z.avgPosition, z.prevAvg, lang, (x) => n.format(x)) : undefined,
          tone: z.avgPosition !== null ? toneOf(z.avgPosition, z.prevAvg, true) : undefined,
        },
        { label: many ? t(`En la primera página · ${z.label}`, `On the first page · ${z.label}`) : t("En la primera página", "On the first page"), value: n.format(z.top10), sub: vsText(z.top10, z.prevTop10, lang), tone: toneOf(z.top10, z.prevTop10) },
      ]),
      items: [...k.bad.map((a) => ({ text: describeRank(a, lang, many), tone: "bad" as const })), ...k.good.map((a) => ({ text: describeRank(a, lang, many), tone: "good" as const }))],
      note: !k.bad.length && !k.good.length ? t("Sin cambios grandes en tus búsquedas (subir o bajar 3 lugares o más).", "No big changes in your searches (moving 3 places or more).") : undefined,
      href: `${base}/seo?tab=google#posiciones`,
      hrefText: t("Ver las posiciones", "See the rankings"),
    });
  }

  if (r.tasks) {
    out.push({
      id: "tasks",
      title: t("Tareas del plan que terminaste", "Action-plan tasks you finished"),
      items: r.tasks.items.map((i) => ({ text: i.title[lang], tone: "good", meta: i.at ? when(i.at) : undefined })),
      href: `${base}/plan`,
      hrefText: t("Ver el plan", "See the plan"),
    });
  }

  if (r.proposals) {
    const imp = (x: number) => (x >= 3 ? t("impacto alto", "high impact") : x === 2 ? t("impacto medio", "medium impact") : t("impacto bajo", "low impact"));
    out.push({
      id: "proposals",
      title: t("Nuevas propuestas de la IA", "New AI proposals"),
      items: r.proposals.items.map((p) => ({ text: p.title[lang], meta: imp(p.impact) })),
      note: t("Tú decides: acéptalas o recházalas en Propuestas. Nada se aplica sin tu permiso.", "You decide: accept or reject them in Proposals. Nothing is applied without your OK."),
      href: `${base}/propuestas`,
      hrefText: t("Ver las propuestas", "See the proposals"),
    });
  }

  if (r.costs) {
    const c = r.costs;
    out.push({
      id: "costs",
      title: t("Costos", "Costs"),
      stats: [
        { label: t("IA", "AI"), value: money(c.aiCents), sub: vsText(c.aiCents, c.prevAiCents, lang, money) },
        { label: t("Anuncios", "Ads"), value: money(c.adsCents), sub: c.adsCumulative ? t("más lo acumulado arriba", "plus the to-date amount above") : undefined },
        { label: t("Total", "Total"), value: money(c.aiCents + c.adsCents) },
      ],
      note: t(`Comparado con ${prev}.`, `Compared with ${prev}.`),
    });
  }

  if (r.next) {
    const items: ViewItem[] = [];
    if (r.next.upcoming) {
      const u = r.next.upcoming;
      items.push({
        text: u.next
          ? t(`${plural(u.count, "Sale 1 publicación programada", `Salen ${u.count} publicaciones programadas`)} en las próximas 24 horas (la primera a las ${fmtTime(u.next, lang, r.period.tz)}).`, `${u.count} scheduled ${plural(u.count, "post goes", "posts go")} out in the next 24 hours (the first at ${fmtTime(u.next, lang, r.period.tz)}).`)
          : t(`${u.count} publicaciones programadas en las próximas 24 horas.`, `${u.count} scheduled posts in the next 24 hours.`),
        href: `${base}/historial?ver=programadas`,
        linkText: t("Ver", "View"),
      });
    }
    for (const task of r.next.tasks) items.push({ text: task.title[lang], href: task.href || `${base}/plan`, linkText: t("Hacerlo", "Do it") });
    out.push({ id: "next", title: t("Próximos pasos", "Next steps"), items });
  }
  return out;
}

// ---------- Lo más importante (3 frases) ----------

/** Datos en frases cortas (con sus números exactos) para la IA: solo puede usar estos. */
export function highlightFacts(r: PeriodReport, lang: Lang): string[] {
  const t = tr(lang);
  const n = nf(lang);
  const f: string[] = [];
  const label = periodText(r.period, lang, "long");
  f.push(t(`Periodo: ${label}.`, `Period: ${label}.`));
  if (r.alerts) for (const a of r.alerts.items.slice(0, 4)) f.push(t(`Aviso: ${a.text.es}`, `Alert: ${a.text.en}`));
  if (r.posts) {
    const chans = r.posts.byChannel.filter((c) => c.sent).map((c) => channelLabel(c.channel, lang));
    f.push(t(`Publicaciones enviadas: ${r.posts.sent}${chans.length ? ` (${chans.join(", ")})` : ""}; en ${prevText(r.period, "es")}: ${r.posts.prevSent}.`, `Posts sent: ${r.posts.sent}${chans.length ? ` (${chans.join(", ")})` : ""}; in ${prevText(r.period, "en")}: ${r.posts.prevSent}.`));
    if (r.posts.failed) f.push(t(`Publicaciones que no salieron: ${r.posts.failed}.`, `Posts that didn't go out: ${r.posts.failed}.`));
  }
  if (r.results) {
    f.push(t(`Resultados de las publicaciones: ${n.format(r.results.totals.reach)} personas alcanzadas y ${n.format(r.results.totals.interactions)} interacciones.`, `Post results: ${n.format(r.results.totals.reach)} people reached and ${n.format(r.results.totals.interactions)} interactions.`));
    const top = r.results.rows[0];
    if (top && top.interactions) f.push(t(`La publicación con más interacciones: ${quote(top.title, lang)} en ${channelLabel(top.channel, lang)} (${n.format(top.interactions)}).`, `The post with the most interactions: ${quote(top.title, lang)} on ${channelLabel(top.channel, lang)} (${n.format(top.interactions)}).`));
  }
  if (r.campaigns) for (const c of r.campaigns.items.slice(0, 3)) f.push(t(`Campaña ${quote(c.name, lang)}: ${statusLabel(c.status, lang)}, ${c.published} publicadas, ${c.prepared} preparadas por la IA.`, `Campaign ${quote(c.name, lang)}: ${statusLabel(c.status, lang)}, ${c.published} posted, ${c.prepared} prepared by the AI.`));
  if (r.ai) f.push(t(`La IA hizo ${r.ai.total} cosas sola (costo ${money(r.ai.costCents)}).`, `The AI did ${r.ai.total} things on its own (cost ${money(r.ai.costCents)}).`));
  if (r.ads && r.ads.rows.some((x) => !x.cumulative)) f.push(t(`Anuncios: gastaron ${money(r.ads.spentCents)} y trajeron ${r.ads.results} resultados.`, `Ads: spent ${money(r.ads.spentCents)} and brought ${r.ads.results} results.`));
  if (r.reviews && r.reviews.newCount) f.push(t(`Reseñas nuevas en Google: ${r.reviews.newCount}${r.reviews.rating !== null ? `; calificación ${n.format(r.reviews.rating)}` : ""}.`, `New Google reviews: ${r.reviews.newCount}${r.reviews.rating !== null ? `; rating ${n.format(r.reviews.rating)}` : ""}.`));
  if (r.web && r.web.organic !== null) f.push(t(`Visitas desde Google a la página: ${n.format(r.web.organic)}${r.web.prevOrganic !== null ? ` (antes ${n.format(r.web.prevOrganic)})` : ""}.`, `Visits from Google to the website: ${n.format(r.web.organic)}${r.web.prevOrganic !== null ? ` (before ${n.format(r.web.prevOrganic)})` : ""}.`));
  if (r.rankings) {
    for (const a of r.rankings.bad.slice(0, 3)) f.push(t(`Bajó en Google: ${describeRank(a, lang)}`, `Dropped on Google: ${describeRank(a, lang)}`));
    for (const a of r.rankings.good.slice(0, 3)) f.push(t(`Subió en Google: ${describeRank(a, lang)}`, `Climbed on Google: ${describeRank(a, lang)}`));
  }
  if (r.tasks) f.push(t(`Tareas del plan terminadas: ${r.tasks.items.length} (${r.tasks.items.slice(0, 3).map((x) => x.title.es).join("; ")}).`, `Action-plan tasks finished: ${r.tasks.items.length} (${r.tasks.items.slice(0, 3).map((x) => x.title.en).join("; ")}).`));
  if (r.proposals) f.push(t(`Propuestas nuevas de la IA para aceptar o rechazar: ${r.proposals.items.length}.`, `New AI proposals to accept or reject: ${r.proposals.items.length}.`));
  if (r.next?.upcoming) f.push(t(`Publicaciones programadas en las próximas 24 horas: ${r.next.upcoming.count}.`, `Posts scheduled in the next 24 hours: ${r.next.upcoming.count}.`));
  if (r.next) for (const task of r.next.tasks.slice(0, 2)) f.push(t(`Próxima tarea del plan: ${task.title.es}.`, `Next action-plan task: ${task.title.en}.`));
  if (isQuiet(r)) f.push(t("Fue un periodo tranquilo: no hubo publicaciones, ni acciones de la IA, ni cambios.", "It was a quiet period: no posts, no AI actions, no changes."));
  return f;
}

/** Las 3 frases de «Lo más importante» sin IA: primero lo urgente, luego lo bueno, luego qué sigue. */
export function ruleHighlights(r: PeriodReport, lang: Lang): string[] {
  const t = tr(lang);
  const n = nf(lang);
  const out: string[] = [];
  const bad = r.alerts?.items.filter((a) => a.tone === "bad") ?? [];
  if (bad.length) out.push(bad.length === 1 ? t(`Atención: ${bad[0].text.es}`, `Heads up: ${bad[0].text.en}`) : t(`Hay ${bad.length} cosas que necesitan tu atención. La primera: ${bad[0].text.es}`, `${bad.length} things need your attention. The first: ${bad[0].text.en}`));
  if (r.posts && r.posts.sent) {
    const chans = r.posts.byChannel.filter((c) => c.sent).length;
    out.push(t(`Se ${plural(r.posts.sent, "publicó 1 cosa", `publicaron ${r.posts.sent} cosas`)} en ${plural(chans, "1 canal", `${chans} canales`)} (${prevText(r.period, "es")}: ${r.posts.prevSent}).`, `${r.posts.sent} ${plural(r.posts.sent, "post went", "posts went")} out on ${chans} ${plural(chans, "channel", "channels")} (${prevText(r.period, "en")}: ${r.posts.prevSent}).`));
  }
  if (r.reviews && r.reviews.newCount) out.push(t(`Llegaron ${plural(r.reviews.newCount, "1 reseña nueva", `${r.reviews.newCount} reseñas nuevas`)} en Google${r.reviews.rating !== null ? ` (tu calificación: ${n.format(r.reviews.rating)} ★)` : ""}.`, `${r.reviews.newCount} new Google ${plural(r.reviews.newCount, "review", "reviews")}${r.reviews.rating !== null ? ` (your rating: ${n.format(r.reviews.rating)} ★)` : ""}.`));
  if (r.ads && r.ads.spentCents) out.push(t(`Los anuncios gastaron ${money(r.ads.spentCents)} y trajeron ${n.format(r.ads.results)} resultados.`, `Ads spent ${money(r.ads.spentCents)} and brought ${n.format(r.ads.results)} results.`));
  if (r.rankings && r.rankings.good.length) out.push(t(`Buenas noticias en Google: ${describeRank(r.rankings.good[0], lang)}`, `Good news on Google: ${describeRank(r.rankings.good[0], lang)}`));
  if (r.rankings && r.rankings.bad.length && !bad.length) out.push(t(`Ojo en Google: ${describeRank(r.rankings.bad[0], lang)}`, `Watch Google: ${describeRank(r.rankings.bad[0], lang)}`));
  if (r.results && r.results.totals.reach) out.push(t(`Tus publicaciones llegaron a ${n.format(r.results.totals.reach)} personas, con ${n.format(r.results.totals.interactions)} interacciones.`, `Your posts reached ${n.format(r.results.totals.reach)} people, with ${n.format(r.results.totals.interactions)} interactions.`));
  if (r.ai) out.push(t(`La IA hizo ${plural(r.ai.total, "1 cosa", `${r.ai.total} cosas`)} sola${r.ai.costCents ? ` (costo: ${money(r.ai.costCents)})` : ""}: puedes revisar cada una en el registro.`, `The AI did ${r.ai.total} ${plural(r.ai.total, "thing", "things")} on its own${r.ai.costCents ? ` (cost: ${money(r.ai.costCents)})` : ""}: you can review each one in the log.`));
  if (r.tasks) out.push(t(`Terminaste ${plural(r.tasks.items.length, "1 tarea", `${r.tasks.items.length} tareas`)} del plan. ¡Bien!`, `You finished ${r.tasks.items.length} action-plan ${plural(r.tasks.items.length, "task", "tasks")}. Nice!`));
  if (r.proposals) out.push(t(`La IA tiene ${plural(r.proposals.items.length, "1 propuesta nueva", `${r.proposals.items.length} propuestas nuevas`)} para que decidas.`, `The AI has ${r.proposals.items.length} new ${plural(r.proposals.items.length, "proposal", "proposals")} for you to decide on.`));
  if (r.web && r.web.organic !== null && r.web.organic > 0) out.push(t(`Tu página recibió ${n.format(r.web.organic)} visitas desde Google.`, `Your website got ${n.format(r.web.organic)} visits from Google.`));
  if (isQuiet(r) && out.length < 3) out.unshift(isSingleDay(r.period) ? t("Fue un día tranquilo: no hubo publicaciones ni cambios importantes.", "It was a quiet day: no posts and no important changes.") : t("Fue un periodo tranquilo: no hubo publicaciones ni cambios importantes.", "It was a quiet period: no posts and no important changes."));
  if (out.length < 3 && r.next?.upcoming) out.push(t(`Lo que viene: ${plural(r.next.upcoming.count, "1 publicación programada", `${r.next.upcoming.count} publicaciones programadas`)} en las próximas 24 horas.`, `Coming up: ${r.next.upcoming.count} scheduled ${plural(r.next.upcoming.count, "post", "posts")} in the next 24 hours.`));
  for (const task of r.next?.tasks ?? []) if (out.length < 3) out.push(t(`Próximo paso sugerido: ${task.title.es}`, `Suggested next step: ${task.title.en}`));
  if (!out.length) out.push(t("Todavía no hay datos para este periodo.", "There's no data for this period yet."));
  return out.slice(0, 3);
}
