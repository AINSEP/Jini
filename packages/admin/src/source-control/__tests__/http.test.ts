import { expect, it, vi } from 'vitest';
import { createHttpSourceControlApi } from '../adapters/http.js';
import type { SourceControlTransportPort } from '../ports.js';
const raw = { id: 'a/b', providerId: 'git', label: 'Personal', configured: true as const, isDefault: true, createdAt: 'first', updatedAt: 'last', token: 'must-strip', ciphertext: 'must-strip', username: 'must-strip' };
it('matches every server route, request body, envelope and signal while stripping saved secrets', async () => {
  const calls: unknown[] = []; const signal = new AbortController().signal;
  const transport: SourceControlTransportPort = { async request<T>(r: Parameters<SourceControlTransportPort['request']>[0], o?: Parameters<SourceControlTransportPort['request']>[1]) { calls.push([r, o]); return (r.path.endsWith('/providers') ? { providers: [{ id: 'git', label: 'Git' }], switchedOff: [] } : r.method === 'GET' ? { credentials: [raw] } : { credential: raw }) as T; } };
  const api = createHttpSourceControlApi({ transport, workspacePath: '/workspace/' });
  expect(await api.providers({}, { signal })).toEqual([{ id: 'git', label: 'Git' }]); const listed = await api.list({}, { signal }); expect(listed[0]).not.toHaveProperty('token'); expect(listed[0]).not.toHaveProperty('username');
  const input = { label: 'default', connection: { providerId: 'git', token: 'new' } }; expect(await api.create(input, { signal })).not.toHaveProperty('ciphertext');
  await api.update({ id: 'a/b', patch: { label: 'Renamed' } }, { signal }); await api.remove({ id: 'a/b' }, { signal });
  expect(calls).toEqual([[{ path: '/workspace/system/source-control/providers', method: 'GET' }, { signal }], [{ path: '/workspace/system/source-control/credentials', method: 'GET' }, { signal }], [{ path: '/workspace/system/source-control/credentials', method: 'POST', body: input }, { signal }], [{ path: '/workspace/system/source-control/credentials/a%2Fb', method: 'PUT', body: { label: 'Renamed' } }, { signal }], [{ path: '/workspace/system/source-control/credentials/a%2Fb', method: 'DELETE' }, { signal }]]);
});
it('aborted operations never reach the injected transport', async () => {
  const request = vi.fn(), api = createHttpSourceControlApi({ transport: { request }, workspacePath: '/workspace' }); const abort = new AbortController(); abort.abort();
  for (const action of [() => api.providers({}, { signal: abort.signal }), () => api.list({}, { signal: abort.signal }), () => api.create({ label: 'x', connection: { providerId: 'git', token: 'x' } }, { signal: abort.signal }), () => api.update({ id: 'x', patch: {} }, { signal: abort.signal }), () => api.remove({ id: 'x' }, { signal: abort.signal })]) await expect(action()).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
});
