// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { bootWithContext, type ClientPorts } from '../client/index.js';

const config = { contract: 1, policy: 'snapshot', regionMode: 'opt-in', banner: 'headless', context: '/_consent/context', scripts: [{ src: '/stats.js', consent: ['analytics'] }] };
const ports = () => ({ doc: document, fetch: vi.fn(), now: Date.now, gpc: () => false, reload: vi.fn(), importModule: vi.fn() }) as ClientPorts & { fetch: ReturnType<typeof vi.fn> };
beforeEach(() => { sessionStorage.clear(); delete window.jiniConsent; delete window.jiniConsentQueue; document.body.innerHTML = `<script id="jini-consent-config" type="application/json">${JSON.stringify(config)}</script>`; });
afterEach(() => { vi.restoreAllMocks(); });

test('disabled or missing config makes no request and never reads consent storage', async () => {
  const cookie = vi.spyOn(document, 'cookie', 'get');
  for (const body of ['', JSON.stringify({ ...config, banner: 'off' })]) {
    document.getElementById('jini-consent-config')!.textContent = body;
    const supplied = ports();
    expect(await bootWithContext({ win: window }, { ports: supplied })).toBeUndefined();
    expect(supplied.fetch).not.toHaveBeenCalled();
    expect(supplied.importModule).not.toHaveBeenCalled();
  }
  expect(cookie).not.toHaveBeenCalled();
});

test('a disabled context makes one no-store request and no storage reads or optional startup', async () => {
  const cookie = vi.spyOn(document, 'cookie', 'get');
  const supplied = ports();
  supplied.fetch.mockResolvedValue({ ok: true, json: async () => ({ enabled: false }) });
  expect(await bootWithContext({ win: window }, { ports: supplied })).toBeUndefined();
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
  expect(await bootWithContext({ win: window }, { ports: supplied })).toBeUndefined();
  expect(cookie).not.toHaveBeenCalled();
  expect(document.querySelector('script[src]')).toBeNull();
});

test('stale banner copy cannot collect consent: reload first, then boot the matching published page', async () => {
  const cookie = vi.spyOn(document, 'cookie', 'get');
  const supplied = ports();
  const bridge = vi.fn();
  window.jiniConsentQueue = [{ id: 'queued-bridge', kind: 'consent-bridge', mount: bridge }] as never;
  document.getElementById('jini-consent-config')!.textContent = JSON.stringify({ ...config, scripts: [{ src: '/menu.js' }, ...config.scripts] });
  supplied.fetch.mockResolvedValue({ ok: true, json: async () => ({ enabled: true, policy: 'published', regionMode: 'auto' }) });
  expect(await bootWithContext({ win: window }, { ports: supplied })).toBeUndefined();
  expect(supplied.reload).toHaveBeenCalledOnce();
  expect(cookie).not.toHaveBeenCalled();
  expect(window.jiniConsent).toBeUndefined();
  expect(supplied.importModule).not.toHaveBeenCalled();
  expect(bridge).not.toHaveBeenCalled();
  expect(document.querySelector('script[src]')).toBeNull();

  // Model the revalidated document: copy and config now name the same publication as context.
  document.getElementById('jini-consent-config')!.textContent = JSON.stringify({ ...config, policy: 'published' });
  const api = await bootWithContext({ win: window }, { ports: supplied });
  expect(supplied.reload).toHaveBeenCalledOnce();
  expect(bridge).toHaveBeenCalledOnce();
  expect(api!.get().policy).toBe('published');
  expect(api!.get().allowed.analytics).toBe(false);
  expect(document.querySelector('script[src]')).toBeNull();
});


test('a cached page reloads once for its policy across repeated document boots', async () => {
  const supplied = ports();
  supplied.fetch.mockResolvedValue({ ok: true, json: async () => ({ enabled: true, policy: 'published', regionMode: 'auto' }) });
  expect(await bootWithContext({ win: window }, { ports: supplied })).toBeUndefined();
  // A shared cache can return the identical stale page after the first reload.
  document.body.innerHTML = `<script id="jini-consent-config" type="application/json">${JSON.stringify(config)}</script>`;
  expect(await bootWithContext({ win: window }, { ports: supplied })).toBeUndefined();
  expect(supplied.reload).toHaveBeenCalledOnce();
  expect(window.jiniConsent).toBeUndefined();
  document.getElementById('jini-consent-config')!.textContent = JSON.stringify({ ...config, policy: 'another-snapshot' });
  await bootWithContext({ win: window }, { ports: supplied });
  expect(supplied.reload).toHaveBeenCalledTimes(2);
});
