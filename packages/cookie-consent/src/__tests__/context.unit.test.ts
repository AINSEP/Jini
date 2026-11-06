// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { bootWithContext, type ClientPorts } from '../client/index.js';

const config = { contract: 1, policy: 'snapshot', regionMode: 'opt-in', banner: 'headless', context: '/_consent/context', scripts: [{ src: '/stats.js', consent: ['analytics'] }] };
const ports = () => ({ doc: document, fetch: vi.fn(), now: Date.now, gpc: () => false, reload: vi.fn(), importModule: vi.fn() }) as ClientPorts & { fetch: ReturnType<typeof vi.fn> };
beforeEach(() => { delete window.jiniConsent; delete window.jiniConsentQueue; document.body.innerHTML = `<script id="jini-consent-config" type="application/json">${JSON.stringify(config)}</script>`; });
afterEach(() => { vi.restoreAllMocks(); });

test('disabled or missing config makes no request and never reads consent storage', async () => {
  const cookie = vi.spyOn(document, 'cookie', 'get');
  for (const body of ['', JSON.stringify({ ...config, banner: 'off' })]) {
    document.getElementById('jini-consent-config')!.textContent = body;
    const supplied = ports();
    expect(await bootWithContext(window, { ports: supplied })).toBeUndefined();
    expect(supplied.fetch).not.toHaveBeenCalled();
    expect(supplied.importModule).not.toHaveBeenCalled();
  }
  expect(cookie).not.toHaveBeenCalled();
});

test('a disabled context makes one no-store request and no storage reads or optional startup', async () => {
  const cookie = vi.spyOn(document, 'cookie', 'get');
  const supplied = ports();
  supplied.fetch.mockResolvedValue({ ok: true, json: async () => ({ enabled: false }) });
  expect(await bootWithContext(window, { ports: supplied })).toBeUndefined();
  expect(supplied.fetch).toHaveBeenCalledOnce();
  expect(supplied.fetch).toHaveBeenCalledWith('/_consent/context', { credentials: 'same-origin', cache: 'no-store' });
  expect(cookie).not.toHaveBeenCalled();
  expect(supplied.importModule).not.toHaveBeenCalled();
  expect(document.querySelector('script[src]')).toBeNull();
});

test('context failure never starts optional code or reads a cached choice', async () => {
  const cookie = vi.spyOn(document, 'cookie', 'get');
  const supplied = ports();
  supplied.fetch.mockRejectedValue(new Error('offline'));
  expect(await bootWithContext(window, { ports: supplied })).toBeUndefined();
  expect(cookie).not.toHaveBeenCalled();
  expect(document.querySelector('script[src]')).toBeNull();
});

test('published context replaces stale cached policy before effective consent is computed', async () => {
  const supplied = ports();
  supplied.fetch.mockResolvedValue({ ok: true, json: async () => ({ enabled: true, policy: 'published', regionMode: 'auto' }) });
  const api = await bootWithContext(window, { ports: supplied });
  expect(api!.get().policy).toBe('published');
  expect(api!.get().allowed.analytics).toBe(false);
  expect(document.querySelector('script[src]')).toBeNull();
});
