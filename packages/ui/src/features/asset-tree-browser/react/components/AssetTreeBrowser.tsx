import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { DEFAULT_KIND_CONFIG_MAP } from '../../constants.js';
import type { AssetTreeDependencies } from '../../ports.js';
import type {
  AssetTreeFileItem,
  AssetTreeFolderItem,
  AssetTreeKindConfigMap,
  AssetTreeNavState,
  AssetTreeSelectors,
  AssetTreeToolbarAction,
} from '../../types.js';
import type { useAssetTreeNavigation } from '../hooks/useAssetTreeNavigation.js';
import type { useAssetTreePreview } from '../hooks/useAssetTreePreview.js';
import type { useAssetTreeRename } from '../hooks/useAssetTreeRename.js';
import type { useAssetTreeSelection } from '../hooks/useAssetTreeSelection.js';
import {
  AssetTreeBrowserBody,
  AssetTreeBrowserPreview,
  AssetTreeBrowserRowMenu,
  AssetTreeBrowserTopbar,
} from './AssetTreeBrowserParts.js';
import { useAssetTreeBrowserController } from './useAssetTreeBrowserController.js';

export interface AssetTreeBrowserProps<TFile extends AssetTreeFileItem> {
  files: TFile[];
  /** Persisted folders, including empty ones — see `AssetTreeFolderItem`'s doc comment. */
  folders?: AssetTreeFolderItem[];
  selectors: AssetTreeSelectors<TFile>;
  kindConfig?: AssetTreeKindConfigMap;
  /** Kind render order; kinds absent from it append in first-seen order. */
  sectionOrder?: readonly string[];
  /** Defaults to `createBrowserAssetTreeDependencies()` — a host never needs to supply this. */
  dependencies?: AssetTreeDependencies;
  /** The breadcrumb root's label (e.g. a project name). Defaults to `t('Files')`. */
  rootLabel?: string;
  /** True while the host is reindexing/reloading the tree — drives a loading overlay. */
  reloading?: boolean;
  navState?: AssetTreeNavState;
  onNavStateChange?: (state: AssetTreeNavState) => void;
  onSelectionChange?: (paths: Set<string>) => void;
  onOpenFile: (file: TFile) => void;
  onRenameFile: (path: string, nextPath: string) => Promise<TFile | null> | TFile | null;
  onDeleteFile: (path: string) => void;
  onDeleteFiles: (paths: string[]) => Promise<void> | void;
  onUploadFiles: (files: File[]) => void;
  /** Omit to hide every download affordance (row menu + preview pane) entirely. */
  getFileUrl?: (file: TFile) => string;
  /** Omit to hide the batch-download action. The host owns the actual archive endpoint — this package only triggers the browser-side save once it resolves. */
  downloadFiles?: (paths: string[]) => Promise<{ blob: Blob; filename: string }>;
  selectInitialPreviewFile?: (files: TFile[]) => TFile | null;
  renderPreviewThumbnail?: (file: TFile) => ReactNode;
  /** Threaded through to `FilePreviewPane` — see its doc comment. */
  thumbnailIsInteractive?: boolean;
  toolbarActions?: readonly AssetTreeToolbarAction[];
  emptyStateActions?: readonly AssetTreeToolbarAction[];
  /** Host-owned footer slot, rendered below the listing. This package ships no default footer — see `packages/ui/source-map.md` for why. */
  footer?: ReactNode;
  /** Custom hook overrides for dependency injection / testing. */
  useAssetTreeNavigation?: typeof useAssetTreeNavigation;
  useAssetTreePreview?: typeof useAssetTreePreview;
  useAssetTreeRename?: typeof useAssetTreeRename;
  useAssetTreeSelection?: typeof useAssetTreeSelection;
}

/**
 * A directory-navigable file tree: breadcrumbs, a host-supplied toolbar,
 * kind-grouped sections with a pinned Folders section, row selection with
 * batch delete/download, inline rename, a row context menu, drag-and-drop +
 * clipboard-paste upload, and a companion `FilePreviewPane`. Ported from a
 * design-tool origin project's file-manager panel — see
 * `packages/ui/source-map.md` for the full retained-behavior manifest and
 * everything dropped (the origin's live-artifacts section, plugin-folders
 * section, project menu, rotating-tip footer, and file-kind-specific
 * preview rendering).
 */
export function AssetTreeBrowser<TFile extends AssetTreeFileItem>(props: AssetTreeBrowserProps<TFile>) {
  const t = useT();
  const { files, folders, selectors, kindConfig = DEFAULT_KIND_CONFIG_MAP, getFileUrl } = props;
  const controller = useAssetTreeBrowserController(props, props);
  const { navigation, preview, selection, rowMenu, dragUpload } = controller;
  const hasSelection = selection.selected.size > 0;
  const previewedFile = preview.previewFile;

  return (
    <div
      className={`asset-tree-panel${previewedFile ? '' : ' no-preview'}${hasSelection ? ' has-selection' : ''}`}
    >
      {props.reloading ? (
        <div className="asset-tree-reloading-overlay" data-testid="asset-tree-reloading">
          {t('Loading…')}
        </div>
      ) : null}
      <div className="asset-tree-main">
        <AssetTreeBrowserTopbar
          currentDir={navigation.currentDir}
          rootLabel={props.rootLabel}
          onNavigate={navigation.setCurrentDir}
          toolbarActions={props.toolbarActions}
        />
        <AssetTreeBrowserBody
          controller={controller}
          files={files}
          folders={folders}
          selectors={selectors}
          kindConfig={kindConfig}
          downloadFiles={props.downloadFiles}
          emptyStateActions={props.emptyStateActions}
          footer={props.footer}
        />
        {dragUpload.draggingFiles ? (
          <div className="asset-tree-drop-overlay" aria-hidden data-testid="asset-tree-drop-overlay">
            <div className="asset-tree-drop-overlay-card">
              <span className="label">{t('Drop to upload')}</span>
            </div>
          </div>
        ) : null}
      </div>
      {previewedFile ? (
        <AssetTreeBrowserPreview
          // Keyed on the path so a host's `renderThumbnail` (which may mount
          // a heavy/stateful element like an iframe or canvas) fully
          // remounts when the user switches files, instead of React reusing
          // the same DOM node across two different files.
          key={previewedFile.path}
          file={previewedFile}
          selectors={selectors}
          kindConfig={kindConfig}
          onOpenFile={props.onOpenFile}
          onClose={preview.clearPreview}
          getFileUrl={getFileUrl}
          renderPreviewThumbnail={props.renderPreviewThumbnail}
          thumbnailIsInteractive={props.thumbnailIsInteractive}
        />
      ) : null}
      {rowMenu.menuPos ? (
        <AssetTreeBrowserRowMenu
          controller={controller}
          menuPos={rowMenu.menuPos}
          selectors={selectors}
          getFileUrl={getFileUrl}
          onDeleteFile={props.onDeleteFile}
        />
      ) : null}
    </div>
  );
}
