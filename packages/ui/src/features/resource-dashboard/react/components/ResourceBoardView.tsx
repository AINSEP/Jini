import type { ReactNode, RefObject } from 'react';
import { ResourceBoardAlerts, ResourceBoardContent, ResourceBoardViewToolbar } from './ResourceBoardViewParts.js';
import type { ResourceKanbanColumn } from './ResourceKanbanBoard.js';
import type { ResourceBoardItem, ResourceBoardViewMode, ResourceSortOption, ResourceStatusToneMap } from '../../types.js';

export interface ResourceBoardViewProps<TBody = unknown> {
  loading: boolean;
  error: string | null;
  errorLabel?: string;
  /** A single-item delete/duplicate failure — rendered as its own alert ABOVE the item list, unlike `error`/`errorLabel` (the LOAD failure, which replaces the list entirely) since the already-loaded items must stay visible and actionable while this is shown. */
  actionError?: string | null;
  actionErrorLabel?: string;
  /** Whether the port returned any item at all, BEFORE search filtering — distinguishes "nothing exists yet" (with a create CTA) from "search matched nothing" (DesignsTab's own two distinct empty states). */
  hasAnyItems: boolean;
  items: ResourceBoardItem<TBody>[];
  kanbanColumns: readonly ResourceKanbanColumn<TBody>[];

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

  enableBulkDelete: boolean;
  selectMode: boolean;
  selected: ReadonlySet<string>;
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

  openMenuId: string | null;
  menuContainerRef?: RefObject<HTMLDivElement | null>;
  onToggleMenu: (id: string) => void;
  onItemAction: (id: string, kind: string) => void;
  isItemBusy: (id: string) => boolean;
  onOpenItem: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onKanbanDelete?: (id: string) => void;

  statusLabel: (status: string) => string;
  toneMap?: ResourceStatusToneMap;
  menuActionLabel?: (kind: string, fallback: string) => string;
  moreLabel: string;
  deleteLabel: string;
  deleteAriaLabel: (title: string) => string;
  emptyColumnLabel: string;
  emptyStateTitle: string;
  emptyStateNoMatch: string;
  renderBody?: (item: ResourceBoardItem<TBody>) => ReactNode;
}

/**
 * Pure composition (props in, JSX out): the toolbar, then either the empty
 * state, the card grid, or the kanban board — DesignsTab's own
 * `filtered.length === 0 ? empty : view === "grid" ? grid : kanban` branch.
 */
export function ResourceBoardView<TBody = unknown>(props: ResourceBoardViewProps<TBody>) {
  return (
    <div className={`resource-board${props.viewMode === 'kanban' ? ' is-kanban' : ''}`}>
      <ResourceBoardViewToolbar {...props} />

      <ResourceBoardAlerts {...props} />

      <ResourceBoardContent {...props} />
    </div>
  );
}
