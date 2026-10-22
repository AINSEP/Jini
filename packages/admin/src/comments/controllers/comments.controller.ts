import { createControllerStore } from '../../core/module/controller-store.js';
import { describeApiError } from '../../core/transport/errors.js';
import type { CommentsState } from '../models.js';

/** Permissions settle from the shared query cache; absent grants default to denied. */
export function createCommentsController(_required: Record<string, never>, _optional: Record<string, never> = {}) {
  const store = createControllerStore<CommentsState>({ initial: { permissions: null, error: null } });
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, dispose: store.dispose,
    settle({ data, error }: { data: { effectivePermissions?: readonly string[] } | null; error: Error | null }, _options: Record<string, never> = {}) {
      store.set({ patch: {
        permissions: data ? [...(data.effectivePermissions ?? [])] : null,
        error: error ? describeApiError({ e: error, fallback: 'failed to load permissions' }) : null,
      } });
    },
  };
}
