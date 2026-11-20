import type { Logger } from '@jini-ai/core/primitives';
import { useWiredAssetGridLiveUpdates } from '../hooks/useAssetGridLiveUpdates.js';
import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import type { AssetGridDependencies } from '../../ports.js';
import type { AssetGridFacetOption, AssetGridItem, AssetGridSelectors, AssetGridViewMode } from '../../types.js';
import { useWiredAssetGridData } from '../hooks/useAssetGridData.js';
import { useAssetGridSelection } from '../hooks/useAssetGridSelection.js';
import { useAssetGridView } from './AssetGrid.hooks.js';
import { AssetGridBody, type AssetGridBodyProps } from './AssetGridBody.js';
import { AssetGridToolbar } from './AssetGridToolbar.js';
import { SelectionActionBar } from './SelectionActionBar.js';
import { SelectionBand } from './SelectionBand.js';
import { DeleteConfirmDialog } from './DeleteConfirmDialog.js';

export interface AssetGridProps<TAsset extends AssetGridItem> {
  report?: Pick<Logger, 'error'> | undefined;
  useWiredAssetGridLiveUpdates?: typeof useWiredAssetGridLiveUpdates;
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
  /** Hooks the grid calls itself; defaults to the real ones, a test hands in fakes. */
  hooks?: AssetGridHooks | undefined;
}

export const defaultAssetGridHooks = { useT, useAssetGridView };
export type AssetGridHooks = typeof defaultAssetGridHooks;

function DeleteFeedback({
  deleteError,
  confirmDeleteOpen,
  count,
  onCancel,
  onConfirm,
}: {
  deleteError: string | null | undefined;
  confirmDeleteOpen: boolean;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      {deleteError ? (
        <p className="jini-hint jini-hint-error" role="alert">
          {deleteError}
        </p>
      ) : null}
      {confirmDeleteOpen ? <DeleteConfirmDialog count={count} onCancel={onCancel} onConfirm={onConfirm} /> : null}
    </>
  );
}

function renderGridContent<TAsset extends AssetGridItem>(
  { loading, emptyState, t, ...bodyProps }: AssetGridBodyProps<TAsset> & {
    loading: boolean;
    emptyState: ReactNode;
    t: ReturnType<typeof useT>;
  },
  _options: Record<string, never> = {},
) {
  if (loading && bodyProps.assets.length === 0) return <p className="jini-asset-grid-empty">{t('Loading…')}</p>;
  if (bodyProps.assets.length === 0) return emptyState ?? <div className="jini-asset-grid-empty">{t('No assets yet.')}</div>;
  return <AssetGridBody {...bodyProps} />;
}

/**
 * A live-updating, filterable, multi-selectable asset grid — the generic
 * pattern behind a photo library / DAM. See `archived UI source map` for
 * the full retained-behavior manifest against the original `LibrarySection.tsx`.
 */
export function AssetGrid<TAsset extends AssetGridItem>({
  active = true, report, useWiredAssetGridLiveUpdates: useWiredAssetGridLiveUpdatesHook = useWiredAssetGridLiveUpdates,
  selectors,
  dependencies,
  kindFacets: configuredKindFacets,
  sourceFacets: configuredSourceFacets,
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
  searchDebounceMs,
  liveUpdateCoalesceMs,
  initialViewMode = 'grid',
  useWiredAssetGridData: useWiredAssetGridDataHook = useWiredAssetGridData,
  useAssetGridSelection: useAssetGridSelectionHook = useAssetGridSelection,
  hooks = defaultAssetGridHooks,
}: AssetGridProps<TAsset>) {
  const t = hooks.useT();

  const { kind, setKind, source, setSource, search, setSearch, kindFacets, sourceFacets, viewMode, setViewMode, assets, loading, reload, selectedIds, selectAll, clearSelection, containerRef, band, dragging, onMouseDown, requestDeleteSelected, confirmDeleteOpen, setConfirmDeleteOpen, deleteError, getDayKey, renderCard, confirmDelete } = hooks.useAssetGridView({ active, report, useWiredAssetGridLiveUpdatesHook, selectors, dependencies, configuredKindFacets, configuredSourceFacets, renderThumbnail, renderThumbnailPlaceholder, renderCardExtra, onDeleteAsset, onDeleteSelected, onPreview, isPreviewOpen, searchDebounceMs, liveUpdateCoalesceMs, initialViewMode, useWiredAssetGridDataHook, useAssetGridSelectionHook });

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

      {renderGridContent({
        loading,
        emptyState,
        t,
        viewMode,
        assets,
        getDayKey,
        containerRef,
        onMouseDown,
        selecting: selectedIds.size > 0,
        renderCard,
      })}

      <SelectionBand band={band} />

      <DeleteFeedback
        deleteError={deleteError}
        confirmDeleteOpen={confirmDeleteOpen}
        count={selectedIds.size}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
