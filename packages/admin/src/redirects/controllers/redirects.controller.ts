import { createControllerStore } from '../../core/module/controller-store.js';
import type { AdminRedirect } from '../../core/ports/redirects.js';
/** Fetch-query owns request/cache states; this controller owns confirmation and write sequencing. */
export interface RedirectsActions {
  saving: boolean;
  create(form: FormData): Promise<unknown>;
  toggle(rule: AdminRedirect): Promise<unknown>;
  remove(rule: AdminRedirect): Promise<unknown>;
  resetOthers(active: 'create' | 'toggle' | 'remove'): void;
}
/** The action getter reads the current query mutations, preserving independent errors and guards.
 * @example createRedirectsController({ actions: () => currentActions }, {});
 */
export function createRedirectsController({ actions }: { actions: () => RedirectsActions }, _optional = {}) {
  const store = createControllerStore<{ pendingDelete: AdminRedirect | null }>({ initial: { pendingDelete: null } });
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, dispose: store.dispose,
    setPendingDelete({ rule }: { rule: AdminRedirect | null }, _options = {}) { store.set({ patch: { pendingDelete: rule } }); },
    createRedirect({ form }: { form: FormData }, _options = {}): Promise<boolean> {
      actions().resetOthers('create');
      // Never rejects: a failed create preserves the operator's form so it can be fixed/resubmitted.
      return actions().create(form).then(() => true, () => false);
    },
    onToggleStatus({ rule }: { rule: AdminRedirect }, _options = {}) {
      if (actions().saving || store.signal.aborted) return;
      actions().resetOthers('toggle');
      // The mutation owns the visible error; handle this derived promise too.
      void actions().toggle(rule).catch(() => {});
    },
    onRequestDelete({ rule }: { rule: AdminRedirect }, _options = {}) {
      if (actions().saving || store.signal.aborted) return;
      store.set({ patch: { pendingDelete: rule } });
    },
    confirmDelete(_required: Record<string, never> = {}, _options = {}) {
      const rule = store.getSnapshot().pendingDelete;
      if (!rule || store.signal.aborted) return;
      actions().resetOthers('remove');
      // Catch BEFORE finally: finally creates a new rejection even if mutate handled its own.
      // Failure is already surfaced by the mutation; always close confirmation once it settles.
      void actions().remove(rule).catch(() => {}).finally(() => store.set({ patch: { pendingDelete: null } }));
    },
  };
}
