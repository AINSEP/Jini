/** Full ESM client surface. The browser assets split optional feature delivery from core state. */
import type { JiniConsentApi } from '../contract.js';
import { createCookieConsent as createCore, boot as bootCore, bootWithContext as bootCoreWithContext, readPage, type BootOptions } from './runtime.js';
import { installFeatures } from './features.js';
export { browserPorts, purgeStorage, installOpeners, bindBanner } from './runtime.js';
export type { ClientPorts, ClientOptions, BootOptions } from './runtime.js';

export const createCookieConsent: typeof createCore = (required, options) => {
  const api = createCore(required, options);
  installFeatures({ api, doc: required.ports.doc, config: required.config, reload: required.ports.reload });
  return api;
};

function features(win: Window & typeof globalThis, api: JiniConsentApi | undefined, options: BootOptions): JiniConsentApi | undefined {
  if (api) installFeatures({ api, doc: win.document, config: readPage(win.document)!, reload: options.ports?.reload ?? (() => win.location.reload()) }, { bindBanner: options.bindBanner });
  return api;
}

export function boot(win: Window & typeof globalThis = window, options: BootOptions = {}): JiniConsentApi | undefined {
  return features(win, bootCore(win, { ...options, bindBanner: undefined }), options);
}

export async function bootWithContext({ win }: { win: Window & typeof globalThis }, options: BootOptions = {}): Promise<JiniConsentApi | undefined> {
  return features(win, await bootCoreWithContext({ win }, { ...options, bindBanner: undefined }), options);
}
