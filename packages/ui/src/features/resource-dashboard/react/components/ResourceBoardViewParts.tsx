import { ResourceCard } from './ResourceCard.js';
import { ResourceKanbanBoard } from './ResourceKanbanBoard.js';
import type { ResourceBoardViewProps } from './ResourceBoardView.js';

/** The LOAD-failure banner and, independently, the single-item action-failure banner (shown ABOVE the still-visible item list). */
export function ResourceBoardAlerts<TBody>({
  error,
  errorLabel,
  actionError,
  actionErrorLabel,
}: Pick<ResourceBoardViewProps<TBody>, 'error' | 'errorLabel' | 'actionError' | 'actionErrorLabel'>) {
  return (
    <>
      {error ? (
        <div className="resource-board-error" role="alert">
          {errorLabel ?? error}
        </div>
      ) : null}

      {actionError ? (
        <div className="resource-board-action-error" role="alert">
          {actionErrorLabel ?? actionError}
        </div>
      ) : null}
    </>
  );
}

/** The card grid: one `ResourceCard` per item, with the item's id bound into each per-card callback. */
export function ResourceBoardGrid<TBody>({
  items,
  selectMode,
  selected,
  openMenuId,
  isItemBusy,
  statusLabel,
  toneMap,
  menuActionLabel,
  moreLabel,
  menuContainerRef,
  renderBody,
  onOpenItem,
  onToggleSelected,
  onToggleMenu,
  onItemAction,
}: ResourceBoardViewProps<TBody>) {
  return (
    <div className="resource-board-grid" data-testid="resource-board-grid">
      {items.map((item) => (
        <ResourceCard
          key={item.id}
          item={item}
          selectMode={selectMode}
          selected={selected.has(item.id)}
          menuOpen={openMenuId === item.id}
          busy={isItemBusy(item.id)}
          {...(item.status ? { statusLabel: statusLabel(item.status) } : {})}
          {...(toneMap ? { toneMap } : {})}
          {...(menuActionLabel ? { menuActionLabel } : {})}
          moreLabel={moreLabel}
          {...(menuContainerRef ? { menuContainerRef } : {})}
          {...(renderBody ? { renderBody } : {})}
          onOpen={() => onOpenItem(item.id)}
          onToggleSelected={() => onToggleSelected(item.id)}
          onToggleMenu={() => onToggleMenu(item.id)}
          onAction={(kind) => onItemAction(item.id, kind)}
        />
      ))}
    </div>
  );
}

/**
 * DesignsTab's own `filtered.length === 0 ? empty : view === "grid" ? grid : kanban`
 * branch, behind a loading state. The empty state is suppressed while a load
 * error is showing, and picks "search matched nothing" over "nothing exists
 * yet" whenever the port returned any item at all.
 */
export function ResourceBoardContent<TBody>(props: ResourceBoardViewProps<TBody>) {
  const { loading, error, items, hasAnyItems, viewMode, onKanbanDelete } = props;
  if (loading) return <div className="resource-board-loading" role="status" />;
  if (!error && items.length === 0) {
    return <div className="resource-board-empty">{hasAnyItems ? props.emptyStateNoMatch : props.emptyStateTitle}</div>;
  }
  if (viewMode === 'grid') return <ResourceBoardGrid {...props} />;
  return (
    <ResourceKanbanBoard
      columns={props.kanbanColumns}
      emptyColumnLabel={props.emptyColumnLabel}
      deleteLabel={props.deleteLabel}
      deleteAriaLabel={props.deleteAriaLabel}
      isBusy={props.isItemBusy}
      onOpen={props.onOpenItem}
      {...(onKanbanDelete ? { onDelete: onKanbanDelete } : {})}
    />
  );
}
