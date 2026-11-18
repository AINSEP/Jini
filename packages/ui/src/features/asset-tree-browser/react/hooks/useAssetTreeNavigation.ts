import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_SECTION_ORDER } from '../../constants.js';
import {
  deriveTreeChildren,
  groupFilesByKind,
  nextExistingAncestorDir,
} from '../../rules.js';
import type {
  AssetTreeFileItem,
  AssetTreeFolderItem,
  AssetTreeNavState,
  AssetTreeSection,
} from '../../types.js';

// Stable empty-array fallbacks: allocating `[]` inline as a default (`params.folders ?? []`)
// would create a new array reference every render, defeating the `useMemo`/`useEffect`
// dependency arrays below.
const EMPTY_FOLDERS: readonly AssetTreeFolderItem[] = [];

export interface UseAssetTreeNavigationParams<TFile extends AssetTreeFileItem> {
  files: readonly TFile[];
  folders?: readonly AssetTreeFolderItem[] | undefined;
  /** Kind render order; kinds absent from it append in first-seen order. Defaults to `[]` (pure first-seen order). */
  sectionOrder?: readonly string[] | undefined;
  getKind: (file: TFile) => string;
  getModifiedAt: (file: TFile) => number;
  /** Seeds the initial directory and is reported back to on every navigation. Uncontrolled after mount — see `AssetTreeBrowser`'s doc comment. */
  navState?: AssetTreeNavState | undefined;
  onNavStateChange?: ((state: AssetTreeNavState) => void) | undefined;
}

export interface UseAssetTreeNavigationResult<TFile> {
  currentDir: string;
  setCurrentDir: (dir: string) => void;
  dirsAtCurrentDir: string[];
  filesAtCurrentDir: TFile[];
  sections: AssetTreeSection<TFile>[];
}

/**
 * Directory navigation: current-directory state (seeded from `navState`,
 * reported upward via `onNavStateChange` on every change — a one-time seed
 * plus a report-upward callback, not a fully controlled prop, matching the
 * origin `DesignFilesPanel`'s own `navState`/`onNavStateChange` pair),
 * derived subdirectories/files at that level, kind-grouped sections, and the
 * auto-ancestor-correction effect that walks back up when the viewed
 * directory disappears (e.g. after deleting the last file in it).
 */
export function useAssetTreeNavigation<TFile extends AssetTreeFileItem>(
  params: UseAssetTreeNavigationParams<TFile>,
): UseAssetTreeNavigationResult<TFile> {
  const { files, getKind, getModifiedAt, onNavStateChange } = params;
  const folders = params.folders ?? EMPTY_FOLDERS;
  const sectionOrder = params.sectionOrder ?? DEFAULT_SECTION_ORDER;
  const [currentDir, setCurrentDirState] = useState<string>(() => params.navState?.currentDir ?? '');

  const setCurrentDir = useCallback(
    (dir: string) => {
      setCurrentDirState(dir);
      onNavStateChange?.({ currentDir: dir });
    },
    [onNavStateChange],
  );

  // Walk back up to the nearest ancestor that still exists when the viewed
  // directory disappears — otherwise navigating into an empty folder that
  // later loses its files would leave the panel stuck showing nothing.
  useEffect(() => {
    const corrected = nextExistingAncestorDir({ files, folders, currentDir });
    if (corrected !== null) setCurrentDir(corrected);
    // `setCurrentDir` intentionally excluded: it's `useCallback`-stable given
    // a stable `onNavStateChange`, and including it here would be a no-op
    // for correctness — this effect must only re-run when the tree contents
    // or the viewed directory change, not when the host swaps callback
    // identity.
  }, [files, folders, currentDir]);

  const { dirsAtCurrentDir, filesAtCurrentDir } = useMemo(
    () => deriveTreeChildren({ files, folders, currentDir }),
    [files, folders, currentDir],
  );

  const sections = useMemo(
    () => groupFilesByKind({ files: filesAtCurrentDir, sectionOrder, getKind, getModifiedAt }),
    [filesAtCurrentDir, sectionOrder, getKind, getModifiedAt],
  );

  return { currentDir, setCurrentDir, dirsAtCurrentDir, filesAtCurrentDir, sections };
}
