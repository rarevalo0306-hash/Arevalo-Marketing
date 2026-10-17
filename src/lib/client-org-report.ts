// Reglas del reporte semanal por email de una organización de clientes (ClientOrg): qué semana se reporta, cuándo
// toca mandarlo, qué datos de contacto y horario se guardan y cuándo se reintenta un envío que falló.
// También arma el email que recibe el CLIENTE: él nunca entra a la app, así que ahí solo va una lista blanca de secciones
// (publicaciones, resultados, reseñas, visitas, posiciones y lo que viene) y nada interno ni ningún link a la app.
// Este archivo es PURO (sin base de datos ni red) pero solo se usa en el servidor: importa seo/alerts, que trae el
// resto del servidor. No lo importes desde componentes del navegador (para eso está client-orgs.ts).
import { APP_HOST, OLD_APP_HOSTS } from "@/lib/app-host";
import { addDays, appTz, isValidTz, localDay } from "@/lib/business-tz";
import { publicBase, type BuiltEmail } from "@/lib/daily-report";
import { bi } from "@/lib/i18n";
import { periodText, rangePeriod, type PeriodReport, type PostsSection } from "@/lib/report-period";
import { reportSections, type ViewSection } from "@/lib/report-period-view";
import { parseAlertEmails } from "@/lib/seo/alerts";
import { escapeHtml } from "@/lib/text";
import { localToUtc } from "@/lib/time";

// ---------- La semana ----------

/** Una semana de lunes a domingo: `week` es el lunes (AAAA-MM-DD), `fromDay`/`toDay` los días que abarca. */
export type ReportWeek = { week: string; fromDay: string; toDay: string };

/** El lunes de la semana en la que cae un día ("2026-10-21" → "2026-10-19"). */
function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(day, -((dow + 6) % 7));
}

/** La última semana completa (lunes a domingo) antes de `now`, contada en la hora de la organización. */
export function reportWeek(now: Date, tz: string): ReportWeek {
  const fromDay = addDays(mondayOf(localDay(now, tz)), -7);
  return { week: fromDay, fromDay, toDay: addDays(fromDay, 6) };
}

/**
 * La semana que toca mandar ahora, o null. El momento de envío de esta semana es el día elegido (0 = domingo …
 * 6 = sábado, contado desde el lunes de esta semana) a la hora elegida, en la hora de la organización; si ya pasó,
 * toca la última semana completa. Con el reporte apagado nunca toca.
 */
export function dueWeek(org: { reportOn: boolean; reportDay: number; reportHour: number }, now: Date, tz: string): ReportWeek | null {
  if (!org.reportOn) return null;
  const sendDay = addDays(mondayOf(localDay(now, tz)), (org.reportDay + 6) % 7);
  const sendAt = localToUtc(sendDay, 0, `${String(org.reportHour).padStart(2, "0")}:00`, tz);
  return now.getTime() >= sendAt.getTime() ? reportWeek(now, tz) : null;
}

/** La zona de la organización: la suya si es válida; si está vacía o no sirve, la de la app. */
export function orgTz(timezone: string): string {
  const tz = timezone.trim();
  return isValidTz(tz) ? tz : appTz();
}

// ---------- Ajustes ----------

export type ReportSettings = {
  contactName: string;
  reportEmail: string;
  phone: string;
  reportLang: "es" | "en";
  reportOn: boolean;
  reportDay: number;
  reportHour: number;
  timezone: string;
};

const CONTACT_NAME_MAX = 120;
const PHONE_MAX = 40;

/** Un número entero en texto ("5") dentro de un rango, o null. */
function intIn(text: string, min: number, max: number): number | null {
  if (!/^\d{1,2}$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/**
 * Lee y valida los ajustes del reporte de una organización (los campos del formulario, como texto). Quita los
 * espacios, y si un campo no sirve lanza un BiError que lo nombra (el primero que falle).
 */
export function readReportSettings(raw: Record<string, string>): ReportSettings {
  const get = (k: string) => (raw[k] ?? "").trim();

  const contactName = get("contactName");
  if (contactName.length > CONTACT_NAME_MAX) {
    throw bi(`El nombre de contacto puede tener hasta ${CONTACT_NAME_MAX} caracteres.`, `The contact name can be up to ${CONTACT_NAME_MAX} characters.`);
  }

  const emails = parseAlertEmails(get("reportEmail"));
  if (!emails.ok) throw bi("Escribe hasta 3 emails válidos para el reporte.", "Enter up to 3 valid emails for the report.");

  const phone = get("phone");
  if (phone.length > PHONE_MAX) {
    throw bi(`El teléfono puede tener hasta ${PHONE_MAX} caracteres.`, `The phone number can be up to ${PHONE_MAX} characters.`);
  }

  const reportLang = get("reportLang");
  if (reportLang !== "es" && reportLang !== "en") {
    throw bi("Elige el idioma del reporte: español o inglés.", "Choose the report language: Spanish or English.");
  }

  const reportDay = intIn(get("reportDay"), 0, 6);
  if (reportDay === null) throw bi("Elige el día del reporte (de domingo a sábado).", "Choose the report day (Sunday to Saturday).");

  const reportHour = intIn(get("reportHour"), 0, 23);
  if (reportHour === null) throw bi("Elige la hora del reporte (de 0 a 23).", "Choose the report hour (0 to 23).");

  const timezone = get("timezone");
  if (timezone && !isValidTz(timezone)) throw bi("La zona horaria del reporte no es válida.", "The report time zone is not valid.");

  return { contactName, reportEmail: emails.emails.join(", "), phone, reportLang, reportOn: raw.reportOn === "on", reportDay, reportHour, timezone };
}

// ---------- Reintentos ----------

/** Intentos en total de un envío automático (el primero cuenta). */
export const MAX_ATTEMPTS = 3;
/** Cuánto se espera entre un intento y el siguiente. */
export const RETRY_MS = 30 * 60_000;

/**
 * ¿Se reintenta este envío automático? Si falló (error) o quedó trabado (sending), le quedan intentos y pasaron
 * al menos 30 minutos desde el último movimiento.
 */
export function retryable(row: { state: string; attempts: number; updatedAt: Date }, now: Date): boolean {
  if (row.state !== "error" && row.state !== "sending") return false;
  return row.attempts < MAX_ATTEMPTS && now.getTime() - row.updatedAt.getTime() >= RETRY_MS;
}

// ---------- Lo que ve el cliente ----------

/** Las únicas secciones que llegan al cliente. Todo lo demás del reporte (costos, IA, anuncios…) es de la agencia. */
export const CLIENT_SECTIONS = ["posts", "results", "reviews", "web", "rankings", "next"] as const;

/**
 * De las publicaciones, solo lo que salió: las que salieron (con su link público) y cuántas fueron. Lo que no salió o
 * se saltó, sus razones y sus números no llegan al cliente: es un problema de la agencia, no una noticia para él.
 * Escrito campo por campo y con `failed`/`skipped` en 0, para que ni las frases de «Resumen» (que salen de estos
 * números) hablen de eso. Si no salió ninguna, no hay sección.
 */
function sentPosts(p: PostsSection): PostsSection | null {
  if (!p.sent) return null;
  return {
    sent: p.sent,
    failed: 0,
    skipped: 0,
    prevSent: p.prevSent,
    byChannel: p.byChannel.filter((c) => c.sent > 0).map((c) => ({ channel: c.channel, sent: c.sent, failed: 0, skipped: 0 })),
    items: p.items
      .filter((i) => i.status === "sent")
      .map((i) => ({ postId: i.postId, title: i.title, channel: i.channel, status: i.status, url: i.url, at: i.at, detail: "" })),
  };
}

/**
 * El reporte con solo lo que puede ver el cliente. Es un objeto escrito campo por campo (nunca `...r`): si algún día
 * PeriodReport gana una sección, aquí deja de compilar en vez de colarse en el email. De «lo que viene» solo pasa
 * `upcoming` (las publicaciones programadas); las tareas pendientes son de la agencia.
 */
export function clientOnly(r: PeriodReport): PeriodReport {
  return {
    business: r.business,
    period: r.period,
    generatedAt: r.generatedAt,
    posts: r.posts ? sentPosts(r.posts) : null,
    results: r.results,
    campaigns: null,
    ai: null,
    ads: null,
    reviews: r.reviews,
    web: r.web,
    rankings: r.rankings,
    tasks: null,
    proposals: null,
    alerts: null,
    costs: null,
    next: r.next?.upcoming ? { tasks: [], upcoming: r.next.upcoming } : null,
  };
}

/** Las direcciones de la app (y de matya.app): un link a cualquiera de ellas es un link a la app. */
function appHosts(): string[] {
  const hosts = new Set<string>([APP_HOST, ...OLD_APP_HOSTS]);
  try {
    hosts.add(new URL(publicBase()).hostname.toLowerCase());
  } catch {
    // PUBLIC_BASE_URL no es una dirección: queda la de siempre
  }
  return [...hosts];
}

/** Un link que el cliente puede abrir: https completo y que NO sea de la app (ni sus rutas «/b/…»). Si no, null. */
function publicLink(href: string | null | undefined): string | null {
  const v = (href ?? "").trim();
  if (!/^https:\/\//i.test(v)) return null;
  let host = "";
  try {
    host = new URL(v).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || appHosts().some((h) => host === h || host.endsWith(`.${h}`))) return null;
  return v;
}

/** De la línea de una reseña, solo la hora (lo que va antes del primer « · »): lo demás es de la agencia (si la contestó o no) y no se deja pasar. */
function reviewMeta(meta: string | undefined): string | undefined {
  return meta?.split(" · ")[0] || undefined;
}

/**
 * Una sección para el cliente, campo por campo (una lista blanca, no `...s`): sin `href`/`hrefText` (llevan a la app) ni
 * `more` («y 12 más en el historial» habla de la app), y con links solo si son públicos (la publicación o la reseña).
 * De las reseñas solo queda la hora de cada una.
 */
export function clientSection(s: ViewSection): ViewSection {
  const out: ViewSection = { id: s.id, title: s.title };
  if (s.note) out.note = s.note;
  if (s.stats) out.stats = s.stats.map((x) => ({ label: x.label, value: x.value, sub: x.sub, tone: x.tone }));
  if (s.items) {
    out.items = s.items.map((i) => {
      const href = publicLink(i.href);
      const meta = s.id === "reviews" ? reviewMeta(i.meta) : i.meta;
      return href ? { text: i.text, tone: i.tone, meta, href, linkText: i.linkText } : { text: i.text, tone: i.tone, meta };
    });
  }
  if (s.table) out.table = { head: s.table.head, rows: s.table.rows, links: s.table.links?.map(publicLink) };
  return out;
}

/** Las secciones del cliente en su idioma, listas para el email: solo la lista blanca y sin links a la app. */
export function clientView(r: PeriodReport, lang: "es" | "en"): ViewSection[] {
  return reportSections(clientOnly(r), lang)
    .filter((s) => (CLIENT_SECTIONS as readonly string[]).includes(s.id))
    .map(clientSection);
}

/**
 * «Resumen» de la organización: hasta 3 frases, una de cada negocio por turno (A, B, A…). Con más de un negocio cada
 * frase dice de cuál es («Techos: …»); con uno solo van tal cual.
 */
export function orgHighlights(perBusiness: { name: string; items: string[] }[]): string[] {
  const out: string[] = [];
  const many = perBusiness.length > 1;
  for (let round = 0; out.length < 3; round++) {
    let any = false;
    for (const b of perBusiness) {
      const item = b.items[round];
      if (item === undefined) continue;
      any = true;
      if (out.length < 3) out.push(many ? `${b.name}: ${item}` : item);
    }
    if (!any) break;
  }
  return out;
}

// ---------- El email del cliente ----------

export type ClientOrgEmail = {
  orgName: string;
  /** El nombre de la cuenta (la agencia): firma el pie. */
  accountName: string;
  week: ReportWeek;
  tz: string;
  lang: "es" | "en";
  /** Un envío de prueba: el asunto empieza con «Prueba · ». */
  test: boolean;
  businesses: { name: string; color: string; sections: ViewSection[] }[];
  highlights: string[];
};

const FONT = "font-family:Arial,Helvetica,sans-serif;";
const INK = "#1f2933";
const MUTED = "#6b7280";
const LINK = "#0b5cad";
const TONE = { bad: "#b42318", good: "#067647", neutral: "#475467" };
const MARK = { bad: "▼", good: "▲", neutral: "•" };
/** Lo máximo que se muestra de una lista o tabla (el resto: «y N más»). */
const MAX_LINES = 12;

const toneOf = (t: string | undefined): "bad" | "good" | "neutral" => (t === "bad" || t === "good" ? t : "neutral");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** El color del punto del negocio: un #rgb o #rrggbb; cualquier otra cosa (que iría dentro de un style) no pasa. */
const dotColor = (c: string) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()) ? c.trim() : "#126BBC");

function sectionHtml(s: ViewSection, color: string, t: (es: string, en: string) => string): string {
  const e = escapeHtml;
  const rows: string[] = [];
  rows.push(`<tr><td style="${FONT}padding:18px 0 6px 0;font-size:16px;font-weight:bold;color:${INK};border-bottom:2px solid ${color};">${e(s.title)}</td></tr>`);
  if (s.stats?.length) {
    const cells = s.stats.map(
      (st) =>
        `<td valign="top" width="50%" style="${FONT}padding:8px 8px 8px 0;"><div style="font-size:12px;color:${MUTED};">${e(st.label)}</div><div style="font-size:22px;font-weight:bold;color:${toneOf(st.tone) === "neutral" ? INK : TONE[toneOf(st.tone)]};">${e(st.value)}</div>${st.sub ? `<div style="font-size:12px;color:${MUTED};">${e(st.sub)}</div>` : ""}</td>`,
    );
    const lines: string[] = [];
    for (let i = 0; i < cells.length; i += 2) lines.push(`<tr>${cells[i]}${cells[i + 1] ?? '<td width="50%"></td>'}</tr>`);
    rows.push(`<tr><td style="padding:4px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lines.join("")}</table></td></tr>`);
  }
  if (s.items?.length) {
    const li = s.items
      .slice(0, MAX_LINES)
      .map((i) => {
        const tone = toneOf(i.tone);
        const href = publicLink(i.href);
        const link = href ? ` <a href="${e(href)}" style="color:${LINK};font-weight:bold;">${e(t("Ver", "View"))}</a>` : "";
        const meta = i.meta ? `<div style="font-size:12px;color:${MUTED};">${e(i.meta)}</div>` : "";
        return `<tr><td valign="top" style="${FONT}width:18px;padding:5px 0;font-size:12px;color:${TONE[tone]};">${MARK[tone]}</td><td style="${FONT}padding:5px 0;font-size:15px;line-height:1.45;color:${INK};">${e(i.text)}${link}${meta}</td></tr>`;
      })
      .join("");
    rows.push(`<tr><td style="padding:4px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${li}</table></td></tr>`);
    const rest = s.items.length - MAX_LINES;
    if (rest > 0) rows.push(`<tr><td style="${FONT}padding:2px 0 0 18px;font-size:13px;color:${MUTED};">${e(t(`y ${rest} más.`, `and ${rest} more.`))}</td></tr>`);
  }
  if (s.table?.rows.length) {
    const th = s.table.head.map((h, i) => `<th align="${i ? "right" : "left"}" style="${FONT}padding:6px 4px;font-size:12px;color:${MUTED};font-weight:normal;border-bottom:1px solid #e5e7eb;">${e(h)}</th>`).join("");
    const body = s.table.rows
      .slice(0, MAX_LINES)
      .map((row, ri) => {
        const href = publicLink(s.table?.links?.[ri]);
        return `<tr>${row
          .map((c, i) => {
            const inner = i === 0 && href ? `<a href="${e(href)}" style="color:${LINK};">${e(c)}</a>` : e(c);
            return `<td align="${i ? "right" : "left"}" style="${FONT}padding:6px 4px;font-size:14px;color:${INK};border-bottom:1px solid #f0f1f3;${i ? "white-space:nowrap;" : ""}">${inner}</td>`;
          })
          .join("")}</tr>`;
      })
      .join("");
    rows.push(`<tr><td style="padding:4px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${th}</tr>${body}</table></td></tr>`);
    const rest = s.table.rows.length - MAX_LINES;
    if (rest > 0) rows.push(`<tr><td style="${FONT}padding:2px 0 0 4px;font-size:13px;color:${MUTED};">${e(t(`y ${rest} más.`, `and ${rest} more.`))}</td></tr>`);
  }
  if (s.note) rows.push(`<tr><td style="${FONT}padding:6px 0;font-size:13px;line-height:1.5;color:${MUTED};">${e(s.note)}</td></tr>`);
  return rows.join("\n");
}

/** El texto sin HTML: nada de `<` ni `>` de los datos, y cada valor en una sola línea. */
const tx = (s: string) => oneLine(s.replace(/[<>]/g, ""));

function sectionText(s: ViewSection, t: (es: string, en: string) => string): string[] {
  const lines = ["", tx(s.title), "-".repeat(Math.min(60, Math.max(3, tx(s.title).length)))];
  for (const st of s.stats ?? []) lines.push(`${tx(st.label)}: ${tx(st.value)}${st.sub ? ` (${tx(st.sub)})` : ""}`);
  for (const i of (s.items ?? []).slice(0, MAX_LINES)) {
    const href = publicLink(i.href);
    lines.push(`${i.tone === "bad" ? "(-)" : i.tone === "good" ? "(+)" : " -"} ${tx(i.text)}${i.meta ? ` [${tx(i.meta)}]` : ""}${href ? ` ${tx(href)}` : ""}`);
  }
  if ((s.items?.length ?? 0) > MAX_LINES) lines.push(t(`y ${s.items!.length - MAX_LINES} más.`, `and ${s.items!.length - MAX_LINES} more.`));
  if (s.table?.rows.length) {
    lines.push(s.table.head.map(tx).join(" | "));
    s.table.rows.slice(0, MAX_LINES).forEach((row, ri) => {
      const href = publicLink(s.table?.links?.[ri]);
      lines.push(`${row.map(tx).join(" | ")}${href ? ` ${tx(href)}` : ""}`);
    });
    if (s.table.rows.length > MAX_LINES) lines.push(t(`y ${s.table.rows.length - MAX_LINES} más.`, `and ${s.table.rows.length - MAX_LINES} more.`));
  }
  if (s.note) lines.push(tx(s.note));
  return lines;
}

/**
 * El email semanal de una organización para su cliente: el nombre y la semana, «Resumen» (hasta 3 frases), cada
 * negocio con sus secciones y «Enviado por <cuenta>». Sin botón ni link a la app: solo los links públicos (la
 * publicación o la reseña) y solo si son https. Lo que no se escribe aquí no sale: este renderizador ignora el
 * `href` de cada sección y cualquier link que no sea público, aunque las secciones que reciba los traigan.
 */
export function buildClientOrgEmail(e: ClientOrgEmail): BuiltEmail {
  const lang = e.lang === "en" ? "en" : "es";
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const esc = escapeHtml;
  const org = oneLine(e.orgName);
  const account = oneLine(e.accountName);
  const when = periodText(rangePeriod(e.week.fromDay, e.week.toDay, orgTz(e.tz)), lang, "long");
  const subject = `${e.test ? t("Prueba · ", "Test · ") : ""}${t(`Reporte semanal de ${org}: ${when}`, `Weekly report for ${org}: ${when}`)}`;
  const kicker = t("Reporte semanal", "Weekly report");
  const summaryTitle = t("Resumen", "Summary");
  const noActivity = t("Sin actividad esta semana.", "No activity this week.");
  const footer = t(`Enviado por ${account}`, `Sent by ${account}`);
  const highlights = e.highlights.map(oneLine).filter(Boolean);

  const blocks = e.businesses.map((b) => {
    const color = dotColor(b.color);
    const head = `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="12" height="12" bgcolor="${color}" style="width:12px;height:12px;background:${color};border-radius:6px;font-size:0;line-height:0;">&nbsp;</td><td style="${FONT}padding-left:8px;font-size:20px;font-weight:bold;color:${INK};">${esc(oneLine(b.name))}</td></tr></table>`;
    const body = b.sections.length
      ? b.sections.map((s) => sectionHtml(s, color, t)).join("\n")
      : `<tr><td style="${FONT}padding:10px 0;font-size:15px;color:${MUTED};">${esc(noActivity)}</td></tr>`;
    return `<tr><td style="padding:22px 22px 4px 22px;">${head}</td></tr>
<tr><td style="padding:0 22px 8px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${body}
</table></td></tr>`;
  });

  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(highlights[0] ?? when)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;"><tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;">
<tr><td style="${FONT}background:${INK};color:#ffffff;padding:20px 22px 22px 22px;border-radius:10px 10px 0 0;">
<div style="font-size:12px;letter-spacing:1.5px;font-weight:bold;opacity:0.85;">${esc(kicker.toUpperCase())}</div>
<div style="font-size:24px;font-weight:bold;line-height:1.25;margin-top:6px;">${esc(org)}</div>
<div style="font-size:14px;margin-top:4px;">${esc(when)}</div>
</td></tr>
<tr><td style="padding:16px 22px 4px 22px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;border-radius:8px;border-left:4px solid ${INK};">
<tr><td style="${FONT}padding:12px 14px 4px 14px;font-size:15px;font-weight:bold;color:${INK};">${esc(summaryTitle)}</td></tr>
${(highlights.length ? highlights : [noActivity]).map((h) => `<tr><td style="${FONT}padding:4px 14px 6px 14px;font-size:15px;line-height:1.45;color:${INK};">• ${esc(h)}</td></tr>`).join("\n")}
<tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
</table></td></tr>
${blocks.join("\n")}
<tr><td style="${FONT}padding:18px 22px 20px 22px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:${MUTED};">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    tx(org),
    tx(kicker),
    tx(when),
    "",
    tx(summaryTitle),
    ...(highlights.length ? highlights : [noActivity]).map((h) => `- ${tx(h)}`),
    ...e.businesses.flatMap((b) => [
      "",
      "=".repeat(60),
      tx(b.name),
      ...(b.sections.length ? b.sections.flatMap((s) => sectionText(s, t)) : ["", noActivity]),
    ]),
    "",
    tx(footer),
  ].join("\n");

  return { subject, html, text };
}
