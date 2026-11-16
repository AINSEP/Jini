// Smoke test for the feature's public barrel: proves every advertised export
// actually resolves through `index.js` (not just through each source file
// directly, which every other test in this directory exercises). Catches an
// export silently dropped from the barrel without touching runtime behavior.
import { describe, expect, it } from 'vitest';
import * as AssetTreeBrowserFeature from '../index.js';

describe('asset-tree-browser index barrel', () => {
  it('re-exports the constants, rules, dependencies, hooks, and components it advertises', () => {
    const runtimeExports = [
      'DEFAULT_KIND_CONFIG_MAP',
      'DEFAULT_KIND_GLYPH',
      'DEFAULT_SECTION_ORDER',
      'EMPTY_TOOLBAR_ACTIONS',
      'ROW_MENU_ESTIMATED_HEIGHT_PX',
      'ROW_MENU_SAFE_PADDING_PX',
      'COPY_LOCAL_PATH_CONFIRM_MS',
      'DOUBLE_ACTIVATION_WINDOW_MS',
      'deriveTreeChildren',
      'groupFilesByKind',
      'nextExistingAncestorDir',
      'countFilesUnderDir',
      'toggleInSet',
      'pruneMissingPaths',
      'basenameForRename',
      'resolveRenameCommit',
      'computeMenuPosition',
      'canCopyLocalPath',
      'isDoubleActivation',
      'resolveKindConfig',
      'humanBytes',
      'relativeTimeResult',
      'fileExtensionLabel',
      'buildBreadcrumbSegments',
      'filesFromClipboardData',
      'normalizePastedFile',
      'shouldIgnoreClipboardFilePaste',
      'filesFromDataTransfer',
      'filesFromFileSystemEntry',
      'createBrowserAssetTreeClipboardPort',
      'createBrowserAssetTreeDomBridgePort',
      'createBrowserAssetTreeDependencies',
      'createFakeAssetTreeDependencies',
      'useAssetTreeNavigation',
      'useAssetTreeSelection',
      'useAssetTreePreview',
      'useAssetTreeRename',
      'useAssetTreeRowMenu',
      'useAssetTreeDragUpload',
      'useAssetTreeClipboardPasteUpload',
      'useAssetTreeBatchActions',
      'triggerBrowserDownload',
      'useAssetTreeCopyLocalPath',
      'AssetTreeBreadcrumbs',
      'AssetTreeToolbar',
      'AssetTreeSelectionBar',
      'AssetTreeFileRow',
      'AssetTreeFolderRow',
      'AssetTreeRowMenu',
      'FilePreviewPane',
      'AssetTreeEmptyState',
      'AssetTreeUploadErrorBanner',
      'AssetTreeBrowser',
    ] as const;

    for (const name of runtimeExports) {
      expect(AssetTreeBrowserFeature[name], `expected index.js to export ${name}`).toBeDefined();
    }
  });
});
