import type { DeclaredScript } from '../contract.js';
import { allows, validateScripts } from '../contracts/scripts.js';
import { DENIED } from '../contracts/policy.js';
const attribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** Ordinary delivery when consent is off. Validation never reads or transforms page HTML. */
export function renderScriptAssets({ scripts }: { scripts: readonly DeclaredScript[] }, _optional = {}): string {
  return validateScripts({ scripts }).scripts.map(script => `<script data-jini-declared-script src="${attribute(script.src)}" defer></script>`).join('');
}

/** Automatic assets never depend on context, receipts or the optional browser lifecycle. */
export function declaredScriptDelivery({ scripts }: { scripts: readonly DeclaredScript[] }, _optional = {}) {
  const accepted = validateScripts({ scripts }).scripts;
  const automatic = accepted.filter(script => allows({ state: { allowed: DENIED }, consent: script.consent }));
  const conditional = accepted.filter(script => !allows({ state: { allowed: DENIED }, consent: script.consent }));
  return { head: renderScriptAssets({ scripts: automatic }), scripts: conditional };
}
