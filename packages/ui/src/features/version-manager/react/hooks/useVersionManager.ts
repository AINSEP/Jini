import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../i18n/index.js';
import type { ViewportPreset } from '../../../viewer-shell/index.js';
import { DEFAULT_VIEWPORT_PRESETS } from '../../../viewer-shell/index.js';
import {
  PREVIEW_LOAD_FALLBACK_MS,
  SEARCH_VISIBLE_THRESHOLD,
} from '../../constants.js';
import { defaultVersionManagerDependencies } from '../../dependencies.js';
import type { VersionManagerDependencies, VersionManagerPort } from '../../ports.js';
import {
  buildVersionIndex,
  contentMatchesSelection,
  filterVersionsBySearch,
  formatVersionDateTime,
  isRestoreDisabled,
  restoredFromVersion,
  resolveSelectedVersion,
  shouldShowVersionSearch,
  sortVersionsDescending,
  versionSourceLabel,
} from '../../rules.js';
import type { VersionManagerFileRef, VersionRecord } from '../../types.js';

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

function seedCurrentVersionContent({
  currentVersion,
  currentContent,
  contentCache,
}: {
  currentVersion: VersionRecord | undefined;
  currentContent: string | null;
  contentCache: Map<string, string>;
}) {
  if (currentVersion && currentContent != null && !contentCache.has(currentVersion.id)) {
    contentCache.set(currentVersion.id, currentContent);
  }
}

/**
 * Owns the whole version-manager state machine: list fetch, selection,
 * content cache/prefetch, search, restore, and viewport choice. Kept as one
 * cohesive hook per this package's Phase 6 "one natural owning cluster"
 * discipline (matching `features/connectors/`'s `useConnectorAuthorization`
 * precedent) — the source's own version, list, and preview state are all
 * read/written by each other's effects and don't split cleanly.
 */
export function useVersionManager<TVersion extends VersionRecord>(
  dependencies: VersionManagerDependencies<TVersion>,
  options: UseVersionManagerOptions<TVersion>,
): VersionManagerController<TVersion> {
  const { fileRef, currentContent, onRestored, onRestoredCleanly, viewportPresets = DEFAULT_VIEWPORT_PRESETS } = options;
  const port: VersionManagerPort<TVersion> = dependencies.versions;
  const { locale, t } = useI18n();

  // Latest-ref indirection so the fetch callbacks below don't need `t` in
  // their dependency arrays (see this package's documented infinite-loop
  // gotcha for hooks that call useT()/useI18n() from an effect).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [versions, setVersions] = useState<TVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(currentContent);
  const [selectedContentVersionId, setSelectedContentVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [search, setSearch] = useState('');
  const [viewport, setViewport] = useState<string>(viewportPresets[0]?.id ?? 'desktop');
  const [loadedPreviewDocument, setLoadedPreviewDocument] = useState<string | null>(null);

  const contentCacheRef = useRef<Map<string, string>>(new Map());
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  // Set right before a restore-warning reload changes `selectedId` (which
  // re-triggers the content-load effect below); consumed once by that
  // effect to skip its normal `setError(null)` so the just-set warning
  // message survives the version switch instead of being immediately
  // clobbered. See the `restore` warning branch.
  const preserveErrorOnNextSelectionRef = useRef(false);

  const versionById = useMemo(() => buildVersionIndex(versions), [versions]);
  const selectedVersion = resolveSelectedVersion(versions, versionById, selectedId);
  const showSearch = shouldShowVersionSearch(versions.length, SEARCH_VISIBLE_THRESHOLD);

  const describeVersion = useCallback(
    (version: TVersion): string => {
      const from = restoredFromVersion(version, versionById);
      return [
        `v${version.version}`,
        `version ${version.version}`,
        version.prompt ?? '',
        version.label ?? '',
        tRef.current(versionSourceLabel(version.source)),
        formatVersionDateTime(version.createdAt, locale),
        from ? `v${from.version}` : '',
      ]
        .join(' ')
        .toLowerCase();
    },
    [versionById, locale],
  );

  const visibleVersions = useMemo(
    () => (showSearch ? filterVersionsBySearch(versions, search, describeVersion) : versions),
    [showSearch, versions, search, describeVersion],
  );

  const selectedContentMatchesVersion = contentMatchesSelection(
    selectedId,
    selectedContentVersionId,
    selectedContent,
  );
  const restoreDisabled = isRestoreDisabled({
    selectedVersion,
    restoring,
    loadingContent,
    selectedContentMatchesVersion,
  });

  const previewDocument = useMemo(
    () => (selectedContent ? port.resolvePreviewDocument(fileRef, selectedContent) : ''),
    [port, fileRef, selectedContent],
  );
  const frameReady = loadedPreviewDocument === previewDocument;

  // Primes the content cache for one version at most once, deduping
  // concurrent callers (hover-prefetch racing the click that selects it).
  const primeVersionContent = useCallback(
    (versionId: string): Promise<void> => {
      if (contentCacheRef.current.has(versionId)) return Promise.resolve();
      const pending = inFlightRef.current.get(versionId);
      if (pending) return pending;
      const request = port
        .fetchVersionContent(fileRef, versionId)
        .then((result) => {
          if (result != null) contentCacheRef.current.set(versionId, result);
        })
        .catch(() => {})
        .finally(() => {
          inFlightRef.current.delete(versionId);
        });
      inFlightRef.current.set(versionId, request);
      return request;
    },
    [port, fileRef],
  );

  const loadVersions = useCallback(
    async (preferredId?: string | null) => {
      setLoading(true);
      setError(null);
      const result = await port.listVersions(fileRef);
      if (!result) {
        setError(tRef.current('Couldn’t load version history.'));
        setLoading(false);
        return;
      }
      const nextVersions = sortVersionsDescending(result);
      setVersions(nextVersions);
      const currentVersion = nextVersions.find((version) => version.current);
      seedCurrentVersionContent({ currentVersion, currentContent, contentCache: contentCacheRef.current });
      const preferredVersion = preferredId ? nextVersions.find((version) => version.id === preferredId) : null;
      const nextSelected = preferredVersion ?? currentVersion ?? nextVersions[0] ?? null;
      setSelectedId(nextSelected?.id ?? null);
      setLoading(false);
    },
    [port, fileRef, currentContent],
  );

  // Re-fetches whenever `loadVersions`'s own dependencies change — including
  // `currentContent` — matching the source exactly (a fresh `currentContent`
  // re-lists so it can be cache-seeded as the new `current` version's body).
  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedContent(null);
      setSelectedContentVersionId(null);
      return undefined;
    }
    const cached = contentCacheRef.current.get(selectedId);
    if (cached !== undefined) {
      setSelectedContent(cached);
      setSelectedContentVersionId(selectedId);
      setLoadingContent(false);
      if (preserveErrorOnNextSelectionRef.current) {
        preserveErrorOnNextSelectionRef.current = false;
      } else {
        setError(null);
      }
      return undefined;
    }
    // Cache miss: keep the previous preview mounted (don't clear
    // `selectedContent`) so switching versions never blanks to empty while
    // the loading overlay covers it.
    //
    // No `preserveErrorOnNextSelectionRef` check here (unlike the cache-hit
    // branch above): the only caller that sets that flag (`restore`'s
    // warning branch) always seeds the cache for the version it switches
    // to first, so that switch can only ever land in the cache-HIT branch
    // above — this branch genuinely cannot run with the flag set. A real
    // cache-miss always means a genuinely new fetch starting, which should
    // unconditionally clear a stale error.
    let cancelled = false;
    setLoadingContent(true);
    setError(null);
    void primeVersionContent(selectedId).then(() => {
      if (cancelled) return;
      const next = contentCacheRef.current.get(selectedId);
      if (next === undefined) {
        setSelectedContent(null);
        setSelectedContentVersionId(null);
        setError(tRef.current('Couldn’t load this version’s preview.'));
      } else {
        setSelectedContent(next);
        setSelectedContentVersionId(selectedId);
      }
      setLoadingContent(false);
    });
    return () => {
      cancelled = true;
    };
  }, [primeVersionContent, selectedId]);

  // Safety net: clear a stuck loading overlay if the iframe's `load` event
  // is ever missed.
  useEffect(() => {
    if (!previewDocument || loadedPreviewDocument === previewDocument) return undefined;
    const fallback = setTimeout(() => setLoadedPreviewDocument(previewDocument), PREVIEW_LOAD_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [previewDocument, loadedPreviewDocument]);

  const restore = useCallback(async () => {
    if (
      isRestoreDisabled({ selectedVersion, restoring, loadingContent, selectedContentMatchesVersion }) ||
      !selectedVersion ||
      !selectedContent
    ) {
      return;
    }
    setRestoring(true);
    setError(null);
    let handledRestore = false;
    try {
      const result = await port.restoreVersion(fileRef, selectedVersion);
      if (!result) {
        setError(tRef.current('Restore failed.'));
        return;
      }
      const restoredVersion = result.version ?? selectedVersion;
      await onRestored(selectedContent, restoredVersion);
      if (result.warning) {
        // Seed the cache with the content we already have in hand — it's
        // exactly what was just restored — so the list reload below
        // selects the new version as a cache HIT. Without this, the
        // content-load effect's own fetch-start `setError(null)` (for a
        // legitimate reason: clearing a stale error when starting a new
        // load) would race with and clobber the warning message set right
        // below, once React flushes that effect after this restore
        // completes. Seeding also avoids a pointless refetch of content
        // this hook already has.
        contentCacheRef.current.set(restoredVersion.id, selectedContent);
        preserveErrorOnNextSelectionRef.current = true;
        await loadVersions(restoredVersion.id);
        setError(result.warning.message);
        return;
      }
      handledRestore = true;
      onRestoredCleanly?.();
    } finally {
      if (!handledRestore) setRestoring(false);
    }
  }, [
    selectedVersion,
    restoring,
    loadingContent,
    selectedContentMatchesVersion,
    selectedContent,
    port,
    fileRef,
    onRestored,
    onRestoredCleanly,
    loadVersions,
  ]);

  const openInNewTab = useMemo(() => {
    if (!port.openPreviewInNewTab) return null;
    return () => {
      if (loadingContent || !selectedContentMatchesVersion || !selectedContent || !selectedVersion) return;
      port.openPreviewInNewTab!(
        fileRef,
        selectedContent,
        `${fileRef.name} · v${selectedVersion.version}`,
      );
    };
  }, [port, fileRef, loadingContent, selectedContentMatchesVersion, selectedContent, selectedVersion]);

  return {
    versions,
    visibleVersions,
    versionById,
    selectedVersion,
    selectedId,
    selectVersion: setSelectedId,
    prefetchVersion: (id: string) => {
      void primeVersionContent(id);
    },
    restoredFrom: (version: TVersion) => restoredFromVersion(version, versionById),
    loading,
    loadingContent,
    error,
    search,
    setSearch,
    showSearch,
    selectedContent,
    previewDocument,
    frameReady,
    markFrameLoaded: setLoadedPreviewDocument,
    restoring,
    restoreDisabled,
    restore,
    openInNewTab,
    viewportPresets,
    viewport,
    setViewport,
    describeVersion,
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
