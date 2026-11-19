import { useCallback, useState } from 'react';
import { basenameForRename, resolveRenameCommit } from '../../rules.js';
import type { AssetTreeFileItem, AssetTreeRenameState } from '../../types.js';

export interface UseAssetTreeRenameParams<TFile extends AssetTreeFileItem> {
  currentDir: string;
  onRenameFile: (path: string, nextPath: string) => Promise<TFile | null> | TFile | null;
  /** Fired after a successful rename, so the orchestrator can carry the preview/selection over to the new path. */
  onRenamed?: (oldPath: string, renamedFile: TFile) => void;
}

export interface UseAssetTreeRenameResult {
  renaming: AssetTreeRenameState | null;
  /** Set when `onRenameFile` rejects or resolves falsy; cleared on the next `startRename`/`cancelRename`. */
  renameError: string | null;
  startRename: (path: string) => void;
  updateDraft: (draft: string) => void;
  commitRename: () => Promise<void>;
  cancelRename: () => void;
}

/**
 * Inline rename: start (seeds the draft with the current basename) / edit /
 * commit / cancel. Diverges from the origin `DesignFilesPanel`'s
 * `commitRename` in one deliberate way: a failed rename here is surfaced as
 * `renameError` state instead of a blocking native `alert()` — this package
 * ships into a headless, agent-drivable engine (see the repo's own
 * `AGENTS.md`), where a hardcoded blocking dialog call is exactly the kind
 * of host-hostile side effect a generic UI feature must not own. A host
 * (or `RowContextMenu`) renders `renameError` however fits its own UI.
 */
export function useAssetTreeRename<TFile extends AssetTreeFileItem>(
  params: UseAssetTreeRenameParams<TFile>,
): UseAssetTreeRenameResult {
  const { currentDir, onRenameFile, onRenamed } = params;
  const [renaming, setRenaming] = useState<AssetTreeRenameState | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const startRename = useCallback(
    (path: string) => {
      setRenameError(null);
      setRenaming({ path, draft: basenameForRename({ path, currentDir }), saving: false });
    },
    [currentDir],
  );

  const updateDraft = useCallback((draft: string) => {
    setRenaming((prev) => (prev ? { ...prev, draft } : prev));
  }, []);

  const cancelRename = useCallback(() => {
    setRenaming(null);
    setRenameError(null);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renaming) return;
    const decision = resolveRenameCommit({ path: renaming.path, currentDir, draft: renaming.draft });
    if (!decision) {
      setRenaming(null);
      return;
    }
    setRenaming({ ...renaming, saving: true });
    try {
      const renamedFile = await onRenameFile(renaming.path, decision.nextPath);
      if (!renamedFile) throw new Error('Rename failed');
      onRenamed?.(renaming.path, renamedFile);
      setRenaming(null);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
      setRenaming((prev) => (prev ? { ...prev, saving: false } : prev));
    }
  }, [renaming, currentDir, onRenameFile, onRenamed]);

  return { renaming, renameError, startRename, updateDraft, commitRename, cancelRename };
}
