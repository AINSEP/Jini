import { describe, it, expect, vi } from 'vitest';
import { createHttpRootKey } from '../adapters/http.js';
import type { SecurityTransportPort } from '../ports.js';
// SEC-6 W15: `POST /system/site-key/reveal` is opt-in on the HTTP adapter, and only `active` and a
// non-empty `hex` leave it. Fixture values only.
const HEX = 'a3f9'.repeat(16);
function transport(reply: unknown) {
  const request = vi.fn(async () => reply); return { request: request as unknown as SecurityTransportPort['request'], calls: request.mock.calls as unknown as [{ path: string; method: string; body?: unknown }][] };
}
describe('createHttpRootKey reveal (W15)', () => {
  it('has no reveal unless the host opts in', () => {
    expect(createHttpRootKey({ transport: transport({}), workspacePath: '/workspaces/w' }, { path: '/system/site-key' }).reveal).toBeUndefined();
  });
  it('POSTs once to the reveal route and projects only active and hex', async () => {
    const t = transport({ active: true, hex: HEX, source: 'file', fingerprint: 'fp', keyFilePath: '/k', state: 'active', runtimeMode: 'local' });
    const api = createHttpRootKey({ transport: t, workspacePath: '/workspaces/w' }, { path: '/system/site-key', reveal: true });
    expect(await api.reveal!({})).toEqual({ active: true, hex: HEX });
    expect(t.calls.map(([r]) => `${r.method} ${r.path}`)).toEqual(['POST /workspaces/w/system/site-key/reveal']); expect(t.calls[0]![0]).not.toHaveProperty('body');
  });
  it.each([[{ active: false, hex: HEX }], [{ active: true, hex: '' }], [{ active: true }]])('drops hex from %j', async (reply) => {
    const api = createHttpRootKey({ transport: transport(reply), workspacePath: '/workspaces/w' }, { reveal: true });
    expect(await api.reveal!({})).toEqual({ active: reply.active });
  });
});
