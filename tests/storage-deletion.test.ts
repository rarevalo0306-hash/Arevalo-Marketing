import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteBusinessMedia } from '@/lib/media';
import { deleteBusinessR2Files } from '@/lib/r2';
const fetchMock=vi.fn();
beforeEach(()=>{vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();vi.stubEnv('SUPABASE_URL','https://storage.example.com');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test');vi.stubEnv('R2_ACCOUNT_ID','test');vi.stubEnv('R2_ACCESS_KEY_ID','test');vi.stubEnv('R2_SECRET_ACCESS_KEY','test');vi.stubEnv('R2_BUCKET','media');vi.stubEnv('R2_PUBLIC_URL','https://media.example.com');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('storage cleanup isolation',()=>{
 it('recurses folders and deletes only this business including documents and sidecars',async()=>{
  fetchMock.mockResolvedValueOnce(Response.json([{name:'image.jpg',id:'1'},{name:'brand',id:null}])).mockResolvedValueOnce(Response.json([{name:'manual.pdf',id:'2'},{name:'image.json',id:'3'}])).mockResolvedValueOnce(Response.json([]));
  await deleteBusinessMedia('biz123');
  const body=JSON.parse(fetchMock.mock.calls[2][1].body);expect(body.prefixes).toEqual(['biz123/image.jpg','biz123/brand/manual.pdf','biz123/brand/image.json']);
 });
 it('refuses a traversal-shaped listing before any removal',async()=>{
  fetchMock.mockResolvedValueOnce(Response.json([{name:'../other',id:'1'}]));await expect(deleteBusinessMedia('biz123')).rejects.toThrow('Unsafe');expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it('rejects invalid identifiers without sending provider requests',async()=>{
  await expect(deleteBusinessMedia('../other')).rejects.toThrow();await expect(deleteBusinessR2Files('../other')).rejects.toThrow();expect(fetchMock).not.toHaveBeenCalled();
 });
 it('pages through R2 and does not touch remote Drive originals',async()=>{
  fetchMock.mockResolvedValueOnce(new Response('<ListBucketResult><Contents><Key>library/biz123/2026-10/a.jpg</Key></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>next&amp;page</NextContinuationToken></ListBucketResult>')).mockResolvedValueOnce(new Response('<ListBucketResult><Contents><Key>library/biz123/2026-10/b.jpg</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>')).mockResolvedValue(new Response('',{status:200}));
  await deleteBusinessR2Files('biz123');expect(fetchMock.mock.calls[1][0]).toContain('continuation-token=next%26page');
  expect(fetchMock.mock.calls.slice(2).every(([url,init])=>url.startsWith('https://test.r2.cloudflarestorage.com/media/library/biz123/')&&init.method==='DELETE')).toBe(true);
 });
 it('rejects out-of-scope keys returned by a provider',async()=>{
  fetchMock.mockResolvedValueOnce(new Response('<ListBucketResult><Key>library/other/a.jpg</Key><IsTruncated>false</IsTruncated></ListBucketResult>'));await expect(deleteBusinessR2Files('biz123')).rejects.toThrow('outside');expect(fetchMock).toHaveBeenCalledTimes(1);
 });
});
