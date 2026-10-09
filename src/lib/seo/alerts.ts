// Avisos de SEO por email: un aviso cuando la revisión diaria automática encuentra que bajaste en Google,
// y un resumen cada lunes (posiciones, competidores, IAs, salud de la página, Search Console y recomendaciones).
// Las funciones que arman los avisos y los emails son puras (se prueban en tests/seo-alerts.test.ts).
import { brevoDomains, brevoEnvKey } from "@/lib/brevo";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { BiError, intlLocale, type UiLang } from "@/lib/i18n";
import { isBrevo, parseFrom } from "@/lib/publishers/messaging";
import { fetchJson } from "@/lib/publishers/http";
import { escapeHtml } from "@/lib/text";
import { BUSINESS_TZ } from "@/lib/time";
import { readAuditReport } from "@/lib/seo/audit";
import { readBacklinksReport, type BacklinksReport } from "@/lib/seo/backlinks";
import { buildCannibal, type CannibalReport } from "@/lib/seo/cannibal";
import { businessTopicVocab, relevantGapRows } from "@/lib/seo/gap";
import { readReviewsReport } from "@/lib/seo/gbp";
import { readZones, zoneLabel } from "@/lib/seo/dataforseo";
import { asGscReport } from "@/lib/seo/gsc";
import { readKeywordsReport, type KeywordsReport } from "@/lib/seo/keywords";
import { readMapReport } from "@/lib/seo/maprank";
import { readRankReport, type RankReport, type RankRow } from "@/lib/seo/rank";
import { mapGroups, marketSummary, organicChange, organicShare, pctText, type MarketSummary } from "@/lib/seo/sov";
import { changeText, hasData, latestMonth, readTrafficReport, siteName, trafficDelta, visitsText, type TrafficReport } from "@/lib/seo/traffic";
import { readVisibilityReport, sentimentText, type VisibilityReport } from "@/lib/seo/visibility";
import { groupByZone, latestByZone } from "@/lib/seo/zones";

const DAY_MS = 24 * 3600_000;
/** Lugar que se usa para "no sale en los primeros 20" al medir cuánto subió o bajó. */
const OUT = 21;

// ---------- Destinatarios ----------

export const MAX_ALERT_EMAILS = 3;
const EMAIL_RE = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[a-z]{2,}$/i;

/** "a@x.com, b@y.com" → lista limpia (minúsculas, sin repetir). Error si alguno no es válido o son más de 3. */
export function parseAlertEmails(raw: string): { ok: true; emails: string[] } | { ok: false; bad: string; tooMany?: boolean } {
  const parts = raw
    .split(/[,;\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const emails = [...new Set(parts)];
  if (emails.length > MAX_ALERT_EMAILS) return { ok: false, bad: emails.slice(MAX_ALERT_EMAILS).join(", "), tooMany: true };
  const bad = emails.find((e) => !EMAIL_RE.test(e) || e.length > 200);
  if (bad) return { ok: false, bad };
  return { ok: true, emails };
}

/** Los destinatarios guardados, o [] si no hay o alguno no es válido. */
export function alertRecipients(raw: string): string[] {
  const r = parseAlertEmails(raw);
  return r.ok ? r.emails : [];
}

// ---------- Avisos de posiciones (puros) ----------

export type RankAlertKind = "drop" | "page1-exit" | "map-exit" | "new-competitor" | "climb" | "top3-enter" | "map-enter";
export type RankAlert = {
  kind: RankAlertKind;
  keyword: string;
  /** Lugar antes y ahora (orgánico, o en el mapa para map-exit/map-enter). null = no salía / no sale. */
  from: number | null;
  to: number | null;
  /** Para new-competitor: el dominio que entró al top 3. */
  domain?: string;
};
export type RankAlerts = { zone: string; bad: RankAlert[]; good: RankAlert[] };

const effective = (p: number | null) => p ?? OUT;
const mapPos = (r: RankRow) => r.localPack?.position ?? null;

/**
 * Compara dos revisiones de la MISMA zona y devuelve lo malo (bajó 3 o más lugares, salió de la primera página,
 * salió de los 3 del mapa, un dominio nuevo entró al top 3 por encima tuyo) y lo bueno (subió 3 o más, entró al
 * top 3, entró a los 3 del mapa). Las palabras con error en cualquiera de las dos se ignoran.
 */
export function rankAlerts(prev: RankReport, cur: RankReport): RankAlerts {
  const before = new Map(prev.rows.filter((r) => !r.error).map((r) => [r.keyword.toLowerCase(), r]));
  const bad: RankAlert[] = [];
  const good: RankAlert[] = [];
  for (const r of cur.rows) {
    if (r.error) continue;
    const p = before.get(r.keyword.toLowerCase());
    if (!p) continue;
    const was = p.position;
    const now = r.position;
    const delta = was === null && now === null ? 0 : effective(was) - effective(now);

    // Orgánico: salir de la primera página es lo más grave; si no, bajar 3 o más.
    if (was !== null && was <= 10 && (now === null || now > 10)) bad.push({ kind: "page1-exit", keyword: r.keyword, from: was, to: now });
    else if (was !== null && delta <= -3) bad.push({ kind: "drop", keyword: r.keyword, from: was, to: now });
    // Lo bueno: entrar al top 3 es lo mejor; si no, subir 3 o más.
    if (now !== null && now <= 3 && (was === null || was > 3)) good.push({ kind: "top3-enter", keyword: r.keyword, from: was, to: now });
    else if (now !== null && delta >= 3) good.push({ kind: "climb", keyword: r.keyword, from: was, to: now });

    // Mapa: solo si Google mostró el mapa esta vez (si no lo muestra para nadie, no es un cambio tuyo).
    const mapWas = p.localPack ? mapPos(p) : null;
    const mapNow = r.localPack ? mapPos(r) : null;
    if (mapWas !== null && mapWas <= 3 && r.localPack && (mapNow === null || mapNow > 3)) bad.push({ kind: "map-exit", keyword: r.keyword, from: mapWas, to: mapNow });
    if (mapNow !== null && mapNow <= 3 && (mapWas === null || mapWas > 3)) good.push({ kind: "map-enter", keyword: r.keyword, from: mapWas, to: mapNow });

    // Competidores nuevos en el top 3 por encima tuyo. Sin top anterior (reportes viejos) no hay con qué comparar.
    if (p.top.length) {
      const had = new Set(p.top.filter((t) => t.position <= 3).map((t) => t.domain.toLowerCase()));
      for (const t of r.top) {
        const d = t.domain.toLowerCase();
        if (!d || t.position > 3 || t.position >= effective(now) || had.has(d)) continue;
        bad.push({ kind: "new-competitor", keyword: r.keyword, from: null, to: t.position, domain: t.domain });
      }
    }
  }
  return { zone: zoneLabel(cur.location), bad, good };
}

// ---------- Avisos de las IAs (puros) ----------

export type AiChange = { provider: string; question: string };
export const AI_NAMES: Record<string, string> = { gemini: "Gemini", claude: "Claude", openai: "ChatGPT" };
const qKey = (provider: string, q: string) => `${provider}|${q.trim().toLowerCase().replace(/\s+/g, " ")}`;

/** Preguntas en que una IA te mencionaba y ahora no (lost), y al revés (gained). Las respuestas con error no cuentan. */
export function aiAlerts(prev: VisibilityReport, cur: VisibilityReport): { lost: AiChange[]; gained: AiChange[] } {
  const before = new Map(prev.results.filter((r) => !r.error).map((r) => [qKey(r.provider, r.question), r.mentioned]));
  const lost: AiChange[] = [];
  const gained: AiChange[] = [];
  for (const r of cur.results) {
    if (r.error) continue;
    const was = before.get(qKey(r.provider, r.question));
    if (was === undefined) continue;
    if (was && !r.mentioned) lost.push({ provider: r.provider, question: r.question });
    if (!was && r.mentioned) gained.push({ provider: r.provider, question: r.question });
  }
  return { lost, gained };
}

export type NegativeMention = { provider: string; question: string; reason: string };

/**
 * Menciones donde una IA habla mal de ti y que no estaban antes: la misma IA y la misma pregunta no eran negativas en
 * la revisión anterior (o no había revisión anterior). Las revisiones sin tono leído no avisan nada.
 */
export function newNegativeMentions(prev: VisibilityReport | null | undefined, cur: VisibilityReport): NegativeMention[] {
  if (cur.sentiment?.status !== "ok") return [];
  const before = new Set((prev?.results ?? []).filter((r) => !r.error && r.sentiment?.sentiment === "negativa").map((r) => qKey(r.provider, r.question)));
  return cur.results
    .filter((r) => !r.error && r.mentioned && r.sentiment?.sentiment === "negativa" && !before.has(qKey(r.provider, r.question)))
    .map((r) => ({ provider: r.provider, question: r.question, reason: r.sentiment?.reason ?? "" }));
}

// ---------- Tu parte de Google en el aviso diario (puro) ----------

/** Puntos que tiene que bajar tu parte de los clics de Google (entre dos revisiones) para avisar. */
export const SHARE_ALERT_POINTS = 5;
export type ShareDrop = { from: number; to: number };

/**
 * Si tu parte de los clics de Google bajó 5 puntos o más entre la revisión anterior y esta (comparando solo las
 * palabras que están en las dos, en todas las zonas). `pairs`: por zona, [la actual, la anterior]. En %, sin decimales.
 */
export function shareDrop(pairs: [RankReport, RankReport][], website: string, keywords: KeywordsReport[] = []): ShareDrop | null {
  if (!website.trim() || !pairs.length) return null;
  const opts = { website, keywords };
  const delta = organicChange(pairs, opts);
  const now = organicShare(pairs.map((p) => p[0]), opts);
  if (delta === null || !now || delta > -SHARE_ALERT_POINTS) return null;
  const to = Math.round(now.you * 100);
  return { from: Math.round(now.you * 100 - delta), to };
}

// ---------- ¿Toca el resumen semanal? (puro) ----------

function localParts(date: Date, tz: string): { weekday: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { weekday: parts.weekday, hour: Number(parts.hour) };
}

/** El resumen sale el lunes desde las 8:00 (hora del negocio), si el último se mandó hace más de 6 días. */
export function isWeeklyDue(now: Date, lastSent: Date | null, tz = BUSINESS_TZ): boolean {
  const { weekday, hour } = localParts(now, tz);
  if (weekday !== "Mon" || hour < 8) return false;
  return !lastSent || now.getTime() - lastSent.getTime() > 6 * DAY_MS;
}

// ---------- Emails (puros) ----------

export type EmailBusiness = { id: string; name: string; color: string };
export type BuiltEmail = { subject: string; html: string; text: string };
export type EmailOpts = { baseUrl?: string; tz?: string; /** Cómo dejar de recibir este email (si no, el texto de los avisos). */ offText?: string; /** Ancla de la sección en la página de SEO ("#reporte"). */ anchor?: string };

type Tone = "bad" | "good" | "neutral";
/** Un bloque del cuerpo del email (título, párrafo, lista o tabla). */
export type EmailBlock = Block;
type Block =
  | { kind: "h"; text: string }
  | { kind: "p"; text: string; muted?: boolean }
  | { kind: "list"; items: { text: string; tone?: Tone }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

const baseUrlOf = (opts?: EmailOpts) => (opts?.baseUrl ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const brandColor = (c: string) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()) ? c.trim() : "#126BBC");

/** Texto oscuro o claro según qué tan claro es el color de la marca. */
function textOn(hex: string): string {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#111827" : "#ffffff";
}

const TONE: Record<Tone, string> = { bad: "#b42318", good: "#067647", neutral: "#1f2933" };
const MARK: Record<Tone, string> = { bad: "▼", good: "▲", neutral: "•" };
const FONT = "font-family:Arial,Helvetica,sans-serif;";

function blockHtml(b: Block, color: string): string {
  if (b.kind === "h")
    return `<tr><td style="${FONT}padding:18px 0 6px 0;font-size:17px;font-weight:bold;color:${color};border-bottom:2px solid ${color};">${escapeHtml(b.text)}</td></tr>`;
  if (b.kind === "p")
    return `<tr><td style="${FONT}padding:8px 0;font-size:${b.muted ? 13 : 15}px;line-height:1.5;color:${b.muted ? "#6b7280" : "#1f2933"};">${escapeHtml(b.text)}</td></tr>`;
  if (b.kind === "list")
    return `<tr><td style="padding:6px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${b.items
      .map(
        (i) =>
          `<tr><td valign="top" style="${FONT}width:18px;padding:4px 0;font-size:13px;color:${TONE[i.tone ?? "neutral"]};">${MARK[i.tone ?? "neutral"]}</td><td style="${FONT}padding:4px 0;font-size:15px;line-height:1.45;color:#1f2933;">${escapeHtml(i.text)}</td></tr>`,
      )
      .join("")}</table></td></tr>`;
  const th = b.head
    .map((h, i) => `<th align="${i ? "right" : "left"}" style="${FONT}padding:6px 4px;font-size:12px;color:#6b7280;font-weight:normal;border-bottom:1px solid #e5e7eb;">${escapeHtml(h)}</th>`)
    .join("");
  const rows = b.rows
    .map(
      (r) =>
        `<tr>${r.map((c, i) => `<td align="${i ? "right" : "left"}" style="${FONT}padding:6px 4px;font-size:14px;color:#1f2933;border-bottom:1px solid #f0f1f3;">${escapeHtml(c)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<tr><td style="padding:6px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${th}</tr>${rows}</table></td></tr>`;
}

function blockText(b: Block): string {
  if (b.kind === "h") return `\n${b.text.toUpperCase()}\n${"-".repeat(Math.min(b.text.length, 60))}`;
  if (b.kind === "p") return b.text;
  if (b.kind === "list") return b.items.map((i) => `${i.tone === "bad" ? "(-)" : i.tone === "good" ? "(+)" : " -"} ${i.text}`).join("\n");
  return [b.head.join(" | "), ...b.rows.map((r) => r.join(" | "))].join("\n");
}

/** El email completo (HTML y texto) con el encabezado de la marca, los bloques y el pie. */
export function renderEmail(business: EmailBusiness, lang: UiLang, title: string, blocks: Block[], opts?: EmailOpts): { html: string; text: string } {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const color = brandColor(business.color);
  const fg = textOn(color);
  const base = baseUrlOf(opts);
  const seoUrl = `${base}/b/${encodeURIComponent(business.id)}/seo${opts?.anchor ?? ""}`;
  const offText = opts?.offText ?? t(
    "Para dejar de recibir estos emails: entra a SEO en la app, busca \"Avisos por email\" y quita la marca de cada opción.",
    "To stop these emails: open SEO in the app, find \"Email alerts\" and uncheck each option.",
  );
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;"><tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;">
<tr><td style="${FONT}background:${color};color:${fg};padding:20px 24px;border-radius:8px 8px 0 0;">
<div style="font-size:13px;">${escapeHtml(business.name)}</div>
<div style="font-size:22px;font-weight:bold;line-height:1.3;">${escapeHtml(title)}</div>
</td></tr>
<tr><td style="padding:8px 24px 16px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${blocks.map((b) => blockHtml(b, color)).join("\n")}
</table></td></tr>
<tr><td align="center" style="padding:4px 24px 20px 24px;"><a href="${escapeHtml(seoUrl)}" style="${FONT}display:inline-block;background:${color};color:${fg};text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:6px;">${escapeHtml(t("Ver todo en la app", "See everything in the app"))}</a></td></tr>
<tr><td style="${FONT}padding:14px 24px 20px 24px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280;">
${escapeHtml(t(`Este email lo manda Nehora para ${business.name}.`, `This email is sent by Nehora for ${business.name}.`))}
<a href="${escapeHtml(seoUrl)}" style="color:#6b7280;">${escapeHtml(seoUrl)}</a><br>${escapeHtml(offText)}
</td></tr>
</table></td></tr></table></body></html>`;
  const text = [business.name, title, "", ...blocks.map(blockText), "", `${t("Ver todo en la app", "See everything in the app")}: ${seoUrl}`, "", offText].join("\n");
  return { html, text };
}

const quote = (s: string) => `"${s}"`;

function describeAlert(a: RankAlert, lang: UiLang): string {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const kw = quote(a.keyword);
  // "del lugar 7 al 14" o "del lugar 7 y quedaste fuera de los primeros 20".
  const fromTo = a.to === null ? t(`del lugar ${a.from} y quedaste fuera de los primeros 20`, `from #${a.from} to outside the top 20`) : t(`del lugar ${a.from} al ${a.to}`, `from #${a.from} to #${a.to}`);
  switch (a.kind) {
    case "page1-exit":
      return t(`${kw}: saliste de la primera página de Google (${fromTo}).`, `${kw}: you dropped off Google's first page (${fromTo}).`);
    case "drop":
      return t(`${kw}: bajaste ${fromTo}.`, `${kw}: you dropped ${fromTo}.`);
    case "map-exit":
      return a.to === null
        ? t(`${kw}: ya no sales entre los 3 negocios del mapa (estabas en el lugar ${a.from}).`, `${kw}: you're no longer in the map's top 3 (you were #${a.from}).`)
        : t(`${kw}: bajaste en el mapa del lugar ${a.from} al ${a.to}, fuera de los 3 que se ven.`, `${kw}: you dropped in the map from #${a.from} to #${a.to}, out of the 3 that show.`);
    case "new-competitor":
      return t(`${kw}: ${a.domain} entró al top 3 (lugar ${a.to}), por encima de ti.`, `${kw}: ${a.domain} entered the top 3 (#${a.to}), above you.`);
    case "top3-enter":
      return t(`${kw}: ¡entraste al top 3! Ahora estás en el lugar ${a.to}.`, `${kw}: you made the top 3! You're now #${a.to}.`);
    case "climb":
      return a.from === null
        ? t(`${kw}: ahora sales en el lugar ${a.to} (antes no salías en los primeros 20).`, `${kw}: you now show at #${a.to} (you weren't in the top 20 before).`)
        : t(`${kw}: subiste del lugar ${a.from} al ${a.to}.`, `${kw}: you climbed from #${a.from} to #${a.to}.`);
    case "map-enter":
      return t(`${kw}: ahora sales entre los 3 del mapa (lugar ${a.to}).`, `${kw}: you're now in the map's top 3 (#${a.to}).`);
  }
}

/**
 * Email de aviso después de la revisión diaria automática: lo malo primero, luego lo bueno, por zona.
 * `extra.share`: tu parte de los clics de Google bajó 5 puntos o más (shareDrop): va primero, entre lo que bajó.
 */
export function buildAlertEmail(business: EmailBusiness, zones: RankAlerts[], lang: UiLang, opts?: EmailOpts, extra?: { share?: ShareDrop | null }): BuiltEmail {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const share = extra?.share ?? null;
  const badCount = zones.reduce((s, z) => s + z.bad.length, 0) + (share ? 1 : 0);
  const many = zones.filter((z) => z.bad.length || z.good.length).length > 1;
  const where = (z: RankAlerts) => (many && z.zone ? ` (${z.zone})` : "");
  const blocks: Block[] = [
    {
      kind: "p",
      text: t(
        "La revisión diaria de tus posiciones en Google encontró cambios que conviene mirar:",
        "Today's automatic check of your Google rankings found changes worth a look:",
      ),
    },
  ];
  if (share) {
    blocks.push({ kind: "h", text: t("Tu parte de Google", "Your share of Google") });
    blocks.push({
      kind: "list",
      items: [
        {
          tone: "bad",
          text: t(
            `Tu parte de los clics en tus búsquedas de Google bajó del ${share.from}% al ${share.to}%: tu competencia o los directorios se están llevando más.`,
            `Your share of the clicks on your Google searches dropped from ${share.from}% to ${share.to}%: your competitors or directories are getting more.`,
          ),
        },
      ],
    });
  }
  for (const z of zones) {
    if (!z.bad.length) continue;
    blocks.push({ kind: "h", text: t(`Lo que bajó${where(z)}`, `What dropped${where(z)}`) });
    blocks.push({ kind: "list", items: z.bad.map((a) => ({ text: describeAlert(a, lang), tone: "bad" as const })) });
  }
  const good = zones.filter((z) => z.good.length);
  if (good.length) {
    blocks.push({ kind: "h", text: t("Buenas noticias", "Good news") });
    for (const z of good) blocks.push({ kind: "list", items: z.good.map((a) => ({ text: describeAlert(a, lang) + where(z), tone: "good" as const })) });
  }
  blocks.push({
    kind: "p",
    muted: true,
    text: t(
      "Las posiciones cambian un poco de un día a otro. Si algo sigue abajo varios días, revisa esa página de tu sitio o publica algo nuevo sobre ese tema.",
      "Rankings move a little from day to day. If something stays down for several days, review that page on your site or publish something new on that topic.",
    ),
  });
  const subject =
    badCount === 1
      ? t(`Aviso: 1 cambio en tus posiciones en Google — ${business.name}`, `Alert: 1 change in your Google rankings — ${business.name}`)
      : t(`Aviso: ${badCount} cambios en tus posiciones en Google — ${business.name}`, `Alert: ${badCount} changes in your Google rankings — ${business.name}`);
  const title = t("Cambios en tus posiciones en Google", "Changes in your Google rankings");
  return { subject, ...renderEmail(business, lang, title, blocks, opts) };
}

// ---------- Resumen semanal ----------

export type WeeklyZone = { label: string; cur: RankReport; prev: RankReport | null };
export type Recommendation = { keyword: string; volume: number | null; why: "gap" | "idea"; type?: string };
export type WeeklyData = {
  zones: WeeklyZone[];
  ai: { date: string; cur: VisibilityReport; prev: VisibilityReport | null } | null;
  audit: { score: number; date: string } | null;
  gsc: { clicks: number; impressions: number; prevClicks: number; prevImpressions: number; start: string; end: string } | null;
  recommendations: Recommendation[];
  /** Tu Perfil de Google: solo si ya se trajeron las reseñas (opcional, los resúmenes de antes no lo tienen). */
  gbp?: WeeklyGbp | null;
  /** Tu parte del mercado: Google, mapa e IAs (opcional). */
  market?: WeeklyMarket | null;
  /** Enlaces hacia tu página (opcional). */
  links?: WeeklyLinks | null;
  /** Visitas de tu competencia (opcional). */
  traffic?: WeeklyTraffic | null;
  /** Páginas que compiten entre sí: solo si hay alguna urgente (opcional). */
  cannibal?: WeeklyCannibal | null;
};

/** Tu parte de Google, del mapa y de las IAs (0 a 1) y su cambio en puntos porcentuales. */
export type WeeklyMarket = { organic: number | null; organicDelta: number | null; map: number | null; mapDelta: number | null; ai: number | null; aiDelta: number | null };

/** Lo de tu parte del mercado que va en el resumen. null si no hay nada. */
export function weeklyMarket(m: MarketSummary): WeeklyMarket | null {
  if (!m.organic && !m.map && !m.ai) return null;
  return {
    organic: m.organic?.you ?? null,
    organicDelta: m.organicDelta,
    map: m.map?.you ?? null,
    mapDelta: m.mapDelta,
    // Si las IAs no nombraron ningún negocio, no hay "parte" que mostrar.
    ai: m.ai && m.ai.mentions ? m.ai.you : null,
    aiDelta: m.ai && m.ai.mentions ? m.aiDelta : null,
  };
}

export type WeeklyLinks = {
  referringDomains: number | null;
  /** En la revisión anterior (null si no hay). */
  prevReferringDomains: number | null;
  /** Sitios nuevos y perdidos en el último mes (null si DataForSEO no lo dio). */
  newDomains: number | null;
  lostDomains: number | null;
  /** Sitios que enlazan a tu competencia y a ti no. */
  gap: number;
  date: string;
};

/** Lo de tus enlaces que va en el resumen, con la revisión anterior para el cambio. null si no sirve. */
export function weeklyLinks(cur: BacklinksReport | null, prev: BacklinksReport | null = null): WeeklyLinks | null {
  if (!cur) return null;
  const count = (r: BacklinksReport) => r.summary.referringDomains ?? r.referringTotal;
  return {
    referringDomains: count(cur),
    prevReferringDomains: prev ? count(prev) : null,
    newDomains: cur.summary.newDomains1m,
    lostDomains: cur.summary.lostDomains1m,
    gap: cur.gap.length,
    date: cur.createdAt,
  };
}

export type WeeklyTrafficSite = { domain: string; etv: number | null; year: { from: number; to: number } | null };
export type WeeklyTraffic = { you: WeeklyTrafficSite | null; rival: WeeklyTrafficSite | null; date: string };

/** Tú y el competidor que más visitas recibe, con el cambio en un año. null si nadie tiene datos. */
export function weeklyTraffic(report: TrafficReport | null): WeeklyTraffic | null {
  if (!report) return null;
  const end = latestMonth(report.domains);
  const site = (d: TrafficReport["domains"][number]): WeeklyTrafficSite => ({ domain: d.domain, etv: d.now?.etv ?? null, year: trafficDelta(d, 12, end) });
  const you = report.domains.find((d) => d.isYou && hasData(d));
  const rival = report.domains.filter((d) => !d.isYou && hasData(d)).sort((a, b) => (b.now?.etv ?? 0) - (a.now?.etv ?? 0))[0];
  if (!you && !rival) return null;
  return { you: you ? site(you) : null, rival: rival ? site(rival) : null, date: report.createdAt };
}

export type WeeklyCannibal = { urgent: number; query: string; pages: number };

/** La búsqueda urgente de "páginas que compiten entre sí" (null si no hay ninguna urgente). */
export function weeklyCannibal(report: CannibalReport | null): WeeklyCannibal | null {
  const urgent = (report?.issues ?? []).filter((i) => i.severity === "alta");
  return urgent[0] ? { urgent: urgent.length, query: urgent[0].query, pages: urgent[0].pages.length } : null;
}

/** Lo del Perfil de Google que va en el resumen semanal. */
export type WeeklyGbp = {
  rating: number | null;
  /** Reseñas en total en Google. */
  total: number | null;
  /** Reseñas nuevas en los 7 días antes del resumen. */
  newLast7: number;
  unanswered: number;
  /** Cuándo se trajeron las reseñas (ISO). */
  date: string;
};

/** Lo del Perfil de Google para el resumen, desde el último reporte de reseñas. null si no sirve. */
export function weeklyGbp(json: unknown, now = new Date()): WeeklyGbp | null {
  const r = readReviewsReport(json);
  if (!r) return null;
  const from = now.getTime() - 7 * DAY_MS;
  const newLast7 = r.reviews.filter((x) => {
    const at = x.timestamp ? Date.parse(x.timestamp) : NaN;
    return at >= from && at <= now.getTime() + DAY_MS;
  }).length;
  return { rating: r.rating ?? r.stats.average, total: r.total, newLast7, unanswered: r.stats.unanswered, date: r.createdAt };
}

export type Mover = { keyword: string; zone: string; from: number | null; to: number | null; delta: number };

/** Lo que más subió y más bajó (hasta 5 de cada uno), comparando cada zona con su revisión de hace ~7 días. */
export function weeklyMovers(zones: WeeklyZone[], n = 5): { climbs: Mover[]; drops: Mover[] } {
  const all: Mover[] = [];
  const many = zones.length > 1;
  for (const z of zones) {
    if (!z.prev) continue;
    const before = new Map(z.prev.rows.filter((r) => !r.error).map((r) => [r.keyword.toLowerCase(), r]));
    for (const r of z.cur.rows) {
      const p = before.get(r.keyword.toLowerCase());
      if (r.error || !p || (p.position === null && r.position === null)) continue;
      const delta = effective(p.position) - effective(r.position);
      if (delta) all.push({ keyword: r.keyword, zone: many ? z.label : "", from: p.position, to: r.position, delta });
    }
  }
  return {
    climbs: all.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, n),
    drops: all.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, n),
  };
}

/** Dominios que entraron al top 3 esta semana (por encima tuyo), sin repetir. */
export function weeklyNewCompetitors(zones: WeeklyZone[]): { domain: string; keyword: string; position: number; zone: string }[] {
  const seen = new Set<string>();
  const out: { domain: string; keyword: string; position: number; zone: string }[] = [];
  for (const z of zones) {
    if (!z.prev) continue;
    for (const a of rankAlerts(z.prev, z.cur).bad) {
      if (a.kind !== "new-competitor" || !a.domain || seen.has(a.domain.toLowerCase())) continue;
      seen.add(a.domain.toLowerCase());
      out.push({ domain: a.domain, keyword: a.keyword, position: a.to ?? 0, zone: zones.length > 1 ? z.label : "" });
    }
  }
  return out;
}

export function buildWeeklyEmail(business: EmailBusiness, data: WeeklyData, lang: UiLang, opts?: EmailOpts): BuiltEmail {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const tz = opts?.tz ?? BUSINESS_TZ;
  const nf = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });
  const day = (iso: string, zone = tz) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat(intlLocale(lang), { timeZone: zone, day: "numeric", month: "short", year: "numeric" }).format(d);
  };
  const signed = (n: number) => (n > 0 ? `+${nf.format(n)}` : nf.format(n));
  const withChange = (now: number | null, before: number | null | undefined, lowerIsBetter = false) => {
    if (now === null) return "—";
    if (before === null || before === undefined) return nf.format(now);
    const diff = Math.round((lowerIsBetter ? before - now : now - before) * 10) / 10;
    return diff ? `${nf.format(now)} (${signed(diff)})` : nf.format(now);
  };
  const pos = (p: number | null) => (p === null ? t("fuera de 20", "out of 20") : String(p));
  const blocks: Block[] = [];

  // Posiciones por zona.
  const zones = data.zones.filter((z) => z.cur.rows.length);
  if (zones.length) {
    blocks.push({ kind: "h", text: t("Tus posiciones en Google", "Your Google rankings") });
    blocks.push({
      kind: "table",
      head: [t("Zona", "Area"), t("Promedio", "Average"), "Top 3", "Top 10", t("Visibilidad", "Visibility")],
      rows: zones.map((z) => [
        z.label || "—",
        withChange(z.cur.avgPosition, z.prev ? z.prev.avgPosition : undefined, true),
        withChange(z.cur.inTop3, z.prev?.inTop3),
        withChange(z.cur.inTop10, z.prev?.inTop10),
        `${withChange(z.cur.visibility, z.prev?.visibility)}`,
      ]),
    });
    const comparedAt = zones.find((z) => z.prev)?.prev?.createdAt;
    blocks.push({
      kind: "p",
      muted: true,
      text: comparedAt
        ? t(
            `Promedio = lugar promedio donde sales (más bajo es mejor). Entre paréntesis, el cambio comparado con la revisión del ${day(comparedAt)} (positivo = mejoró).`,
            `Average = your average position (lower is better). In parentheses, the change vs. the check on ${day(comparedAt)} (positive = better).`,
          )
        : t("Promedio = lugar promedio donde sales (más bajo es mejor).", "Average = your average position (lower is better)."),
    });
    const { climbs, drops } = weeklyMovers(zones);
    const where = (m: Mover) => (m.zone ? ` (${m.zone})` : "");
    if (climbs.length) {
      blocks.push({ kind: "h", text: t("Lo que más subió", "Biggest climbs") });
      blocks.push({ kind: "list", items: climbs.map((m) => ({ tone: "good" as const, text: `${quote(m.keyword)}${where(m)}: ${pos(m.from)} → ${pos(m.to)}` })) });
    }
    if (drops.length) {
      blocks.push({ kind: "h", text: t("Lo que más bajó", "Biggest drops") });
      blocks.push({ kind: "list", items: drops.map((m) => ({ tone: "bad" as const, text: `${quote(m.keyword)}${where(m)}: ${pos(m.from)} → ${pos(m.to)}` })) });
    }
    const rivals = weeklyNewCompetitors(zones);
    if (rivals.length) {
      blocks.push({ kind: "h", text: t("Competidores nuevos en el top 3", "New competitors in the top 3") });
      blocks.push({
        kind: "list",
        items: rivals.slice(0, 8).map((c) => ({
          tone: "bad" as const,
          text: t(`${c.domain}: lugar ${c.position} en ${quote(c.keyword)}`, `${c.domain}: #${c.position} for ${quote(c.keyword)}`) + (c.zone ? ` (${c.zone})` : ""),
        })),
      });
    }
  }

  // Tu parte del mercado (Google, mapa e IAs), en una línea.
  if (data.market) {
    const m = data.market;
    const pts = (d: number | null) => (d ? ` (${d > 0 ? "+" : "−"}${nf.format(Math.abs(d))} pts)` : "");
    const parts = [
      m.organic !== null ? `Google: ${pctText(m.organic)}${pts(m.organicDelta)}` : "",
      m.map !== null ? t(`Mapa: ${pctText(m.map)}${pts(m.mapDelta)}`, `Map: ${pctText(m.map)}${pts(m.mapDelta)}`) : "",
      m.ai !== null ? t(`IAs: ${pctText(m.ai)}${pts(m.aiDelta)}`, `AIs: ${pctText(m.ai)}${pts(m.aiDelta)}`) : "",
    ].filter(Boolean);
    if (parts.length) {
      blocks.push({ kind: "h", text: t("Tu parte del mercado", "Your share of the market") });
      blocks.push({ kind: "p", text: parts.join(" · ") });
      blocks.push({
        kind: "p",
        muted: true,
        text: t(
          "Qué parte de los clics de tus búsquedas en Google, de los 3 primeros lugares del mapa y de los negocios que nombran las IAs te llevas tú. Entre paréntesis, el cambio con la revisión anterior.",
          "How much of the clicks on your Google searches, the map's top 3 spots and the businesses the AIs name goes to you. In parentheses, the change vs. the previous check.",
        ),
      });
    }
  }

  // Visibilidad en las IAs.
  if (data.ai) {
    const { cur, prev } = data.ai;
    const providers = Object.entries(cur.byProvider).flatMap(([id, s]) => (s && s.score !== null ? [{ id, score: s.score }] : []));
    if (providers.length || cur.score !== null) {
      blocks.push({ kind: "h", text: t("¿Te recomiendan las IAs?", "Do AI assistants recommend you?") });
      blocks.push({
        kind: "table",
        head: [t("IA", "AI"), t("Te mencionan", "Mention you")],
        rows: [
          ...providers.map((p) => [AI_NAMES[p.id] ?? p.id, `${withChange(p.score, prev?.byProvider[p.id as keyof typeof prev.byProvider]?.score ?? undefined)}%`]),
          ...(cur.score !== null ? [[t("Total", "Overall"), `${withChange(cur.score, prev?.score ?? undefined)}%`]] : []),
        ],
      });
      if (prev) {
        const { lost, gained } = aiAlerts(prev, cur);
        const items = [
          ...lost.slice(0, 5).map((c) => ({ tone: "bad" as const, text: t(`${AI_NAMES[c.provider] ?? c.provider} ya no te menciona en: ${quote(c.question)}`, `${AI_NAMES[c.provider] ?? c.provider} no longer mentions you for: ${quote(c.question)}`) })),
          ...gained.slice(0, 5).map((c) => ({ tone: "good" as const, text: t(`${AI_NAMES[c.provider] ?? c.provider} ahora te menciona en: ${quote(c.question)}`, `${AI_NAMES[c.provider] ?? c.provider} now mentions you for: ${quote(c.question)}`) })),
        ];
        if (items.length) blocks.push({ kind: "list", items });
      }
      blocks.push({
        kind: "p",
        muted: true,
        text: prev
          ? t(`% de respuestas que te mencionan. Revisión del ${day(data.ai.date)}; entre paréntesis, el cambio con la anterior.`, `% of answers that mention you. Check from ${day(data.ai.date)}; in parentheses, the change vs. the previous one.`)
          : t(`% de respuestas que te mencionan. Revisión del ${day(data.ai.date)}.`, `% of answers that mention you. Check from ${day(data.ai.date)}.`),
      });
    }

    // Cómo hablan de ti (solo si se leyó el tono): los conteos y, si apareció, la mención negativa nueva.
    const sent = cur.sentiment;
    if (sent && sent.status === "ok" && sent.total > 0) {
      const counts = sentimentText(sent);
      const fresh = newNegativeMentions(prev, cur);
      const items: { text: string; tone?: Tone }[] = [{ tone: sent.negativa > sent.positiva ? "bad" : sent.negativa ? "neutral" : sent.positiva ? "good" : "neutral", text: t(counts.es, counts.en) + "." }];
      if (fresh.length) {
        const f = fresh[0];
        const name = AI_NAMES[f.provider] ?? f.provider;
        const why = f.reason.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
        const short = why.length > 140 ? `${why.slice(0, 139).trimEnd()}…` : why;
        const more = fresh.length - 1;
        items.push({
          tone: "bad",
          text:
            t(`Nueva mención negativa: ${name}, en ${quote(f.question)}`, `New negative mention: ${name}, for ${quote(f.question)}`) +
            (short ? `: ${short}` : "") +
            (more ? t(` (y ${more} más)`, ` (and ${more} more)`) : "") +
            ".",
        });
      }
      blocks.push({ kind: "h", text: t("Cómo hablan de ti las IAs", "How the AIs talk about you") });
      blocks.push({ kind: "list", items });
    }
  }

  // Salud de la página.
  if (data.audit) {
    blocks.push({ kind: "h", text: t("Salud de tu página web", "Your website's health") });
    blocks.push({ kind: "p", text: t(`Puntaje: ${data.audit.score} de 100 (revisión del ${day(data.audit.date)}).`, `Score: ${data.audit.score} out of 100 (check from ${day(data.audit.date)}).`) });
  }

  // Páginas que compiten entre sí: una línea, solo si hay alguna urgente.
  if (data.cannibal) {
    const c = data.cannibal;
    const more = c.urgent - 1;
    blocks.push({ kind: "h", text: t("Páginas que compiten entre sí", "Pages competing with each other") });
    blocks.push({
      kind: "list",
      items: [
        {
          tone: "bad",
          text: t(
            `Urgente: para ${quote(c.query)}, ${c.pages} de tus páginas compiten entre sí en Google y se reparten las visitas${more ? ` (y ${more} búsqueda${more === 1 ? "" : "s"} más)` : ""}. En la app te decimos cómo arreglarlo.`,
            `Urgent: for ${quote(c.query)}, ${c.pages} of your pages compete with each other on Google and split the visits${more ? ` (and ${more} more search${more === 1 ? "" : "es"})` : ""}. The app shows you how to fix it.`,
          ),
        },
      ],
    });
  }

  // Search Console.
  if (data.gsc) {
    const g = data.gsc;
    const int = new Intl.NumberFormat(intlLocale(lang));
    const ch = (now: number, before: number) => (before > 0 ? ` (${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}%)` : "");
    blocks.push({ kind: "h", text: t("Google Search Console", "Google Search Console") });
    blocks.push({
      kind: "list",
      items: [
        { text: t(`Clics desde Google: ${int.format(g.clicks)}${ch(g.clicks, g.prevClicks)}`, `Clicks from Google: ${int.format(g.clicks)}${ch(g.clicks, g.prevClicks)}`) },
        { text: t(`Veces que saliste en Google: ${int.format(g.impressions)}${ch(g.impressions, g.prevImpressions)}`, `Times you showed on Google: ${int.format(g.impressions)}${ch(g.impressions, g.prevImpressions)}`) },
      ],
    });
    if (g.start && g.end)
      blocks.push({
        kind: "p",
        muted: true,
        text: t(`Del ${day(`${g.start}T12:00:00Z`, "UTC")} al ${day(`${g.end}T12:00:00Z`, "UTC")}, comparado con el periodo anterior.`, `From ${day(`${g.start}T12:00:00Z`, "UTC")} to ${day(`${g.end}T12:00:00Z`, "UTC")}, compared with the previous period.`),
      });
  }

  // Tu Perfil de Google (reseñas).
  if (data.gbp) {
    const g = data.gbp;
    const int = new Intl.NumberFormat(intlLocale(lang));
    blocks.push({ kind: "h", text: t("Tu perfil de Google", "Your Google Business Profile") });
    const items: { text: string; tone?: Tone }[] = [];
    if (g.rating !== null)
      items.push({
        text:
          t(`Calificación: ${nf.format(g.rating)} ★`, `Rating: ${nf.format(g.rating)} ★`) +
          (g.total !== null ? t(` (${int.format(g.total)} reseñas)`, ` (${int.format(g.total)} reviews)`) : ""),
      });
    items.push({
      tone: g.newLast7 > 0 ? "good" : "neutral",
      text: g.newLast7
        ? t(`Reseñas nuevas en los últimos 7 días: ${g.newLast7}`, `New reviews in the last 7 days: ${g.newLast7}`)
        : t("No hubo reseñas nuevas en los últimos 7 días.", "No new reviews in the last 7 days."),
    });
    items.push({
      tone: g.unanswered > 0 ? "bad" : "good",
      text: g.unanswered
        ? t(`Reseñas sin contestar: ${g.unanswered}. En la app la IA te escribe las respuestas.`, `Unanswered reviews: ${g.unanswered}. In the app the AI writes the replies for you.`)
        : t("Todas tus reseñas están contestadas.", "All your reviews are answered."),
    });
    blocks.push({ kind: "list", items });
    const when = day(g.date);
    if (when) blocks.push({ kind: "p", muted: true, text: t(`Según tus reseñas traídas el ${when}.`, `Based on your reviews fetched on ${when}.`) });
  }

  // Enlaces hacia tu página.
  if (data.links && data.links.referringDomains !== null) {
    const l = data.links;
    const int = new Intl.NumberFormat(intlLocale(lang));
    const items: { text: string; tone?: Tone }[] = [
      {
        tone: l.prevReferringDomains === null || l.referringDomains === l.prevReferringDomains ? "neutral" : l.referringDomains! > l.prevReferringDomains ? "good" : "bad",
        text: t(`Sitios que te enlazan: ${withChange(l.referringDomains, l.prevReferringDomains)}`, `Sites linking to you: ${withChange(l.referringDomains, l.prevReferringDomains)}`),
      },
    ];
    const month =
      l.newDomains !== null || l.lostDomains !== null
        ? t(
            `En el último mes: ${int.format(l.newDomains ?? 0)} ${l.newDomains === 1 ? "nuevo" : "nuevos"} y ${int.format(l.lostDomains ?? 0)} ${l.lostDomains === 1 ? "perdido" : "perdidos"}`,
            `In the last month: ${int.format(l.newDomains ?? 0)} new and ${int.format(l.lostDomains ?? 0)} lost`,
          )
        : "";
    const gap = l.gap ? t(`${int.format(l.gap)} sitios enlazan a tu competencia y a ti no`, `${int.format(l.gap)} sites link to your competitors but not to you`) : "";
    if (month || gap) items.push({ text: [month, gap].filter(Boolean).join(" · ") + "." });
    blocks.push({ kind: "h", text: t("Enlaces hacia tu página", "Links to your website") });
    blocks.push({ kind: "list", items });
  }

  // Visitas de tu competencia: tú contra el que más recibe, y cómo cambió en un año.
  if (data.traffic) {
    const tr = data.traffic;
    const v = (x: number | null) => visitsText(x, lang);
    const who = [
      tr.you ? t(`tú unas ${v(tr.you.etv)}`, `you about ${v(tr.you.etv)}`) : "",
      tr.rival ? t(`${siteName(tr.rival.domain)} unas ${v(tr.rival.etv)}`, `${siteName(tr.rival.domain)} about ${v(tr.rival.etv)}`) : "",
    ].filter(Boolean);
    const yours = tr.you?.year;
    const year = [
      tr.rival?.year ? changeText(siteName(tr.rival.domain), tr.rival.year) : null,
      // Solo tú: "pasaste de 1 a 3 visitas al mes".
      yours ? (tr.rival?.year ? changeText(null, yours) : { es: `pasaste de ${visitsText(yours.from, "es")} a ${visitsText(yours.to, "es")} visitas al mes`, en: `you went from ${visitsText(yours.from, "en")} to ${visitsText(yours.to, "en")} visits a month` }) : null,
    ].filter((x) => x !== null);
    const items: { text: string; tone?: Tone }[] = [{ text: t(`Visitas al mes desde Google: ${who.join(" · ")}.`, `Monthly visits from Google: ${who.join(" · ")}.`) }];
    if (year.length) items.push({ text: t(`En un año, ${year.map((x) => x.es).join("; ")}.`, `Over a year, ${year.map((x) => x.en).join("; ")}.`) });
    blocks.push({ kind: "h", text: t("Visitas de tu competencia", "Your competitors' visits") });
    blocks.push({ kind: "list", items });
  }

  // Recomendaciones.
  if (data.recommendations.length) {
    const int = new Intl.NumberFormat(intlLocale(lang));
    blocks.push({ kind: "h", text: t("Lo que te recomendamos esta semana", "What we recommend this week") });
    blocks.push({
      kind: "list",
      items: data.recommendations.slice(0, 3).map((r) => {
        const vol = r.volume ? t(` (${int.format(r.volume)} búsquedas al mes)`, ` (${int.format(r.volume)} searches a month)`) : "";
        const why =
          r.why === "gap" && r.type === "weak"
            ? t("Ya sales con esta búsqueda, pero tus competidores están más arriba: mejora esa página.", "You already show up for this search, but your competitors rank higher: improve that page.")
            : r.why === "gap"
            ? t("Tus competidores salen en Google con esta búsqueda: crea o mejora una página sobre esto.", "Your competitors show up on Google for this search: create or improve a page about it.")
            : t("Mucha gente lo busca: escribe una página o publicación sobre esto.", "Lots of people search for it: write a page or post about it.");
        return { text: `${quote(r.keyword)}${vol}. ${why}` };
      }),
    });
  }

  if (!blocks.length)
    blocks.push({
      kind: "p",
      text: t(
        "Todavía no hay datos de SEO para resumir. Entra a SEO en la app para revisar tus posiciones en Google, tu página o las IAs.",
        "There's no SEO data to summarize yet. Open SEO in the app to check your Google rankings, your website or the AI assistants.",
      ),
    });
  else blocks.unshift({ kind: "p", text: t("Así te fue esta semana en Google y en las IAs:", "Here's how you did this week on Google and in AI assistants:") });

  const subject = t(`Tu resumen SEO de la semana — ${business.name}`, `Your weekly SEO summary — ${business.name}`);
  return { subject, ...renderEmail(business, lang, t("Tu resumen SEO de la semana", "Your weekly SEO summary"), blocks, opts) };
}

/** Lee el reporte de oportunidades ("gap") sin confiar en su forma; [] si no se parece a lo esperado. */
export function readGapRecommendations(json: unknown, n = 3): Recommendation[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];
  const rows = (json as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return rows
    .flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const r = raw as Record<string, unknown>;
      const keyword = typeof r.keyword === "string" ? r.keyword.trim().slice(0, 120) : "";
      if (!keyword) return [];
      const rank = num(r.score) ?? num(r.opportunity) ?? num(r.volume) ?? 0;
      const rec: Recommendation = { keyword, volume: num(r.volume), why: "gap", ...(typeof r.type === "string" ? { type: r.type.slice(0, 40) } : {}) };
      return [{ rec, rank }];
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, n)
    .map((x) => x.rec);
}

// ---------- Datos del resumen (base de datos) ----------

/** El reporte más cercano a 7 días antes de `cur` (al menos 1 día más viejo), de la misma zona. */
export function closestWeekBefore(cur: RankReport, older: RankReport[]): RankReport | null {
  const curAt = Date.parse(cur.createdAt);
  const target = curAt - 7 * DAY_MS;
  let best: RankReport | null = null;
  for (const r of older) {
    const at = Date.parse(r.createdAt);
    if (!(curAt - at >= DAY_MS)) continue;
    if (!best || Math.abs(at - target) < Math.abs(Date.parse(best.createdAt) - target)) best = r;
  }
  return best;
}

/** Junta lo que va en el resumen semanal. Cada parte falta (null o vacía) si no hay datos. */
export async function gatherWeekly(businessId: string, now = new Date()): Promise<WeeklyData> {
  const b = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { name: true, website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoKeywords: true, study: true },
  });
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const latest = (kind: string, take = 1) => db.seoReport.findMany({ where: { businessId, kind }, orderBy: { createdAt: "desc" }, take, select: { data: true, createdAt: true } });
  // Las partes nuevas (mapa, enlaces, visitas) son opcionales: si su lectura falla, el resumen sale igual.
  const optional = (kind: string, take = 1) => latest(kind, take).catch(() => []);

  const [rankRows, aiRows, auditRows, gscRows, gapRows, kwRows, reviewRows, mapRows, linkRows, trafficRows] = await Promise.all([
    db.seoReport.findMany({
      where: { businessId, kind: "rank", createdAt: { gte: new Date(now.getTime() - 21 * DAY_MS) } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { data: true, createdAt: true },
    }),
    latest("ai", 2),
    latest("audit"),
    latest("gsc"),
    latest("gap"),
    // El último de cada zona (para pesar tu parte de Google por búsquedas al mes).
    latest("keywords", 2 * Math.max(1, zones.length)),
    latest("reviews"),
    optional("maprank", 10),
    optional("backlinks", 2),
    optional("traffic"),
  ]);

  const ranks = rankRows
    .map((r) => {
      const rep = readRankReport(r.data);
      // Reportes sin fecha propia: la de la fila.
      return rep && rep.createdAt === new Date(0).toISOString() ? { ...rep, createdAt: r.createdAt.toISOString() } : rep;
    })
    .filter((r): r is RankReport => r !== null);
  const weeklyZones: WeeklyZone[] = [];
  // Para tu parte de Google: por zona, [la actual, la de hace ~7 días], con el código de la zona.
  const shareZones: RankReport[][] = [];
  for (const [code, list] of groupByZone(ranks, zones)) {
    const [cur, ...older] = list;
    if (!cur) continue;
    const zone = zones.find((z) => z.code === code);
    const prev = closestWeekBefore(cur, older);
    weeklyZones.push({ label: zoneLabel(zone?.name || cur.location), cur, prev });
    shareZones.push([cur, ...(prev ? [prev] : [])].map((r) => ({ ...r, locationCode: code })));
  }

  const ai = aiRows.map((r) => ({ rep: readVisibilityReport(r.data), at: r.createdAt })).filter((r) => r.rep);
  const audit = auditRows[0] ? readAuditReport(auditRows[0].data) : null;
  const gsc = gscRows[0] ? asGscReport(gscRows[0].data) : null;

  // Tu parte del mercado: Google (contra hace ~7 días), el mapa y las IAs (contra la revisión anterior).
  const main = zones[0]?.code;
  const kwByZone = latestByZone(kwRows.map((r) => readKeywordsReport(r.data)), zones);
  const market = weeklyMarket(
    marketSummary({
      website: b.website,
      rankByZone: shareZones,
      keywords: [...kwByZone.entries()].sort(([a], [c]) => Number(c === main) - Number(a === main)).map(([code, k]) => ({ ...k, locationCode: code })),
      maps: mapGroups(mapRows.flatMap((r) => readMapReport(r.data) ?? [])),
      ai: [ai[0]?.rep, ai[1]?.rep],
    }),
  );

  // Páginas que compiten entre sí: solo Search Console puede marcar una búsqueda como urgente.
  const cannibal = gsc?.pageQueries.length
    ? weeklyCannibal(buildCannibal({ businessName: b.name, website: b.website, zones, gsc: { pageQueries: gsc.pageQueries, range: gsc.range }, ranks: [], audit, now }))
    : null;

  // Solo búsquedas que tienen que ver con el negocio (los reportes viejos pueden traer de todo).
  const vocab = businessTopicVocab(b);
  let recommendations = gapRows[0] ? relevantGapRows(readGapRecommendations(gapRows[0].data, 50), vocab).slice(0, 3) : [];
  if (!recommendations.length && kwRows[0]) {
    const kw = readKeywordsReport(kwRows[0].data);
    const tracked = new Set((Array.isArray(b.seoKeywords) ? b.seoKeywords : []).map((k) => String(k).toLowerCase()));
    recommendations = relevantGapRows(kw?.ideas ?? [], vocab)
      .filter((i) => !tracked.has(i.keyword.toLowerCase()) && (i.volume ?? 0) > 0)
      .sort((a, c) => (c.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 3)
      .map((i) => ({ keyword: i.keyword, volume: i.volume, why: "idea" as const }));
  }

  return {
    zones: weeklyZones,
    ai: ai[0]?.rep ? { date: ai[0].rep.finishedAt || ai[0].at.toISOString(), cur: ai[0].rep, prev: ai[1]?.rep ?? null } : null,
    audit: audit && auditRows[0] ? { score: audit.score, date: audit.finishedAt || auditRows[0].createdAt.toISOString() } : null,
    gsc: gsc
      ? { clicks: gsc.totals.clicks, impressions: gsc.totals.impressions, prevClicks: gsc.previous.clicks, prevImpressions: gsc.previous.impressions, start: gsc.range.start, end: gsc.range.end }
      : null,
    recommendations,
    gbp: reviewRows[0] ? weeklyGbp(reviewRows[0].data, now) : null,
    market,
    links: linkRows[0] ? weeklyLinks(readBacklinksReport(linkRows[0].data), linkRows[1] ? readBacklinksReport(linkRows[1].data) : null) : null,
    traffic: trafficRows[0] ? weeklyTraffic(readTrafficReport(trafficRows[0].data)) : null,
    cannibal,
  };
}

// ---------- Envío ----------

/** Error de configuración (no hay cómo enviar): no sirve reintentar cada minuto. */
export class SenderConfigError extends BiError {}

export type Sender = { name: string; email: string; apiKey: string; via: "connection" | "app" };

const noSender = () =>
  new SenderConfigError(
    "No hay cómo enviar emails: conecta Email en Conexiones (con Brevo o Resend) y vuelve a intentar.",
    "There's no way to send emails: connect Email in Connections (with Brevo or Resend) and try again.",
  );

/**
 * De dónde salen los emails: el Email conectado del negocio (su remitente, con su clave o la de la app) o,
 * si no hay, la clave de Brevo de la app con el nombre del negocio y ALERTS_FROM o seo@<primer dominio autenticado>.
 */
export async function resolveSender(businessId: string): Promise<Sender> {
  const [b, conn] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true } }),
    db.connection.findUnique({ where: { businessId_channel: { businessId, channel: "email" } }, select: { secret: true } }),
  ]);
  if (conn) {
    let creds: Record<string, string> = {};
    try {
      creds = decryptJson(conn.secret);
    } catch {
      throw new SenderConfigError("No se pudo leer la conexión de Email. Vuelve a conectarla en Conexiones.", "Couldn't read the Email connection. Reconnect it in Connections.");
    }
    const apiKey = creds.apiKey?.trim() || brevoEnvKey();
    const from = parseFrom(creds.from ?? "");
    if (apiKey && from.email.includes("@")) return { name: from.name, email: from.email, apiKey, via: "connection" };
  }
  const appKey = brevoEnvKey();
  if (!appKey) throw noSender();
  let address = process.env.ALERTS_FROM?.trim() ? parseFrom(process.env.ALERTS_FROM.trim()).email : "";
  if (!address) {
    const domains = await brevoDomains(appKey);
    if (!domains[0]) throw noSender();
    address = `seo@${domains[0]}`;
  }
  return { name: b.name.replace(/[<>"]/g, "").slice(0, 80), email: address, apiKey: appKey, via: "app" };
}

/** "Nombre <correo>" para mostrar en la pantalla (nunca la clave). */
export const senderLabel = (s: Pick<Sender, "name" | "email">) => (s.name ? `${s.name} <${s.email}>` : s.email);

/** Un archivo adjunto (por ejemplo el reporte en PDF). */
export type EmailAttachment = { name: string; content: Buffer };

/** Los adjuntos como los pide cada servicio: Brevo `attachment: [{ name, content }]`, Resend `attachments: [{ filename, content }]` (base64). */
export function attachmentPayload(list: EmailAttachment[] | undefined, brevo: boolean): Record<string, unknown> {
  const files = (list ?? []).filter((a) => a.name && a.content.length);
  if (!files.length) return {};
  return brevo
    ? { attachment: files.map((a) => ({ name: a.name, content: a.content.toString("base64") })) }
    : { attachments: files.map((a) => ({ filename: a.name, content: a.content.toString("base64") })) };
}

/** Manda un email a los destinatarios (Brevo o Resend según la clave). Errores en los dos idiomas, sin claves. */
export async function sendSeoEmail(opts: {
  businessId: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}): Promise<Sender> {
  const to = opts.to.filter((e) => EMAIL_RE.test(e)).slice(0, MAX_ALERT_EMAILS);
  if (!to.length) throw new SenderConfigError("Falta un email válido para recibir los avisos.", "A valid email to receive the alerts is missing.");
  const sender = await resolveSender(opts.businessId);
  try {
    if (isBrevo(sender.apiKey)) {
      await fetchJson("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": sender.apiKey.trim(), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sender: sender.name ? { name: sender.name, email: sender.email } : { email: sender.email },
          to: to.map((email) => ({ email })),
          subject: opts.subject,
          htmlContent: opts.html,
          textContent: opts.text,
          ...attachmentPayload(opts.attachments, true),
        }),
      });
    } else {
      await fetchJson("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${sender.apiKey.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: senderLabel(sender), to, subject: opts.subject, html: opts.html, text: opts.text, ...attachmentPayload(opts.attachments, false) }),
      });
    }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    const status = Number(msg.match(/^(\d{3}):/)?.[1] ?? 0);
    const Err = status >= 400 && status < 500 && status !== 429 ? SenderConfigError : BiError;
    throw new Err(`No se pudo enviar el email (${msg}). Revisa Email en Conexiones.`, `Couldn't send the email (${msg}). Check Email in Connections.`);
  }
  return sender;
}

const emailLang = (v: string): UiLang => (v === "en" ? "en" : "es");

// ---------- Aviso después de la revisión diaria automática ----------

/**
 * Después de guardar los reportes de la revisión diaria automática: si el negocio tiene los avisos encendidos,
 * compara cada zona con su revisión anterior y manda UN email si algo bajó (con las buenas noticias también).
 */
export async function notifyRankAlerts(businessId: string, savedIds: string[]): Promise<{ sent: boolean; bad: number }> {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, color: true, website: true, seoAlerts: true, seoAlertEmail: true, seoEmailLang: true, seoLocations: true, seoLocationCode: true, seoLocationName: true },
  });
  const to = b ? alertRecipients(b.seoAlertEmail) : [];
  if (!b || !b.seoAlerts || !to.length || !savedIds.length) return { sent: false, bad: 0 };
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const [rows, kwRows] = await Promise.all([
    db.seoReport.findMany({ where: { businessId, kind: "rank" }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, data: true } }),
    // Para pesar tu parte de Google por búsquedas al mes (opcional).
    db.seoReport.findMany({ where: { businessId, kind: "keywords" }, orderBy: { createdAt: "desc" }, take: 2 * Math.max(1, zones.length), select: { data: true } }).catch(() => []),
  ]);
  const fresh = rows.filter((r) => savedIds.includes(r.id)).map((r) => readRankReport(r.data));
  const older = rows.filter((r) => !savedIds.includes(r.id)).map((r) => readRankReport(r.data));
  const prevByZone = groupByZone(older, zones);
  const results: RankAlerts[] = [];
  const pairs: [RankReport, RankReport][] = [];
  for (const [code, list] of groupByZone(fresh, zones)) {
    const cur = list[0];
    const prev = prevByZone.get(code)?.[0];
    if (!cur || !prev) continue;
    const z = rankAlerts(prev, cur);
    const zone = zones.find((x) => x.code === code);
    results.push({ ...z, zone: zoneLabel(zone?.name || cur.location) });
    pairs.push([{ ...cur, locationCode: code }, { ...prev, locationCode: code }]);
  }
  const main = zones[0]?.code;
  const kw = [...latestByZone(kwRows.map((r) => readKeywordsReport(r.data)), zones).entries()].sort(([a], [c]) => Number(c === main) - Number(a === main)).map(([code, k]) => ({ ...k, locationCode: code }));
  const share = shareDrop(pairs, b.website, kw);
  const bad = results.reduce((s, z) => s + z.bad.length, 0) + (share ? 1 : 0);
  if (!bad) return { sent: false, bad: 0 };
  const email = buildAlertEmail(b, results, emailLang(b.seoEmailLang), undefined, { share });
  await sendSeoEmail({ businessId, to, ...email });
  return { sent: true, bad };
}

// ---------- Resumen de cada lunes ----------

/** Arma y manda el resumen semanal (también lo usa el botón "Enviar un email de prueba"). */
export async function sendWeeklyReport(businessId: string, now = new Date()): Promise<{ to: string[]; sender: Sender }> {
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { id: true, name: true, color: true, seoAlertEmail: true, seoEmailLang: true } });
  const to = alertRecipients(b.seoAlertEmail);
  if (!to.length) throw new SenderConfigError("Guarda primero un email válido para recibir los avisos.", "First save a valid email to receive the alerts.");
  const data = await gatherWeekly(businessId, now);
  const email = buildWeeklyEmail(b, data, emailLang(b.seoEmailLang));
  const sender = await sendSeoEmail({ businessId, to, ...email });
  return { to, sender };
}

const FAIL_MARK = "weekly-fail";
const MAX_RETRIES = 3;

/**
 * Lo llama el cron cada minuto: manda como mucho UN resumen semanal por llamada. Reserva el negocio con un
 * updateMany (si otra llamada lo reservó antes, no hace nada). Si el envío falla por algo pasajero, deja
 * seoWeeklyAt como estaba para reintentar en el próximo minuto (hasta 3 veces); si es de configuración, no reintenta.
 */
export async function runWeeklyReports(now = new Date()): Promise<{ businessId: string; ok: boolean; error?: string } | null> {
  const candidates = await db.business.findMany({
    where: { seoWeekly: true, seoAlertEmail: { not: "" }, OR: [{ seoWeeklyAt: null }, { seoWeeklyAt: { lt: new Date(now.getTime() - 6 * DAY_MS) } }] },
    select: { id: true, seoAlertEmail: true, seoWeeklyAt: true },
    orderBy: { seoWeeklyAt: { sort: "asc", nulls: "first" } },
    take: 50,
  });
  const due = candidates.find((b) => alertRecipients(b.seoAlertEmail).length && isWeeklyDue(now, b.seoWeeklyAt));
  if (!due) return null;

  const claimed = await db.business.updateMany({ where: { id: due.id, seoWeekly: true, seoWeeklyAt: due.seoWeeklyAt }, data: { seoWeeklyAt: now } });
  if (claimed.count !== 1) return null;

  try {
    await sendWeeklyReport(due.id, now);
    await db.seoReport.deleteMany({ where: { businessId: due.id, kind: FAIL_MARK } });
    return { businessId: due.id, ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    let retry = !(e instanceof SenderConfigError);
    if (retry) {
      await db.seoReport.create({ data: { businessId: due.id, kind: FAIL_MARK, data: { at: now.toISOString(), error: error.slice(0, 300) } } });
      const fails = await db.seoReport.count({ where: { businessId: due.id, kind: FAIL_MARK, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } });
      retry = fails < MAX_RETRIES;
      await db.seoReport.deleteMany({ where: { businessId: due.id, kind: FAIL_MARK, createdAt: { lt: new Date(now.getTime() - 14 * DAY_MS) } } });
    }
    if (retry) await db.business.updateMany({ where: { id: due.id, seoWeeklyAt: now }, data: { seoWeeklyAt: due.seoWeeklyAt } });
    console.error(`[reporte-semanal] ${due.id}: ${error}${retry ? " (se reintenta en el próximo minuto)" : " (no se reintenta esta semana)"}`);
    return { businessId: due.id, ok: false, error };
  }
}
