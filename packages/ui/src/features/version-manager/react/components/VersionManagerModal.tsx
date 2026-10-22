import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef } from 'react';
import { useI18n } from '../../../i18n/index.js';
import { useCopyToClipboard, ViewportToggleGroup, type ViewportPreset } from '../../../viewer-shell/index.js';
import { defaultVersionManagerDependencies } from '../../dependencies.js';
import { formatVersionDateTime, restoredFromVersion, versionSourceClassName, versionSourceLabel } from '../../rules.js';
import type { VersionManagerDependencies } from '../../ports.js';
import type { VersionManagerFileRef, VersionRecord } from '../../types.js';
import { useVersionManager } from '../hooks/useVersionManager.js';
import { VersionSidebar } from './VersionSidebar.js';
import { VersionPromptPopover } from './VersionPromptPopover.js';
import { VersionRestoreControl } from './VersionRestoreControl.js';
import { VersionPreviewFrame } from './VersionPreviewFrame.js';

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

/**
 * The generic slice of the source's `FileVersionManagerModal`: a list +
 * cached-preview + restore + search modal shell. See
 * `packages/ui/source-map.md`'s `html-viewer` classification section for
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
}: VersionManagerModalProps<TVersion>) {
  const { t, locale } = useI18n();
  const controller = useVersionManagerHook(dependencies, {
    fileRef,
    currentContent,
    onRestored,
    onRestoredCleanly: onClose,
    ...(viewportPresets ? { viewportPresets } : {}),
  });
  const { copied, copy } = useCopyToClipboard(dependencies.clipboard);

  const {
    versions,
    visibleVersions,
    versionById,
    selectedVersion,
    search,
    setSearch,
    showSearch,
    loading,
    loadingContent,
    error,
    previewDocument,
    frameReady,
    markFrameLoaded,
    restoring,
    restoreDisabled,
    restore,
    openInNewTab,
    viewportPresets: presets,
    viewport,
    setViewport,
    selectVersion,
    prefetchVersion,
  } = controller;

  const versionCountLabel =
    versions.length === 1 ? t('1 version') : t('{count} versions', { count: versions.length });

  // Layered Escape handling: close the modal only when neither popover is
  // consuming the keystroke — each popover owns its own Escape dismissal
  // via `useDismissOnOutsideOrEscape`, so this only needs to know whether
  // to let Escape reach the modal itself. Simplified from the source's
  // single-listener if/else priority chain to two independently-scoped
  // listeners plus this modal-level one; see source-map.md for why this is
  // a disclosed, behavior-preserving-in-practice simplification.
  //
  // `promptOpenRef` is how the modal knows "to let Escape reach the modal
  // itself": `VersionPromptPopover` is mounted once (unconditionally) and
  // registers its own document `keydown` listener only while it holds
  // itself open, so this modal-level listener — added once at mount,
  // always earlier in the document's listener order than any popover
  // listener it later attaches on open — reads the ref synchronously
  // before the popover's own handler has run and closes itself. A plain
  // `event.stopPropagation()` in the popover wouldn't help here since its
  // listener always fires *after* this one for that reason.
  const promptOpenRef = useRef(false);
  const handleEscape = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !promptOpenRef.current) onClose();
    },
    [onClose],
  );
  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  return createPortal(
    <div
      className="jini-modal-backdrop jini-version-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="jini-version-modal" role="dialog" aria-modal="true" aria-label={t('Version history')}>
        <VersionSidebar
          countLabel={versionCountLabel}
          search={search}
          onSearchChange={setSearch}
          showSearch={showSearch}
          loading={loading}
          versions={versions}
          visibleVersions={visibleVersions}
          selectedVersionId={selectedVersion ? selectedVersion.id : null}
          onSelect={selectVersion}
          onPrefetch={prefetchVersion}
          formatDate={(version) => formatVersionDateTime(version.createdAt, locale)}
          sourceLabel={(version) => t(versionSourceLabel(version.source))}
          sourceClassName={(version) => versionSourceClassName(version.source)}
          restoredFrom={(version) => restoredFromVersion(version, versionById)}
        />
        <div className="jini-version-main">
          <header className="jini-version-head">
            <VersionMetadata
              selectedVersion={selectedVersion}
              versionById={versionById}
              fileName={fileRef.name}
              copied={copied}
              onCopy={(text) => void copy(text)}
              onOpenChange={(open) => {
                promptOpenRef.current = open;
              }}
            />
            <div className="jini-version-actions">
              {selectedVersion && !selectedVersion.current ? (
                <VersionRestoreControl disabled={restoreDisabled} restoring={restoring} onRestore={() => void restore()} />
              ) : null}
              <ViewportToggleGroup presets={presets} viewport={viewport} onViewport={setViewport} ariaLabel={t('Preview viewport')} />
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
          </header>
          <VersionPreviewFrame
            previewDocument={previewDocument}
            frameReady={frameReady}
            onFrameLoad={() => markFrameLoaded(previewDocument)}
            viewport={viewport}
            viewportPresets={presets}
            title={selectedVersion ? `${fileRef.name} · v${selectedVersion.version}` : fileRef.name}
            error={error}
            loading={loading}
            loadingContent={loadingContent}
          />
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
}: VersionMetadataProps<TVersion>) {
  const { t, locale } = useI18n();
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
