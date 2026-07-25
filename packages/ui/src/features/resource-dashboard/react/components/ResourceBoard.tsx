import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { useWiredResourceBoard } from '../hooks/useResourceBoard.js';
import { ResourceBoardView } from './ResourceBoardView.js';
import { UNMATCHED_STATUS_BUCKET } from '../../constants.js';
import type { ResourceKanbanColumn } from './ResourceKanbanBoard.js';
import type { ResourceBoardDependencies } from '../../ports.js';
import type { ResourceBoardItem, ResourceBoardViewMode, ResourceSortOption, ResourceStatusOption, ResourceStatusToneMap } from '../../types.js';

export interface ResourceBoardProps<TItem extends ResourceBoardItem<TBody>, TBody = unknown> {
  dependencies: ResourceBoardDependencies<TItem>;
  /** Also defines the kanban column order (array order) and each column's label. */
  statusOptions: ResourceStatusOption[];
  toneMap?: ResourceStatusToneMap;
  defaultStatus?: string;
  normalizeStatus?: (status: string) => string;
  sortOptions?: ResourceSortOption[];
  initialSort?: string;
  storageScopeKey?: string;
  defaultViewMode?: ResourceBoardViewMode;
  /** Renders the select-mode toggle + bulk-delete bar (grid view only). Defaults to true — a host with no bulk-delete concept for its resource sets this to false. */
  enableBulkDelete?: boolean;
  onOpenItem: (id: string) => void;
  onCreate?: () => void;
  createLabel?: string;
  /** Fired when a kebab menu action with `kind === 'rename'` is clicked — this primitive never collects the new name itself (no `Dialog` is ported, see `packages/ui/source-map.md`). */
  onRenameRequest?: (id: string, currentTitle: string) => void;
  /** Fired for any menu action kind other than the three this primitive natively understands (`rename`/`duplicate`/`delete`). */
  onCustomItemAction?: (id: string, kind: string) => void;
  refreshToken?: string | number;
  renderBody?: (item: ResourceBoardItem<TBody>) => ReactNode;
  /** Custom hook override for dependency injection / testing. */
  useWiredResourceBoard?: typeof useWiredResourceBoard;
}

/**
 * The DesignsTab-shaped orchestrator: wires `useWiredResourceBoard` +
 * `useT()` + `ResourceBoardView`. `rename`/`duplicate`/`delete` are the
 * three menu-action kinds this primitive understands natively (matching the
 * three ports.ts methods) — `delete`/`duplicate` are handled entirely
 * in-hook (no extra input needed), `rename` always bubbles to
 * `onRenameRequest` since it needs a text input this primitive doesn't
 * collect, and anything else bubbles to `onCustomItemAction`.
 */
export function ResourceBoard<TItem extends ResourceBoardItem<TBody>, TBody = unknown>({
  dependencies,
  statusOptions,
  toneMap,
  defaultStatus,
  normalizeStatus,
  sortOptions = [],
  initialSort,
  storageScopeKey,
  defaultViewMode,
  enableBulkDelete = true,
  onOpenItem,
  onCreate,
  createLabel,
  onRenameRequest,
  onCustomItemAction,
  refreshToken,
  renderBody,
  useWiredResourceBoard: useWiredResourceBoardHook = useWiredResourceBoard,
}: ResourceBoardProps<TItem, TBody>) {
  const t = useT();
  const board = useWiredResourceBoardHook<TItem>({
    dependencies,
    statusOrder: statusOptions.map((option) => option.value),
    ...(defaultStatus !== undefined ? { defaultStatus } : {}),
    ...(normalizeStatus !== undefined ? { normalizeStatus } : {}),
    ...(initialSort !== undefined ? { initialSort } : {}),
    ...(storageScopeKey !== undefined ? { storageScopeKey } : {}),
    ...(defaultViewMode !== undefined ? { defaultViewMode } : {}),
    ...(refreshToken !== undefined ? { refreshToken } : {}),
  });

  const kanbanColumns: ResourceKanbanColumn<TBody>[] = statusOptions.map((option) => ({
    status: option.value,
    label: t(option.label),
    // Non-null: `useWiredResourceBoard` above is called with `statusOrder:
    // statusOptions.map(option => option.value)`, and `groupItemsByStatus`
    // (rules.ts) always seeds one Map entry per `statusOrder` value before
    // placing any item — so every `option.value` here is guaranteed present.
    items: board.kanbanColumns.get(option.value)!,
  }));
  const unmatched = board.kanbanColumns.get(UNMATCHED_STATUS_BUCKET);
  if (unmatched && unmatched.length > 0) {
    kanbanColumns.push({ status: UNMATCHED_STATUS_BUCKET, label: t('Other'), items: unmatched });
  }

  const handleItemAction = (id: string, kind: string) => {
    if (kind === 'delete') {
      void board.remove(id);
      return;
    }
    if (kind === 'duplicate') {
      void board.duplicate(id);
      return;
    }
    if (kind === 'rename') {
      board.closeMenu();
      // Non-null: `id` only ever reaches this handler via a menu-action
      // click closure `ResourceBoardView` builds per rendered item (from
      // this SAME render's `board.visibleItems`), so the item is always
      // still present in the array at lookup time.
      const current = board.visibleItems.find((item) => item.id === id)!;
      onRenameRequest?.(id, current.title);
      return;
    }
    board.closeMenu();
    onCustomItemAction?.(id, kind);
  };

  return (
    <ResourceBoardView
      loading={board.loading}
      error={board.error}
      {...(board.error ? { errorLabel: t(board.error) } : {})}
      actionError={board.actionError}
      {...(board.actionError ? { actionErrorLabel: t(board.actionError) } : {})}
      hasAnyItems={board.totalCount > 0}
      items={board.visibleItems}
      kanbanColumns={kanbanColumns}
      sortOptions={sortOptions}
      {...(board.sort !== undefined ? { activeSort: board.sort } : {})}
      onSortChange={board.setSort}
      sortAriaLabel={t('Sort')}
      query={board.query}
      onQueryChange={board.setQuery}
      searchPlaceholder={t('Search…')}
      viewMode={board.viewMode}
      onViewModeChange={board.setViewMode}
      viewToggleAriaLabel={t('View')}
      gridViewLabel={t('Grid view')}
      kanbanViewLabel={t('Kanban view')}
      enableBulkDelete={enableBulkDelete}
      selectMode={board.selectMode}
      selected={board.selected}
      bulkDeleteBusy={board.bulkDeleteBusy}
      onEnterSelectMode={board.enterSelectMode}
      onExitSelectMode={board.exitSelectMode}
      onBulkDelete={() => void board.bulkDelete()}
      selectModeLabel={t('Select')}
      selectedCountLabel={(n) => t('{n} selected', { n })}
      deleteSelectedLabel={t('Delete selected')}
      cancelSelectLabel={t('Cancel')}
      {...(createLabel !== undefined || onCreate ? { createLabel: createLabel ?? t('New') } : {})}
      {...(onCreate ? { onCreate } : {})}
      openMenuId={board.openMenuId}
      menuContainerRef={board.menuContainerRef}
      onToggleMenu={board.toggleMenu}
      onItemAction={handleItemAction}
      isItemBusy={board.isItemBusy}
      onOpenItem={onOpenItem}
      onToggleSelected={board.toggleSelected}
      onKanbanDelete={(id) => void board.remove(id)}
      statusLabel={(status) => t(statusOptions.find((option) => option.value === status)?.label ?? status)}
      {...(toneMap ? { toneMap } : {})}
      menuActionLabel={(_kind, fallback) => t(fallback)}
      moreLabel={t('More')}
      deleteLabel={t('Delete')}
      deleteAriaLabel={(title) => t('Delete {name}', { name: title })}
      emptyColumnLabel={t('No items in this column.')}
      emptyStateTitle={t('No items yet.')}
      emptyStateNoMatch={t('No items match your search.')}
      {...(renderBody ? { renderBody } : {})}
    />
  );
}
