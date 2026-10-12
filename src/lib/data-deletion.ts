// Provider cleanup precedes relational deletion. Failures leave rows available for retry.
import { cookies } from 'next/headers';
import { safeEqual, SESSION_COOKIE, sessionToken } from '@/lib/session';
import { decryptJson } from '@/lib/crypto';
import { db } from '@/lib/db';
import { deleteBusinessMedia } from '@/lib/media';
import { deleteBusinessR2Files, r2Enabled } from '@/lib/r2';
import { revokeGoogleToken } from '@/lib/google-oauth';

export const GOOGLE_CHANNELS = ['google', 'gsc', 'ga4', 'youtube'] as const;

async function requireSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !process.env.APP_PASSWORD || !process.env.APP_SECRET || !safeEqual(token, await sessionToken())) throw new Error('Authentication required');
}

export async function disconnectGoogleData(businessId: string, channel: string) {
  await requireSession();
  if (!GOOGLE_CHANNELS.some(c => c === channel)) throw new Error('Unsupported Google connection');
  const connection = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel } } });
  if (connection) {
    const secret = decryptJson<{ refreshToken?: string }>(connection.secret);
    if (secret.refreshToken) await revokeGoogleToken(secret.refreshToken);
  }
  // Revocation may invalidate other connections under the same Google grant.
  // Report cleanup is scoped to this selected connection, never another business.
  await db.$transaction([
    db.connection.deleteMany({ where: { businessId, channel } }),
    db.seoReport.deleteMany({ where: { businessId, kind: channel } }),
  ]);
}

export async function eraseBusinessData(businessId: string) {
  await requireSession();
  if (!r2Enabled() && await db.libraryItem.count({ where: { businessId } }) > 0) throw new Error('Configure R2 before deleting a business with library files; cleanup cannot be verified.');
  const connections = await db.connection.findMany({ where: { businessId, channel: { in: [...GOOGLE_CHANNELS] } }, select: { secret: true } });
  const tokens = new Set<string>();
  for (const c of connections) {
    const secret = decryptJson<{ refreshToken?: string }>(c.secret);
    if (secret.refreshToken) tokens.add(secret.refreshToken);
  }
  for (const token of tokens) await revokeGoogleToken(token);
  await deleteBusinessMedia(businessId);
  await deleteBusinessR2Files(businessId);
  // All business relations are ON DELETE CASCADE in the deployed database.
  await db.business.delete({ where: { id: businessId } });
}
