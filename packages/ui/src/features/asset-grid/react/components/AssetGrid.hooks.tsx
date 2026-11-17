import { useCallback, useMemo, useRef, useState } from 'react';
import { dayKeyFromTimestamp, resolveFacetLabel } from '../../rules.js';
import type { AssetGridItem, AssetGridViewMode } from '../../types.js';
import type { AssetGridProps } from './AssetGrid.js';
import { useWiredAssetGridData } from '../hooks/useAssetGridData.js';
import { useWiredAssetGridLiveUpdates } from '../hooks/useAssetGridLiveUpdates.js';
import { useAssetGridSelection } from '../hooks/useAssetGridSelection.js';
import { useRubberBandDrag } from '../hooks/useRubberBandDrag.js';
import { useAssetGridKeyboardShortcuts } from '../hooks/useAssetGridKeyboardShortcuts.js';
import { useAssetGridFilters } from './useAssetGridFilters.js';
import { AssetCard } from './AssetCard.js';

function withoutAssetIds<TAsset extends AssetGridItem>(
  { assets, ids }: { assets: TAsset[]; ids: ReadonlySet<string> }, _options = {},
): TAsset[] {
  return assets.filter(asset => !ids.has(asset.id));
}

type AssetsSetter<TAsset> = (update: (prev: TAsset[]) => TAsset[]) => void;

/** Delete flow for the grid: confirm dialog state, the inline error, and the batch/single handlers. */
function useAssetGridDeletion<TAsset extends AssetGridItem>({ selectedIds, setSelectedIds, setAssets, onDeleteAsset, onDeleteSelected }: {
  selectedIds: ReadonlySet<string>; setSelectedIds: (ids: Set<string>) => void; setAssets: AssetsSetter<TAsset>;
  onDeleteAsset: AssetGridProps<TAsset>['onDeleteAsset']; onDeleteSelected: AssetGridProps<TAsset>['onDeleteSelected'];
}, _options = {}) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  /** Message from a delete the host rejected. Rendered inline — see `runDelete`. */
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    const idSet = new Set(ids);
    const removeDeleted = (prev: TAsset[]) => withoutAssetIds({ assets: prev, ids: idSet });
    await runDelete(onDeleteSelected ? (batch) => onDeleteSelected([...batch]) : null, ids, () => {
      setAssets(removeDeleted);
      setSelectedIds(new Set());
    });
  }, [selectedIds, onDeleteSelected, setAssets, setSelectedIds, runDelete]);

  // Built only when the host supplied `onDeleteAsset`: the card shows its per-asset delete control
  // only when it receives a handler, so there is no "no handler" path to route through `runDelete`
  // here (the old inline `onDeleteAsset ? … : null` could never see `null` from a rendered card).
  const handleDeleteAsset = useMemo(
    () => onDeleteAsset
      ? async (id: string) => {
        const removeDeleted = (prev: TAsset[]) => withoutAssetIds({ assets: prev, ids: new Set([id]) });
        await runDelete((batch) => onDeleteAsset(batch[0]!), [id], () => {
          setAssets(removeDeleted);
        });
      }
      : undefined,
    [onDeleteAsset, setAssets, runDelete],
  );
  return { requestDeleteSelected, confirmDeleteOpen, setConfirmDeleteOpen, deleteError, confirmDelete, handleDeleteAsset };
}

/** Builds the memoised per-asset card renderer. */
function useAssetCardRenderer<TAsset extends AssetGridItem>({
  selectors, selectedIds, kindFacetLabels, sourceFacetLabels, renderThumbnail, renderThumbnailPlaceholder,
  renderCardExtra, onDeleteAsset, handleDeleteAsset, handlePreview, toggleOne, rangeTo,
}: {
  selectors: AssetGridProps<TAsset>['selectors']; selectedIds: ReadonlySet<string>;
  kindFacetLabels: Parameters<typeof resolveFacetLabel>[1]; sourceFacetLabels: Parameters<typeof resolveFacetLabel>[1];
  renderThumbnail: AssetGridProps<TAsset>['renderThumbnail']; renderThumbnailPlaceholder: AssetGridProps<TAsset>['renderThumbnailPlaceholder'];
  renderCardExtra: AssetGridProps<TAsset>['renderCardExtra']; onDeleteAsset: AssetGridProps<TAsset>['onDeleteAsset'];
  handleDeleteAsset: ((id: string) => Promise<void>) | undefined; handlePreview: (id: string) => void;
  toggleOne: React.ComponentProps<typeof AssetCard>['onToggle']; rangeTo: React.ComponentProps<typeof AssetCard>['onRange'];
}, _options = {}) {
  return useCallback(
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
          onDeleteAsset={handleDeleteAsset}
          renderCardExtra={renderCardExtra}
        />
      );
    },
    [
      selectedIds, selectors, kindFacetLabels, sourceFacetLabels, renderThumbnail, renderThumbnailPlaceholder,
      toggleOne, rangeTo, handlePreview, onDeleteAsset, handleDeleteAsset, renderCardExtra,
    ],
  );
}

/** Wires the grid's data read and its live-update subscription over the same asset list. */
function useWiredAssetGridReads<TAsset extends AssetGridItem>({
  dependencies, active, kind, source, debouncedSearch, filtersActive, selectors, liveUpdateCoalesceMs, useWiredAssetGridDataHook,
}: {
  dependencies: AssetGridProps<TAsset>['dependencies']; active: boolean; kind: string; source: string; debouncedSearch: string;
  filtersActive: boolean; selectors: AssetGridProps<TAsset>['selectors'];
  liveUpdateCoalesceMs: AssetGridProps<TAsset>['liveUpdateCoalesceMs']; useWiredAssetGridDataHook: typeof useWiredAssetGridData;
}, _options = {}) {
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
  return { assets, setAssets, loading, reload };
}

/** Coordinate grid reads, selection, preview, deletion, and per-card rendering. */
export function useAssetGridView<TAsset extends AssetGridItem>({ active, selectors, dependencies, configuredKindFacets, configuredSourceFacets, renderThumbnail, renderThumbnailPlaceholder, renderCardExtra, onDeleteAsset, onDeleteSelected, onPreview, isPreviewOpen, searchDebounceMs, liveUpdateCoalesceMs, initialViewMode, useWiredAssetGridDataHook, useAssetGridSelectionHook }: {
  active: boolean; selectors: AssetGridProps<TAsset>['selectors']; dependencies: AssetGridProps<TAsset>['dependencies'];
  configuredKindFacets: AssetGridProps<TAsset>['kindFacets']; configuredSourceFacets: AssetGridProps<TAsset>['sourceFacets'];
  renderThumbnail: AssetGridProps<TAsset>['renderThumbnail']; renderThumbnailPlaceholder: AssetGridProps<TAsset>['renderThumbnailPlaceholder'];
  renderCardExtra: AssetGridProps<TAsset>['renderCardExtra']; onDeleteAsset: AssetGridProps<TAsset>['onDeleteAsset'];
  onDeleteSelected: AssetGridProps<TAsset>['onDeleteSelected']; onPreview: AssetGridProps<TAsset>['onPreview'];
  isPreviewOpen: boolean; searchDebounceMs: AssetGridProps<TAsset>['searchDebounceMs']; liveUpdateCoalesceMs: AssetGridProps<TAsset>['liveUpdateCoalesceMs'];
  initialViewMode: AssetGridViewMode; useWiredAssetGridDataHook: typeof useWiredAssetGridData; useAssetGridSelectionHook: typeof useAssetGridSelection;
}, _options = {}) {
  const { kind, setKind, source, setSource, search, setSearch, debouncedSearch, filtersActive, kindFacets, sourceFacets, kindFacetLabels, sourceFacetLabels } =
    useAssetGridFilters({ kindFacets: configuredKindFacets, sourceFacets: configuredSourceFacets, searchDebounceMs });
  const [viewMode, setViewMode] = useState<AssetGridViewMode>(initialViewMode);
  const { assets, setAssets, loading, reload } = useWiredAssetGridReads({
    dependencies, active, kind, source, debouncedSearch, filtersActive, selectors, liveUpdateCoalesceMs, useWiredAssetGridDataHook,
  });

  const { selectedIds, setSelectedIds, toggleOne, rangeTo, selectAll, clearSelection } = useAssetGridSelectionHook(assets);
  const containerRef = useRef<HTMLDivElement>(null);
  const { band, dragging, onMouseDown } = useRubberBandDrag({ containerRef, selectedIds, setSelectedIds });

  const {
    requestDeleteSelected, confirmDeleteOpen, setConfirmDeleteOpen, deleteError, confirmDelete, handleDeleteAsset,
  } = useAssetGridDeletion({ selectedIds, setSelectedIds, setAssets, onDeleteAsset, onDeleteSelected });

  const handlePreview = useCallback(
    (id: string) => {
      const asset = assets.find((a) => a.id === id);
      if (asset) onPreview?.(asset);
    },
    [assets, onPreview],
  );

  useAssetGridKeyboardShortcuts({
    active, enabled: !confirmDeleteOpen, hasAssets: assets.length > 0, hasSelection: selectedIds.size > 0, isPreviewOpen,
    onSelectAll: selectAll, onClearSelection: clearSelection, onRequestDeleteSelected: requestDeleteSelected,
  });

  const getDayKey = useMemo(
    () => selectors.getDayKey ?? ((asset: TAsset) => dayKeyFromTimestamp(selectors.getTimestamp(asset))),
    [selectors],
  );

  const renderCard = useAssetCardRenderer({
    selectors, selectedIds, kindFacetLabels, sourceFacetLabels, renderThumbnail, renderThumbnailPlaceholder,
    renderCardExtra, onDeleteAsset, handleDeleteAsset, handlePreview, toggleOne, rangeTo,
  });

  return { kind, setKind, source, setSource, search, setSearch, kindFacets, sourceFacets, viewMode, setViewMode, assets, loading, reload, selectedIds, selectAll, clearSelection, containerRef, band, dragging, onMouseDown, requestDeleteSelected, confirmDeleteOpen, setConfirmDeleteOpen, deleteError, getDayKey, renderCard, confirmDelete };
}
