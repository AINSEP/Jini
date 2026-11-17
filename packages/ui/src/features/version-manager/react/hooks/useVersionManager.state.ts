import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { PREVIEW_LOAD_FALLBACK_MS, SEARCH_VISIBLE_THRESHOLD } from '../../constants.js';
import type { VersionManagerPort } from '../../ports.js';
import {
  buildVersionIndex,
  filterVersionsBySearch,
  formatVersionDateTime,
  contentMatchesSelection,
  isRestoreDisabled,
  resolveSelectedVersion,
  restoredFromVersion,
  shouldShowVersionSearch,
  sortVersionsDescending,
  versionSourceLabel,
} from '../../rules.js';
import type { VersionManagerFileRef, VersionRecord } from '../../types.js';

/** Sub-hooks of `useVersionManager`, split by responsibility; the orchestrator composes them. */

type Translate = (key: string) => string;
type TRef = MutableRefObject<Translate>;
type SetError = Dispatch<SetStateAction<string | null>>;
type ContentCacheRef = MutableRefObject<Map<string, string>>;

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

/** Per-version content cache; priming is deduped across concurrent callers. */
export function useVersionContentCache<TVersion extends VersionRecord>(
  port: VersionManagerPort<TVersion>,
  fileRef: VersionManagerFileRef,
) {
  const contentCacheRef = useRef<Map<string, string>>(new Map());
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map());

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

  return { contentCacheRef, primeVersionContent };
}

interface VersionListDeps<TVersion extends VersionRecord> {
  port: VersionManagerPort<TVersion>;
  fileRef: VersionManagerFileRef;
  currentContent: string | null;
  tRef: TRef;
  contentCacheRef: ContentCacheRef;
  setError: SetError;
}

/** The version list + current selection, (re)fetched whenever `currentContent` changes. */
export function useVersionList<TVersion extends VersionRecord>({
  port,
  fileRef,
  currentContent,
  tRef,
  contentCacheRef,
  setError,
}: VersionListDeps<TVersion>) {
  const [versions, setVersions] = useState<TVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    [port, fileRef, currentContent, tRef, contentCacheRef, setError],
  );

  // Re-fetches whenever `loadVersions`'s own dependencies change — including
  // `currentContent` — matching the source exactly (a fresh `currentContent`
  // re-lists so it can be cache-seeded as the new `current` version's body).
  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  return { versions, selectedId, setSelectedId, loading, loadVersions };
}

interface SelectedContentDeps {
  selectedId: string | null;
  currentContent: string | null;
  tRef: TRef;
  contentCacheRef: ContentCacheRef;
  primeVersionContent: (versionId: string) => Promise<void>;
  preserveErrorOnNextSelectionRef: MutableRefObject<boolean>;
  setError: SetError;
}

/** Loads (from cache, else the port) the content of the selected version. */
export function useSelectedContent({
  selectedId,
  currentContent,
  tRef,
  contentCacheRef,
  primeVersionContent,
  preserveErrorOnNextSelectionRef,
  setError,
}: SelectedContentDeps) {
  const [selectedContent, setSelectedContent] = useState<string | null>(currentContent);
  const [selectedContentVersionId, setSelectedContentVersionId] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  useEffect(() => {
    const showContent = (content: string | null, versionId: string | null) => {
      setSelectedContent(content);
      setSelectedContentVersionId(versionId);
    };
    if (!selectedId) {
      showContent(null, null);
      return undefined;
    }
    const cached = contentCacheRef.current.get(selectedId);
    if (cached !== undefined) {
      showContent(cached, selectedId);
      setLoadingContent(false);
      const preserveError = preserveErrorOnNextSelectionRef.current;
      preserveErrorOnNextSelectionRef.current = false;
      if (!preserveError) setError(null);
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
        showContent(null, null);
        setError(tRef.current('Couldn’t load this version’s preview.'));
      } else {
        showContent(next, selectedId);
      }
      setLoadingContent(false);
    });
    return () => {
      cancelled = true;
    };
  }, [primeVersionContent, selectedId, contentCacheRef, preserveErrorOnNextSelectionRef, setError, tRef]);

  return { selectedContent, selectedContentVersionId, loadingContent };
}

/** Search box state + the searchable text for each version. */
export function useVersionSearch<TVersion extends VersionRecord>(
  versions: TVersion[],
  locale: string,
  tRef: TRef,
) {
  const [search, setSearch] = useState('');
  const versionById = useMemo(() => buildVersionIndex(versions), [versions]);
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
    [versionById, locale, tRef],
  );

  const visibleVersions = useMemo(
    () => (showSearch ? filterVersionsBySearch(versions, search, describeVersion) : versions),
    [showSearch, versions, search, describeVersion],
  );

  return { search, setSearch, versionById, showSearch, describeVersion, visibleVersions };
}

/** Preview-frame readiness, with a safety net for a missed iframe `load` event. */
export function usePreviewFrame(previewDocument: string) {
  const [loadedPreviewDocument, setLoadedPreviewDocument] = useState<string | null>(null);
  const frameReady = loadedPreviewDocument === previewDocument;

  // Safety net: clear a stuck loading overlay if the iframe's `load` event
  // is ever missed.
  useEffect(() => {
    if (!previewDocument || loadedPreviewDocument === previewDocument) return undefined;
    const fallback = setTimeout(() => setLoadedPreviewDocument(previewDocument), PREVIEW_LOAD_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [previewDocument, loadedPreviewDocument]);

  return { frameReady, markFrameLoaded: setLoadedPreviewDocument };
}

interface RestoreDeps<TVersion extends VersionRecord> {
  port: VersionManagerPort<TVersion>;
  fileRef: VersionManagerFileRef;
  selectedVersion: TVersion | null;
  selectedContent: string | null;
  selectedContentMatchesVersion: boolean;
  loadingContent: boolean;
  onRestored: (content: string, version: TVersion) => Promise<void> | void;
  onRestoredCleanly: (() => void) | undefined;
  loadVersions: (preferredId?: string | null) => Promise<void>;
  tRef: TRef;
  contentCacheRef: ContentCacheRef;
  preserveErrorOnNextSelectionRef: MutableRefObject<boolean>;
  setError: SetError;
}

/** Runs the restore; returns true when it completed cleanly (so the caller keeps `restoring` set until the modal closes). */
async function performRestore<TVersion extends VersionRecord>(
  deps: Pick<
    RestoreDeps<TVersion>,
    | 'port'
    | 'fileRef'
    | 'onRestored'
    | 'onRestoredCleanly'
    | 'loadVersions'
    | 'tRef'
    | 'contentCacheRef'
    | 'preserveErrorOnNextSelectionRef'
    | 'setError'
  >,
  selectedVersion: TVersion,
  selectedContent: string,
): Promise<boolean> {
  const { port, fileRef, onRestored, onRestoredCleanly, loadVersions, tRef, contentCacheRef, setError } = deps;
  const result = await port.restoreVersion(fileRef, selectedVersion);
  if (!result) {
    setError(tRef.current('Restore failed.'));
    return false;
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
    deps.preserveErrorOnNextSelectionRef.current = true;
    await loadVersions(restoredVersion.id);
    setError(result.warning.message);
    return false;
  }
  onRestoredCleanly?.();
  return true;
}

/** Restore the selected version; guarded against a disabled/mismatched selection. */
export function useRestore<TVersion extends VersionRecord>({
  port,
  fileRef,
  selectedVersion,
  selectedContent,
  selectedContentMatchesVersion,
  loadingContent,
  onRestored,
  onRestoredCleanly,
  loadVersions,
  tRef,
  contentCacheRef,
  preserveErrorOnNextSelectionRef,
  setError,
}: RestoreDeps<TVersion>) {
  const [restoring, setRestoring] = useState(false);

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
      handledRestore = await performRestore(
        { port, fileRef, onRestored, onRestoredCleanly, loadVersions, tRef, contentCacheRef, preserveErrorOnNextSelectionRef, setError },
        selectedVersion,
        selectedContent,
      );
    } finally {
      if (!handledRestore) setRestoring(false);
    }
  }, [
    selectedVersion, restoring, loadingContent, selectedContentMatchesVersion, selectedContent, port, fileRef,
    onRestored, onRestoredCleanly, loadVersions, tRef, contentCacheRef, preserveErrorOnNextSelectionRef, setError,
  ]);

  return { restoring, restore };
}

/** A ref that always holds the latest translator, so callbacks needn't list `t` as a dependency. */
export function useLatestTranslate(t: Translate): TRef {
  // Latest-ref indirection so the fetch callbacks don't need `t` in
  // their dependency arrays (see this package's documented infinite-loop
  // gotcha for hooks that call useT()/useI18n() from an effect).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  return tRef;
}

interface VersionSelectionParams<TVersion extends VersionRecord> {
  port: VersionManagerPort<TVersion>;
  fileRef: VersionManagerFileRef;
  currentContent: string | null;
  locale: string;
  tRef: TRef;
  preserveErrorOnNextSelectionRef: MutableRefObject<boolean>;
  setError: SetError;
}

/** The list, search, selected version and its content — everything the sidebar + preview read. */
export function useVersionSelection<TVersion extends VersionRecord>({
  port,
  fileRef,
  currentContent,
  locale,
  tRef,
  preserveErrorOnNextSelectionRef,
  setError,
}: VersionSelectionParams<TVersion>) {
  const { contentCacheRef, primeVersionContent } = useVersionContentCache(port, fileRef);
  const list = useVersionList({ port, fileRef, currentContent, tRef, contentCacheRef, setError });
  const searchState = useVersionSearch(list.versions, locale, tRef);
  const selectedVersion = resolveSelectedVersion(list.versions, searchState.versionById, list.selectedId);
  const content = useSelectedContent({
    selectedId: list.selectedId, currentContent, tRef, contentCacheRef, primeVersionContent, preserveErrorOnNextSelectionRef, setError,
  });
  const selectedContentMatchesVersion = contentMatchesSelection(
    list.selectedId,
    content.selectedContentVersionId,
    content.selectedContent,
  );
  return { ...list, ...searchState, ...content, contentCacheRef, primeVersionContent, selectedVersion, selectedContentMatchesVersion };
}

interface OpenInNewTabParams<TVersion extends VersionRecord> {
  port: VersionManagerPort<TVersion>;
  fileRef: VersionManagerFileRef;
  loadingContent: boolean;
  selectedContentMatchesVersion: boolean;
  selectedContent: string | null;
  selectedVersion: TVersion | null;
}

/** "Open in new tab" action; null when the port can't do it. */
export function useOpenInNewTab<TVersion extends VersionRecord>({
  port,
  fileRef,
  loadingContent,
  selectedContentMatchesVersion,
  selectedContent,
  selectedVersion,
}: OpenInNewTabParams<TVersion>) {
  return useMemo(() => {
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
}

/** The resolved preview document, its frame-ready state, and the open-in-new-tab action for the current selection. */
export function useVersionPreview<TVersion extends VersionRecord>(
  { port, fileRef }: Pick<OpenInNewTabParams<TVersion>, 'port' | 'fileRef'>,
  selection: Omit<OpenInNewTabParams<TVersion>, 'port' | 'fileRef'>,
) {
  const { selectedContent } = selection;
  const previewDocument = useMemo(
    () => (selectedContent ? port.resolvePreviewDocument(fileRef, selectedContent) : ''),
    [port, fileRef, selectedContent],
  );
  const frame = usePreviewFrame(previewDocument);
  const openInNewTab = useOpenInNewTab({ port, fileRef, ...selection });
  return { previewDocument, openInNewTab, ...frame };
}
