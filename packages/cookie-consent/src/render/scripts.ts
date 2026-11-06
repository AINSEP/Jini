import type { DeclaredScript } from '../contract.js';
import { validateScripts } from '../contracts/scripts.js';
const attribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** Ordinary delivery when consent is off. Validation never reads or transforms page HTML. */
export function renderScriptAssets({ scripts }: { scripts: readonly DeclaredScript[] }, _optional = {}): string {
  return validateScripts({ scripts }).scripts.map(script => `<script data-jini-declared-script src="${attribute(script.src)}" defer></script>`).join('');
}
