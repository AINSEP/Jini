/**
 * @file The pure "did this row change out from under an open editor, and what should happen" rule
 * shared by `use-page-editor.hooks.ts` and `use-post-editor.hooks.ts` (2026-09-16, owner bug: an
 * assistant tool writes a Page/Post while its editor is open, and nothing on screen updates until a
 * manual reload).
 *
 * `version` is the change signal because it is already the field every write path bumps
 * (`html-document-store.sqlite.ts`, `post.ts`) whether the write came from the operator's own Save
 * or an agent tool — no new column, no timestamp-skew risk, and a read-only tool result never
 * touches it, so a notification with an unchanged version is correctly a no-op rather than a
 * spurious refresh.
 *
 * `saving` outranks `dirty`: a save already in flight owns the next state transition (its own
 * success or its own 409 conflict banner). Applying a background read over it, or raising a
 * competing notice while it resolves, would either clobber the save's own outcome or double-prompt
 * the operator about the exact same version bump their own Save is about to produce.
 */

/** The minimum an editor's row must carry for the refresh decision — structural, so `AdminPost`
 *  satisfies it without importing this module. */
export interface ExternalEntryRevision {
  id: string;
  version: number;
}

/** What the caller should do about a freshly-fetched row: silently replace the working copy
 *  (`"apply"`), leave it alone (`"ignore"`), or surface a resolve-conflict notice (`"notify"`). */
export type ExternalEntryRefreshDecision = "ignore" | "apply" | "notify";

/**
 * True when `fresh` is a strictly newer revision of the same entry `loaded` represents.
 *
 * @complexity O(1).
 */
export function isNewerRevision(
  required: { loaded: ExternalEntryRevision | null; fresh: ExternalEntryRevision },
  _optional: Record<string, never> = {},
): required is { loaded: ExternalEntryRevision; fresh: ExternalEntryRevision } {
  const { loaded, fresh } = required;
  return loaded !== null && fresh.id === loaded.id && fresh.version > loaded.version;
}

/**
 * Decides what an editor should do when a background re-read of its row settles.
 *
 * @param input.loaded The row the editor currently treats as its saved basis, or `null` before
 *   anything has loaded.
 * @param input.fresh The row as just re-read.
 * @param input.dirty Whether the editor has unsaved edits, read at the moment the fetch settled.
 * @param input.saving Whether the editor's own save is currently in flight.
 * @param input.dismissedForBasisVersion The loaded basis version the operator chose "Keep my
 *   edits" on, or `null` if they have not dismissed a notice on the current basis.
 * @complexity O(1).
 */
export function decideExternalEntryRefresh(input: {
  loaded: ExternalEntryRevision | null;
  fresh: ExternalEntryRevision;
  dirty: boolean;
  saving: boolean;
  dismissedForBasisVersion: number | null;
}): ExternalEntryRefreshDecision {
  if (!isNewerRevision(input) || input.saving) return "ignore";
  const { loaded, dirty, dismissedForBasisVersion } = input;
  if (!dirty) return "apply";
  if (dismissedForBasisVersion === loaded.version) return "ignore";
  return "notify";
}
