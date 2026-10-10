// Reporte diario por email: cierra a la medianoche del negocio (Business.timezone) y se manda a reportEmail
// (o al email del dueño) si Business.reportDaily está encendido. También manda a pedido el reporte de cualquier
// rango de fechas. Cada envío queda anotado en SeoReport kind "daily" (día, a quién, asunto, números, si salió o
// el error): así nunca se manda dos veces el del mismo día. No es una acción de la IA, así que no va al registro AiAction.
//
// Día tranquilo (sin publicaciones, sin nada de la IA, sin cambios): por defecto SÍ se manda, corto, con lo que viene
// y los próximos pasos (así el dueño sabe que todo funciona y que la app no se quedó callada). Si el dueño lo prefiere,
// en los ajustes del reporte puede pedir «solo cuando pase algo» (fila Connection "report_settings"): entonces ese día
// queda anotado como «sin email» y no se manda nada.
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { askGemini } from "@/lib/ai";
import { businessTz, dailyDueDay, dailyKey } from "@/lib/business-tz";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { BiError } from "@/lib/i18n";
import { parseAlertEmails, SenderConfigError, sendSeoEmail, senderLabel, type Sender } from "@/lib/seo/alerts";
import { numbersGrounded } from "@/lib/seo/report";
import { escapeHtml } from "@/lib/text";
import { adSnapshot, buildPeriodReport, dayPeriod, isQuiet, isSingleDay, periodText, rangeQuery, reportCounts, type PeriodReport, type RangePeriod } from "@/lib/report-period";
import { loadPeriodInputs } from "@/lib/report-period-load";
import { highlightFacts, reportSections, ruleHighlights, type ViewSection } from "@/lib/report-period-view";

type Lang = "es" | "en";
const MIN_MS = 60_000;
const APP_NAME = "Matya";

// ---------- Ajustes del reporte ----------

export const REPORT_SETTINGS = "report_settings";
export type ReportSettings = {
  /** send: también los días sin nada (corto) · skip: solo cuando pase algo. */
  quietDays: "send" | "skip";
};
export const DEFAULT_REPORT_SETTINGS: ReportSettings = { quietDays: "send" };

export function readReportSettingsJson(v: unknown): ReportSettings {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { quietDays: o.quietDays === "skip" ? "skip" : "send" };
}

export async function getReportSettings(businessId: string): Promise<ReportSettings> {
  const row = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel: REPORT_SETTINGS } }, select: { secret: true } });
  if (!row) return DEFAULT_REPORT_SETTINGS;
  try {
    return readReportSettingsJson(decryptJson(row.secret));
  } catch {
    return DEFAULT_REPORT_SETTINGS;
  }
}

export async function saveReportSettings(businessId: string, s: ReportSettings): Promise<void> {
  const secret = encryptJson(readReportSettingsJson(s));
  await db.connection.upsert({
    where: { businessId_channel: { businessId, channel: REPORT_SETTINGS } },
    create: { businessId, channel: REPORT_SETTINGS, secret, label: "Reporte diario" },
    update: { secret },
  });
}

// ---------- A quién ----------

/** Los emails que reciben el reporte: reportEmail (hasta 3, separados por comas) o, si está vacío, el del dueño. */
export function dailyRecipients(b: { reportEmail: string; ownerEmail: string }): string[] {
  const raw = b.reportEmail.trim() || b.ownerEmail.trim();
  if (!raw) return [];
  const r = parseAlertEmails(raw);
  return r.ok ? r.emails : [];
}

export const emailLang = (v: string | null | undefined): Lang => (v === "en" ? "en" : "es");

/** La dirección pública de la app para los links del email (PUBLIC_BASE_URL, con o sin https://). */
export function publicBase(raw = process.env.PUBLIC_BASE_URL): string {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!v) return "https://matya.app";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/** Link al reporte completo de ese periodo en la app. */
export const reportUrl = (base: string, businessId: string, p: Pick<RangePeriod, "fromDay" | "toDay">) => `${base.replace(/\/+$/, "")}/b/${encodeURIComponent(businessId)}/reportes?${rangeQuery(p)}`;

// ---------- Lo más importante (con IA, o sin IA si falla) ----------

export type Highlights = { items: string[]; source: "ai" | "rules" };

const HighlightsSchema = z.object({
  bullets: z.array(z.string().describe("One short sentence, plain words, max 25 words")).describe("Exactly 3 bullets, most important first"),
});

type AskFn = (system: string, user: string) => Promise<{ bullets: string[] }>;
const defaultAsk: AskFn = (system, user) => askGemini(HighlightsSchema, system, user, 1500);

const plain = (s: string) =>
  s
    .replace(/[*_#`>]/g, "")
    .replace(/^[\s\-•·\d.)]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);

/**
 * «Lo más importante»: 3 frases escritas por la IA (Gemini) solo con los datos del reporte. Si no hay clave, tarda
 * mucho, falla o usa un número que no está en los datos, salen las 3 frases sin IA. `ask` se cambia en las pruebas.
 */
export async function reportHighlights(r: PeriodReport, lang: Lang, opts: { ai: boolean; ask?: AskFn; timeoutMs?: number } = { ai: true }): Promise<Highlights> {
  const rules = { items: ruleHighlights(r, lang), source: "rules" as const };
  const ask = opts.ask ?? (process.env.GEMINI_API_KEY ? defaultAsk : null);
  if (!opts.ai || !ask) return rules;
  const facts = highlightFacts(r, lang);
  const day = isSingleDay(r.period);
  const system = `You write the top of a ${day ? "daily" : "period"} marketing report for the owner of "${r.business.name}", a small local business. The owner is not technical.
Rules:
- Exactly 3 bullets: the 3 most important things about this ${day ? "day" : "period"}, most important first. Problems that need the owner come first; then good news; then what to do next.
- Use ONLY the facts between <facts>. Never invent numbers, names, causes or results. If you mention a number, copy it exactly as in the facts.
- Plain, warm, direct words. No jargon, no hype, no markdown, no emoji. One sentence each, max 25 words.
- ${lang === "en" ? "Write in natural US English, addressing the owner as \"you\"." : "Escribe en español con acentos correctos, tratando al dueño de «tú»."}`;
  const user = `<facts>\n${facts.map((f) => `- ${f}`).join("\n")}\n</facts>\n\nWrite the 3 bullets.`;
  try {
    const res = await Promise.race([
      ask(system, user),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), opts.timeoutMs ?? 25_000)),
    ]);
    const items = (res.bullets ?? []).map(plain).filter((s) => s.length >= 8).slice(0, 3);
    if (items.length < 3) return rules;
    if (!numbersGrounded(items.join(" "), [...facts, r.business.name])) {
      console.warn("[reporte-diario] la IA usó números que no están en los datos; se usan las frases sin IA");
      return rules;
    }
    return { items, source: "ai" };
  } catch (e) {
    console.warn("[reporte-diario] no se pudo escribir «Lo más importante» con IA:", e instanceof Error ? e.message : e);
    return rules;
  }
}

// ---------- El email (puro) ----------

export type BuiltEmail = { subject: string; html: string; text: string };
export type DailyEmailOpts = { baseUrl?: string; /** Máximo de líneas por sección (el resto: «y N más en la app»). */ maxItems?: number };

const FONT = "font-family:Arial,Helvetica,sans-serif;";
const TONE: Record<string, string> = { bad: "#b42318", good: "#067647", neutral: "#475467" };
const MARK: Record<string, string> = { bad: "▼", good: "▲", neutral: "•" };
const brandColor = (c: string) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()) ? c.trim() : "#126BBC");
function textOn(hex: string): string {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#111827" : "#ffffff";
}
/** Color de la marca para títulos sobre blanco: si es muy claro, uno oscuro que se lea. */
function strongOn(hex: string): string {
  return textOn(hex) === "#111827" ? "#1f2933" : hex;
}
const abs = (href: string, base: string) => (/^https?:\/\//i.test(href) ? href : `${base}${href.startsWith("/") ? "" : "/"}${href}`);
const safeHref = (href: string) => (/^(https?:)?\/\//i.test(href) || href.startsWith("/") ? href : "#");

function sectionHtml(s: ViewSection, color: string, base: string, maxItems: number, lang: Lang): string {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const parts: string[] = [];
  parts.push(`<tr><td style="${FONT}padding:22px 0 6px 0;font-size:17px;font-weight:bold;color:${color};border-bottom:2px solid ${color};">${escapeHtml(s.title)}</td></tr>`);
  if (s.stats?.length) {
    const cells = s.stats.map(
      (st) =>
        `<td valign="top" width="50%" style="${FONT}padding:8px 8px 8px 0;"><div style="font-size:12px;color:#6b7280;">${escapeHtml(st.label)}</div><div style="font-size:22px;font-weight:bold;color:${st.tone && st.tone !== "neutral" ? TONE[st.tone] : "#1f2933"};">${escapeHtml(st.value)}</div>${st.sub ? `<div style="font-size:12px;color:#6b7280;">${escapeHtml(st.sub)}</div>` : ""}</td>`,
    );
    const rows: string[] = [];
    for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cells[i]}${cells[i + 1] ?? '<td width="50%"></td>'}</tr>`);
    parts.push(`<tr><td style="padding:4px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table></td></tr>`);
  }
  if (s.items?.length) {
    const shown = s.items.slice(0, maxItems);
    const li = shown
      .map((i) => {
        const tone = i.tone ?? "neutral";
        const link = i.href ? ` <a href="${escapeHtml(safeHref(abs(i.href, base)))}" style="color:${color};font-weight:bold;">${escapeHtml(i.linkText ?? t("Ver", "View"))}</a>` : "";
        const meta = i.meta ? `<div style="font-size:12px;color:#6b7280;">${escapeHtml(i.meta)}</div>` : "";
        return `<tr><td valign="top" style="${FONT}width:18px;padding:5px 0;font-size:12px;color:${TONE[tone]};">${MARK[tone]}</td><td style="${FONT}padding:5px 0;font-size:15px;line-height:1.45;color:#1f2933;">${escapeHtml(i.text)}${link}${meta}</td></tr>`;
      })
      .join("");
    parts.push(`<tr><td style="padding:4px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${li}</table></td></tr>`);
    const rest = s.items.length - shown.length;
    if (rest > 0) parts.push(`<tr><td style="${FONT}padding:2px 0 0 18px;font-size:13px;color:#6b7280;">${escapeHtml(t(`y ${rest} más en la app`, `and ${rest} more in the app`))}</td></tr>`);
  }
  if (s.table?.rows.length) {
    const th = s.table.head.map((h, i) => `<th align="${i ? "right" : "left"}" style="${FONT}padding:6px 4px;font-size:12px;color:#6b7280;font-weight:normal;border-bottom:1px solid #e5e7eb;">${escapeHtml(h)}</th>`).join("");
    const rows = s.table.rows
      .slice(0, maxItems)
      .map((r, ri) => {
        const link = s.table?.links?.[ri];
        return `<tr>${r
          .map((c, i) => {
            const inner = i === 0 && link ? `<a href="${escapeHtml(safeHref(abs(link, base)))}" style="color:${color};">${escapeHtml(c)}</a>` : escapeHtml(c);
            return `<td align="${i ? "right" : "left"}" style="${FONT}padding:6px 4px;font-size:14px;color:#1f2933;border-bottom:1px solid #f0f1f3;${i ? "white-space:nowrap;" : ""}">${inner}</td>`;
          })
          .join("")}</tr>`;
      })
      .join("");
    parts.push(`<tr><td style="padding:4px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${th}</tr>${rows}</table></td></tr>`);
  }
  if (s.more) parts.push(`<tr><td style="${FONT}padding:2px 0;font-size:13px;color:#6b7280;">${escapeHtml(s.more)}</td></tr>`);
  if (s.note) parts.push(`<tr><td style="${FONT}padding:6px 0;font-size:13px;line-height:1.5;color:#6b7280;">${escapeHtml(s.note)}</td></tr>`);
  if (s.href) parts.push(`<tr><td style="${FONT}padding:4px 0;font-size:14px;"><a href="${escapeHtml(safeHref(abs(s.href, base)))}" style="color:${color};font-weight:bold;">${escapeHtml(s.hrefText ?? t("Ver en la app", "See in the app"))} →</a></td></tr>`);
  return parts.join("\n");
}

function sectionText(s: ViewSection, base: string, maxItems: number): string {
  const lines = [`\n${s.title.toUpperCase()}`, "-".repeat(Math.min(60, s.title.length))];
  for (const st of s.stats ?? []) lines.push(`${st.label}: ${st.value}${st.sub ? ` (${st.sub})` : ""}`);
  for (const i of (s.items ?? []).slice(0, maxItems)) lines.push(`${i.tone === "bad" ? "(-)" : i.tone === "good" ? "(+)" : " -"} ${i.text}${i.meta ? ` [${i.meta}]` : ""}${i.href ? ` ${abs(i.href, base)}` : ""}`);
  if (s.table) {
    lines.push(s.table.head.join(" | "));
    for (const r of s.table.rows.slice(0, maxItems)) lines.push(r.join(" | "));
  }
  if (s.more) lines.push(s.more);
  if (s.note) lines.push(s.note);
  return lines.join("\n");
}

/** Asunto: el negocio, el día y lo principal en números ("Fameseg — 8 oct 2026: 3 publicaciones, 1 aviso"). */
export function dailySubject(r: PeriodReport, lang: Lang, quiet: boolean): string {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const when = periodText(r.period, lang);
  const kind = isSingleDay(r.period) ? t("Tu día", "Your day") : t("Tu reporte", "Your report");
  if (quiet) return t(`Día tranquilo en ${r.business.name} — ${when}`, `A quiet day at ${r.business.name} — ${when}`);
  const bits: string[] = [];
  const bad = r.alerts?.items.filter((a) => a.tone === "bad").length ?? 0;
  if (bad) bits.push(t(`${bad} ${bad === 1 ? "aviso" : "avisos"}`, `${bad} ${bad === 1 ? "alert" : "alerts"}`));
  if (r.posts?.sent) bits.push(t(`${r.posts.sent} ${r.posts.sent === 1 ? "publicación" : "publicaciones"}`, `${r.posts.sent} ${r.posts.sent === 1 ? "post" : "posts"}`));
  if (r.reviews?.newCount) bits.push(t(`${r.reviews.newCount} ${r.reviews.newCount === 1 ? "reseña nueva" : "reseñas nuevas"}`, `${r.reviews.newCount} new ${r.reviews.newCount === 1 ? "review" : "reviews"}`));
  if (bits.length < 2 && r.ai) bits.push(t(`${r.ai.total} ${r.ai.total === 1 ? "acción" : "acciones"} de la IA`, `${r.ai.total} AI ${r.ai.total === 1 ? "action" : "actions"}`));
  return `${kind} — ${r.business.name}, ${when}${bits.length ? `: ${bits.slice(0, 3).join(", ")}` : ""}`;
}

/** El email del reporte (diario o de un rango): «Lo más importante», las secciones y el link al reporte completo. */
export function buildDailyEmail(r: PeriodReport, lang: Lang, highlights: Highlights, opts: DailyEmailOpts = {}): BuiltEmail {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const base = (opts.baseUrl ?? publicBase()).replace(/\/+$/, "");
  const maxItems = opts.maxItems ?? 8;
  const quiet = isQuiet(r);
  const color = brandColor(r.business.color);
  const fg = textOn(color);
  const strong = strongOn(color);
  const day = isSingleDay(r.period);
  const title = quiet ? t("Día tranquilo", "A quiet day") : day ? t("Tu reporte del día", "Your daily report") : t("Tu reporte", "Your report");
  const when = periodText(r.period, lang, "long");
  const full = reportUrl(base, r.business.id, r.period);
  const settingsUrl = `${base}/b/${encodeURIComponent(r.business.id)}/reportes#ajustes`;
  const sections = reportSections(r, lang);
  const topTitle = day ? t("Lo más importante del día", "The most important today") : t("Lo más importante", "The most important");
  const subject = dailySubject(r, lang, quiet);
  const offText = t(
    "Para dejar de recibirlo o cambiar a quién llega: en la app, Resultados › Reportes › Ajustes del reporte.",
    "To stop it or change who gets it: in the app, Results › Reports › Report settings.",
  );
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(highlights.items[0] ?? "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;"><tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;">
<tr><td style="${FONT}background:${color};color:${fg};padding:18px 22px 20px 22px;border-radius:10px 10px 0 0;">
<div style="font-size:12px;letter-spacing:1.5px;font-weight:bold;opacity:0.85;">${escapeHtml(APP_NAME.toUpperCase())}</div>
<div style="font-size:14px;margin-top:8px;">${escapeHtml(r.business.name)}</div>
<div style="font-size:23px;font-weight:bold;line-height:1.25;">${escapeHtml(title)}</div>
<div style="font-size:14px;margin-top:2px;">${escapeHtml(when)}</div>
</td></tr>
<tr><td style="padding:16px 22px 4px 22px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;border-radius:8px;border-left:4px solid ${color};">
<tr><td style="${FONT}padding:12px 14px 4px 14px;font-size:15px;font-weight:bold;color:${strong};">${escapeHtml(topTitle)}</td></tr>
${highlights.items.map((h) => `<tr><td style="${FONT}padding:4px 14px 6px 14px;font-size:15px;line-height:1.45;color:#1f2933;">• ${escapeHtml(h)}</td></tr>`).join("\n")}
<tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
</table></td></tr>
<tr><td style="padding:0 22px 12px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${sections.map((s) => sectionHtml(s, strong, base, maxItems, lang)).join("\n")}
</table></td></tr>
<tr><td align="center" style="padding:8px 22px 22px 22px;"><a href="${escapeHtml(full)}" style="${FONT}display:inline-block;background:${color};color:${fg};text-decoration:none;font-weight:bold;font-size:15px;padding:13px 24px;border-radius:8px;">${escapeHtml(t("Ver el reporte completo", "See the full report"))}</a></td></tr>
<tr><td style="${FONT}padding:14px 22px 20px 22px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280;">
${escapeHtml(t(`Este email lo manda ${APP_NAME} para ${r.business.name}. Las horas están en la zona del negocio (${r.period.tz}).`, `This email is sent by ${APP_NAME} for ${r.business.name}. Times are in the business time zone (${r.period.tz}).`))}<br>
<a href="${escapeHtml(settingsUrl)}" style="color:#6b7280;">${escapeHtml(offText)}</a>
</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    APP_NAME,
    `${r.business.name} — ${title}`,
    when,
    "",
    topTitle.toUpperCase(),
    ...highlights.items.map((h) => `- ${h}`),
    ...sections.map((s) => sectionText(s, base, maxItems)),
    "",
    `${t("Ver el reporte completo", "See the full report")}: ${full}`,
    "",
    offText,
    settingsUrl,
  ].join("\n");
  return { subject, html, text };
}

// ---------- El registro de cada envío (SeoReport kind "daily") ----------

export type DailyState = "sending" | "sent" | "error" | "skipped";
export type DailyTrigger = "cron" | "manual" | "range";
export type DailyRecord = {
  version: 1;
  /** El día del reporte diario ("" en un reporte de un rango pedido a mano). */
  day: string;
  fromDay: string;
  toDay: string;
  tz: string;
  trigger: DailyTrigger;
  state: DailyState;
  to: string[];
  subject: string;
  lang: Lang;
  quiet: boolean;
  counts: ReturnType<typeof reportCounts> | null;
  highlights: Highlights | null;
  error: string;
  /** ¿Se puede volver a intentar? (no si es un problema de configuración). */
  retry: boolean;
  attempts: number;
  lastTryAt: string;
  sentAt: string;
  sender: string;
  /** Foto de los anuncios (números desde el inicio de cada uno) para restar en el próximo reporte. */
  ads: { at: string; items: ReturnType<typeof adSnapshot> } | null;
};

const MAX_ATTEMPTS = 3;
/** Un envío que quedó «enviando» más de esto se cortó: no se reintenta (podría haber salido) y se muestra así. */
const STUCK_MS = 30 * MIN_MS;

export function readDailyRecord(v: unknown): DailyRecord | null {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o) return null;
  const s = (x: unknown) => (typeof x === "string" ? x : "");
  const state = (["sending", "sent", "error", "skipped"] as const).find((x) => x === o.state) ?? "error";
  const trigger = (["cron", "manual", "range"] as const).find((x) => x === o.trigger) ?? "cron";
  const hl = o.highlights && typeof o.highlights === "object" ? (o.highlights as Record<string, unknown>) : null;
  return {
    version: 1,
    day: s(o.day),
    fromDay: s(o.fromDay) || s(o.day),
    toDay: s(o.toDay) || s(o.day),
    tz: s(o.tz),
    trigger,
    state,
    to: Array.isArray(o.to) ? o.to.filter((x): x is string => typeof x === "string").slice(0, 5) : [],
    subject: s(o.subject).slice(0, 300),
    lang: emailLang(s(o.lang)),
    quiet: o.quiet === true,
    counts: o.counts && typeof o.counts === "object" ? (o.counts as DailyRecord["counts"]) : null,
    highlights: hl && Array.isArray(hl.items) ? { items: hl.items.filter((x): x is string => typeof x === "string").slice(0, 3), source: hl.source === "ai" ? "ai" : "rules" } : null,
    error: s(o.error).slice(0, 500),
    retry: o.retry === true,
    attempts: typeof o.attempts === "number" ? o.attempts : 1,
    lastTryAt: s(o.lastTryAt),
    sentAt: s(o.sentAt),
    sender: s(o.sender).slice(0, 200),
    ads: null,
  };
}

/** ¿Este registro ya cierra el día para el envío automático? (salió, se saltó, está saliendo, o falló sin remedio). */
export function closesDay(rec: Pick<DailyRecord, "state" | "retry" | "attempts" | "lastTryAt">, createdAt: Date, now: Date): boolean {
  if (rec.state === "sent" || rec.state === "skipped") return true;
  if (rec.state === "sending") return true;
  if (!rec.retry || rec.attempts >= MAX_ATTEMPTS) return true;
  // Falló por algo pasajero: se reintenta, pero no antes de 10 minutos.
  const last = Date.parse(rec.lastTryAt) || createdAt.getTime();
  return now.getTime() - last < 10 * MIN_MS;
}

/** Cómo mostrar un registro (un «enviando» de hace más de 30 minutos se cortó). */
export function displayState(rec: Pick<DailyRecord, "state">, createdAt: Date, now = new Date()): DailyState | "stuck" {
  if (rec.state === "sending" && now.getTime() - createdAt.getTime() > STUCK_MS) return "stuck";
  return rec.state;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400);

/**
 * Reserva el día de un negocio para mandarlo (con un candado de la base de datos para que dos llamadas del cron a la
 * vez no lo manden dos veces). Devuelve el registro (nuevo o el del intento fallido que se reintenta) o null.
 */
async function claimDay(businessId: string, day: string, tz: string, trigger: DailyTrigger, now: Date): Promise<{ id: string; attempts: number } | null> {
  return db.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${dailyKey(businessId, day)})) AS ok`;
    if (!lock[0]?.ok) return null;
    const rows = await tx.seoReport.findMany({
      where: { businessId, kind: "daily", data: { path: ["day"], equals: day } },
      select: { id: true, data: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const recs = rows.map((r) => ({ row: r, rec: readDailyRecord(r.data) })).filter((x): x is { row: (typeof rows)[number]; rec: DailyRecord } => x.rec !== null);
    if (trigger === "cron") {
      const auto = recs.filter((x) => x.rec.trigger !== "range");
      if (auto.some((x) => closesDay(x.rec, x.row.createdAt, now))) return null;
      const failed = auto.find((x) => x.rec.state === "error");
      if (failed) {
        const attempts = failed.rec.attempts + 1;
        await tx.seoReport.update({ where: { id: failed.row.id }, data: { data: { ...(failed.row.data as Record<string, unknown>), state: "sending", attempts, lastTryAt: now.toISOString() } } });
        return { id: failed.row.id, attempts };
      }
    }
    const created = await tx.seoReport.create({
      data: { businessId, kind: "daily", data: { version: 1, day, fromDay: day, toDay: day, tz, trigger, state: "sending", attempts: 1, lastTryAt: now.toISOString() } },
      select: { id: true },
    });
    return { id: created.id, attempts: 1 };
  });
}

async function finishRecord(id: string, patch: Partial<DailyRecord>): Promise<void> {
  const row = await db.seoReport.findUnique({ where: { id }, select: { data: true } });
  const prev = row?.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : {};
  await db.seoReport.update({ where: { id }, data: { data: { ...prev, ...patch } as Prisma.InputJsonValue } });
}

// ---------- Armar y mandar ----------

export type BuiltPeriod = { report: PeriodReport; ads: ReturnType<typeof adSnapshot> };

/** Lee y arma el reporte de un periodo (sin IA ni email). */
export async function buildReportFor(businessId: string, period: RangePeriod, now = new Date()): Promise<BuiltPeriod> {
  const inputs = await loadPeriodInputs(businessId, period, now);
  return { report: buildPeriodReport(inputs), ads: adSnapshot(inputs.campaigns) };
}

/** Las frases de la IA que ya se escribieron para el reporte diario de ese día (para no pagar otra vez). */
export async function savedHighlights(businessId: string, day: string): Promise<Highlights | null> {
  const rows = await db.seoReport.findMany({ where: { businessId, kind: "daily", data: { path: ["day"], equals: day } }, select: { data: true }, orderBy: { createdAt: "desc" }, take: 5 });
  for (const r of rows) {
    const rec = readDailyRecord(r.data);
    if (rec?.highlights?.items.length === 3 && rec.highlights.source === "ai") return rec.highlights;
  }
  return null;
}

export type SendOutcome = { state: DailyState; to: string[]; subject: string; sender?: Sender; error?: string; recordId: string | null };

/**
 * Manda el reporte de un día que ya cerró. `trigger: "cron"` respeta que ya se haya mandado (y el ajuste de días
 * tranquilos); `"manual"` (el botón «Mandar el de ayer ahora») lo manda siempre.
 */
export async function sendDailyReport(businessId: string, day: string, opts: { trigger: "cron" | "manual"; now?: Date; baseUrl?: string }): Promise<SendOutcome> {
  const now = opts.now ?? new Date();
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { id: true, timezone: true, reportEmail: true, ownerEmail: true, seoEmailLang: true } });
  const tz = businessTz(b);
  const to = dailyRecipients(b);
  if (!to.length)
    throw new SenderConfigError(
      "Falta a quién mandarlo: escribe un email en los ajustes del reporte (o el del dueño en «Datos del negocio»).",
      "There's no one to send it to: enter an email in the report settings (or the owner's in \"Business details\").",
    );
  const claim = await claimDay(businessId, day, tz, opts.trigger, now);
  if (!claim) return { state: "skipped", to, subject: "", recordId: null };
  const lang = emailLang(b.seoEmailLang);
  let snapshot: DailyRecord["ads"] = null;
  try {
    const period = dayPeriod(day, tz);
    const built = await buildReportFor(businessId, period, now);
    snapshot = { at: now.toISOString(), items: built.ads };
    const quiet = isQuiet(built.report);
    const counts = reportCounts(built.report);
    if (quiet && opts.trigger === "cron" && (await getReportSettings(businessId)).quietDays === "skip") {
      await finishRecord(claim.id, { state: "skipped", quiet, counts, to, lang, ads: snapshot, error: "", retry: false });
      return { state: "skipped", to, subject: "", recordId: claim.id };
    }
    const highlights = await reportHighlights(built.report, lang, { ai: true });
    const email = buildDailyEmail(built.report, lang, highlights, { baseUrl: opts.baseUrl });
    await finishRecord(claim.id, { to, subject: email.subject, lang, quiet, counts, highlights, ads: snapshot });
    const sender = await sendSeoEmail({ businessId, to, ...email });
    await finishRecord(claim.id, { state: "sent", sentAt: new Date().toISOString(), sender: senderLabel(sender), error: "", retry: false });
    return { state: "sent", to, subject: email.subject, sender, recordId: claim.id };
  } catch (e) {
    const error = errText(e);
    const retry = !(e instanceof SenderConfigError) && claim.attempts < MAX_ATTEMPTS;
    await finishRecord(claim.id, { state: "error", error, retry, to, lang, ...(snapshot ? { ads: snapshot } : {}) }).catch(() => {});
    if (opts.trigger === "manual") throw e;
    return { state: "error", to, subject: "", error, recordId: claim.id };
  }
}

/** Manda a pedido el reporte de un rango de fechas (botón «Enviarme este reporte por email»). Queda en el historial. */
export async function sendRangeReport(businessId: string, period: RangePeriod, opts: { now?: Date; baseUrl?: string } = {}): Promise<SendOutcome> {
  const now = opts.now ?? new Date();
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { reportEmail: true, ownerEmail: true, seoEmailLang: true } });
  const to = dailyRecipients(b);
  if (!to.length)
    throw new SenderConfigError(
      "Falta a quién mandarlo: escribe un email en los ajustes del reporte (más abajo) y guarda.",
      "There's no one to send it to: enter an email in the report settings (below) and save.",
    );
  const lang = emailLang(b.seoEmailLang);
  const built = await buildReportFor(businessId, period, now);
  const cached = isSingleDay(period) ? await savedHighlights(businessId, period.fromDay) : null;
  const highlights = cached ?? (await reportHighlights(built.report, lang, { ai: true }));
  const email = buildDailyEmail(built.report, lang, highlights, { baseUrl: opts.baseUrl });
  const base = { version: 1, day: "", fromDay: period.fromDay, toDay: period.toDay, tz: period.tz, trigger: "range", to, subject: email.subject, lang, quiet: isQuiet(built.report), counts: reportCounts(built.report), highlights, attempts: 1, lastTryAt: now.toISOString() };
  try {
    const sender = await sendSeoEmail({ businessId, to, ...email });
    const row = await db.seoReport.create({ data: { businessId, kind: "daily", data: { ...base, state: "sent", sentAt: new Date().toISOString(), sender: senderLabel(sender), error: "", retry: false } as Prisma.InputJsonValue } });
    return { state: "sent", to, subject: email.subject, sender, recordId: row.id };
  } catch (e) {
    await db.seoReport.create({ data: { businessId, kind: "daily", data: { ...base, state: "error", error: errText(e), retry: false } as Prisma.InputJsonValue } }).catch(() => {});
    throw e;
  }
}

// ---------- El cron ----------

export type DailyRunResult = { checked: number; sent: number; skipped: number; errors: number; businesses: string[] };

/**
 * Lo llama el cron (cada minuto o cuando corra): para cada negocio con el reporte diario encendido, si ya pasó su
 * medianoche y el día de ayer no se mandó, lo manda. Como mucho `max` negocios por llamada y dentro de `budgetMs`
 * (el resto sigue en la próxima). Nunca manda dos veces el mismo día (ver claimDay); nunca manda días viejos atrasados.
 */
export async function runDailyReports(now = new Date(), opts: { max?: number; budgetMs?: number } = {}): Promise<DailyRunResult> {
  const started = Date.now();
  const max = opts.max ?? 5;
  const budget = opts.budgetMs ?? 90_000;
  const out: DailyRunResult = { checked: 0, sent: 0, skipped: 0, errors: 0, businesses: [] };
  const list = await db.business.findMany({
    where: { reportDaily: true, OR: [{ reportEmail: { not: "" } }, { ownerEmail: { not: "" } }] },
    select: { id: true, timezone: true, reportEmail: true, ownerEmail: true },
    orderBy: { createdAt: "asc" },
    take: 1000,
  });
  const due = list
    .map((b) => ({ id: b.id, day: dailyDueDay(null, businessTz(b), now), ok: dailyRecipients(b).length > 0 }))
    .filter((x): x is { id: string; day: string; ok: boolean } => Boolean(x.day && x.ok));
  if (!due.length) return out;
  // Lo ya mandado (o que no hay que reintentar) en las últimas 50 horas, en UNA consulta.
  const recent = await db.seoReport.findMany({
    where: { kind: "daily", businessId: { in: due.map((d) => d.id) }, createdAt: { gte: new Date(now.getTime() - 50 * 3600_000) } },
    select: { businessId: true, data: true, createdAt: true },
  });
  const closed = new Set<string>();
  for (const r of recent) {
    const rec = readDailyRecord(r.data);
    if (rec && rec.day && rec.trigger !== "range" && closesDay(rec, r.createdAt, now)) closed.add(`${r.businessId}|${rec.day}`);
  }
  for (const d of due) {
    if (closed.has(`${d.id}|${d.day}`)) continue;
    if (out.checked >= max || Date.now() - started > budget) break;
    out.checked += 1;
    try {
      const res = await sendDailyReport(d.id, d.day, { trigger: "cron", now });
      if (res.state === "sent") {
        out.sent += 1;
        out.businesses.push(d.id);
      } else if (res.state === "error") {
        out.errors += 1;
        console.error(`[reporte-diario] ${d.id} ${d.day}: ${res.error}`);
      } else out.skipped += 1;
    } catch (e) {
      out.errors += 1;
      console.error(`[reporte-diario] ${d.id} ${d.day}:`, e instanceof BiError ? e.message : errText(e));
    }
  }
  return out;
}

// ---------- Historial ----------

export type DailyHistoryItem = DailyRecord & { id: string; createdAt: Date; shown: DailyState | "stuck" };

/** Los últimos reportes enviados (o intentados) de un negocio, lo más nuevo primero. */
export async function dailyHistory(businessId: string, take = 30, now = new Date()): Promise<DailyHistoryItem[]> {
  const rows = await db.seoReport.findMany({ where: { businessId, kind: "daily" }, orderBy: { createdAt: "desc" }, take, select: { id: true, data: true, createdAt: true } });
  return rows
    .map((r) => {
      const rec = readDailyRecord(r.data);
      return rec ? { ...rec, id: r.id, createdAt: r.createdAt, shown: displayState(rec, r.createdAt, now) } : null;
    })
    .filter((x): x is DailyHistoryItem => x !== null);
}
