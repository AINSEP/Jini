import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { useDebouncedValue } from '../../../../react/hooks/useDebouncedValue.js';
import { DEFAULT_SEARCH_DEBOUNCE_MS } from '../../constants.js';
import { buildFacetLabelMap, dayKeyFromTimestamp, resolveFacetLabel } from '../../rules.js';
import type { AssetGridDependencies } from '../../ports.js';
import type { AssetGridFacetOption, AssetGridItem, AssetGridSelectors, AssetGridViewMode } from '../../types.js';
import { useWiredAssetGridData } from '../hooks/useAssetGridData.js';
import { useWiredAssetGridLiveUpdates } from '../hooks/useAssetGridLiveUpdates.js';
import { useAssetGridSelection } from '../hooks/useAssetGridSelection.js';
import { useRubberBandDrag } from '../hooks/useRubberBandDrag.js';
import { useAssetGridKeyboardShortcuts } from '../hooks/useAssetGridKeyboardShortcuts.js';
import { AssetCard } from './AssetCard.js';
import { AssetGridBody } from './AssetGridBody.js';
import { AssetGridToolbar } from './AssetGridToolbar.js';
import { SelectionActionBar } from './SelectionActionBar.js';
import { SelectionBand } from './SelectionBand.js';
import { DeleteConfirmDialog } from './DeleteConfirmDialog.js';

export interface AssetGridProps<TAsset extends AssetGridItem> {
  /** Whether this grid is the visible/active surface — gates fetch-on-mount, live updates, and keyboard shortcuts (a tab-visibility gate). Defaults to `true`. */
  active?: boolean;
  selectors: AssetGridSelectors<TAsset>;
  /** Defaults to an empty in-memory fake — a host supplies its own `data` (and optionally `liveUpdates`) port. */
  dependencies?: AssetGridDependencies<TAsset>;
  kindFacets?: AssetGridFacetOption[];
  sourceFacets?: AssetGridFacetOption[];
  /** Host-supplied, kind-aware thumbnail renderer — required, since only the host knows its asset kinds. */
  renderThumbnail: (asset: TAsset) => ReactNode;
  renderThumbnailPlaceholder?: (asset: TAsset) => ReactNode;
  /** Host-owned per-card extra actions (e.g. an "open origin" link), rendered alongside the generic Remove action. */
  renderCardExtra?: (asset: TAsset) => ReactNode;
  /** Host-owned extra bulk actions, rendered in the selection bar before the generic Delete action. */
  renderBulkActions?: (selectedIds: string[]) => ReactNode;
  /** The actual per-asset delete call. Omit to hide the built-in per-card Remove action. */
  onDeleteAsset?: (id: string) => void | Promise<void>;
  /** The actual bulk-delete call, invoked after the user confirms the dialog. Omit to hide the bulk-delete action and Delete-key shortcut entirely. */
  onDeleteSelected?: (ids: string[]) => void | Promise<void>;
  onPreview?: (asset: TAsset) => void;
  /** True while a host-owned preview surface is open — Escape/Delete then defer to it instead of the grid. */
  isPreviewOpen?: boolean;
  /** Host-specific extra toolbar controls (e.g. Upload/Sync buttons). */
  toolbarActions?: ReactNode;
  emptyState?: ReactNode;
  searchPlaceholder?: string;
  searchDebounceMs?: number;
  liveUpdateCoalesceMs?: number;
  initialViewMode?: AssetGridViewMode;
  /** Custom hook overrides for dependency injection / testing. */
  useWiredAssetGridData?: typeof useWiredAssetGridData;
  useAssetGridSelection?: typeof useAssetGridSelection;
}

/**
 * A live-updating, filterable, multi-selectable asset grid — the generic
 * pattern behind a photo library / DAM. See `packages/ui/source-map.md` for
 * the full retained-behavior manifest against the original `LibrarySection.tsx`.
 */
export function AssetGrid<TAsset extends AssetGridItem>({
  active = true,
  selectors,
  dependencies,
  kindFacets = [],
  sourceFacets = [],
  renderThumbnail,
  renderThumbnailPlaceholder,
  renderCardExtra,
  renderBulkActions,
  onDeleteAsset,
  onDeleteSelected,
  onPreview,
  isPreviewOpen = false,
  toolbarActions,
  emptyState,
  searchPlaceholder,
  searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
  liveUpdateCoalesceMs,
  initialViewMode = 'grid',
  useWiredAssetGridData: useWiredAssetGridDataHook = useWiredAssetGridData,
  useAssetGridSelection: useAssetGridSelectionHook = useAssetGridSelection,
}: AssetGridProps<TAsset>) {
  const t = useT();

  const [kind, setKind] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<AssetGridViewMode>(initialViewMode);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  /** Message from a delete the host rejected. Rendered inline — see `runDelete`. */
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, searchDebounceMs);
  const filtersActive = !!(kind || source || debouncedSearch.trim());

  // `dependencies` (host-supplied, or omitted to fall back to the package's
  // in-memory fake) is resolved by each wirer independently — neither this
  // component nor the real `useAssetGridData`/`useAssetGridLiveUpdates`
  // hooks import `dependencies.ts` themselves.
  const { assets, setAssets, loading, reload } = useWiredAssetGridDataHook({
    dependencies,
    active,
    kind,
    source,
    debouncedSearch,
    getKind: selectors.getKind,
    matchesKindFilter: selectors.matchesKindFilter,
    mapKindToQuery: selectors.mapKindToQuery,
  });

  useWiredAssetGridLiveUpdates({
    dependencies,
    active,
    filtersActive,
    setAssets,
    reload,
    coalesceMs: liveUpdateCoalesceMs,
  });

  const { selectedIds, setSelectedIds, toggleOne, rangeTo, selectAll, clearSelection } = useAssetGridSelectionHook(assets);
  const containerRef = useRef<HTMLDivElement>(null);
  const { band, dragging, onMouseDown } = useRubberBandDrag({ containerRef, selectedIds, setSelectedIds });

  const requestDeleteSelected = useCallback(() => {
    if (selectedIds.size) setConfirmDeleteOpen(true);
  }, [selectedIds]);

  /**
   * Drops rows from the grid only once the host has actually deleted them.
   *
   * Two distinct defects here, each reported independently and each reproduced:
   *
   * - **No handler.** `onDelete*` is optional and the API says a host may omit
   *   it — but `await undefined` resolves happily, so the rows were filtered out
   *   of local state anyway. The assets appeared to delete and reappeared on the
   *   next load: the UI lying about state, with nothing persisted.
   * - **Rejected handler.** No `catch`, and the caller discards the promise with
   *   `void`, so a failed delete became an unhandled rejection with no toast, no
   *   inline error, and no visual change of any kind.
   *
   * The error is surfaced rather than swallowed. `resource-dashboard` in this
   * same package already threads an `actionError` through for exactly this
   * situation, so this follows the established pattern rather than inventing one.
   */
  const runDelete = useCallback(
    async (deleteFn: ((ids: readonly string[]) => unknown) | null, ids: readonly string[], drop: () => void) => {
      // No handler means the host cannot persist this — do not pretend it did.
      if (!deleteFn) return;
      setDeleteError(null);
      try {
        await deleteFn(ids);
      } catch (error: unknown) {
        setDeleteError(error instanceof Error ? error.message : String(error));
        return;
      }
      drop();
    },
    [],
  );

  const confirmDelete = useCallback(async () => {
    setConfirmDeleteOpen(false);
    const ids = [...selectedIds];
    if (!ids.length) return;
    await runDelete(onDeleteSelected ? (batch) => onDeleteSelected([...batch]) : null, ids, () => {
      const idSet = new Set(ids);
      setAssets((prev) => prev.filter((a) => !idSet.has(a.id)));
      setSelectedIds(new Set());
    });
  }, [selectedIds, onDeleteSelected, setAssets, setSelectedIds, runDelete]);

  const handleDeleteAsset = useCallback(
    async (id: string) => {
      await runDelete(onDeleteAsset ? (batch) => onDeleteAsset(batch[0]!) : null, [id], () => {
        setAssets((prev) => prev.filter((a) => a.id !== id));
      });
    },
    [onDeleteAsset, setAssets, runDelete],
  );

  const handlePreview = useCallback(
    (id: string) => {
      const asset = assets.find((a) => a.id === id);
      if (asset) onPreview?.(asset);
    },
    [assets, onPreview],
  );

  useAssetGridKeyboardShortcuts({
    active,
    enabled: !confirmDeleteOpen,
    hasAssets: assets.length > 0,
    hasSelection: selectedIds.size > 0,
    isPreviewOpen,
    onSelectAll: selectAll,
    onClearSelection: clearSelection,
    onRequestDeleteSelected: requestDeleteSelected,
  });

  const kindFacetLabels = useMemo(() => buildFacetLabelMap(kindFacets), [kindFacets]);
  const sourceFacetLabels = useMemo(() => buildFacetLabelMap(sourceFacets), [sourceFacets]);
  const getDayKey = useMemo(
    () => selectors.getDayKey ?? ((asset: TAsset) => dayKeyFromTimestamp(selectors.getTimestamp(asset))),
    [selectors],
  );

  const renderCard = useCallback(
    (asset: TAsset, index: number) => {
      const kindValue = selectors.getKind(asset);
      const sourceValue = selectors.getSource?.(asset);
      return (
        <AssetCard
          key={asset.id}
          asset={asset}
          index={index}
          selected={selectedIds.has(asset.id)}
          title={selectors.getTitle(asset)}
          subtitle={selectors.getSubtitle?.(asset)}
          kindLabel={resolveFacetLabel(kindValue, kindFacetLabels)}
          sourceLabel={sourceValue ? resolveFacetLabel(sourceValue, sourceFacetLabels) : undefined}
          renderThumbnail={renderThumbnail}
          renderThumbnailPlaceholder={renderThumbnailPlaceholder}
          onToggle={toggleOne}
          onRange={rangeTo}
          onPreview={handlePreview}
          onDeleteAsset={onDeleteAsset ? handleDeleteAsset : undefined}
          renderCardExtra={renderCardExtra}
        />
      );
    },
    [
      selectedIds,
      selectors,
      kindFacetLabels,
      sourceFacetLabels,
      renderThumbnail,
      renderThumbnailPlaceholder,
      toggleOne,
      rangeTo,
      handlePreview,
      onDeleteAsset,
      handleDeleteAsset,
      renderCardExtra,
    ],
  );

  return (
    <div className="asset-grid-root">
      <AssetGridToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={searchPlaceholder}
        kind={kind}
        onKindChange={setKind}
        kindFacets={kindFacets}
        source={source}
        onSourceChange={setSource}
        sourceFacets={sourceFacets}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onRefresh={() => void reload()}
        loading={loading}
        toolbarActions={toolbarActions}
      />

      {selectedIds.size > 0 && !dragging ? (
        <SelectionActionBar
          selectedIds={[...selectedIds]}
          onSelectAll={selectAll}
          onClear={clearSelection}
          onRequestDelete={requestDeleteSelected}
          renderBulkActions={renderBulkActions}
        />
      ) : null}

      {loading && assets.length === 0 ? (
        <p className="asset-grid-empty">{t('Loading…')}</p>
      ) : assets.length === 0 ? (
        (emptyState ?? <div className="asset-grid-empty">{t('No assets yet.')}</div>)
      ) : (
        <AssetGridBody
          viewMode={viewMode}
          assets={assets}
          getDayKey={getDayKey}
          containerRef={containerRef}
          onMouseDown={onMouseDown}
          selecting={selectedIds.size > 0}
          renderCard={renderCard}
        />
      )}

      <SelectionBand band={band} />

      {deleteError ? (
        <p className="jini-hint jini-hint-error" role="alert">
          {deleteError}
        </p>
      ) : null}

      {confirmDeleteOpen ? (
        <DeleteConfirmDialog
          count={selectedIds.size}
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  );
}
