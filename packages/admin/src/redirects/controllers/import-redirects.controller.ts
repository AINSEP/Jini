import { createControllerStore } from '../../core/module/controller-store.js';
import type { AdminRedirectCreateInput, AdminRedirectImportResult } from '../../core/ports/redirects.js';
import type { RedirectsTranslate } from '../models.js';
import { parseImportPayload } from '../rules.js';
export interface ImportRedirectsActions {
  reset(): void;
  run(rules: readonly AdminRedirectCreateInput[]): Promise<AdminRedirectImportResult>;
}
/** Parse errors are local; the existing query mutation owns request errors and pending state.
 * @example createImportRedirectsController({ actions: () => currentMutation, t }, {});
 */
export function createImportRedirectsController(
  { actions, t }: { actions: () => ImportRedirectsActions; t: () => RedirectsTranslate }, _optional = {},
) {
  const store = createControllerStore<{ raw: string; parseError: string | null; result: AdminRedirectImportResult | null }>({
    initial: { raw: '', parseError: null, result: null },
  });
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, dispose: store.dispose,
    setRaw({ raw }: { raw: string }, _options = {}) { store.set({ patch: { raw } }); },
    async submit(_required: Record<string, never> = {}, _options = {}): Promise<void> {
      store.set({ patch: { parseError: null, result: null } });
      actions().reset();
      // Check JSON + array only: the server remains the validator and returns each item's 207 outcome.
      const parsed = parseImportPayload({ raw: store.getSnapshot().raw, translate: t() });
      if (!parsed.ok) { store.set({ patch: { parseError: parsed.error } }); return; }
      try { store.set({ patch: { result: await actions().run(parsed.rules) } }); }
      catch { /* already surfaced by the mutation's request-error channel */ }
    },
  };
}
