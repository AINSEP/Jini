import { useEffect, useMemo } from 'react';
import { DEFAULT_SECTION_ORDER } from '../../constants.js';
import { createBrowserAssetTreeDependencies } from '../../dependencies.js';
import type { AssetTreeDependencies } from '../../ports.js';
import type { AssetTreeFileItem, AssetTreeFolderItem, AssetTreeNavState, AssetTreeSelectors } from '../../types.js';
import { useAssetTreeBatchActions, type UseAssetTreeBatchActionsResult } from '../hooks/useAssetTreeBatchActions.js';
import { useAssetTreeClipboardPasteUpload } from '../hooks/useAssetTreeClipboardPasteUpload.js';
import { useAssetTreeCopyLocalPath, type UseAssetTreeCopyLocalPathResult } from '../hooks/useAssetTreeCopyLocalPath.js';
import { useAssetTreeDragUpload, type UseAssetTreeDragUploadResult } from '../hooks/useAssetTreeDragUpload.js';
import { useAssetTreeNavigation, type UseAssetTreeNavigationResult } from '../hooks/useAssetTreeNavigation.js';
import { useAssetTreePreview, type UseAssetTreePreviewResult } from '../hooks/useAssetTreePreview.js';
import { useAssetTreeRename, type UseAssetTreeRenameResult } from '../hooks/useAssetTreeRename.js';
import { useAssetTreeRowMenu, type UseAssetTreeRowMenuResult } from '../hooks/useAssetTreeRowMenu.js';
import { useAssetTreeSelection, type UseAssetTreeSelectionResult } from '../hooks/useAssetTreeSelection.js';

/** The `AssetTreeBrowser` props every controller run needs. */
export interface AssetTreeBrowserControllerInput<TFile extends AssetTreeFileItem> {
  files: TFile[];
  selectors: AssetTreeSelectors<TFile>;
  onOpenFile: (file: TFile) => void;
  onRenameFile: (path: string, nextPath: string) => Promise<TFile | null> | TFile | null;
  onDeleteFiles: (paths: string[]) => Promise<void> | void;
  onUploadFiles: (files: File[]) => void;
}

/** The optional `AssetTreeBrowser` props the controller consumes, with the same defaults the component documents. */
export interface AssetTreeBrowserControllerOptions<TFile extends AssetTreeFileItem> {
  folders?: AssetTreeFolderItem[];
  sectionOrder?: readonly string[];
  dependencies?: AssetTreeDependencies;
  navState?: AssetTreeNavState;
  onNavStateChange?: (state: AssetTreeNavState) => void;
  onSelectionChange?: (paths: Set<string>) => void;
  downloadFiles?: (paths: string[]) => Promise<{ blob: Blob; filename: string }>;
  selectInitialPreviewFile?: (files: TFile[]) => TFile | null;
  useAssetTreeNavigation?: typeof useAssetTreeNavigation;
  useAssetTreePreview?: typeof useAssetTreePreview;
  useAssetTreeRename?: typeof useAssetTreeRename;
  useAssetTreeSelection?: typeof useAssetTreeSelection;
}

export interface AssetTreeBrowserController<TFile> {
  navigation: UseAssetTreeNavigationResult<TFile>;
  preview: UseAssetTreePreviewResult<TFile>;
  rename: UseAssetTreeRenameResult;
  selection: UseAssetTreeSelectionResult;
  rowMenu: UseAssetTreeRowMenuResult;
  dragUpload: UseAssetTreeDragUploadResult;
  batchActions: UseAssetTreeBatchActionsResult;
  copyLocalPath: UseAssetTreeCopyLocalPathResult;
  findFile: (path: string) => TFile | undefined;
  /** Resolves `path` against `files` and opens it; a path no longer in `files` is a no-op. */
  openPath: (path: string) => void;
}

/**
 * Every hook `AssetTreeBrowser` composes, wired together in the one order
 * their cross-references need, so the component itself is pure rendering.
 */
export function useAssetTreeBrowserController<TFile extends AssetTreeFileItem>(
  input: AssetTreeBrowserControllerInput<TFile>,
  {
    folders,
    sectionOrder = DEFAULT_SECTION_ORDER,
    dependencies,
    navState,
    onNavStateChange,
    onSelectionChange,
    downloadFiles,
    selectInitialPreviewFile,
    useAssetTreeNavigation: useAssetTreeNavigationHook = useAssetTreeNavigation,
    useAssetTreePreview: useAssetTreePreviewHook = useAssetTreePreview,
    useAssetTreeRename: useAssetTreeRenameHook = useAssetTreeRename,
    useAssetTreeSelection: useAssetTreeSelectionHook = useAssetTreeSelection,
  }: AssetTreeBrowserControllerOptions<TFile>,
): AssetTreeBrowserController<TFile> {
  const { files, selectors, onOpenFile, onRenameFile, onDeleteFiles, onUploadFiles } = input;
  // KNOWN FOLLOW-UP (flagged by the 2026-07-22 verification pass, not yet
  // fixed): this has the same useWiredX gap ConnectorsBrowser had — `deps`
  // resolution is still inline instead of behind a `useWiredAssetTreeBrowser`
  // wrapper. Deliberately not fixed here: unlike ConnectorsBrowser's `deps`
  // (fed to exactly the 3 already-overridable sub-hooks), this `deps` also
  // feeds `useAssetTreeRowMenu`, `useAssetTreeClipboardPasteUpload`, and
  // `useAssetTreeCopyLocalPath` below — none of which currently have their
  // own override props — so collapsing it into one wired hook is a real
  // design decision (what belongs in the wired hook vs. stays overridable)
  // rather than a mechanical port of the ConnectorsBrowser pattern. Lower
  // severity than that one too: these are DOM/clipboard adapters, not
  // remote data fetching.
  const deps = useMemo(() => dependencies ?? createBrowserAssetTreeDependencies(), [dependencies]);

  const navigation = useAssetTreeNavigationHook({
    files,
    folders,
    sectionOrder,
    getKind: selectors.getKind,
    getModifiedAt: selectors.getModifiedAt,
    navState,
    onNavStateChange,
  });
  const preview = useAssetTreePreviewHook(files, selectInitialPreviewFile);
  // Declared before `useAssetTreeSelection` so its in-flight `renaming.path`
  // (if any) can be threaded into selection's prune logic as
  // `pendingRenamePath` — see that hook's doc comment for the race this
  // closes. `onRenamed` referencing `selection` here (declared below) is
  // safe: it's a closure that only actually runs later, once `selection` is
  // fully bound.
  const rename = useAssetTreeRenameHook<TFile>({
    currentDir: navigation.currentDir,
    onRenameFile,
    onRenamed: (oldPath, renamedFile) => {
      if (preview.previewPath === oldPath) preview.setPreviewPath(renamedFile.path);
      selection.renamePath(oldPath, renamedFile.path);
    },
  });
  const selection = useAssetTreeSelectionHook(
    navigation.filesAtCurrentDir,
    navigation.currentDir,
    rename.renaming?.path ?? null,
  );
  const rowMenu = useAssetTreeRowMenu(deps.dom);
  const dragUpload = useAssetTreeDragUpload(onUploadFiles);
  useAssetTreeClipboardPasteUpload({
    dom: deps.dom,
    onUploadFiles,
    onBeforeUpload: dragUpload.clearDropReadError,
  });
  const batchActions = useAssetTreeBatchActions({ selected: selection.selected, onDeleteFiles, downloadFiles });
  const copyLocalPath = useAssetTreeCopyLocalPath(deps.clipboard);

  useEffect(() => {
    onSelectionChange?.(selection.selected);
  }, [selection.selected, onSelectionChange]);

  function findFile(path: string): TFile | undefined {
    return files.find((f) => f.path === path);
  }

  function openPath(path: string) {
    const target = findFile(path);
    if (target) onOpenFile(target);
  }

  return { navigation, preview, rename, selection, rowMenu, dragUpload, batchActions, copyLocalPath, findFile, openPath };
}
