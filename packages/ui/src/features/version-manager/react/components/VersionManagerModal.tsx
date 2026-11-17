import { createPortal } from 'react-dom';
import { useI18n } from '../../../i18n/index.js';
import { useCopyToClipboard, ViewportToggleGroup, type ViewportPreset } from '../../../viewer-shell/index.js';
import { defaultVersionManagerDependencies } from '../../dependencies.js';
import { formatVersionDateTime, restoredFromVersion, versionSourceClassName, versionSourceLabel } from '../../rules.js';
import type { VersionManagerDependencies } from '../../ports.js';
import type { VersionManagerFileRef, VersionRecord } from '../../types.js';
import { useVersionManager, type VersionManagerController } from '../hooks/useVersionManager.js';
import { VersionSidebar } from './VersionSidebar.js';
import { VersionPromptPopover } from './VersionPromptPopover.js';
import { VersionRestoreControl } from './VersionRestoreControl.js';
import { VersionPreviewFrame } from './VersionPreviewFrame.js';
import { useVersionManagerEscape } from './VersionManagerModal.hooks.js';

export interface VersionManagerModalProps<TVersion extends VersionRecord> {
  fileRef: VersionManagerFileRef;
  /** The file's current content, seeding the cache for its `current`
   *  version so it renders instantly with no round-trip. */
  currentContent: string | null;
  onClose: () => void;
  onRestored: (content: string, version: TVersion) => Promise<void> | void;
  /** Defaults to the package's in-memory fake port + real browser
   *  clipboard — a real host supplies its own transport. */
  dependencies?: VersionManagerDependencies<TVersion>;
  viewportPresets?: ViewportPreset[];
  /** Custom hook override for dependency injection / testing. */
  useVersionManager?: typeof useVersionManager;
}

function VersionManagerSidebar<TVersion extends VersionRecord>({
  controller,
  useI18nHook = useI18n,
}: {
  controller: VersionManagerController<TVersion>;
  useI18nHook?: typeof useI18n;
}) {
  const { t, locale } = useI18nHook();
  const { versions, visibleVersions, versionById, selectedVersion, search, setSearch, showSearch, loading } = controller;
  const countLabel = versions.length === 1 ? t('1 version') : t('{count} versions', { count: versions.length });
  return (
    <VersionSidebar
      countLabel={countLabel}
      search={search}
      onSearchChange={setSearch}
      showSearch={showSearch}
      loading={loading}
      versions={versions}
      visibleVersions={visibleVersions}
      selectedVersionId={selectedVersion ? selectedVersion.id : null}
      onSelect={controller.selectVersion}
      onPrefetch={controller.prefetchVersion}
      formatDate={(version) => formatVersionDateTime(version.createdAt, locale)}
      sourceLabel={(version) => t(versionSourceLabel(version.source))}
      sourceClassName={(version) => versionSourceClassName(version.source)}
      restoredFrom={(version) => restoredFromVersion(version, versionById)}
    />
  );
}

function VersionHeaderActions<TVersion extends VersionRecord>({
  controller,
  onClose,
  useI18nHook = useI18n,
}: {
  controller: VersionManagerController<TVersion>;
  onClose: () => void;
  useI18nHook?: typeof useI18n;
}) {
  const { t } = useI18nHook();
  const { selectedVersion, restoreDisabled, restoring, restore, openInNewTab, loadingContent } = controller;
  return (
    <div className="jini-version-actions">
      {selectedVersion && !selectedVersion.current ? (
        <VersionRestoreControl disabled={restoreDisabled} restoring={restoring} onRestore={() => void restore()} />
      ) : null}
      <ViewportToggleGroup
        presets={controller.viewportPresets}
        viewport={controller.viewport}
        onViewport={controller.setViewport}
        ariaLabel={t('Preview viewport')}
      />
      {openInNewTab ? (
        <button
          type="button"
          className="jini-viewer-action jini-viewer-action-icon"
          aria-label={t('Open in new tab')}
          title={t('Open in new tab')}
          disabled={loadingContent}
          onClick={openInNewTab}
        >
          {t('Open')}
        </button>
      ) : null}
      <button
        type="button"
        className="jini-viewer-action jini-viewer-action-icon"
        aria-label={t('Close')}
        title={t('Close')}
        onClick={onClose}
      >
        {t('Close')}
      </button>
    </div>
  );
}

function VersionManagerPreview<TVersion extends VersionRecord>({
  controller,
  fileName,
}: {
  controller: VersionManagerController<TVersion>;
  fileName: string;
}) {
  const { selectedVersion, previewDocument } = controller;
  return (
    <VersionPreviewFrame
      previewDocument={previewDocument}
      frameReady={controller.frameReady}
      onFrameLoad={() => controller.markFrameLoaded(previewDocument)}
      viewport={controller.viewport}
      viewportPresets={controller.viewportPresets}
      title={selectedVersion ? `${fileName} · v${selectedVersion.version}` : fileName}
      error={controller.error}
      loading={controller.loading}
      loadingContent={controller.loadingContent}
    />
  );
}

interface VersionManagerHeaderProps<TVersion extends VersionRecord> {
  controller: VersionManagerController<TVersion>;
  fileName: string;
  copied: boolean;
  onCopy: (text: string) => void;
  onClose: () => void;
  promptOpenRef: { current: boolean };
}

function VersionManagerHeader<TVersion extends VersionRecord>({
  controller,
  fileName,
  copied,
  onCopy,
  onClose,
  promptOpenRef,
}: VersionManagerHeaderProps<TVersion>) {
  const { selectedVersion, versionById } = controller;
  return (
    <header className="jini-version-head">
      <VersionMetadata
        selectedVersion={selectedVersion}
        versionById={versionById}
        fileName={fileName}
        copied={copied}
        onCopy={onCopy}
        onOpenChange={(open) => {
          promptOpenRef.current = open;
        }}
      />
      <VersionHeaderActions controller={controller} onClose={onClose} />
    </header>
  );
}

/**
 * The generic slice of the source's `FileVersionManagerModal`: a list +
 * cached-preview + restore + search modal shell. See
 * `archived UI source map`'s `html-viewer` classification section for
 * what was dropped (deploy/analytics calls — there were none; the actual
 * fetch/restore/preview-resolution calls became the injected
 * `VersionManagerPort`).
 */
export function VersionManagerModal<TVersion extends VersionRecord>({
  fileRef,
  currentContent,
  onClose,
  onRestored,
  dependencies = defaultVersionManagerDependencies as unknown as VersionManagerDependencies<TVersion>,
  viewportPresets,
  useVersionManager: useVersionManagerHook = useVersionManager,
  useI18nHook = useI18n,
  useCopyToClipboardHook = useCopyToClipboard,
  useVersionManagerEscapeHook = useVersionManagerEscape,
}: VersionManagerModalProps<TVersion> & { useI18nHook?: typeof useI18n; useCopyToClipboardHook?: typeof useCopyToClipboard; useVersionManagerEscapeHook?: typeof useVersionManagerEscape }) {
  const { t } = useI18nHook();
  const controller = useVersionManagerHook(dependencies, {
    fileRef,
    currentContent,
    onRestored,
    onRestoredCleanly: onClose,
    ...(viewportPresets ? { viewportPresets } : {}),
  });
  const { copied, copy } = useCopyToClipboardHook(dependencies.clipboard);

  const promptOpenRef = useVersionManagerEscapeHook({ onClose });

  return createPortal(
    <div
      className="jini-modal-backdrop jini-version-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="jini-version-modal" role="dialog" aria-modal="true" aria-label={t('Version history')}>
        <VersionManagerSidebar controller={controller} />
        <div className="jini-version-main">
          <VersionManagerHeader
            controller={controller}
            fileName={fileRef.name}
            copied={copied}
            onCopy={(text) => void copy(text)}
            onClose={onClose}
            promptOpenRef={promptOpenRef}
          />
          <VersionManagerPreview controller={controller} fileName={fileRef.name} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface VersionMetadataProps<TVersion extends VersionRecord> {
  selectedVersion: TVersion | null;
  versionById: ReadonlyMap<string, TVersion>;
  fileName: string;
  copied: boolean;
  onCopy: (text: string) => void;
  onOpenChange: (open: boolean) => void;
}

function VersionMetadata<TVersion extends VersionRecord>({
  selectedVersion,
  versionById,
  fileName,
  copied,
  onCopy,
  onOpenChange,
  useI18nHook = useI18n,
}: VersionMetadataProps<TVersion> & { useI18nHook?: typeof useI18n }) {
  const { t, locale } = useI18nHook();
  const selectedPrompt = selectedVersion?.prompt?.trim() ?? '';
  const selectedDate = selectedVersion ? formatVersionDateTime(selectedVersion.createdAt, locale) : fileName;
  const selectedRestoredFrom = selectedVersion ? restoredFromVersion(selectedVersion, versionById) : null;

  return (
    <div className="jini-version-meta">
      <div className="jini-version-meta-row">
        {selectedVersion?.current ? (
          <span className="jini-version-current-badge">{t('Current')}</span>
        ) : null}
        {selectedVersion ? (
          <span className={`jini-version-source-badge ${versionSourceClassName(selectedVersion.source)}`}>
            {t(versionSourceLabel(selectedVersion.source))}
          </span>
        ) : null}
        <span className="jini-version-selected-date">{selectedDate}</span>
        {selectedRestoredFrom ? (
          <span className="jini-version-restored-from">
            {t('Restored from v{version}', { version: selectedRestoredFrom.version })}
          </span>
        ) : null}
        <VersionPromptPopover
          prompt={selectedPrompt}
          disabled={!selectedVersion}
          copied={copied}
          onCopy={onCopy}
          onOpenChange={onOpenChange}
        />
      </div>
    </div>
  );
}
