/** Optional declared assets and UI bridges install once, before or after the core READY event. */
import { BRIDGE_KIND, type ClientConfig, type JiniConsentApi } from '../contract.js';
import { bindBridges } from './bridges.js';
import { declaredScripts } from './scripts.js';
const installed = new WeakSet<JiniConsentApi>();

export function installFeatures({ api, doc, config, reload }: { api: JiniConsentApi; doc: Document; config: ClientConfig; reload: () => void }, { bindBanner }: { bindBanner?: ((required: { api: JiniConsentApi; doc: Document }) => void) | undefined } = {}): void {
  if (installed.has(api)) return;
  installed.add(api);
  const reconcile = declaredScripts({ doc, scripts: config.scripts ?? [], reload });
  api.subscribe({ listener: reconcile });
  reconcile(api.get());
  bindBridges({ api, doc });
  if (config.banner === 'jini' && bindBanner) api.plugins.registerPlugin({ id: 'jini-banner', kind: BRIDGE_KIND, mount: bindBanner });
}
