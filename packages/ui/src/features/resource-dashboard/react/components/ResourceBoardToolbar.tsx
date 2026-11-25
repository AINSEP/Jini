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
      <button type="button" className="jini-resource-board-select-toggle" onClick={onEnterSelectMode}>
        {selectModeLabel}
      </button>
    );
  }
  return (
    <div className="jini-resource-board-select-bar" role="group">
      <span className="jini-resource-board-select-count">{selectedCountLabel(selectedCount)}</span>
      <button type="button" disabled={selectedCount === 0 || bulkDeleteBusy} onClick={onBulkDelete}>
        {deleteSelectedLabel}
      </button>
      <button type="button" onClick={onExitSelectMode}>
        {cancelSelectLabel}
      </button>
    </div>
  );
}

type ResourceBoardSortPillProps = Pick<
  ResourceBoardToolbarProps,
  'sortOptions' | 'activeSort' | 'onSortChange' | 'sortAriaLabel'
>;

function ResourceBoardSortPill({ sortOptions, activeSort, onSortChange, sortAriaLabel }: ResourceBoardSortPillProps) {
  if (sortOptions.length === 0) return null;
  return (
    <div className="jini-resource-board-sort-pill" role="group" aria-label={sortAriaLabel}>
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
  );
}

type ResourceBoardViewPillProps = Pick<
  ResourceBoardToolbarProps,
  'viewMode' | 'onViewModeChange' | 'viewToggleAriaLabel' | 'gridViewLabel' | 'kanbanViewLabel'
>;

function ResourceBoardViewPill({
  viewMode,
  onViewModeChange,
  viewToggleAriaLabel,
  gridViewLabel,
  kanbanViewLabel,
}: ResourceBoardViewPillProps) {
  return (
    <div className="jini-resource-board-view-pill" role="group" aria-label={viewToggleAriaLabel}>
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
  );
}

/**
 * DesignsTab's toolbar: sub-tab sort pills + a create button + search +
 * select-mode/bulk-delete bar (grid view only) + the grid/kanban view
 * toggle. The origin's manual-refresh button and 15s auto-refresh polling
 * are deliberately NOT ported — see `070311a07^:packages/ui/source-map.md` (section "features/resource-dashboard/"), its "Dropped"
 * list; a host wanting that composes its own refresh affordance around the
 * hook's `reload()`.
 */
export function ResourceBoardToolbar(props: ResourceBoardToolbarProps) {
  const { query, onQueryChange, searchPlaceholder, createLabel, onCreate } = props;
  const showSelectControls = props.enableBulkDelete && props.viewMode === 'grid';

  return (
    <div className="jini-resource-board-toolbar">
      <div className="jini-resource-board-toolbar-left">
        <ResourceBoardSortPill {...props} />
      </div>
      <div className="jini-resource-board-toolbar-right">
        {onCreate && createLabel ? (
          <button type="button" className="jini-resource-board-create-button" onClick={onCreate}>
            {createLabel}
          </button>
        ) : null}
        <div className="jini-resource-board-search">
          <input placeholder={searchPlaceholder} value={query} onChange={(event) => onQueryChange(event.target.value)} />
        </div>
        {showSelectControls ? <ResourceBoardSelectControls {...props} /> : null}
        <ResourceBoardViewPill {...props} />
      </div>
    </div>
  );
}
