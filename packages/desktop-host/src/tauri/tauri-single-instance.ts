import type { SingleInstanceLockPort } from '../single-instance.js';
import type { TauriSingleInstanceApi } from './tauri-surfaces.js';

/**
 * Tauri's single-instance guarantee is enforced Rust-side before this
 * instance's JS ever runs, so `claim` has nothing to request — it just
 * registers the "a second launch was attempted" listener and reports
 * `true`, since by construction this JS is only running because the lock
 * was already granted.
 */
export function createTauriSingleInstanceLockPort({ api }: { api: TauriSingleInstanceApi }): SingleInstanceLockPort {
  return {
    claim({ onSecondInstance }) {
      api.onSecondInstance({ listener: () => onSecondInstance() });
      return true;
    },
  };
}
