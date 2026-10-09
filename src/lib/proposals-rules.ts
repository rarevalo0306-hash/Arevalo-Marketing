// Reglas fijas (sin IA) que buscan mejoras en los resultados: horarios, formatos, canales, anuncios y palabras clave.
// Sin base de datos: reciben los números ya leídos y devuelven propuestas con sus datos («Por qué»). La IA después
// solo las redacta mejor y agrega 1-2 ideas creativas (src/lib/proposals.ts).

import { costPerResultCents, isLive, MIN_DAILY_CENTS, money, type AdEntry } from "@/lib/ads-shape";
import { inQuietHours, kindLabel, localParts, POST_KINDS, toMinutes, type ContentMix, type PostKind } from "@/lib/campaign-shape";
import { channelName } from "@/lib/channels";
import type { GscReport } from "@/lib/seo/gsc";
import type { ResultsSummary } from "@/lib/results";
import {
  describeChange,
  isClosed,
  maxDailyCents,
  timeLabel,
  validateAction,
  type ApplyContext,
  type Bi,
  type CampaignState,
  type Evidence,
  type Fact,
  type ProposalAction,
  type ProposalKind,
} from "@/lib/proposals-shape";

/** Resultado de una publicación en una red (lo último leído). Solo para armar Stats sin el resumen de resultados. */
export type PostStat = {
  postId: string;
  campaignId: string | null;
  kind: PostKind;
  channel: string;
  /** Cuándo salió. */
  at: Date;
  reach: number;
  impressions: number;
  /** Me gusta + comentarios + compartidos + guardados (los clics van aparte, como en Resultados). */
  engagement: number;
};

/** Por hora del día (zona del negocio): publicaciones medidas y tasa de interacción promedio (0 a 1). */
export type HourStat = { hour: number; posts: number; rate: number | null };
/** Un grupo (formato o canal): publicaciones medidas y sus totales. */
export type GroupStat = { key: string; posts: number; reach: number; interactions: number };
export type RankMoveLite = { keyword: string; now: number | null; prev: number | null };

/** Los números que miran las reglas (salen de resultsSummary, src/lib/results.ts). */
export type Stats = {
  /** Publicaciones medidas en el período. */
  measured: number;
  hours: HourStat[];
  /** Por formato de la campaña: post | carousel | story | video. */
  formats: GroupStat[];
  channels: GroupStat[];
  /** Cómo se movieron las posiciones en Google (null = no hay dos revisiones para comparar). */
  rankMoves: RankMoveLite[] | null;
};

export type RulesInput = {
  now: Date;
  from: Date;
  to: Date;
  tz: string;
  businessName: string;
  stats: Stats;
  campaigns: CampaignState[];
  connected: string[];
  tracked: string[];
  gsc: GscReport | null;
  monthlyCapCents: number;
  monthSpentCents: number;
};

/** Formato de Resultados → tipo de publicación de las campañas (foto, diseño y solo texto son «post»). */
export const formatKind = (f: string): PostKind => (f === "carousel" || f === "story" || f === "video" ? f : "post");

function mergeGroups(list: GroupStat[]): GroupStat[] {
  const m = new Map<string, GroupStat>();
  for (const g of list) {
    const cur = m.get(g.key) ?? { key: g.key, posts: 0, reach: 0, interactions: 0 };
    m.set(g.key, { key: g.key, posts: cur.posts + g.posts, reach: cur.reach + g.reach, interactions: cur.interactions + g.interactions });
  }
  return [...m.values()];
}

/** Stats a partir del resumen de resultados (lo que ve el dueño en /resultados). */
export function statsFromSummary(s: Pick<ResultsSummary, "timing" | "byFormat" | "byChannel" | "google">): Stats {
  const rank = s.google.rank;
  return {
    measured: s.timing.measured,
    hours: s.timing.hours.map((h) => ({ hour: h.key, posts: h.posts, rate: h.rate })),
    formats: mergeGroups(s.byFormat.map((g) => ({ key: formatKind(g.key), posts: g.measured, reach: g.reach, interactions: g.interactions }))),
    channels: s.byChannel.map((g) => ({ key: g.key, posts: g.measured, reach: g.reach, interactions: g.interactions })),
    rankMoves: rank && rank.prev ? rank.moves.map((m) => ({ keyword: m.keyword, now: m.now, prev: m.prev })) : null,
  };
}

/** Stats a partir de publicaciones sueltas (si el resumen no se pudo leer, y en las pruebas). */
export function statsFromPosts(posts: PostStat[], tz: string, rankMoves: RankMoveLite[] | null = null): Stats {
  const reach = (p: PostStat) => (p.reach > 0 ? p.reach : p.impressions);
  const measured = posts.filter((p) => reach(p) > 0);
  const hours: HourStat[] = Array.from({ length: 24 }, (_, hour) => {
    const xs = measured.filter((p) => Math.floor(localParts(p.at, tz).minutes / 60) === hour);
    return { hour, posts: xs.length, rate: xs.length ? xs.reduce((sum, p) => sum + Math.min(1, p.engagement / reach(p)), 0) / xs.length : null };
  });
  const group = (keyOf: (p: PostStat) => string) => mergeGroups(posts.map((p) => ({ key: keyOf(p), posts: 1, reach: reach(p), interactions: p.engagement })));
  return { measured: measured.length, hours, formats: group((p) => p.kind), channels: group((p) => p.channel), rankMoves };
}

export type ProposalDraft = {
  kind: ProposalKind;
  campaignId: string | null;
  impact: 1 | 2 | 3;
  title: Bi;
  detail: Bi;
  action: ProposalAction | null;
  evidence: Evidence;
};

/** Mínimos para que un número diga algo (con menos publicaciones no se propone nada). */
export const MIN = { bucket: 3, total: 8, channel: 3, removeChannel: 5, adSpendCents: 300, gscImpressions: 30 } as const;

const P = (es: string, en: string): Bi => ({ es, en });
const n0 = (x: number) => Math.round(x).toLocaleString("en-US");
const pct = (r: number) => `${(Math.round(r * 1000) / 10).toString()} %`;
const perPost = (g: GroupStat) => (g.posts > 0 ? g.interactions / g.posts : 0);
const ratioText = (r: number) => `${(Math.round(r * 10) / 10).toString()}×`;
const nPosts = (n: number, lang: "es" | "en") => (lang === "es" ? `${n} ${n === 1 ? "publicación" : "publicaciones"}` : `${n} ${n === 1 ? "post" : "posts"}`);
const day = (d: Date, tz: string) => localParts(d, tz).day;

const SOURCE_POSTS = P("Resultados de tus publicaciones (alcance, me gusta, comentarios…)", "Your post results (reach, likes, comments…)");
const SOURCE_ADS = P("Resultados de tus anuncios en Meta", "Your ad results on Meta");
const SOURCE_GSC = P("Google Search Console (búsquedas en Google)", "Google Search Console (Google searches)");
const SOURCE_RANK = P("Revisión de tus posiciones en Google", "Your Google rankings check");

/** Campañas a las que se les puede proponer cambios de publicaciones (no paradas, no terminadas, no manuales). */
const postingCampaigns = (cs: CampaignState[]) => cs.filter((c) => !isClosed(c.status) && c.mode !== "manual");

function ctxFor(x: RulesInput, c: CampaignState | null): ApplyContext {
  return { campaign: c, connected: x.connected, tracked: x.tracked, monthlyCapCents: x.monthlyCapCents, monthSpentCents: x.monthSpentCents, now: x.now };
}

/** Arma la propuesta solo si la acción pasa la revisión de seguridad con el estado de ahora. */
function make(
  x: RulesInput,
  c: CampaignState | null,
  base: { kind: ProposalKind; impact: 1 | 2 | 3; title: Bi; detail: Bi; action: ProposalAction | null; key: string; rule: string; facts: Fact[]; source: Bi },
): ProposalDraft | null {
  const ctx = ctxFor(x, c);
  if (base.action && validateAction(base.action, ctx).length) return null;
  return {
    kind: base.kind,
    campaignId: c?.id ?? null,
    impact: base.impact,
    title: base.title,
    detail: base.detail,
    action: base.action,
    evidence: {
      key: base.key,
      rule: base.rule,
      period: { from: day(x.from, x.tz), to: day(x.to, x.tz) },
      facts: base.facts,
      source: base.source,
      change: base.action ? describeChange(base.action, ctx) : [],
    },
  };
}

// ---------- Horarios ----------

const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** La hora que mejor funciona: ≥ 2× la tasa de interacción de las demás horas, con suficientes publicaciones medidas. */
export function bestHour(stats: Stats): { time: string; best: number; rest: number; nBest: number; nRest: number; ratio: number; byTime: Map<string, number> } | null {
  if (stats.measured < MIN.total) return null;
  const slots = stats.hours.filter((h) => h.posts > 0 && h.rate !== null);
  const byTime = new Map(slots.map((h) => [hhmm(h.hour), h.rate as number]));
  let pick: { time: string; best: number; rest: number; nBest: number; nRest: number; ratio: number } | null = null;
  for (const h of slots) {
    if (h.posts < MIN.bucket) continue;
    const others = slots.filter((o) => o.hour !== h.hour);
    const nRest = others.reduce((sum, o) => sum + o.posts, 0);
    if (nRest < MIN.bucket) continue;
    const rest = others.reduce((sum, o) => sum + (o.rate as number) * o.posts, 0) / nRest;
    const best = h.rate as number;
    if (best <= 0) continue;
    const ratio = rest > 0 ? best / rest : Infinity;
    if (ratio >= 2 && (!pick || ratio > pick.ratio)) pick = { time: hhmm(h.hour), best, rest, nBest: h.posts, nRest, ratio };
  }
  return pick ? { ...pick, byTime } : null;
}

function timingRules(x: RulesInput): ProposalDraft[] {
  const b = bestHour(x.stats);
  if (!b) return [];
  const out: ProposalDraft[] = [];
  for (const c of postingCampaigns(x.campaigns)) {
    const times = c.rules.postTimes;
    if (times.includes(b.time) || inQuietHours(toMinutes(b.time), c.rules.quietHours)) continue;
    // Se cambia la hora que peor funciona (o, si no hay datos de ninguna, la última) por la mejor.
    const scored = times.map((t) => ({ t, v: b.byTime.get(`${t.slice(0, 2)}:00`) ?? b.rest }));
    const worst = scored.reduce((w, sc) => (sc.v < w.v ? sc : w), scored[scored.length - 1]);
    const postTimes = [...new Set([...times.filter((t) => t !== worst.t), b.time])].sort();
    const es = timeLabel(b.time, "es");
    const en = timeLabel(b.time, "en");
    const r = Number.isFinite(b.ratio) ? ratioText(b.ratio) : "+";
    const d = make(x, c, {
      kind: "timing",
      impact: b.ratio >= 3 ? 3 : 2,
      title: P(`Publicar a las ${es} en «${c.name}»`, `Post at ${en} in “${c.name}”`),
      detail: P(
        `A tus publicaciones de las ${es} les reacciona ${r} más gente (de cada 100 que las ven) que a las de otras horas. Proponemos cambiar la hora de las ${timeLabel(worst.t, "es")} por las ${es}.`,
        `${r} more people react to your posts at ${en} (out of every 100 who see them) than at other times. We suggest swapping the ${timeLabel(worst.t, "en")} slot for ${en}.`,
      ),
      action: { type: "campaign.update", campaignId: c.id, patch: { postTimes } },
      key: `timing:${c.id}:${b.time}`,
      rule: "best-hour",
      facts: [
        { label: P(`Personas que reaccionan a las ${es} (${nPosts(b.nBest, "es")})`, `People who react at ${en} (${nPosts(b.nBest, "en")})`), value: pct(b.best) },
        { label: P(`Personas que reaccionan a otras horas (${nPosts(b.nRest, "es")})`, `People who react at other times (${nPosts(b.nRest, "en")})`), value: pct(b.rest) },
      ],
      source: SOURCE_POSTS,
    });
    if (d) out.push(d);
  }
  return out;
}

// ---------- Formatos ----------

/** Sube la parte de un formato en 20 puntos (máx. 60 %), quitándola de los que más tienen. Siempre suma 100. */
export function raiseShare(mix: ContentMix, kind: PostKind, points = 20, cap = 60): ContentMix {
  const total = POST_KINDS.reduce((s, k) => s + Math.max(0, mix[k]), 0) || 1;
  const pct = Object.fromEntries(POST_KINDS.map((k) => [k, Math.round((Math.max(0, mix[k]) * 100) / total)])) as ContentMix;
  const fix = 100 - POST_KINDS.reduce((s, k) => s + pct[k], 0);
  const top = POST_KINDS.reduce((a, k) => (pct[k] > pct[a] ? k : a), "post" as PostKind);
  pct[top] += fix;
  const target = Math.min(cap, pct[kind] + points);
  let need = target - pct[kind];
  if (need <= 0) return pct;
  const out = { ...pct, [kind]: target } as ContentMix;
  const donors = POST_KINDS.filter((k) => k !== kind).sort((a, b) => out[b] - out[a]);
  for (const k of donors) {
    const take = Math.min(need, out[k]);
    out[k] -= take;
    need -= take;
    if (!need) break;
  }
  if (need > 0) out[kind] -= need;
  return out;
}

const PLURAL: Record<PostKind, [string, string]> = { post: ["posts", "posts"], carousel: ["carruseles", "carousels"], story: ["historias", "stories"], video: ["videos", "videos"] };

function formatRules(x: RulesInput): ProposalDraft[] {
  const by = new Map(x.stats.formats.map((g) => [g.key, g]));
  const base = by.get("post");
  if (!base || base.posts < MIN.bucket) return [];
  const baseAvg = perPost(base);
  const out: ProposalDraft[] = [];
  for (const k of ["carousel", "video", "story"] as PostKind[]) {
    const g = by.get(k);
    if (!g || g.posts < MIN.bucket) continue;
    const kAvg = perPost(g);
    const ratio = baseAvg > 0 ? kAvg / baseAvg : kAvg > 0 ? Infinity : 0;
    if (ratio < 1.5) continue;
    for (const c of postingCampaigns(x.campaigns)) {
      const contentMix = raiseShare(c.rules.contentMix, k);
      const total = POST_KINDS.reduce((s, q) => s + c.rules.contentMix[q], 0) || 1;
      if (contentMix[k] <= Math.round((c.rules.contentMix[k] * 100) / total)) continue;
      const kes = kindLabel(k, "es").toLowerCase();
      const ken = kindLabel(k, "en").toLowerCase();
      const r = Number.isFinite(ratio) ? ratioText(ratio) : "+";
      const d = make(x, c, {
        kind: "format",
        impact: ratio >= 2 ? 3 : 2,
        title: P(`Más ${PLURAL[k][0]} en «${c.name}»`, `More ${PLURAL[k][1]} in “${c.name}”`),
        detail: P(
          `Cada ${kes} recibe ${r} más reacciones que un post normal. Proponemos subir su parte a ${contentMix[k]} %.`,
          `Each ${ken} gets ${r} more reactions than a regular post. We suggest raising its share to ${contentMix[k]}%.`,
        ),
        action: { type: "campaign.update", campaignId: c.id, patch: { contentMix } },
        key: `format:${c.id}:${k}`,
        rule: "format-wins",
        facts: [
          { label: P(`Reacciones promedio por ${kes} (${nPosts(g.posts, "es")})`, `Average reactions per ${ken} (${nPosts(g.posts, "en")})`), value: n0(kAvg) },
          { label: P(`Reacciones promedio por post normal (${nPosts(base.posts, "es")})`, `Average reactions per regular post (${nPosts(base.posts, "en")})`), value: n0(baseAvg) },
        ],
        source: SOURCE_POSTS,
      });
      if (d) out.push(d);
    }
  }
  return out;
}

// ---------- Canales ----------

function channelRules(x: RulesInput): ProposalDraft[] {
  const by = new Map(x.stats.channels.map((g) => [g.key, g]));
  const out: ProposalDraft[] = [];
  for (const c of postingCampaigns(x.campaigns)) {
    const inCampaign = c.channels.map((ch) => by.get(ch)).filter((g): g is GroupStat => !!g && g.posts >= MIN.channel);
    const campPosts = inCampaign.reduce((sum, g) => sum + g.posts, 0);
    const campAvg = campPosts ? inCampaign.reduce((sum, g) => sum + g.interactions, 0) / campPosts : 0;
    if (inCampaign.length) {
      for (const [ch, ps] of by) {
        if (c.channels.includes(ch) || !x.connected.includes(ch) || ps.posts < MIN.channel) continue;
        const chAvg = perPost(ps);
        if (chAvg <= 0 || (campAvg > 0 && chAvg < campAvg * 1.5)) continue;
        const d = make(x, c, {
          kind: "channel",
          impact: 2,
          title: P(`Agregar ${channelName(ch, "es")} a «${c.name}»`, `Add ${channelName(ch, "en")} to “${c.name}”`),
          detail: P(
            `En ${channelName(ch, "es")} tus publicaciones reciben más reacciones que en los canales de esta campaña.`,
            `On ${channelName(ch, "en")} your posts get more reactions than on this campaign's channels.`,
          ),
          action: { type: "campaign.update", campaignId: c.id, patch: { addChannels: [ch] } },
          key: `channel:${c.id}:add:${ch}`,
          rule: "channel-wins",
          facts: [
            { label: P(`Reacciones promedio en ${channelName(ch, "es")} (${nPosts(ps.posts, "es")})`, `Average reactions on ${channelName(ch, "en")} (${nPosts(ps.posts, "en")})`), value: n0(chAvg) },
            { label: P("Reacciones promedio en los canales de la campaña", "Average reactions on the campaign's channels"), value: n0(campAvg) },
          ],
          source: SOURCE_POSTS,
        });
        if (d) out.push(d);
      }
    }
    if (c.channels.length > 1)
      for (const ch of c.channels) {
        const ps = by.get(ch);
        if (!ps || ps.posts < MIN.removeChannel || ps.interactions > 0 || ps.reach > 0) continue;
        const d = make(x, c, {
          kind: "channel",
          impact: 1,
          title: P(`Dejar de publicar en ${channelName(ch, "es")} en «${c.name}»`, `Stop posting on ${channelName(ch, "en")} in “${c.name}”`),
          detail: P(
            `Las últimas ${ps.posts} publicaciones en ${channelName(ch, "es")} no tuvieron alcance ni reacciones. Mejor enfocar el esfuerzo en los otros canales.`,
            `The last ${ps.posts} posts on ${channelName(ch, "en")} had no reach or reactions. Better to focus on the other channels.`,
          ),
          action: { type: "campaign.update", campaignId: c.id, patch: { removeChannels: [ch] } },
          key: `channel:${c.id}:remove:${ch}`,
          rule: "channel-dead",
          facts: [{ label: P(`Publicaciones sin resultados en ${channelName(ch, "es")}`, `Posts with no results on ${channelName(ch, "en")}`), value: String(ps.posts) }],
          source: SOURCE_POSTS,
        });
        if (d) out.push(d);
      }
  }
  return out;
}

// ---------- Anuncios ----------

const cprText = (a: AdEntry, cents: number, lang: "es" | "en") =>
  a.goal === "awareness" ? (lang === "es" ? `${money(cents)} por cada 1.000 personas` : `${money(cents)} per 1,000 people`) : lang === "es" ? `${money(cents)} por resultado` : `${money(cents)} per result`;

function adRules(x: RulesInput): ProposalDraft[] {
  const out: ProposalDraft[] = [];
  for (const c of x.campaigns) {
    if (isClosed(c.status)) continue;
    const measured = c.ads.items
      .map((a) => ({ a, cpr: costPerResultCents(a) }))
      .filter((m): m is { a: AdEntry; cpr: number } => m.cpr !== null && m.cpr > 0 && (m.a.insights?.spentCents ?? 0) >= MIN.adSpendCents);
    for (const { a, cpr } of measured) {
      const peers = measured.filter((m) => m.a.id !== a.id && m.a.goal === a.goal);
      if (!peers.length) continue;
      const best = Math.min(...peers.map((m) => m.cpr));
      const worst = Math.max(...peers.map((m) => m.cpr));
      const facts: Fact[] = [
        { label: P(`Costo de «${a.name}»`, `Cost of “${a.name}”`), value: `${cprText(a, cpr, "es")}|${cprText(a, cpr, "en")}` },
        { label: P("Mejor anuncio parecido", "Best similar ad"), value: `${cprText(a, best, "es")}|${cprText(a, best, "en")}` },
        { label: P("Gastado en este anuncio", "Spent on this ad"), value: money(a.insights?.spentCents ?? 0) },
      ];
      if (isLive(a) && cpr >= best * 2) {
        const d = make(x, c, {
          kind: "ads-pause",
          impact: 3,
          title: P(`Pausar el anuncio «${a.name}»`, `Pause the ad “${a.name}”`),
          detail: P(
            `Cada resultado de este anuncio cuesta ${ratioText(cpr / best)} más que en tu mejor anuncio parecido. Pausarlo deja el dinero para el que funciona mejor.`,
            `Each result from this ad costs ${ratioText(cpr / best)} more than your best similar ad. Pausing it leaves the money for the one that works better.`,
          ),
          action: { type: "ad.pause", campaignId: c.id, adId: a.id },
          key: `ads-pause:${a.id}`,
          rule: "ad-costly",
          facts,
          source: SOURCE_ADS,
        });
        if (d) out.push(d);
      } else if (isLive(a) && cpr >= best * 1.5) {
        const dailyCents = Math.max(MIN_DAILY_CENTS, Math.round((a.dailyCents * 0.7) / 10) * 10);
        if (dailyCents >= a.dailyCents) continue;
        const d = make(x, c, {
          kind: "ads-budget",
          impact: 2,
          title: P(`Bajar el gasto por día de «${a.name}»`, `Lower the daily spend of “${a.name}”`),
          detail: P(
            `Este anuncio rinde menos que tu mejor anuncio parecido. Proponemos bajar de ${money(a.dailyCents)} a ${money(dailyCents)} por día.`,
            `This ad performs worse than your best similar ad. We suggest lowering it from ${money(a.dailyCents)} to ${money(dailyCents)} a day.`,
          ),
          action: { type: "ad.daily", campaignId: c.id, adId: a.id, dailyCents },
          key: `ads-budget:${a.id}:down`,
          rule: "ad-weak",
          facts,
          source: SOURCE_ADS,
        });
        if (d) out.push(d);
      } else if (cpr * 2 <= worst) {
        const better = { ...facts[1], label: P("Peor anuncio parecido", "Worst similar ad"), value: `${cprText(a, worst, "es")}|${cprText(a, worst, "en")}` };
        if (a.status === "capped_today" || a.status === "active") {
          // Funciona muy bien y llega a su gasto del día: subirlo un 25 %, solo si cabe en TODOS los topes.
          const max = maxDailyCents(a, c, x);
          const want = Math.round((a.dailyCents * 1.25) / 10) * 10;
          const dailyCents = max === null ? 0 : Math.min(want, max);
          if (a.status !== "capped_today" || dailyCents <= a.dailyCents) continue;
          const d = make(x, c, {
            kind: "ads-budget",
            impact: 2,
            title: P(`Darle un poco más a «${a.name}»`, `Give “${a.name}” a bit more`),
            detail: P(
              `Es tu anuncio más barato por resultado y se queda sin gasto del día. Proponemos subir de ${money(a.dailyCents)} a ${money(dailyCents)} por día, sin pasar el presupuesto de la campaña ni el máximo del mes.`,
              `It's your cheapest ad per result and runs out of its daily spend. We suggest raising it from ${money(a.dailyCents)} to ${money(dailyCents)} a day, without passing the campaign budget or the monthly maximum.`,
            ),
            action: { type: "ad.daily", campaignId: c.id, adId: a.id, dailyCents },
            key: `ads-budget:${a.id}:up`,
            rule: "ad-strong",
            facts: [facts[0], better, facts[2]],
            source: SOURCE_ADS,
          });
          if (d) out.push(d);
        } else if (a.status === "paused" && a.pausedReason === "owner") {
          // Encender es solo del dueño (con su confirmación en Anuncios): esto es solo un consejo.
          const d = make(x, c, {
            kind: "ads-budget",
            impact: 1,
            title: P(`Revisar el anuncio «${a.name}»`, `Review the ad “${a.name}”`),
            detail: P(
              `Está pausado, pero era tu anuncio más barato por resultado. Si quieres, revísalo y enciéndelo tú en Anuncios (la IA nunca enciende anuncios sola).`,
              `It's paused, but it was your cheapest ad per result. If you want, review it and turn it on yourself in Ads (the AI never turns ads on by itself).`,
            ),
            action: null,
            key: `ads-budget:${a.id}:review`,
            rule: "ad-paused-good",
            facts: [facts[0], better, facts[2]],
            source: SOURCE_ADS,
          });
          if (d) out.push(d);
        }
      }
    }
  }
  return out;
}

// ---------- Palabras clave ----------

const NO_ACCENTS = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const kwKey = (k: string) => NO_ACCENTS(k).replace(/\s+/g, " ").trim();

function brandWords(name: string): string[] {
  return NO_ACCENTS(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

function keywordRules(x: RulesInput): ProposalDraft[] {
  const out: ProposalDraft[] = [];
  const tracked = new Set(x.tracked.map(kwKey));
  const brand = brandWords(x.businessName);
  if (x.gsc) {
    const rows = [...x.gsc.opportunities, ...x.gsc.queries];
    const seen = new Set<string>();
    const picks = rows
      .filter((r) => {
        const k = kwKey(r.key);
        if (!k || k.length < 4 || k.length > 80 || seen.has(k) || tracked.has(k)) return false;
        seen.add(k);
        return r.impressions >= MIN.gscImpressions && r.position > 0 && r.position <= 30 && !brand.some((w) => k.includes(w));
      })
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 3);
    for (const r of picks) {
      const d = make(x, null, {
        kind: "keyword",
        impact: r.impressions >= 100 ? 2 : 1,
        title: P(`Seguir «${r.key}» en Google`, `Track “${r.key}” on Google`),
        detail: P(
          `La gente ya te encuentra en Google buscando «${r.key}» (estás cerca del lugar ${Math.round(r.position)}). Si la sigues, verás cada semana si subes.`,
          `People already find you on Google searching “${r.key}” (you're around position ${Math.round(r.position)}). If you track it, you'll see each week whether you move up.`,
        ),
        action: { type: "keyword.track", keywords: [r.key] },
        key: `keyword:track:${kwKey(r.key)}`,
        rule: "gsc-query",
        facts: [
          { label: P("Veces que apareciste en Google", "Times you appeared on Google"), value: n0(r.impressions) },
          { label: P("Clics", "Clicks"), value: n0(r.clicks) },
          { label: P("Posición promedio", "Average position"), value: (Math.round(r.position * 10) / 10).toString() },
        ],
        source: SOURCE_GSC,
      });
      if (d) out.push(d);
    }
  }
  if (x.stats.rankMoves) {
    const rising = x.stats.rankMoves
      .filter((r) => r.now !== null && r.now <= 10 && (r.prev === null || r.prev - r.now >= 3))
      .map((r) => ({ keyword: r.keyword, now: r.now as number, was: r.prev }))
      .slice(0, 5);
    for (const c of postingCampaigns(x.campaigns).filter((c) => c.status === "active" || c.status === "draft")) {
      const have = new Set(c.keywords.map(kwKey));
      const add = rising.filter((r) => !have.has(kwKey(r.keyword))).slice(0, 3);
      if (!add.length) continue;
      const words = add.map((r) => r.keyword);
      const d = make(x, c, {
        kind: "keyword",
        impact: 2,
        title: P(`Usar ${words.map((w) => `«${w}»`).join(", ")} en «${c.name}»`, `Use ${words.map((w) => `“${w}”`).join(", ")} in “${c.name}”`),
        detail: P(
          "Estas búsquedas están subiendo en Google para ti. Usarlas en los textos de la campaña ayuda a que suban más.",
          "These searches are rising on Google for you. Using them in the campaign's texts helps them rise more.",
        ),
        action: { type: "campaign.update", campaignId: c.id, patch: { addKeywords: words } },
        key: `keyword:campaign:${c.id}:${words.map(kwKey).sort().join("+")}`,
        rule: "rank-rising",
        facts: add.map((r) => ({
          label: P(`«${r.keyword}»`, `“${r.keyword}”`),
          value: r.was === null ? `— → ${r.now}` : `${r.was} → ${r.now}`,
        })),
        source: SOURCE_RANK,
      });
      if (d) out.push(d);
    }
  }
  return out;
}

/** Todas las reglas, de más a menos impacto, sin repetir la misma clave. */
export function detectProposals(x: RulesInput): ProposalDraft[] {
  const all = [...adRules(x), ...timingRules(x), ...formatRules(x), ...channelRules(x), ...keywordRules(x)];
  const seen = new Set<string>();
  return all
    .filter((d) => (seen.has(d.evidence.key) ? false : (seen.add(d.evidence.key), true)))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 12);
}
