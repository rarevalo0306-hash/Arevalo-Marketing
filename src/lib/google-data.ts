// Mantenimiento de los datos de Google (lo llama el cron en src/app/api/cron/route.ts, con su propio try/catch):
// - Revisa cada conexión de Google más o menos una vez al día pidiendo un permiso nuevo. Si Google dice invalid_grant
//   (el dueño quitó el acceso desde su cuenta de Google), se marca y a los 3 días se borran la conexión y sus datos.
// - A la hora del cron diario (13 UTC) borra los resultados de YouTube de más de 28 días, el nombre del canal que no
//   se pudo volver a leer en 30 días y los reportes viejos de Search Console y Analytics.
// Las reglas puras (cuándo toca, qué se borra) están en google-data-shape.ts. Cada escritura deja Connection.updatedAt
// como estaba (así no cambia «Necesita volver a conectarse») y solo se guarda si nadie volvió a conectar mientras tanto.
import { decryptJson, encryptJson } from "@/lib/crypto";
import { GOOGLE_CHANNELS, purgeGoogleChannelData, type GoogleChannel } from "@/lib/data-deletion";
import { db } from "@/lib/db";
import {
  DAY_MS,
  googleCheckDue,
  isRevokedGrant,
  SEO_RETENTION,
  shouldPurgeRevoked,
  YOUTUBE_KEEP_DAYS,
  youtubeLabelExpired,
  type GoogleHealth,
} from "@/lib/google-data-shape";
import { googleEnabled, youtubeChannel } from "@/lib/google-oauth";
import { googleAccessToken } from "@/lib/publishers/google";
import type { Creds } from "@/lib/publishers/types";

/** Revisiones (o borrados) como mucho por vuelta. */
export const CHECK_MAX = 50;
/** La hora (UTC) del cron diario de Vercel (vercel.json): ahí se borra lo viejo. */
export const PRUNE_HOUR_UTC = 13;
/**
 * Interruptor de emergencia: GOOGLE_REVOKED_PURGE=off deja marcadas las conexiones sin permiso pero no las borra
 * (por ejemplo, si la app de Google quedara en modo de prueba, donde Google vence todos los permisos cada 7 días).
 */
const purgeOn = () => process.env.GOOGLE_REVOKED_PURGE !== "off";

type Secret = GoogleHealth & { refreshToken?: string } & Record<string, unknown>;
type Row = { id: string; businessId: string; channel: string; secret: string; updatedAt: Date };
export type CheckSummary = { checked: number; revoked: number; purged: number; errors: number };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Guarda el secreto (y el nombre) sin mover updatedAt; si la conexión cambió desde que se leyó, no guarda nada. */
async function writeConnection(c: Pick<Row, "id" | "updatedAt">, secret: Secret, label?: string): Promise<boolean> {
  const { count } = await db.connection.updateMany({
    where: { id: c.id, updatedAt: c.updatedAt },
    data: { secret: encryptJson(secret), ...(label !== undefined ? { label } : {}), updatedAt: c.updatedAt },
  });
  return count > 0;
}

/** Revisa las conexiones de Google que tocan y borra las que Google dice sin permiso desde hace 3 días. Nunca lanza por una conexión. */
export async function checkGoogleConnections(now: Date, opts: { budgetMs: number; max?: number }): Promise<CheckSummary> {
  const sum: CheckSummary = { checked: 0, revoked: 0, purged: 0, errors: 0 };
  if (!googleEnabled()) return sum;
  const started = Date.now();
  const max = opts.max ?? CHECK_MAX;
  const iso = now.toISOString();
  // Solo canales de Google (la tabla también guarda report_settings, meta_ads…). Son pocas filas: se leen todas.
  const rows: Row[] = await db.connection.findMany({
    where: { channel: { in: [...GOOGLE_CHANNELS] } },
    select: { id: true, businessId: true, channel: true, secret: true, updatedAt: true },
  });
  const items: { c: Row; s: Secret }[] = [];
  for (const c of rows) {
    try {
      const s = decryptJson<Secret>(c.secret);
      if (s.refreshToken) items.push({ c, s });
    } catch {
      sum.errors++;
    }
  }
  // Primero lo que ya toca borrar; después lo que lleva más tiempo sin revisar (lo nunca revisado va primero). Así, aunque
  // el cron corra una sola vez al día y haya más conexiones que el máximo por vuelta, todas se van revisando por turno.
  const purge = purgeOn() ? items.filter((x) => shouldPurgeRevoked(x.s, now)) : [];
  const lastCheck = (x: { s: Secret }) => Date.parse(x.s.checkedAt ?? "") || 0;
  const due = items.filter((x) => !purge.includes(x) && googleCheckDue(x.s, now)).sort((a, b) => lastCheck(a) - lastCheck(b));
  let work = 0;
  for (const x of purge) {
    if (work >= max || Date.now() - started >= opts.budgetMs) return sum;
    work++;
    try {
      if (await purgeGoogleChannelData(x.c.businessId, x.c.channel as GoogleChannel, { id: x.c.id, updatedAt: x.c.updatedAt })) sum.purged++;
    } catch (e) {
      sum.errors++;
      console.error("[google-datos] no se pudo borrar", x.c.channel, x.c.businessId, errText(e));
    }
  }
  for (const { c, s } of due) {
    if (work >= max || Date.now() - started >= opts.budgetMs) break;
    work++;
    sum.checked++;
    try {
      // Las conexiones sin cliente propio (Search Console, Analytics) usan el de la app (ver googleAccessToken).
      const token = await googleAccessToken(s as unknown as Creds);
      let label: string | undefined;
      let fresh = true;
      if (c.channel === "youtube") {
        // El nombre del canal es dato de YouTube: se vuelve a leer; si no se puede, no cuenta como al día.
        const ch = await youtubeChannel(token).catch(() => null);
        if (ch) label = ch.title;
        else fresh = false;
      }
      await writeConnection(c, { ...s, checkedAt: iso, ...(fresh ? { okAt: iso } : {}), revokedAt: undefined }, label);
    } catch (e) {
      const msg = errText(e);
      if (isRevokedGrant(msg)) {
        sum.revoked++;
        await writeConnection(c, { ...s, checkedAt: iso, revokedAt: s.revokedAt ?? iso }).catch(() => undefined);
      } else {
        // Otro error (cliente mal configurado, Google caído, red): nunca cuenta como permiso quitado.
        sum.errors++;
        await writeConnection(c, { ...s, checkedAt: iso }).catch(() => undefined);
      }
    }
  }
  return sum;
}

/** Resultados de YouTube de más de 28 días y nombres de canal que no se pudieron volver a leer en 30 días. */
export async function pruneYoutubeData(now: Date): Promise<{ metrics: number; labels: number }> {
  const { count: metrics } = await db.postMetric.deleteMany({ where: { channel: "youtube", fetchedAt: { lt: new Date(now.getTime() - YOUTUBE_KEEP_DAYS * DAY_MS) } } });
  const conns = await db.connection.findMany({ where: { channel: "youtube", label: { not: "" } }, select: { id: true, secret: true, updatedAt: true } });
  let labels = 0;
  for (const c of conns) {
    let s: Secret;
    try {
      s = decryptJson<Secret>(c.secret);
    } catch {
      continue;
    }
    if (!youtubeLabelExpired(s, c.updatedAt, now)) continue;
    const { count } = await db.connection.updateMany({ where: { id: c.id, updatedAt: c.updatedAt }, data: { label: "", updatedAt: c.updatedAt } });
    labels += count;
  }
  return { metrics, labels };
}

/** Reportes viejos de Search Console y Analytics: se quedan las `keep` más nuevas de cada negocio y las de menos de `maxAgeDays`. */
export async function pruneSeoReports(now: Date): Promise<number> {
  let total = 0;
  for (const [kind, rule] of Object.entries(SEO_RETENTION)) {
    const cutoff = new Date(now.getTime() - rule.maxAgeDays * DAY_MS);
    const businesses = await db.seoReport.findMany({ where: { kind, createdAt: { lt: cutoff } }, distinct: ["businessId"], select: { businessId: true } });
    for (const { businessId } of businesses) {
      const newest = await db.seoReport.findMany({ where: { businessId, kind }, orderBy: { createdAt: "desc" }, take: rule.keep, select: { id: true } });
      const { count } = await db.seoReport.deleteMany({ where: { businessId, kind, createdAt: { lt: cutoff }, id: { notIn: newest.map((r) => r.id) } } });
      total += count;
    }
  }
  return total;
}

export type MaintenanceSummary = CheckSummary & { metrics: number; labels: number; reports: number };

/** Lo que corre en cada llamada del cron: la revisión siempre; el borrado de lo viejo solo a la hora del cron diario. */
export async function runGoogleDataMaintenance(now: Date, opts: { budgetMs: number }): Promise<MaintenanceSummary> {
  const sum: MaintenanceSummary = { checked: 0, revoked: 0, purged: 0, errors: 0, metrics: 0, labels: 0, reports: 0 };
  try {
    Object.assign(sum, await checkGoogleConnections(now, opts));
  } catch (e) {
    sum.errors++;
    console.error("[google-datos] error al revisar las conexiones:", errText(e));
  }
  if (now.getUTCHours() !== PRUNE_HOUR_UTC) return sum;
  try {
    Object.assign(sum, await pruneYoutubeData(now));
  } catch (e) {
    sum.errors++;
    console.error("[google-datos] error al borrar lo viejo de YouTube:", errText(e));
  }
  try {
    sum.reports = await pruneSeoReports(now);
  } catch (e) {
    sum.errors++;
    console.error("[google-datos] error al borrar reportes viejos:", errText(e));
  }
  return sum;
}
