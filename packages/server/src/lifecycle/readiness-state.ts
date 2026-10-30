import type { BootResult, ReadinessStore } from './boot-lifecycle.js';

function copy(snapshot: BootResult): BootResult {
  return { ok: snapshot.ok, modules: snapshot.modules.map(module => ({
    ...module, lifecycle: { ...module.lifecycle },
  })) };
}

/** Instance-owned snapshots. Host-specific health records are supplied by the caller. */
export function createReadinessStore(
  _required: Record<string, never>,
  optional: { initial?: BootResult } = {},
): ReadinessStore {
  let snapshot = copy(optional.initial ?? { ok: true, modules: [] });
  return {
    set({ snapshot: next }) { snapshot = copy(next); },
    get() { return copy(snapshot); },
  };
}
