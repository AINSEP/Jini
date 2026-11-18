// @vitest-environment jsdom
/** R12b: a browser adapter is a separately delivered module, so the runtime hands it the storage purge on every call. */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ADAPTER_KIND, type ClientConfig, type ConsentAdapter, type GrantInput } from '../contract.js';
import { createCookieConsent, purgeStorage, type ClientPorts } from '../client/index.js';

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
const ports = (over: Partial<ClientPorts> = {}) =>
  ({ doc: document, fetch: vi.fn(), now: () => 1_800_000_000_000, gpc: () => false, reload: vi.fn(), importModule: vi.fn(), ...over }) as ClientPorts;
const config: ClientConfig = { contract: 1, policy: 'p1', regionMode: 'opt-in', banner: 'headless' };

beforeEach(() => {
  for (const part of document.cookie.split('; ')) if (part) document.cookie = `${part.split('=')[0]}=; Path=/; Max-Age=0`;
});

/** Records the first argument of every adapter call, in order. */
function recorder() {
  const calls: { via: 'onState' | 'grant'; input: Record<string, unknown> }[] = [];
  const adapter = {
    id: 'rec', kind: ADAPTER_KIND, category: 'analytics', storage: { cookies: ['rec_'] },
    onState: (input: Record<string, unknown>) => { calls.push({ via: 'onState', input }); },
    grant: (input: GrantInput<unknown>) => { calls.push({ via: 'grant', input: input as unknown as Record<string, unknown> }); return { revoke: () => true }; },
  } as unknown as ConsentAdapter;
  return { adapter, calls };
}

describe('the runtime passes its storage purge to every adapter call', () => {
  test('registration, grant start, grant, and every later state change carry `purge`', async () => {
    const api = createCookieConsent({ config, ports: ports() });
    const { adapter, calls } = recorder();
    api.plugins.registerPlugin(adapter as never);            // addSlot: the lazy-adapter state call
    await api.set({ action: 'accept' });                     // start(): onState + grant; reconcile(): onState
    await flush();
    await api.set({ action: 'reject' });                     // reconcile(): onState for a withdrawn adapter
    await flush();
    expect(calls.filter(c => c.via === 'grant')).toHaveLength(1);
    expect(calls.filter(c => c.via === 'onState').length).toBeGreaterThanOrEqual(4);
    for (const call of calls) expect(call.input.purge, `${call.via} input`).toBe(purgeStorage);
  });

  test('a lazy adapter loaded after consent gets `purge` in its first onState and its grant', async () => {
    const { adapter, calls } = recorder();
    const importModule = vi.fn(async () => ({ default: adapter }));
    const lazy = { id: 'rec', kind: ADAPTER_KIND, category: 'analytics', src: '/adapter.js', storage: { cookies: ['rec_'] } };
    const api = createCookieConsent({ config: { ...config, plugins: [lazy] }, ports: ports({ importModule }) });
    await api.set({ action: 'accept' });
    await flush();
    expect(importModule).toHaveBeenCalledOnce();
    expect(calls.map(c => c.via)).toContain('grant');
    for (const call of calls) expect(call.input.purge, `${call.via} input`).toBe(purgeStorage);
  });

  test('the handed purge removes only the prefixes it is given', async () => {
    document.cookie = 'rec_id=1; Path=/';
    document.cookie = 'host_pref=1; Path=/';
    const api = createCookieConsent({ config, ports: ports() });
    const { adapter, calls } = recorder();
    api.plugins.registerPlugin(adapter as never);
    const purge = calls[0]!.input.purge as typeof purgeStorage;
    purge({ doc: document, storage: { cookies: ['rec_'] } });
    expect(document.cookie).toBe('host_pref=1');
  });
});
