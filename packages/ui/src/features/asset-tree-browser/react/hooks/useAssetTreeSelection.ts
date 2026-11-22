import { useCallback, useEffect, useState } from 'react';
import { pruneMissingPaths, toggleInSet } from '../../rules.js';
import type { AssetTreeFileItem } from '../../types.js';

export interface UseAssetTreeSelectionResult {
  selected: Set<string>;
  toggleSelect: (path: string) => void;
  clearSelection: () => void;
  /** Carries a selected path over to its new path after a successful rename, instead of silently dropping the selection. */
  renamePath: (oldPath: string, newPath: string) => void;
}

/**
 * Row selection: a `Set` of selected paths, reset whenever the viewed
 * directory changes, and pruned whenever a previously-selected path
 * disappears from the current listing (a delete or a refresh) — mirrors
 * `features/asset-grid`'s `useAssetGridSelection`, scoped to `path` instead
 * of `id`.
 *
 * `pendingRenamePath` (the path `useAssetTreeRename` currently has in
 * flight, if any) is exempted from pruning. Without this, a host that
 * updates its `files` prop as soon as `onRenameFile` resolves — before
 * `AssetTreeBrowser`'s own `onRenamed` callback gets to call `renamePath`
 * below — creates a real race: the old path vanishes from `filesAtCurrentDir`
 * and gets pruned away *before* `renamePath` runs, so `renamePath`'s own
 * `prev.has(oldPath)` guard (see below) then finds nothing to carry over and
 * silently no-ops, dropping the selection. Keeping the in-flight path "live"
 * for pruning purposes closes that window; once the rename actually
 * resolves, `renamePath` swaps it for the new path, which is by then always
 * present in the caller's updated `files`.
 */
export function useAssetTreeSelection<TFile extends AssetTreeFileItem>(
  filesAtCurrentDir: readonly TFile[],
  currentDir: string,
  pendingRenamePath?: string | null,
): UseAssetTreeSelectionResult {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSelected(new Set());
  }, [currentDir]);

  useEffect(() => {
    setSelected((prev) => {
      const livePaths = filesAtCurrentDir.map((f) => f.path);
      if (pendingRenamePath) livePaths.push(pendingRenamePath);
      return pruneMissingPaths({ prev, livePaths });
    });
  }, [filesAtCurrentDir, pendingRenamePath]);

  const toggleSelect = useCallback((path: string) => {
    setSelected((prev) => toggleInSet({ prev, path }));
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const renamePath = useCallback((oldPath: string, newPath: string) => {
    setSelected((prev) => {
      if (!prev.has(oldPath)) return prev;
      const next = new Set(prev);
      next.delete(oldPath);
      next.add(newPath);
      return next;
    });
  }, []);

  return { selected, toggleSelect, clearSelection, renamePath };
}
