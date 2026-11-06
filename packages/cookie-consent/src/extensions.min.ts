/** Optional feature asset: no boot, cookie read or request without a ready core API. */
import { CONFIG_ID, READY_EVENT, type PageConfig } from './contract.js';
import { bindBanner } from './client/dom.js';
import { installFeatures } from './client/features.js';
function install(): void {
  const api = window.jiniConsent;
  if (!api) return;
  try {
    const config = JSON.parse(document.getElementById(CONFIG_ID)?.textContent ?? '') as PageConfig;
    installFeatures({ api, doc: document, config, reload: () => location.reload() }, { bindBanner });
  } catch { /* Broken configuration never starts optional assets. */ }
}
document.addEventListener(READY_EVENT, install);
install();
