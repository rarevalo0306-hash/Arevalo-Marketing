import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({value:'session'}) }) }));
vi.mock('@/lib/session', () => ({ SESSION_COOKIE:'am_session', sessionToken:async ()=>'session', safeEqual:(a:string,b:string)=>a===b }));
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), findMany: vi.fn(), connectionDelete: vi.fn(), reportDelete: vi.fn(), businessDelete: vi.fn(), libraryCount:vi.fn(), transaction: vi.fn(),
  decrypt: vi.fn(), revoke: vi.fn(), media: vi.fn(), r2: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: { connection: { findUnique: mocks.findUnique, findMany: mocks.findMany, deleteMany: mocks.connectionDelete }, seoReport: { deleteMany: mocks.reportDelete }, business: { delete: mocks.businessDelete }, libraryItem:{count:mocks.libraryCount}, $transaction: mocks.transaction } }));
vi.mock('@/lib/crypto', () => ({ decryptJson: mocks.decrypt }));
vi.mock('@/lib/google-oauth', () => ({ revokeGoogleToken: mocks.revoke }));
vi.mock('@/lib/media', () => ({ deleteBusinessMedia: mocks.media }));
vi.mock('@/lib/r2', () => ({ deleteBusinessR2Files: mocks.r2, r2Enabled:()=>true }));
import { disconnectGoogleData, eraseBusinessData } from '@/lib/data-deletion';
beforeEach(() => { process.env.APP_PASSWORD='test';process.env.APP_SECRET='test';vi.resetAllMocks(); mocks.findMany.mockResolvedValue([]); mocks.findUnique.mockResolvedValue(null); mocks.revoke.mockResolvedValue(undefined); mocks.media.mockResolvedValue(undefined); mocks.r2.mockResolvedValue(undefined); });
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
 it('scopes report and connection removal to the selected business and integration', async () => {
  await disconnectGoogleData('biz123','gsc');expect(mocks.reportDelete).toHaveBeenCalledWith({ where: { businessId:'biz123',kind:'gsc' } });expect(mocks.connectionDelete).toHaveBeenCalledWith({ where: { businessId:'biz123',channel:'gsc' } });
 });
});
