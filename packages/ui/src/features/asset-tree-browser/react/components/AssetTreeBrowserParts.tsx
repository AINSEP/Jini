import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { EMPTY_TOOLBAR_ACTIONS } from '../../constants.js';
import { basenameForRename, canCopyLocalPath, countFilesUnderDir, resolveKindConfig } from '../../rules.js';
import type {
  AssetTreeFileItem,
  AssetTreeFolderItem,
  AssetTreeKindConfigMap,
  AssetTreeMenuPosition,
  AssetTreeSection,
  AssetTreeSelectors,
  AssetTreeToolbarAction,
} from '../../types.js';
import { AssetTreeBreadcrumbs } from './AssetTreeBreadcrumbs.js';
import { AssetTreeEmptyState } from './AssetTreeEmptyState.js';
import { AssetTreeFileRow } from './AssetTreeFileRow.js';
import { AssetTreeFolderRow } from './AssetTreeFolderRow.js';
import { AssetTreeRowMenu } from './AssetTreeRowMenu.js';
import { AssetTreeSelectionBar } from './AssetTreeSelectionBar.js';
import { AssetTreeToolbar } from './AssetTreeToolbar.js';
import { AssetTreeUploadErrorBanner } from './AssetTreeUploadErrorBanner.js';
import { FilePreviewPane } from './FilePreviewPane.js';
import type { AssetTreeBrowserController } from './useAssetTreeBrowserController.js';

/*
 * The render pieces `AssetTreeBrowser` is assembled from. Internal to the
 * feature (not re-exported from the barrel): each one is a slice of the
 * original single component's markup, split out only so every unit stays
 * small — the rendered DOM is unchanged.
 */

interface ControllerProps<TFile> {
  controller: AssetTreeBrowserController<TFile>;
}

export interface AssetTreeBrowserTopbarProps {
  currentDir: string;
  rootLabel?: string | undefined;
  onNavigate: (dir: string) => void;
  toolbarActions?: readonly AssetTreeToolbarAction[] | undefined;
}

/** Breadcrumbs (root label defaults to `t('Files')`) plus the host toolbar. */
export function AssetTreeBrowserTopbar({
  currentDir,
  rootLabel,
  onNavigate,
  toolbarActions = EMPTY_TOOLBAR_ACTIONS,
}: AssetTreeBrowserTopbarProps) {
  const t = useT();
  return (
    <div className="asset-tree-topbar">
      <div className="asset-tree-topbar-left">
        <AssetTreeBreadcrumbs currentDir={currentDir} rootLabel={rootLabel ?? t('Files')} onNavigate={onNavigate} />
      </div>
      <div className="asset-tree-topbar-right">
        <AssetTreeToolbar actions={toolbarActions} />
      </div>
    </div>
  );
}

export interface AssetTreeBrowserBodyProps<TFile extends AssetTreeFileItem> extends ControllerProps<TFile> {
  files: TFile[];
  folders?: AssetTreeFolderItem[] | undefined;
  selectors: AssetTreeSelectors<TFile>;
  kindConfig: AssetTreeKindConfigMap;
  downloadFiles?: ((paths: string[]) => Promise<{ blob: Blob; filename: string }>) | undefined;
  emptyStateActions?: readonly AssetTreeToolbarAction[] | undefined;
  footer?: ReactNode;
}

/** The drop-target listing area: upload-error banner, selection bar, folders + kind sections (or the empty state), footer. */
export function AssetTreeBrowserBody<TFile extends AssetTreeFileItem>(props: AssetTreeBrowserBodyProps<TFile>) {
  const { controller, downloadFiles, footer } = props;
  const { dragUpload, preview } = controller;
  return (
    <div
      className="asset-tree-body"
      data-testid="asset-tree-body"
      onDragEnter={dragUpload.onDragEnter}
      onDragOver={dragUpload.onDragOver}
      onDragLeave={dragUpload.onDragLeave}
      onDrop={dragUpload.onDrop}
    >
      {dragUpload.dropReadError && !preview.previewPath ? (
        <AssetTreeUploadErrorBanner message={dragUpload.dropReadError} onDismiss={dragUpload.clearDropReadError} />
      ) : null}
      <AssetTreeBrowserSelectionBar controller={controller} downloadFiles={downloadFiles} />
      <AssetTreeBrowserListing {...props} />
      {footer}
    </div>
  );
}

function AssetTreeBrowserSelectionBar<TFile>({
  controller,
  downloadFiles,
}: ControllerProps<TFile> & Pick<AssetTreeBrowserBodyProps<AssetTreeFileItem>, 'downloadFiles'>) {
  const { selection, batchActions } = controller;
  if (selection.selected.size === 0) return null;
  return (
    <AssetTreeSelectionBar
      count={selection.selected.size}
      onClear={selection.clearSelection}
      onDelete={() => void batchActions.deleteSelected()}
      deleting={batchActions.deleting}
      onDownload={downloadFiles ? () => void batchActions.downloadSelected() : undefined}
      downloading={batchActions.downloading}
      downloadError={batchActions.downloadError}
    />
  );
}

function AssetTreeBrowserListing<TFile extends AssetTreeFileItem>({
  controller,
  files,
  folders,
  selectors,
  kindConfig,
  emptyStateActions = EMPTY_TOOLBAR_ACTIONS,
}: AssetTreeBrowserBodyProps<TFile>) {
  const { navigation } = controller;
  const isEmpty = files.length === 0 && (folders?.length ?? 0) === 0;
  if (isEmpty) return <AssetTreeEmptyState actions={emptyStateActions} />;
  return (
    <>
      <AssetTreeFoldersSection
        key="folders"
        files={files}
        dirs={navigation.dirsAtCurrentDir}
        currentDir={navigation.currentDir}
        onNavigate={navigation.setCurrentDir}
      />
      {navigation.sections.map((section) => (
        <AssetTreeKindSection
          key={`kind:${section.kind}`}
          controller={controller}
          section={section}
          selectors={selectors}
          kindConfig={kindConfig}
        />
      ))}
    </>
  );
}

function AssetTreeFoldersSection<TFile extends AssetTreeFileItem>({
  files,
  dirs,
  currentDir,
  onNavigate,
}: {
  files: TFile[];
  dirs: string[];
  currentDir: string;
  onNavigate: (dir: string) => void;
}) {
  const t = useT();
  if (dirs.length === 0) return null;
  return (
    <div className="asset-tree-section">
      <div className="asset-tree-section-label">
        {t('Folders')}
        <span className="asset-tree-section-count">{dirs.length}</span>
      </div>
      {dirs.map((dirName) => {
        const fullPath = currentDir === '' ? dirName : `${currentDir}/${dirName}`;
        return (
          <AssetTreeFolderRow
            key={fullPath}
            name={dirName}
            path={fullPath}
            fileCount={countFilesUnderDir(files, fullPath)}
            onNavigate={onNavigate}
          />
        );
      })}
    </div>
  );
}

function AssetTreeKindSection<TFile extends AssetTreeFileItem>({
  controller,
  section,
  selectors,
  kindConfig,
}: ControllerProps<TFile> & {
  section: AssetTreeSection<TFile>;
  selectors: AssetTreeSelectors<TFile>;
  kindConfig: AssetTreeKindConfigMap;
}) {
  const t = useT();
  const { navigation, preview, selection, rename, rowMenu, openPath } = controller;
  const config = resolveKindConfig(section.kind, kindConfig);
  return (
    <div className="asset-tree-section">
      <div className="asset-tree-section-label">
        {t(config.label)}
        <span className="asset-tree-section-count">{section.files.length}</span>
      </div>
      {section.files.map((f) => (
        <AssetTreeFileRow
          key={f.path}
          path={f.path}
          displayName={basenameForRename(f.path, navigation.currentDir)}
          active={preview.previewPath === f.path}
          selected={selection.selected.has(f.path)}
          kindLabel={t(config.label)}
          kindGlyph={config.glyph}
          size={selectors.getSize(f)}
          modifiedAt={selectors.getModifiedAt(f)}
          renaming={rename.renaming?.path === f.path ? rename.renaming : null}
          onSelectPreview={preview.setPreviewPath}
          onOpen={openPath}
          onToggleSelect={selection.toggleSelect}
          onOpenMenu={rowMenu.openMenuFor}
          onRenameDraftChange={rename.updateDraft}
          onCommitRename={() => void rename.commitRename()}
          onCancelRename={rename.cancelRename}
        />
      ))}
    </div>
  );
}

export interface AssetTreeBrowserPreviewProps<TFile extends AssetTreeFileItem> {
  file: TFile;
  selectors: AssetTreeSelectors<TFile>;
  kindConfig: AssetTreeKindConfigMap;
  onOpenFile: (file: TFile) => void;
  onClose: () => void;
  getFileUrl?: ((file: TFile) => string) | undefined;
  renderPreviewThumbnail?: ((file: TFile) => ReactNode) | undefined;
  thumbnailIsInteractive?: boolean | undefined;
}

/** `FilePreviewPane` for the previewed `file`, with its kind display config resolved. */
export function AssetTreeBrowserPreview<TFile extends AssetTreeFileItem>({
  file,
  selectors,
  kindConfig,
  onOpenFile,
  onClose,
  getFileUrl,
  renderPreviewThumbnail,
  thumbnailIsInteractive,
}: AssetTreeBrowserPreviewProps<TFile>) {
  const t = useT();
  const previewKindConfig = resolveKindConfig(selectors.getKind(file), kindConfig);
  return (
    <FilePreviewPane
      file={file}
      path={file.path}
      kindLabel={t(previewKindConfig.label)}
      kindGlyph={previewKindConfig.glyph}
      size={selectors.getSize(file)}
      modifiedAt={selectors.getModifiedAt(file)}
      onOpen={() => onOpenFile(file)}
      onClose={onClose}
      downloadHref={getFileUrl?.(file)}
      renderThumbnail={renderPreviewThumbnail}
      thumbnailIsInteractive={thumbnailIsInteractive}
    />
  );
}

export interface AssetTreeBrowserRowMenuProps<TFile extends AssetTreeFileItem> extends ControllerProps<TFile> {
  menuPos: AssetTreeMenuPosition;
  selectors: AssetTreeSelectors<TFile>;
  getFileUrl?: ((file: TFile) => string) | undefined;
  onDeleteFile: (path: string) => void;
}

/** The open row context menu for `menuPos.path`, with every action wired. */
export function AssetTreeBrowserRowMenu<TFile extends AssetTreeFileItem>({
  controller,
  menuPos,
  selectors,
  getFileUrl,
  onDeleteFile,
}: AssetTreeBrowserRowMenuProps<TFile>) {
  const { navigation, rowMenu, rename, copyLocalPath, findFile, openPath } = controller;
  const { path } = menuPos;
  const menuFile = findFile(path) ?? null;
  return (
    <AssetTreeRowMenu
      path={path}
      displayName={basenameForRename(path, navigation.currentDir)}
      top={menuPos.top}
      left={menuPos.left}
      containerRef={rowMenu.containerRef}
      canCopyLocalPath={!!menuFile && canCopyLocalPath(menuFile, selectors)}
      copied={copyLocalPath.copiedPath === path}
      download={getFileUrl && menuFile ? { href: getFileUrl(menuFile), onClick: rowMenu.closeMenu } : undefined}
      onOpen={() => {
        rowMenu.closeMenu();
        openPath(path);
      }}
      onRename={() => {
        rowMenu.closeMenu();
        rename.startRename(path);
      }}
      // Deliberately does NOT close the menu (unlike every other action
      // here) — the origin `DesignFilesPanel`'s equivalent handler did
      // call `setMenuPos(null)` before copying, which meant its
      // "Copied" confirmation label could never actually become visible
      // to a user (it only ever renders inside the now-closed popover).
      // Since the whole point of `copiedPath`/the transient-confirmation
      // UI is to be seen, this keeps the menu open so it can be; the
      // existing outside-dismiss/Escape handling still closes it
      // normally afterward.
      onCopyLocalPath={() => {
        // `canCopyLocalPath` (passed below) already gates the button's
        // `disabled` state on `!!menuFile`, so a click can only reach
        // this handler when `menuFile` is non-null — asserting that
        // instead of re-guarding it here avoids an unreachable `: null`
        // ternary arm (a real click can never fire on a disabled
        // button, so that arm was dead code, not defensive coding).
        const localPath = selectors.getLocalPath?.(menuFile!);
        if (localPath) void copyLocalPath.copyLocalPath(path, localPath);
      }}
      onDelete={() => {
        rowMenu.closeMenu();
        onDeleteFile(path);
      }}
    />
  );
}
