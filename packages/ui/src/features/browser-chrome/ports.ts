// Coverage note: this file is `export interface` only — TypeScript erases it
// to an empty module (verified via the package's own esbuild transform: zero
// emitted statements), so v8/istanbul coverage has no executable line to
// measure and reports 0/0 as 0% rather than N/A. Excluded from the feature's
// coverage run via `--coverage.exclude` (see packages/ui/archived provenance ledger's
// browser-chrome section) rather than chasing a phantom gap.
import type { BrowserHistoryEntry, BrowserTabHandle } from './types.js';

export interface BrowserHistoryStoragePort {
  loadHistory(scopeKey: string): BrowserHistoryEntry[];
  saveHistory(scopeKey: string, history: BrowserHistoryEntry[]): void;
}

/**
 * Lets a host wire its own registration mechanism for a live browser tab's
 * handle (e.g. re-exposing the rendered surface to some external bridge)
 * without this feature knowing or caring what the host does with it. The
 * registration MECHANISM (register-on-mount, unregister-on-unmount, keyed by
 * a scope id) is generic; what a host registers the handle FOR is not.
 */
export interface BrowserBridgeRegistrationPort {
  registerBrowserHandle(scopeKey: string, handle: BrowserTabHandle | null): void;
}
