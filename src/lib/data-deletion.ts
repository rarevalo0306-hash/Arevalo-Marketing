// Provider cleanup precedes relational deletion. Failures leave rows available for retry.
import type { Prisma } from '@prisma/client';
import { requireBusiness } from '@/lib/auth';
import { decryptJson } from '@/lib/crypto';
import { db } from '@/lib/db';
import { canRevokeAlone, gscCannibalQueries, scrubOnPageGsc, scrubPostedReplies, scrubSetupGsc } from '@/lib/google-data-shape';
import { deleteBusinessMedia } from '@/lib/media';
import { deleteBusinessR2Files, r2Enabled } from '@/lib/r2';
import { revokeGoogleToken } from '@/lib/google-oauth';
import { urlKey } from '@/lib/seo/onpage';
import { norm } from '@/lib/seo/writer';

export const GOOGLE_CHANNELS = ['google', 'gsc', 'ga4', 'youtube'] as const;
export type GoogleChannel = (typeof GOOGLE_CHANNELS)[number];

type GoogleSecret = { refreshToken?: string; googleUser?: string };

/** The Google account (googleUser) of every other Google connection, in any business; undefined when unknown. */
async function googleUsersWhere(where: Prisma.ConnectionWhereInput): Promise<(string | undefined)[]> {
  const rows = await db.connection.findMany({ where: { channel: { in: [...GOOGLE_CHANNELS] }, ...where }, select: { secret: true } });
  return rows.map(r => {
    try {
      return decryptJson<GoogleSecret>(r.secret).googleUser;
    } catch {
      return undefined;
    }
  });
}

// Disconnecting Google needs "connect" (Administrator or "Can connect" for that business); erasing a business stays
// Administrator-only (src/lib/auth.ts).
export async function disconnectGoogleData(businessId: string, channel: string) {
  await requireBusiness(businessId, 'connect');
  if (!GOOGLE_CHANNELS.some(c => c === channel)) throw new Error('Unsupported Google connection');
  const connection = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel } } });
  if (connection) {
    const secret = decryptJson<GoogleSecret>(connection.secret);
    // Revoking at Google would also cut every other connection made with the same Google account (any business), and the
    // cron would then delete their data. Only revoke when no other connection uses, or may use, that account.
    if (secret.refreshToken && canRevokeAlone(secret.googleUser, await googleUsersWhere({ NOT: { id: connection.id } })))
      await revokeGoogleToken(secret.refreshToken);
  }
  // Data cleanup is scoped to this selected connection, never another business.
  await purgeGoogleChannelData(businessId, channel as GoogleChannel);
}

/**
 * Deletes what one Google connection brought in and what Matya derived from it, then the connection itself.
 * No auth and no Google revoke here (callers do that). DataForSEO public data ("gbp", "reviews") is never deleted.
 * `guard` (cron): only the connection row read earlier is deleted; a reconnect made meanwhile is left alone.
 * Returns false when the guard no longer matches and nothing was done.
 */
export async function purgeGoogleChannelData(businessId: string, channel: GoogleChannel, guard?: { id: string; updatedAt: Date }): Promise<boolean> {
  if (guard && !(await db.connection.count({ where: { id: guard.id, updatedAt: guard.updatedAt } }))) return false;
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  const rewrite = (id: string, data: Record<string, unknown>) => ops.push(db.seoReport.updateMany({ where: { id }, data: { data: data as Prisma.InputJsonValue } }));
  if (channel === 'gsc') {
    // Search Console keywords inside the on-page review and the SEO setup proposal (every row is scrubbed).
    const rows = await db.seoReport.findMany({ where: { businessId, kind: { in: ['onpage', 'setup'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, data: true } });
    // Plan tasks: every task of a page whose keyword came from Search Console in the newest on-page review (the one the
    // plan reads), and, from older reviews, the tasks that quote that Search Console keyword. Tasks built from the owner's
    // or another keyword keep their done/dismissed state.
    const urls = new Set<string>();
    const older: { url: string; keyword: string }[] = [];
    let newestOnpage = true;
    for (const r of rows) {
      if (r.kind === 'onpage') {
        const s = scrubOnPageGsc(r.data);
        if (s && newestOnpage) s.urls.forEach(u => urls.add(urlKey(u)));
        else if (s) older.push(...s.keywords.map(k => ({ url: urlKey(k.url), keyword: k.keyword })));
        newestOnpage = false;
        if (s) rewrite(r.id, s.data);
      } else {
        const s = scrubSetupGsc(r.data);
        if (s) rewrite(r.id, s);
      }
    }
    const quoting = older.filter(o => !urls.has(o.url));
    const onpageTasks = quoting.length
      ? await db.actionTask.findMany({ where: { businessId, OR: [...new Set(quoting.map(o => o.url))].map(u => ({ key: { startsWith: `onpage:${u}:` } })) }, select: { id: true, key: true, title: true, detail: true } })
      : [];
    const quoted = onpageTasks
      .filter(t => quoting.some(o => t.key.startsWith(`onpage:${o.url}:`) && JSON.stringify([t.title, t.detail]).includes(o.keyword)))
      .map(t => t.id);
    // "decay" is all Search Console. Competing-pages reviews count only when built from Search Console (others come from
    // rank or audit data); the plan tasks of their Search Console searches go, from any of those reviews.
    const cannibal = await db.seoReport.findMany({ where: { businessId, kind: 'cannibal', data: { path: ['source'], equals: 'gsc' } }, select: { data: true } });
    const cannibalKeys = [...new Set(cannibal.flatMap(r => gscCannibalQueries(r.data)).map(q => `cannibal:${norm(q)}`))];
    ops.push(db.seoReport.deleteMany({ where: { businessId, kind: { in: ['gsc', 'decay'] } } }));
    ops.push(db.seoReport.deleteMany({ where: { businessId, kind: 'cannibal', data: { path: ['source'], equals: 'gsc' } } }));
    ops.push(db.actionTask.deleteMany({
      where: {
        businessId,
        OR: [
          { source: 'gsc', key: { not: 'setup:gsc' } },
          { key: { startsWith: 'decay:' } },
          ...(cannibalKeys.length ? [{ key: { in: cannibalKeys } }] : []),
          ...[...urls].map(u => ({ key: { startsWith: `onpage:${u}:` } })),
          ...(quoted.length ? [{ id: { in: quoted } }] : []),
        ],
      },
    }));
    ops.push(db.aiProposal.deleteMany({ where: { businessId, evidence: { path: ['rule'], equals: 'gsc-query' } } }));
  } else if (channel === 'ga4') {
    // ga4:key-events, ga4:organic-low and ga4:bounce:* (setup:ga4 only invites to connect, so it stays).
    ops.push(db.seoReport.deleteMany({ where: { businessId, kind: 'ga4' } }));
    ops.push(db.actionTask.deleteMany({ where: { businessId, key: { startsWith: 'ga4:' } } }));
  } else if (channel === 'youtube') {
    ops.push(db.postMetric.deleteMany({ where: { businessId, channel: 'youtube' } }));
    // Proposals to add or remove YouTube from a campaign quote YouTube results.
    ops.push(db.aiProposal.deleteMany({ where: { businessId, evidence: { path: ['key'], string_ends_with: ':youtube' } } }));
  } else {
    // Business Profile: only the "posted from Matya" reply markers.
    const rows = await db.seoReport.findMany({ where: { businessId, kind: 'reviews' }, select: { id: true, data: true } });
    for (const r of rows) {
      const s = scrubPostedReplies(r.data);
      if (s) rewrite(r.id, s);
    }
  }
  ops.push(guard ? db.connection.deleteMany({ where: { id: guard.id, updatedAt: guard.updatedAt } }) : db.connection.deleteMany({ where: { businessId, channel } }));
  await db.$transaction(ops);
  return true;
}

export async function eraseBusinessData(businessId: string) {
  await requireBusiness(businessId, 'admin');
  if (!r2Enabled() && await db.libraryItem.count({ where: { businessId } }) > 0) throw new Error('Configure R2 before deleting a business with library files; cleanup cannot be verified.');
  const connections = await db.connection.findMany({ where: { businessId, channel: { in: [...GOOGLE_CHANNELS] } }, select: { secret: true } });
  // Same rule as disconnecting: never revoke a Google account that another business's connection uses (or may use).
  const others = connections.length ? await googleUsersWhere({ businessId: { not: businessId } }) : [];
  const tokens = new Set<string>();
  for (const c of connections) {
    const secret = decryptJson<GoogleSecret>(c.secret);
    if (secret.refreshToken && canRevokeAlone(secret.googleUser, others)) tokens.add(secret.refreshToken);
  }
  for (const token of tokens) await revokeGoogleToken(token);
  await deleteBusinessMedia(businessId);
  await deleteBusinessR2Files(businessId);
  // All business relations are ON DELETE CASCADE in the deployed database.
  await db.business.delete({ where: { id: businessId } });
}
