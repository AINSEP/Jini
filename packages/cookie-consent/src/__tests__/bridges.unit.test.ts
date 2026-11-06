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
