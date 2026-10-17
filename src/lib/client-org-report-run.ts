// Envío del reporte semanal de una organización de cliente (ClientOrg): reserva la semana, arma el email del cliente,
// lo manda y anota cada intento en ClientOrgReport. También el corredor que llaman el worker de la PC y el cron de Vercel.
//
// Una semana automática se manda UNA sola vez aunque dos corredores disparen en el mismo instante: el índice único parcial
// ClientOrgReport_cron_week_key (clientOrgId, week) WHERE trigger = 'cron' deja pasar solo a un INSERT. Quien pierde esa
// carrera puede reclamar la misma fila solo si falló o quedó trabada (ver `retryable`), con un solo UPDATE condicionado.
// Lo que sale al cliente pasa SIEMPRE por la lista blanca de client-org-report.ts (clientOnly / clientView): este archivo es
// donde se aplica, porque buildClientOrgEmail dibuja lo que recibe.
import { Prisma } from "@prisma/client";
import { buildClientOrgEmail, clientOnly, clientView, dueWeek, MAX_ATTEMPTS, orgHighlights, orgTz, reportWeek, retryable, RETRY_MS, type ReportWeek } from "@/lib/client-org-report";
import { notInAccount } from "@/lib/client-orgs-store";
import { buildReportFor, reportHighlights } from "@/lib/daily-report";
import { db } from "@/lib/db";
import { bi, BiError } from "@/lib/i18n";
import { rangePeriod } from "@/lib/report-period";
import { parseAlertEmails, SenderConfigError, sendSeoEmail, type Sender } from "@/lib/seo/alerts";

/** Lo más que se guarda del texto de un error. */
const ERROR_MAX = 300;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, ERROR_MAX);

/** Los emails de una lista guardada o pedida ("a@x.com, b@y.com"); vacía si alguno no es válido. */
function emailsOf(raw: string): string[] {
  const r = parseAlertEmails(raw);
  return r.ok ? r.emails : [];
}

const isUniqueRefusal = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

// ---------- Reservar la semana ----------

/**
 * Reserva la semana automática de una organización para mandarla. Inserta la fila `cron` en estado `sending`; si la
 * semana ya tiene fila (índice único parcial, P2002) la reclama con UN solo UPDATE condicionado a que sea reintentable
 * (error o sending, menos de 3 intentos y sin moverse en 30 minutos), así que de dos llamadas simultáneas gana una.
 * Devuelve la fila (id e intentos con este incluido) o null si otro ya la tiene, ya salió o ya no se reintenta.
 * Todo se escribe con el `now` que llega, no con el reloj de la base: la regla de los 30 minutos sigue al que llama.
 */
export async function claimCronWeek(clientOrgId: string, week: string, now: Date): Promise<{ id: string; attempts: number } | null> {
  try {
    return await db.clientOrgReport.create({
      data: { clientOrgId, week, trigger: "cron", state: "sending", to: [], createdAt: now, updatedAt: now },
      select: { id: true, attempts: true },
    });
  } catch (e) {
    if (!isUniqueRefusal(e)) throw e;
  }
  const { count } = await db.clientOrgReport.updateMany({
    where: {
      clientOrgId,
      week,
      trigger: "cron",
      state: { in: ["error", "sending"] },
      attempts: { lt: MAX_ATTEMPTS },
      updatedAt: { lte: new Date(now.getTime() - RETRY_MS) },
    },
    data: { state: "sending", attempts: { increment: 1 }, updatedAt: now },
  });
  if (count === 0) return null;
  // Quien ganó el UPDATE lo movió a `now`: nadie más lo reclama hasta dentro de 30 minutos, así que esta lectura es la suya.
  return db.clientOrgReport.findFirst({ where: { clientOrgId, week, trigger: "cron" }, select: { id: true, attempts: true } });
}

// ---------- Mandar ----------

export type ClientOrgSendOutcome = { state: "sent" | "error"; week: ReportWeek; to: string[]; subject: string; sender?: Sender; error?: string };

/**
 * Manda el reporte semanal de una organización. `organizationId` es la cuenta que lo pide (null solo para el corredor
 * automático, que recorre todas las cuentas): con una cuenta, una organización de otra cuenta se rechaza igual que una que
 * no existe, antes de escribir nada.
 *
 * `cron` reserva la semana con `claimCronWeek` y devuelve null si no le tocó; `manual` y `test` anotan su propia fila (se
 * pueden repetir y no estorban al automático). Sin negocios, o sin a quién mandarlo, lanza un BiError antes de reservar.
 * Un fallo al armar o mandar queda anotado como `error` y se devuelve (no se lanza); un SenderConfigError (falta o falla
 * la configuración del email) se anota con todos los intentos gastados para que no se reintente.
 */
export async function sendClientOrgReport(
  clientOrgId: string,
  opts: { trigger: "cron" | "manual" | "test"; organizationId: string | null; to?: string[]; now?: Date; week?: ReportWeek },
): Promise<ClientOrgSendOutcome | null> {
  const now = opts.now ?? new Date();
  const org = await db.clientOrg.findFirst({
    where: { id: clientOrgId, ...(opts.organizationId === null ? {} : { organizationId: opts.organizationId }) },
    select: {
      id: true,
      name: true,
      reportEmail: true,
      reportLang: true,
      timezone: true,
      organization: { select: { name: true } },
      businesses: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, color: true } },
    },
  });
  if (!org) throw notInAccount();
  if (!org.businesses.length) {
    throw bi("Esta organización no tiene negocios: agrega uno para poder mandar su reporte.", "This organization has no businesses: add one to be able to send its report.");
  }
  const to = opts.trigger === "test" ? emailsOf((opts.to ?? []).join(", ")) : emailsOf(org.reportEmail);
  if (!to.length) {
    throw bi("Falta a quién mandarlo: escribe un email válido para el reporte.", "There's no one to send it to: enter a valid email for the report.");
  }

  const tz = orgTz(org.timezone);
  const week = opts.week ?? reportWeek(now, tz);
  let row: { id: string } | null;
  if (opts.trigger === "cron") {
    row = await claimCronWeek(org.id, week.week, now);
    if (!row) return null;
  } else {
    row = await db.clientOrgReport.create({
      data: { clientOrgId: org.id, week: week.week, trigger: opts.trigger, state: "sending", to: [], createdAt: now, updatedAt: now },
      select: { id: true },
    });
  }
  const rowId = row.id;

  let sent: { subject: string; sender: Sender };
  try {
    const lang = org.reportLang === "en" ? "en" : "es";
    const period = rangePeriod(week.fromDay, week.toDay, tz);
    const perBusiness: { name: string; items: string[] }[] = [];
    const businesses: { name: string; color: string; sections: ReturnType<typeof clientView> }[] = [];
    for (const b of org.businesses) {
      const { report } = await buildReportFor(b.id, period, now);
      // Lo que ve el cliente: las frases del «Resumen» salen del reporte ya filtrado, nunca del completo.
      const safe = clientOnly(report);
      const highlights = await reportHighlights(safe, lang, { ai: false });
      perBusiness.push({ name: b.name, items: highlights.items });
      businesses.push({ name: b.name, color: b.color, sections: clientView(report, lang) });
    }
    const accountName = org.organization.name;
    const email = buildClientOrgEmail({ orgName: org.name, accountName, week, tz, lang, test: opts.trigger === "test", businesses, highlights: orgHighlights(perBusiness) });
    const sender = await sendSeoEmail({ businessId: org.businesses[0].id, to, subject: email.subject, html: email.html, text: email.text, fromName: accountName });
    sent = { subject: email.subject, sender };
  } catch (e) {
    const error = errText(e);
    await db.clientOrgReport.update({
      where: { id: rowId },
      data: { state: "error", to, error, updatedAt: now, ...(e instanceof SenderConfigError ? { attempts: MAX_ATTEMPTS } : {}) },
    });
    return { state: "error", week, to, subject: "", error };
  }
  // Fuera del try: si anotar «sent» fallara, el email ya salió y no debe quedar como error (se reintentaría y se mandaría dos veces).
  await db.clientOrgReport.update({ where: { id: rowId }, data: { state: "sent", to, error: "", updatedAt: now } });
  return { state: "sent", week, to, subject: sent.subject, sender: sent.sender };
}

// ---------- El corredor ----------

/**
 * Lo llaman el worker de la PC y el cron de Vercel: para cada organización con el reporte encendido, con emails y con
 * al menos un negocio, si ya toca su semana (`dueWeek`, en su zona) y esa semana no se mandó (o se puede reintentar),
 * la manda. Como mucho `max` organizaciones por llamada y dentro de `budgetMs` (el resto sigue en la próxima). Dos
 * corredores al mismo tiempo no mandan dos veces: lo decide `claimCronWeek`. Una organización que falla no frena a las demás.
 */
export async function runClientOrgReports(now = new Date(), opts: { max?: number; budgetMs?: number } = {}): Promise<{ checked: number; sent: number; errors: number }> {
  const started = Date.now();
  const max = opts.max ?? 5;
  const budget = opts.budgetMs ?? 90_000;
  const out = { checked: 0, sent: 0, errors: 0 };
  const list = await db.clientOrg.findMany({
    where: { reportOn: true, reportEmail: { not: "" }, businesses: { some: {} } },
    select: { id: true, reportEmail: true, reportOn: true, reportDay: true, reportHour: true, timezone: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 1000,
  });
  // Las que ya tienen a quién mandarle y a las que les toca ahora (cada una en su zona). Un email guardado que no sirve no cuenta:
  // si no, se llevaría uno de los `max` en cada vuelta y las demás nunca llegarían.
  const due = list.flatMap((o) => {
    const week = dueWeek(o, now, orgTz(o.timezone));
    return week && emailsOf(o.reportEmail).length ? [{ id: o.id, week }] : [];
  });
  if (!due.length) return out;
  // Lo ya anotado de esas semanas, en UNA consulta: lo mandado (o que ya no se reintenta) no gasta ni uno de los `max`.
  const existing = await db.clientOrgReport.findMany({
    where: { trigger: "cron", clientOrgId: { in: due.map((d) => d.id) }, week: { in: [...new Set(due.map((d) => d.week.week))] } },
    select: { clientOrgId: true, week: true, state: true, attempts: true, updatedAt: true },
  });
  const rowOf = new Map(existing.map((r) => [`${r.clientOrgId}|${r.week}`, r]));
  for (const d of due) {
    const prior = rowOf.get(`${d.id}|${d.week.week}`);
    if (prior && !retryable(prior, now)) continue;
    if (out.checked >= max || Date.now() - started > budget) break;
    out.checked += 1;
    try {
      const res = await sendClientOrgReport(d.id, { trigger: "cron", organizationId: null, week: d.week, now });
      if (res?.state === "sent") out.sent += 1;
      else if (res?.state === "error") {
        out.errors += 1;
        console.error(`[reporte-semanal] ${d.id}: ${res.error}`);
      }
    } catch (e) {
      out.errors += 1;
      console.error(`[reporte-semanal] ${d.id}: ${e instanceof BiError ? e.message : e instanceof Error ? e.name : "unknown"}`);
    }
  }
  return out;
}
