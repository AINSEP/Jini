import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { useWiredResourceBoard } from '../hooks/useResourceBoard.js';
import { ResourceBoardView } from './ResourceBoardView.js';
import { boardCreateProps, buildKanbanColumns, createItemActionHandler, resourceBoardHookParams, statusLabelFor } from './resourceBoardProps.js';
import { translatedErrorLabelProps } from './translatedErrorLabelProps.js';
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
  const board = useWiredResourceBoardHook<TItem>(
    resourceBoardHookParams<TItem>(
      { dependencies, statusOptions },
      { defaultStatus, normalizeStatus, initialSort, storageScopeKey, defaultViewMode, refreshToken },
    ),
  );
  const kanbanColumns = buildKanbanColumns<TItem, TBody>({ statusOptions, columns: board.kanbanColumns, t });
  const handleItemAction = createItemActionHandler({ board }, { onRenameRequest, onCustomItemAction });

  return (
    <ResourceBoardView
      loading={board.loading}
      error={board.error}
      actionError={board.actionError}
      {...translatedErrorLabelProps({ t, error: board.error, actionError: board.actionError })}
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
      {...boardCreateProps({ t }, { createLabel, onCreate })}
      openMenuId={board.openMenuId}
      menuContainerRef={board.menuContainerRef}
      onToggleMenu={board.toggleMenu}
      onItemAction={handleItemAction}
      isItemBusy={board.isItemBusy}
      onOpenItem={onOpenItem}
      onToggleSelected={board.toggleSelected}
      onKanbanDelete={(id) => void board.remove(id)}
      statusLabel={statusLabelFor({ t, statusOptions })}
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
