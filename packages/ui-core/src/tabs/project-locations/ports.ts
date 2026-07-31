import type { ProjectLocation, ProjectLocationDraft } from './types.js';

/**
 * The host-specific transport this tab needs: opening a native folder picker,
 * fetching the configured roots, persisting edits, and (optionally) importing
 * existing projects found under a newly-added root. Genuinely host-owned —
 * the origin called its own Electron IPC handlers for all four. This feature
 * ships only a fake in `dependencies.ts`; a real host supplies its own
 * implementation (same convention as `ExecutionPort`/`McpIntegrationsPort`).
 */
export interface ProjectLocationsPort {
  /** The full current list, including the host's built-in root. Called on
   *  mount. */
  fetchLocations(): Promise<readonly ProjectLocation[]>;

  /** Opens a native folder-choose dialog. Resolves the chosen absolute path,
   *  or `null` when the operator cancelled — cancelling is a normal outcome,
   *  not a failure, so it resolves rather than rejects. */
  openFolderDialog(): Promise<string | null>;

  /**
   * Persists `drafts` as the full set of non-built-in locations (an add, an
   * edit, or a removal is expressed as the next complete list, same as the
   * origin's `updateProjectLocations`) and resolves the authoritative list
   * afterward, built-in root included.
   *
   * REJECTS on failure — unlike `ExecutionPort.testConnection`, there is no
   * "reached but declined" outcome worth modelling as a value here; a save
   * either persists or it doesn't.
   */
  saveLocations(drafts: readonly ProjectLocationDraft[]): Promise<readonly ProjectLocation[]>;

  /**
   * Imports any existing projects found under the host's configured roots
   * into its own project list. Optional — a host with no such import step
   * (or one that already indexes on access) omits it, and the tab skips the
   * post-add scan entirely rather than reporting a result that never
   * happened.
   */
  scanLocations?(): Promise<{ imported: readonly string[]; existing: readonly string[] }>;
}
