import { ResourceRowListItemActions, ResourceRowListItemContent } from './ResourceRowListItemParts.js';
import { ResourceRunHistoryList } from './ResourceRunHistoryList.js';
import type { ResourceRowItem, ResourceRunHistoryItem, ResourceStatusToneMap } from '../../types.js';

export interface ResourceRowListItemProps {
  row: ResourceRowItem;
  busy: boolean;
  statusLabel: (status: string) => string;
  toneMap?: ResourceStatusToneMap;
  canExpandHistory: boolean;
  expanded: boolean;
  showHistoryLabel: string;
  hideHistoryLabel: string;
  historyItems: ResourceRunHistoryItem[] | undefined;
  historyLoading: boolean;
  historyTitleLabel: string;
  historyLoadingLabel: string;
  historyEmptyLabel: string;
  onToggleExpand: () => void;
  onAction: (kind: string) => void;
  onHistoryItemAction?: (historyItemId: string, actionKind: string) => void;
}

/**
 * One row in the flat "your automations"-shaped list — TasksView's
 * `automation-row`: title/meta/detail lines, a last-run `StatusPill` +
 * label, always-visible inline action buttons (never a kebab menu, unlike
 * `ResourceCard`), an optional history-expand toggle, and the expanded
 * `ResourceRunHistoryList` sublist.
 */
export function ResourceRowListItem({
  row,
  busy,
  statusLabel,
  toneMap,
  canExpandHistory,
  expanded,
  showHistoryLabel,
  hideHistoryLabel,
  historyItems,
  historyLoading,
  historyTitleLabel,
  historyLoadingLabel,
  historyEmptyLabel,
  onToggleExpand,
  onAction,
  onHistoryItemAction,
}: ResourceRowListItemProps) {
  return (
    <li className={`resource-row-list-item${row.paused ? ' is-paused' : ''}`} data-testid="resource-row-list-item">
      <div className="resource-row-list-item-main">
        <ResourceRowListItemContent row={row} statusLabel={statusLabel} toneMap={toneMap} />
      </div>
      <ResourceRowListItemActions
        row={row}
        busy={busy}
        canExpandHistory={canExpandHistory}
        expanded={expanded}
        showHistoryLabel={showHistoryLabel}
        hideHistoryLabel={hideHistoryLabel}
        onToggleExpand={onToggleExpand}
        onAction={onAction}
      />
      {expanded ? (
        <ResourceRunHistoryList
          items={historyItems}
          loading={historyLoading}
          titleLabel={historyTitleLabel}
          loadingLabel={historyLoadingLabel}
          emptyLabel={historyEmptyLabel}
          statusLabel={statusLabel}
          {...(toneMap ? { toneMap } : {})}
          {...(onHistoryItemAction ? { onAction: onHistoryItemAction } : {})}
        />
      ) : null}
    </li>
  );
}
