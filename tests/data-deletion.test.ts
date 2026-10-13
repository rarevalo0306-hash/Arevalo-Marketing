import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth', () => ({ requireBusiness: async () => ({ user: { id: 'u1' }, role: 'admin' }) }));
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), findMany: vi.fn(), connectionDelete: vi.fn(), connectionCount: vi.fn(), reportDelete: vi.fn(), reportFind: vi.fn(), reportUpdate: vi.fn(), reportFindFirst: vi.fn(), reportUpdateOne: vi.fn(),
  taskDelete: vi.fn(), proposalDelete: vi.fn(), metricDelete: vi.fn(), businessDelete: vi.fn(), libraryCount:vi.fn(), transaction: vi.fn(),
  decrypt: vi.fn(), revoke: vi.fn(), media: vi.fn(), r2: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: {
  connection: { findUnique: mocks.findUnique, findMany: mocks.findMany, deleteMany: mocks.connectionDelete, count: mocks.connectionCount },
  seoReport: { deleteMany: mocks.reportDelete, findMany: mocks.reportFind, updateMany: mocks.reportUpdate, findFirst: mocks.reportFindFirst, update: mocks.reportUpdateOne },
  actionTask: { deleteMany: mocks.taskDelete }, aiProposal: { deleteMany: mocks.proposalDelete }, postMetric: { deleteMany: mocks.metricDelete },
  business: { delete: mocks.businessDelete }, libraryItem:{count:mocks.libraryCount}, $transaction: mocks.transaction,
} }));
vi.mock('@/lib/crypto', () => ({ decryptJson: mocks.decrypt }));
vi.mock('@/lib/google-oauth', () => ({ revokeGoogleToken: mocks.revoke }));
vi.mock('@/lib/media', () => ({ deleteBusinessMedia: mocks.media }));
vi.mock('@/lib/r2', () => ({ deleteBusinessR2Files: mocks.r2, r2Enabled:()=>true }));
import { disconnectGoogleData, eraseBusinessData, purgeGoogleChannelData } from '@/lib/data-deletion';
import { rememberVolumes } from '@/lib/seo/setup';
// Each db call returns a tag, so the transaction shows which operations ran and in what order.
const tag = (op: string) => (args: unknown) => ({ op, args });
beforeEach(() => {
  process.env.APP_PASSWORD='test';process.env.APP_SECRET='test';vi.resetAllMocks(); mocks.findMany.mockResolvedValue([]); mocks.findUnique.mockResolvedValue(null); mocks.revoke.mockResolvedValue(undefined); mocks.media.mockResolvedValue(undefined); mocks.r2.mockResolvedValue(undefined);
  mocks.reportFind.mockResolvedValue([]); mocks.connectionCount.mockResolvedValue(1); mocks.transaction.mockResolvedValue([]);
  mocks.connectionDelete.mockImplementation(tag('connection.deleteMany')); mocks.reportDelete.mockImplementation(tag('seoReport.deleteMany')); mocks.reportUpdate.mockImplementation(tag('seoReport.updateMany'));
  mocks.taskDelete.mockImplementation(tag('actionTask.deleteMany')); mocks.proposalDelete.mockImplementation(tag('aiProposal.deleteMany')); mocks.metricDelete.mockImplementation(tag('postMetric.deleteMany'));
});
const ops = () => (mocks.transaction.mock.calls[0][0] as { op: string; args: unknown }[]);
describe('data erasure sequencing', () => {
 it('keeps relational data when external storage fails so cleanup can be retried', async () => {
  mocks.media.mockRejectedValue(new Error('Storage unavailable'));
  await expect(eraseBusinessData('biz123')).rejects.toThrow('Storage unavailable');
  expect(mocks.businessDelete).not.toHaveBeenCalled();
 });
 it('revokes duplicate tokens once and removes rows only after both storage providers succeed', async () => {
  mocks.findMany.mockResolvedValue([{ secret: 'a' }, { secret: 'b' }]);mocks.decrypt.mockReturnValue({ refreshToken: 'same' });
  await eraseBusinessData('biz123');
  expect(mocks.revoke).toHaveBeenCalledTimes(1);expect(mocks.media).toHaveBeenCalledWith('biz123');expect(mocks.r2).toHaveBeenCalledWith('biz123');
  expect(mocks.businessDelete.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.r2.mock.invocationCallOrder[0]);
  expect(mocks.businessDelete).toHaveBeenCalledWith({ where: { id: 'biz123' } });
 });
 it('does not discard credentials or reports when revocation fails', async () => {
  mocks.findUnique.mockResolvedValue({ secret: 'a' });mocks.decrypt.mockReturnValue({ refreshToken: 'refresh' });mocks.revoke.mockRejectedValue(new Error('Google unavailable'));
  await expect(disconnectGoogleData('biz123','ga4')).rejects.toThrow();expect(mocks.transaction).not.toHaveBeenCalled();expect(mocks.connectionDelete).not.toHaveBeenCalled();
 });
 it('revokes first, then deletes the connection last and scoped to the selected business and integration', async () => {
  mocks.findUnique.mockResolvedValue({ secret: 'a' });mocks.decrypt.mockReturnValue({ refreshToken: 'refresh' });
  await disconnectGoogleData('biz123','gsc');
  expect(mocks.revoke.mock.invocationCallOrder[0]).toBeLessThan(mocks.transaction.mock.invocationCallOrder[0]);
  const list = ops();
  expect(list.at(-1)).toEqual({ op: 'connection.deleteMany', args: { where: { businessId:'biz123',channel:'gsc' } } });
  expect(list.every(o => JSON.stringify(o.args).includes('"businessId":"biz123"') || o.op === 'seoReport.updateMany')).toBe(true);
 });
});

const SITE = 'https://empresa.com';
const onpageRow = { id: 'op1', kind: 'onpage', data: { pages: [
  { url: `${SITE}/techos/`, keyword: 'techos miami', keywordSource: 'gsc', score: 70, ideas: [{ id: 'length' }], winners: [], brief: null, linksTo: [], checkedAt: '2026-10-01T00:00:00.000Z' },
  { url: `${SITE}/pintura`, keyword: 'pintura', keywordSource: 'rank', score: 60, ideas: [], winners: [], brief: null, linksTo: [], checkedAt: '2026-10-01T00:00:00.000Z' },
], overrides: {} } };
const setupRow = { id: 'st1', kind: 'setup', data: { version: 1, hash: 'h', rejected: ['x'], proposal: { zones: [], keywords: [
  { keyword: 'techos miami', source: 'search_console', why: { es: '', en: '' } }, { keyword: 'pintura', source: 'study', why: { es: '', en: '' } },
] } } };

describe('purgeGoogleChannelData', () => {
 it('Search Console: deletes its reports, derived tasks and proposals, and scrubs onpage and setup rows', async () => {
  mocks.reportFind.mockResolvedValue([onpageRow, setupRow, { id: 'old', kind: 'onpage', data: { pages: 'x' } }]);
  expect(await purgeGoogleChannelData('biz1', 'gsc')).toBe(true);
  expect(mocks.reportFind).toHaveBeenCalledWith({ where: { businessId: 'biz1', kind: { in: ['onpage', 'setup'] } }, select: { id: true, kind: true, data: true } });
  expect(mocks.reportDelete).toHaveBeenCalledWith({ where: { businessId: 'biz1', kind: { in: ['gsc', 'decay', 'cannibal'] } } });
  expect(mocks.taskDelete).toHaveBeenCalledWith({ where: { businessId: 'biz1', OR: [
    { source: 'gsc', key: { not: 'setup:gsc' } }, { key: { startsWith: 'decay:' } }, { key: { startsWith: 'cannibal:' } }, { key: { startsWith: 'onpage:empresa.com/techos:' } },
  ] } });
  expect(mocks.proposalDelete).toHaveBeenCalledWith({ where: { businessId: 'biz1', evidence: { path: ['rule'], equals: 'gsc-query' } } });
  // Only the two rows with Search Console data are rewritten; the unreadable old row is left alone.
  expect(mocks.reportUpdate).toHaveBeenCalledTimes(2);
  const page = mocks.reportUpdate.mock.calls[0][0] as { where: { id: string }; data: { data: { pages: Record<string, unknown>[] } } };
  expect(page.where).toEqual({ id: 'op1' });
  expect(page.data.data.pages[0]).toMatchObject({ keyword: null, keywordSource: null, score: null, ideas: [], needsRecheck: true });
  expect(page.data.data.pages[1]).toBe(onpageRow.data.pages[1]);
  const setup = mocks.reportUpdate.mock.calls[1][0] as { where: { id: string }; data: { data: { proposal: { keywords: { keyword: string }[] }; rejected: string[] } } };
  expect(setup.where).toEqual({ id: 'st1' });
  expect(setup.data.data.proposal.keywords.map(k => k.keyword)).toEqual(['pintura']);
  expect(setup.data.data.rejected).toEqual(['x']);
  expect(ops().map(o => o.op)).toEqual(['seoReport.updateMany', 'seoReport.updateMany', 'seoReport.deleteMany', 'actionTask.deleteMany', 'aiProposal.deleteMany', 'connection.deleteMany']);
  expect(mocks.metricDelete).not.toHaveBeenCalled();
 });

 it('Search Console: the scrubbed setup row is still read by the setup reader', async () => {
  mocks.reportFind.mockResolvedValue([setupRow]);
  await purgeGoogleChannelData('biz1', 'gsc');
  const scrubbed = (mocks.reportUpdate.mock.calls[0][0] as { data: { data: unknown } }).data.data;
  mocks.reportFindFirst.mockResolvedValue({ id: 'st1', data: scrubbed });
  await rememberVolumes('biz1', new Map([['pintura', 50]]), 'Miami');
  // rememberVolumes returns early when the reader drops the proposal; it saved, so the proposal still parses.
  const saved = mocks.reportUpdateOne.mock.calls[0][0] as { where: { id: string }; data: { data: { proposal: { keywords: { keyword: string; volume?: number }[] }; rejected: string[] } } };
  expect(saved.where).toEqual({ id: 'st1' });
  expect(saved.data.data.proposal.keywords).toMatchObject([{ keyword: 'pintura', source: 'study', volume: 50 }]);
  expect(saved.data.data.rejected).toEqual(['x']);
 });

 it('Analytics: deletes ga4 reports and every ga4:* plan task (setup:ga4 has another key)', async () => {
  await purgeGoogleChannelData('biz1', 'ga4');
  expect(mocks.reportDelete).toHaveBeenCalledWith({ where: { businessId: 'biz1', kind: 'ga4' } });
  expect(mocks.taskDelete).toHaveBeenCalledWith({ where: { businessId: 'biz1', key: { startsWith: 'ga4:' } } });
  expect(mocks.reportFind).not.toHaveBeenCalled();
  expect(ops().map(o => o.op)).toEqual(['seoReport.deleteMany', 'actionTask.deleteMany', 'connection.deleteMany']);
 });

 it('YouTube: deletes only YouTube results and YouTube channel proposals', async () => {
  await purgeGoogleChannelData('biz1', 'youtube');
  expect(mocks.metricDelete).toHaveBeenCalledWith({ where: { businessId: 'biz1', channel: 'youtube' } });
  expect(mocks.proposalDelete).toHaveBeenCalledWith({ where: { businessId: 'biz1', evidence: { path: ['key'], string_ends_with: ':youtube' } } });
  expect(mocks.reportDelete).not.toHaveBeenCalled();
  expect(mocks.taskDelete).not.toHaveBeenCalled();
 });

 it('Business Profile: never deletes gbp or reviews rows, only scrubs replies posted from Matya', async () => {
  const at = '2026-10-05T10:00:00.000Z';
  mocks.reportFind.mockResolvedValue([
   { id: 'r1', data: { reviews: [{ id: 'a', ownerAnswer: 'Gracias', ownerTimestamp: at, postedAt: at }] } },
   { id: 'r2', data: { reviews: [{ id: 'b', ownerAnswer: 'Público', ownerTimestamp: at }] } },
  ]);
  await purgeGoogleChannelData('biz1', 'google');
  expect(mocks.reportFind).toHaveBeenCalledWith({ where: { businessId: 'biz1', kind: 'reviews' }, select: { id: true, data: true } });
  expect(mocks.reportDelete).not.toHaveBeenCalled();
  expect(mocks.reportUpdate).toHaveBeenCalledTimes(1);
  expect(mocks.reportUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { data: { reviews: [{ id: 'a', ownerAnswer: '', ownerTimestamp: '' }] } } });
  expect(ops().map(o => o.op)).toEqual(['seoReport.updateMany', 'connection.deleteMany']);
 });

 it('with a guard (cron) deletes only the connection row that was read, so a reconnect is never removed', async () => {
  const updatedAt = new Date('2026-10-01T00:00:00Z');
  await purgeGoogleChannelData('biz1', 'ga4', { id: 'c1', updatedAt });
  expect(mocks.connectionCount).toHaveBeenCalledWith({ where: { id: 'c1', updatedAt } });
  expect(ops().at(-1)).toEqual({ op: 'connection.deleteMany', args: { where: { id: 'c1', updatedAt } } });
 });

 it('with a guard does nothing when the connection changed since it was read', async () => {
  mocks.connectionCount.mockResolvedValue(0);
  expect(await purgeGoogleChannelData('biz1', 'gsc', { id: 'c1', updatedAt: new Date() })).toBe(false);
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.reportFind).not.toHaveBeenCalled();
 });
});
