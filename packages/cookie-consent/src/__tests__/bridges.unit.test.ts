// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { boot } from '../client/index.js';
import { BRIDGE_KIND, type JiniConsentApi } from '../contract.js';

test('custom bridge uses receipt and GPC enforced state and disposes on removal', async () => {
  document.body.innerHTML = '<script id="jini-consent-config" type="application/json">{"contract":1,"policy":"bridge","regionMode":"opt-in","banner":"headless"}</script>';
  document.cookie = 'jini_choices=; Max-Age=0; Path=/';
  delete window.jiniConsent;
  const dispose = vi.fn();
  let bridgeApi: JiniConsentApi | undefined;
  window.jiniConsentQueue = [{ id: 'outside-cmp', kind: BRIDGE_KIND, mount: ({ api }: { api: JiniConsentApi }) => { bridgeApi = api; return dispose; } }] as never;
  const builtin = vi.fn();
  const api = boot(window, { bindBanner: builtin, ports: { doc: document, fetch: vi.fn(), now: Date.now, gpc: () => true, reload: vi.fn(), importModule: vi.fn() } })!;
  expect(bridgeApi).toBe(api);
  expect(builtin).not.toHaveBeenCalled();
  await bridgeApi!.set({ action: 'accept' });
  expect(api.allows({ consent: ['marketing'] })).toBe(false);
  const remove = api.plugins.registerPlugin({ id: 'temporary', kind: BRIDGE_KIND, mount: () => dispose });
  remove();
  expect(dispose).toHaveBeenCalledTimes(1);
});

function bridgePage(plugins: unknown[]) {
  document.body.innerHTML = '<script id="jini-consent-config" type="application/json">{"contract":1,"policy":"bridge-isolation","regionMode":"opt-in","banner":"jini"}</script>';
  document.cookie = 'jini_choices=; Max-Age=0; Path=/';
  delete window.jiniConsent;
  window.jiniConsentQueue = plugins as never;
  const builtin = vi.fn();
  const api = boot(window, { bindBanner: builtin, ports: { doc: document, fetch: vi.fn(), now: Date.now, gpc: () => false, reload: vi.fn(), importModule: vi.fn() } })!;
  return { api, builtin };
}

test('a custom bridge that throws during initial mounting cannot break core or the built-in banner', async () => {
  const { api, builtin } = bridgePage([{ id: 'broken', kind: BRIDGE_KIND, mount: () => { throw new Error('broken bridge'); } }]);
  expect(builtin).toHaveBeenCalledOnce();
  await api.set({ action: 'accept' });
  expect(api.get().allowed.analytics).toBe(true);
  await api.set({ action: 'reject' });
  expect(api.get().allowed.analytics).toBe(false);
});

test('throwing disposal does not leave a dead bridge blocking later mounts', () => {
  const { api, builtin } = bridgePage([]);
  const remove = api.plugins.registerPlugin({ id: 'throwing-disposer', kind: BRIDGE_KIND, mount: () => () => { throw new Error('broken disposal'); } });
  expect(remove).not.toThrow();
  const healthy = vi.fn();
  api.plugins.registerPlugin({ id: 'healthy', kind: BRIDGE_KIND, mount: healthy });
  expect(healthy).toHaveBeenCalledOnce();
  expect(builtin).toHaveBeenCalledOnce();
});

test('an imported bridge mount failure is handled without rejecting outside the registry', async () => {
  const opened = vi.fn();
  document.addEventListener('jini:consent-open', opened, { once: true });
  const src = 'data:text/javascript,' + encodeURIComponent('export default { mount({api}) { api.open(); throw new Error("lazy bridge failed"); } }');
  const { api, builtin } = bridgePage([{ id: 'broken-lazy', kind: BRIDGE_KIND, src }]);
  await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
  expect(builtin).toHaveBeenCalledOnce();
  await api.set({ action: 'accept' });
  expect(api.get().allowed.analytics).toBe(true);
});
