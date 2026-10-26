// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ADAPTER_KIND, type ConsentAdapter } from '../contract.js';
import { bindBanner, browserPorts, createCookieConsent, type ClientPorts } from '../client/index.js';
import { purge, readCookie, writeCookie } from '../client/dom.js';

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
/** A cookie jar fake: records every write so Domain/Secure attributes can be asserted. */
function fakeDoc(over: object = {}) {
  const writes: string[] = [];
  const doc = { get cookie() { return 'keep=1; _v_a=1; _v_b=2'; }, set cookie(value: string) { writes.push(value); }, defaultView: undefined, ...over };
  return { doc: doc as unknown as Document, writes };
}
const ports = (over: Partial<ClientPorts> = {}) => ({
  doc: document, fetch: vi.fn(async () => ({ ok: true, json: async () => ({ id: 'receipt-0000000000001' }) }) as unknown as Response),
  now: () => 1_800_000_000_000, gpc: () => false, reload: vi.fn(), importModule: vi.fn(), ...over,
}) as ClientPorts & { reload: ReturnType<typeof vi.fn> };
const config = { contract: 1 as const, policy: 'p1', regionMode: 'opt-in' as const, banner: 'headless' as const };

beforeEach(() => {
  for (const part of document.cookie.split('; ')) if (part) document.cookie = `${part.split('=')[0]}=; Path=/; Max-Age=0`;
  document.body.innerHTML = '';
});

describe('cookie helpers', () => {
  test('a malformed cookie escape reads as no value', () => {
    expect(readCookie({ cookie: 'x=%E0%A4%A' } as Document, 'x')).toBeNull();
    expect(readCookie({ cookie: 'y=1' } as Document, 'x')).toBeNull();
  });

  test('writeCookie adds Secure on https and the configured Domain', () => {
    const { doc, writes } = fakeDoc({ defaultView: { location: { protocol: 'https:' } } });
    writeCookie(doc, { name: 'c', value: 'a b', maxAgeS: 10.7 }, { domain: 'example.com' });
    expect(writes).toEqual(['c=a%20b; Path=/; Max-Age=10; SameSite=Lax; Secure; Domain=example.com']);
  });

  test('purge expires prefixed cookies on the host and every parent domain', () => {
    const { doc, writes } = fakeDoc({ defaultView: { location: { hostname: 'a.shop.example' }, localStorage: {} } });
    purge(doc, { cookies: ['_v_'] });
    expect(writes).toEqual([
      '_v_a=; Path=/; Max-Age=0', '_v_a=; Path=/; Max-Age=0; Domain=.a.shop.example', '_v_a=; Path=/; Max-Age=0; Domain=.shop.example',
      '_v_b=; Path=/; Max-Age=0', '_v_b=; Path=/; Max-Age=0; Domain=.a.shop.example', '_v_b=; Path=/; Max-Age=0; Domain=.shop.example',
    ]);
  });

  test('purge without a window expires on the host only and survives missing storage', () => {
    const { doc, writes } = fakeDoc();
    expect(() => purge(doc, { cookies: ['_v_a'], local: ['x'] })).not.toThrow();
    expect(writes).toEqual(['_v_a=; Path=/; Max-Age=0']);
    expect(() => purge(doc)).not.toThrow();
  });

  test('purge removes prefixed local-storage keys only', () => {
    localStorage.setItem('vend:1', 'x'); localStorage.setItem('mine', 'y');
    purge(document, { local: ['vend:'] });
    expect(Object.keys(localStorage)).toEqual(['mine']);
    localStorage.clear();
  });
});

describe('client edges', () => {
  test('a grant that returns nothing is treated as unstoppable: withdrawal reloads', async () => {
    const p = ports();
    const api = createCookieConsent({ config, ports: p });
    api.plugins.registerPlugin({ id: 'quiet', kind: ADAPTER_KIND, category: 'analytics', grant: () => undefined } as never);
    await api.set({ action: 'accept' });
    await flush();
    await api.set({ action: 'reject' });
    await flush();
    expect(p.reload).toHaveBeenCalledTimes(1);
  });

  test('unregistering an adapter that never ran stops nothing and needs no reload', async () => {
    const p = ports();
    const api = createCookieConsent({ config, ports: p });
    const grant = vi.fn();
    const dispose = api.plugins.registerPlugin({ id: 'idle', kind: ADAPTER_KIND, category: 'marketing', grant } as never);
    dispose();
    await flush();
    expect(grant).not.toHaveBeenCalled();
    expect(p.reload).not.toHaveBeenCalled();
  });

  test('unregistering a running adapter that cannot revoke reloads the page', async () => {
    const p = ports();
    const api = createCookieConsent({ config, ports: p });
    const dispose = api.plugins.registerPlugin({ id: 'stuck', kind: ADAPTER_KIND, category: 'analytics', grant: () => ({ revoke: () => false }) } as never);
    await api.set({ action: 'accept' });
    await flush();
    dispose();
    await flush();
    expect(p.reload).toHaveBeenCalledTimes(1);
  });

  test('durable evidence without waitMs still settles once the receipt lands', async () => {
    const p = ports();
    const api = createCookieConsent({ config, ports: p }, { evidence: { mode: 'durable', endpoint: '/_consent' } });
    const state = await api.set({ action: 'accept' });
    expect(state.receipt).toBe('stored');
    expect(p.fetch).toHaveBeenCalledTimes(1);
  });

  test('a bare banner (no boxes, no alert) still binds; clicks outside actions are ignored', async () => {
    document.body.innerHTML = '<section id="jini-consent"><p id="text">x</p><button data-consent-action="accept">A</button></section>';
    const api = createCookieConsent({ config, ports: ports() });
    const set = vi.spyOn(api, 'set');
    bindBanner({ api, doc: document });
    const root = document.getElementById('jini-consent')!;
    expect(root.hidden).toBe(false);
    document.getElementById('text')!.click();
    expect(set).not.toHaveBeenCalled();
    root.querySelector('button')!.click();
    await flush();
    expect(root.hidden).toBe(true);
  });

  test('browserPorts wires reload and lazy imports to the window', async () => {
    const reload = vi.fn();
    const p = browserPorts({ document, fetch: vi.fn(), navigator: {}, location: { reload } } as never);
    p.reload();
    expect(reload).toHaveBeenCalled();
    await expect(p.importModule('/definitely-missing-adapter.mjs')).rejects.toBeDefined();
  });
});
