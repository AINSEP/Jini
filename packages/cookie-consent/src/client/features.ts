/** Optional declared assets and UI bridges install once, before or after the core READY event. */
import { BRIDGE_KIND, type ClientConfig, type ConsentState, type JiniConsentApi } from '../contract.js';
import { bindBridges } from './bridges.js';
import { declaredScripts } from './scripts.js';
import { declaredFrames } from './dom.js';
const installed = Symbol.for('jini-consent:features');

export function installFeatures({ api, doc, config, reload }: { api: JiniConsentApi; doc: Document; config: ClientConfig; reload: () => void }, { bindBanner }: { bindBanner?: ((required: { api: JiniConsentApi; doc: Document }) => void) | undefined } = {}): void {
  if (Object.prototype.hasOwnProperty.call(api, installed)) return;
  Object.defineProperty(api, installed, { value: true });
  const reconcile = declaredAssets({ doc, config, reload });
  api.subscribe({ listener: reconcile });
  reconcile(api.get());
  bindBridges({ api, doc });
  if (config.banner === 'jini' && bindBanner) api.plugins.registerPlugin({ id: 'jini-banner', kind: BRIDGE_KIND, mount: bindBanner });
}

/** Both declaration owners finish their withdrawal cleanup before the shared document reload. */
function declaredAssets({ doc, config, reload }: { doc: Document; config: ClientConfig; reload: () => void }): (state: ConsentState) => void {
  let requested = false;
  let reloaded = false;
  const requestReload = () => { requested = true; };
  const scripts = declaredScripts({ doc, scripts: config.scripts ?? [], reload: requestReload });
  const frames = declaredFrames({ doc, reload: requestReload });
  return state => {
    frames(state);
    scripts(state);
    if (!requested || reloaded) return;
    reloaded = true;
    reload();
  };
}
