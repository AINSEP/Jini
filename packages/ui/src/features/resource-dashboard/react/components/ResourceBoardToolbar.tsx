import type { ResourceBoardViewMode, ResourceSortOption } from '../../types.js';

export interface ResourceBoardToolbarProps {
  sortOptions: ResourceSortOption[];
  activeSort?: string;
  onSortChange: (value: string) => void;
  sortAriaLabel: string;

  query: string;
  onQueryChange: (value: string) => void;
  searchPlaceholder: string;

  viewMode: ResourceBoardViewMode;
  onViewModeChange: (mode: ResourceBoardViewMode) => void;
  viewToggleAriaLabel: string;
  gridViewLabel: string;
  kanbanViewLabel: string;

  /** Whether select-mode/bulk-delete controls render at all — omitted entirely when the host never supplied a bulk-delete handler to the orchestrator. Only ever shown in grid view (mirrors DesignsTab, which hides select-mode entirely in kanban view). */
  enableBulkDelete: boolean;
  selectMode: boolean;
  selectedCount: number;
  bulkDeleteBusy: boolean;
  onEnterSelectMode: () => void;
  onExitSelectMode: () => void;
  onBulkDelete: () => void;
  selectModeLabel: string;
  selectedCountLabel: (n: number) => string;
  deleteSelectedLabel: string;
  cancelSelectLabel: string;

  createLabel?: string;
  onCreate?: () => void;
}

type ResourceBoardSelectControlsProps = Pick<
  ResourceBoardToolbarProps,
  | 'selectMode'
  | 'selectedCount'
  | 'bulkDeleteBusy'
  | 'onEnterSelectMode'
  | 'onExitSelectMode'
  | 'onBulkDelete'
  | 'selectModeLabel'
  | 'selectedCountLabel'
  | 'deleteSelectedLabel'
  | 'cancelSelectLabel'
>;

/** The select-mode bar while selecting, otherwise the button that enters select mode. */
function ResourceBoardSelectControls({
  selectMode,
  selectedCount,
  bulkDeleteBusy,
  onEnterSelectMode,
  onExitSelectMode,
  onBulkDelete,
  selectModeLabel,
  selectedCountLabel,
  deleteSelectedLabel,
  cancelSelectLabel,
}: ResourceBoardSelectControlsProps) {
  if (!selectMode) {
    return (
      <button type="button" className="resource-board-select-toggle" onClick={onEnterSelectMode}>
        {selectModeLabel}
      </button>
    );
  }
  return (
    <div className="resource-board-select-bar" role="group">
      <span className="resource-board-select-count">{selectedCountLabel(selectedCount)}</span>
      <button type="button" disabled={selectedCount === 0 || bulkDeleteBusy} onClick={onBulkDelete}>
        {deleteSelectedLabel}
      </button>
      <button type="button" onClick={onExitSelectMode}>
        {cancelSelectLabel}
      </button>
    </div>
  );
}

/**
 * DesignsTab's toolbar: sub-tab sort pills + a create button + search +
 * select-mode/bulk-delete bar (grid view only) + the grid/kanban view
 * toggle. The origin's manual-refresh button and 15s auto-refresh polling
 * are deliberately NOT ported — see `packages/ui/source-map.md`'s "Dropped"
 * list; a host wanting that composes its own refresh affordance around the
 * hook's `reload()`.
 */
export function ResourceBoardToolbar({
  sortOptions,
  activeSort,
  onSortChange,
  sortAriaLabel,
  query,
  onQueryChange,
  searchPlaceholder,
  viewMode,
  onViewModeChange,
  viewToggleAriaLabel,
  gridViewLabel,
  kanbanViewLabel,
  enableBulkDelete,
  selectMode,
  selectedCount,
  bulkDeleteBusy,
  onEnterSelectMode,
  onExitSelectMode,
  onBulkDelete,
  selectModeLabel,
  selectedCountLabel,
  deleteSelectedLabel,
  cancelSelectLabel,
  createLabel,
  onCreate,
}: ResourceBoardToolbarProps) {
  const showSelectControls = enableBulkDelete && viewMode === 'grid';

  return (
    <div className="resource-board-toolbar">
      <div className="resource-board-toolbar-left">
        {sortOptions.length > 0 ? (
          <div className="resource-board-sort-pill" role="group" aria-label={sortAriaLabel}>
            {sortOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={activeSort === option.value}
                className={activeSort === option.value ? 'active' : ''}
                onClick={() => onSortChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="resource-board-toolbar-right">
        {onCreate && createLabel ? (
          <button type="button" className="resource-board-create-button" onClick={onCreate}>
            {createLabel}
          </button>
        ) : null}
        <div className="resource-board-search">
          <input placeholder={searchPlaceholder} value={query} onChange={(event) => onQueryChange(event.target.value)} />
        </div>
        {showSelectControls ? (
          <ResourceBoardSelectControls
            selectMode={selectMode}
            selectedCount={selectedCount}
            bulkDeleteBusy={bulkDeleteBusy}
            onEnterSelectMode={onEnterSelectMode}
            onExitSelectMode={onExitSelectMode}
            onBulkDelete={onBulkDelete}
            selectModeLabel={selectModeLabel}
            selectedCountLabel={selectedCountLabel}
            deleteSelectedLabel={deleteSelectedLabel}
            cancelSelectLabel={cancelSelectLabel}
          />
        ) : null}
        <div className="resource-board-view-pill" role="group" aria-label={viewToggleAriaLabel}>
          <button
            aria-pressed={viewMode === 'grid'}
            className={viewMode === 'grid' ? 'active' : ''}
            title={gridViewLabel}
            onClick={() => onViewModeChange('grid')}
          >
            {gridViewLabel}
          </button>
          <button
            aria-pressed={viewMode === 'kanban'}
            className={viewMode === 'kanban' ? 'active' : ''}
            title={kanbanViewLabel}
            onClick={() => onViewModeChange('kanban')}
          >
            {kanbanViewLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
