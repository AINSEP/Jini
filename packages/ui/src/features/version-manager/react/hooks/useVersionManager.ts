import { useRef, useState } from 'react';
import { useI18n } from '../../../i18n/index.js';
import type { ViewportPreset } from '../../../viewer-shell/index.js';
import { DEFAULT_VIEWPORT_PRESETS } from '../../../viewer-shell/index.js';
import { defaultVersionManagerDependencies } from '../../dependencies.js';
import type { VersionManagerDependencies, VersionManagerPort } from '../../ports.js';
import { isRestoreDisabled, restoredFromVersion } from '../../rules.js';
import type { VersionManagerFileRef, VersionRecord } from '../../types.js';
import { useLatestTranslate, useRestore, useVersionPreview, useVersionSelection } from './useVersionManager.state.js';

export interface UseVersionManagerOptions<TVersion extends VersionRecord> {
  fileRef: VersionManagerFileRef;
  /** The file's current (pre-version-history) content, used to seed the
   *  cache so the version flagged `current` renders instantly with no
   *  round-trip. `null` if there is none yet. */
  currentContent: string | null;
  onRestored: (content: string, version: TVersion) => Promise<void> | void;
  /** Called after a restore completes with no warning — matches the
   *  source, which closes the modal immediately on a clean restore but
   *  keeps it open (showing the warning) when the restore succeeded with
   *  a caveat. Omit if the host wants to keep the modal open regardless. */
  onRestoredCleanly?: () => void;
  viewportPresets?: ViewportPreset[];
}

export interface VersionManagerController<TVersion extends VersionRecord> {
  versions: TVersion[];
  visibleVersions: TVersion[];
  versionById: ReadonlyMap<string, TVersion>;
  selectedVersion: TVersion | null;
  selectedId: string | null;
  selectVersion: (id: string) => void;
  prefetchVersion: (id: string) => void;
  restoredFrom: (version: TVersion) => TVersion | null;
  loading: boolean;
  loadingContent: boolean;
  error: string | null;
  search: string;
  setSearch: (value: string) => void;
  showSearch: boolean;
  selectedContent: string | null;
  previewDocument: string;
  frameReady: boolean;
  markFrameLoaded: (document: string) => void;
  restoring: boolean;
  restoreDisabled: boolean;
  restore: () => Promise<void>;
  openInNewTab: (() => void) | null;
  viewportPresets: ViewportPreset[];
  viewport: string;
  setViewport: (id: string) => void;
  describeVersion: (version: TVersion) => string;
}

/**
 * Owns the whole version-manager state machine: list fetch, selection,
 * content cache/prefetch, search, restore, and viewport choice. It stays
 * the single owning hook (the pieces share refs and each other's state), but
 * composes per-responsibility sub-hooks from `useVersionManager.state.ts`.
 */
export function useVersionManager<TVersion extends VersionRecord>(
  dependencies: VersionManagerDependencies<TVersion>,
  options: UseVersionManagerOptions<TVersion>,
): VersionManagerController<TVersion> {
  const { fileRef, currentContent, onRestored, onRestoredCleanly, viewportPresets = DEFAULT_VIEWPORT_PRESETS } = options;
  const port: VersionManagerPort<TVersion> = dependencies.versions;
  const { locale, t } = useI18n();

  const tRef = useLatestTranslate(t);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<string>(viewportPresets[0]?.id ?? 'desktop');
  // Set right before a restore-warning reload changes `selectedId` (which
  // re-triggers the content-load effect); consumed once by that
  // effect to skip its normal `setError(null)` so the just-set warning
  // message survives the version switch instead of being immediately
  // clobbered. See the `restore` warning branch.
  const preserveErrorOnNextSelectionRef = useRef(false);

  const selection = useVersionSelection({ port, fileRef, currentContent, locale, tRef, preserveErrorOnNextSelectionRef, setError });
  const { versions, selectedId, selectedContent, selectedVersion, loadingContent, selectedContentMatchesVersion } = selection;
  const { restoring, restore } = useRestore({
    ...selection, port, fileRef, onRestored, onRestoredCleanly, tRef, preserveErrorOnNextSelectionRef, setError,
  });
  const restoreDisabled = isRestoreDisabled({ selectedVersion, restoring, loadingContent, selectedContentMatchesVersion });
  const { previewDocument, frameReady, markFrameLoaded, openInNewTab } = useVersionPreview({ port, fileRef }, selection);
  const { primeVersionContent, versionById } = selection;

  return {
    versions,
    visibleVersions: selection.visibleVersions,
    versionById,
    selectedVersion,
    selectedId,
    selectVersion: selection.setSelectedId,
    prefetchVersion: (id: string) => {
      void primeVersionContent(id);
    },
    restoredFrom: (version: TVersion) => restoredFromVersion({ version, versionById }),
    loading: selection.loading,
    loadingContent,
    error,
    search: selection.search,
    setSearch: selection.setSearch,
    showSearch: selection.showSearch,
    selectedContent,
    previewDocument,
    frameReady,
    markFrameLoaded,
    restoring,
    restoreDisabled,
    restore,
    openInNewTab,
    viewportPresets,
    viewport,
    setViewport,
    describeVersion: selection.describeVersion,
  };
}

/**
 * Production wiring for `useVersionManager`: binds the module-level default
 * dependencies singleton (a stateless fake port + the real stateless
 * browser clipboard — see `dependencies.ts`'s `defaultVersionManagerDependencies`
 * for why this must stay ONE shared instance rather than a fresh call per
 * render: a fresh `dependencies.versions` identity every render would
 * re-trigger `loadVersions`'s effect in a loop, the same reasoning
 * `useWiredCopyToClipboard` in `features/viewer-shell/` documents for its
 * own singleton). A real host supplies its own `VersionManagerDependencies`
 * directly to `useVersionManager` instead of using this wirer.
 */
export function useWiredVersionManager<TVersion extends VersionRecord>(
  options: UseVersionManagerOptions<TVersion>,
  dependencies: VersionManagerDependencies<TVersion> = defaultVersionManagerDependencies as unknown as VersionManagerDependencies<TVersion>,
): VersionManagerController<TVersion> {
  return useVersionManager(dependencies, options);
}
