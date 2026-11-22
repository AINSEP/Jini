export type {
  ResourceBoardItem,
  ResourceBoardViewMode,
  ResourceMenuActionSpec,
  ResourceMetric,
  ResourceRowAction,
  ResourceRowItem,
  ResourceRunHistoryItem,
  ResourceSortOption,
  ResourceStatusOption,
  ResourceStatusTone,
  ResourceStatusToneMap,
} from './types.js';

export { DEFAULT_BOARD_VIEW_MODE, DEFAULT_STATUS_TONE, UNMATCHED_STATUS_BUCKET } from './constants.js';

// `isActionPending`/`pendingActionKey`/`withPendingAction`/`withoutPendingAction`
// have one shared implementation in `utils/pending-actions.ts` and are not
// re-exported here: `features/source-config-list` already exports their
// positional adapters through the top-level barrel. Re-exporting these names
// here would create an ambiguous export at `src/index.ts`.
export { filterBoardItemsByQuery, groupItemsByStatus, pruneSelectedIds, sortBoardItems, statusToneFor, toggleSelectedId } from './rules.js';

export type {
  ResourceBoardDependencies,
  ResourceBoardPort,
  ResourceRowListDependencies,
  ResourceRowListPort,
  ResourceViewModeStoragePort,
} from './ports.js';

export {
  createFakeResourceBoardDependencies,
  createFakeResourceBoardPort,
  createFakeResourceRowListDependencies,
  createFakeResourceRowListPort,
  createLocalStorageViewModeStorage,
} from './dependencies.js';
export type { FakeResourceBoardPortOptions, FakeResourceRowListPortOptions } from './dependencies.js';

export { useResourceBoard, useWiredResourceBoard } from './react/hooks/useResourceBoard.js';
export type {
  ResourceBoardController,
  UseResourceBoardParams,
  UseWiredResourceBoardParams,
} from './react/hooks/useResourceBoard.js';

export { useResourceRowList, useWiredResourceRowList } from './react/hooks/useResourceRowList.js';
export type {
  ResourceRowListController,
  UseResourceRowListParams,
  UseWiredResourceRowListParams,
} from './react/hooks/useResourceRowList.js';

export { StatusPill } from './react/components/StatusPill.js';
export type { StatusPillProps } from './react/components/StatusPill.js';
export { ResourceMetrics } from './react/components/ResourceMetrics.js';
export type { ResourceMetricsProps } from './react/components/ResourceMetrics.js';

export { ResourceCard } from './react/components/ResourceCard.js';
export type { ResourceCardProps } from './react/components/ResourceCard.js';
export { ResourceKanbanBoard } from './react/components/ResourceKanbanBoard.js';
export type { ResourceKanbanBoardProps, ResourceKanbanColumn } from './react/components/ResourceKanbanBoard.js';
export { ResourceBoardToolbar } from './react/components/ResourceBoardToolbar.js';
export type { ResourceBoardToolbarProps } from './react/components/ResourceBoardToolbar.js';
export { ResourceBoardView } from './react/components/ResourceBoardView.js';
export type { ResourceBoardViewProps } from './react/components/ResourceBoardView.js';
export { ResourceBoard } from './react/components/ResourceBoard.js';
export type { ResourceBoardProps } from './react/components/ResourceBoard.js';

export { ResourceRunHistoryList } from './react/components/ResourceRunHistoryList.js';
export type { ResourceRunHistoryListProps } from './react/components/ResourceRunHistoryList.js';
export { ResourceRowListItem } from './react/components/ResourceRowListItem.js';
export type { ResourceRowListItemProps } from './react/components/ResourceRowListItem.js';
export { ResourceRowListView } from './react/components/ResourceRowListView.js';
export type { ResourceRowListViewProps } from './react/components/ResourceRowListView.js';
export { ResourceRowList } from './react/components/ResourceRowList.js';
export type { ResourceRowListProps } from './react/components/ResourceRowList.js';
