/** Ordered, once-only declared scripts. Arbitrary executed code needs a reload on withdrawal. */
import type { ConsentState, DeclaredScript } from '../contract.js';
import { allows, validateScripts } from '../contracts/scripts.js';

export function declaredScripts({ doc, scripts, reload }: { doc: Document; scripts: readonly DeclaredScript[]; reload: () => void }, _optional = {}): (state: ConsentState) => void {
  const entries = validateScripts({ scripts }).scripts.map(script => ({ script, started: false, node: null as HTMLScriptElement | null }));
  let loading: HTMLScriptElement | null = null;
  let latest: ConsentState;
  let withdrawn = false;
  function advance(): void {
    if (loading || withdrawn) return;
    const entry = entries.find(item => !item.started && allows({ state: latest, consent: item.script.consent }));
    if (!entry) return;
    entry.started = true;
    const node = doc.createElement('script');
    entry.node = loading = node;
    node.async = false;
    node.src = entry.script.src;
    const complete = () => {
      if (loading === node) loading = null;
      advance();
    };
    node.onload = complete;
    node.onerror = complete;
    doc.head.append(node);
  }
  return state => {
    latest = state;
    const revoked = entries.filter(entry => entry.started && !allows({ state, consent: entry.script.consent }));
    if (revoked.length && !withdrawn) {
      withdrawn = true;
      revoked.forEach(entry => entry.node?.remove());
      // Removing a pending node cannot prove it never executed. Denial was persisted before reconciliation.
      reload();
    }
    advance();
  };
}
