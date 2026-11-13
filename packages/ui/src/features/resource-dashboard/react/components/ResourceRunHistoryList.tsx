import { StatusPill } from './StatusPill.js';
import type { ResourceRunHistoryItem, ResourceStatusToneMap } from '../../types.js';

export interface ResourceRunHistoryListProps {
  /** `undefined` while the first fetch for this expansion hasn't resolved yet. */
  items: ResourceRunHistoryItem[] | undefined;
  loading: boolean;
  titleLabel: string;
  loadingLabel: string;
  emptyLabel: string;
  statusLabel: (status: string) => string;
  toneMap?: ResourceStatusToneMap;
  onAction?: (historyItemId: string, actionKind: string) => void;
}

/**
 * A row's expandable run-history sublist — TasksView's
 * `AutomationRunHistory`: a small header, a loading/empty state, or a flat
 * list of past runs each showing a `StatusPill` + timing + an optional
 * error/summary message + host-defined actions (the origin's "crystallize"/
 * "view progress" buttons, generalized — see `archived UI source map`
 * for what crystallize's own OD-specific workflow dropped).
 */
export function ResourceRunHistoryList({
  items,
  loading,
  titleLabel,
  loadingLabel,
  emptyLabel,
  statusLabel,
  toneMap,
  onAction,
}: ResourceRunHistoryListProps) {
  if (loading || items === undefined) {
    return (
      <div className="resource-row-history resource-row-history-empty" data-testid="resource-row-history">
        {loadingLabel}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="resource-row-history resource-row-history-empty" data-testid="resource-row-history">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="resource-row-history" data-testid="resource-row-history">
      <div className="resource-row-history-head">
        <span>{titleLabel}</span>
      </div>
      <ul className="resource-row-history-list">
        {items.map((item) => (
          <li key={item.id} className="resource-row-history-row">
            <div className="resource-row-history-status">
              <StatusPill status={item.status} label={statusLabel(item.status)} {...(toneMap ? { toneMap } : {})} />
              <span>{item.startedAtLabel}</span>
              {item.durationLabel ? <span>{item.durationLabel}</span> : null}
            </div>
            {item.message ? (
              <div className={`resource-row-history-message${item.isError ? ' is-error' : ''}`}>{item.message}</div>
            ) : null}
            {item.actions && item.actions.length > 0 ? (
              <div className="resource-row-history-actions">
                {item.actions.map((action) => (
                  <button
                    key={action.kind}
                    type="button"
                    className={action.danger ? 'danger' : undefined}
                    disabled={action.disabled}
                    onClick={() => onAction?.(item.id, action.kind)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
