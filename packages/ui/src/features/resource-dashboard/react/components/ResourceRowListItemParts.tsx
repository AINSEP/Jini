import { StatusPill } from './StatusPill.js';
import type { ResourceRowItem, ResourceStatusToneMap } from '../../types.js';

/** Title/meta/detail lines plus the last-run `StatusPill` + label of one `ResourceRowListItem`. */
export function ResourceRowListItemContent({
  row,
  statusLabel,
  toneMap,
}: {
  row: ResourceRowItem;
  statusLabel: (status: string) => string;
  toneMap: ResourceStatusToneMap | undefined;
}) {
  const toneMapProps = toneMap ? { toneMap } : {};
  return (
    <div className="resource-row-list-item-content">
      <span className="resource-row-list-item-title">{row.title}</span>
      {row.metaLine ? <span className="resource-row-list-item-meta">{row.metaLine}</span> : null}
      {row.detailLine ? <span className="resource-row-list-item-detail">{row.detailLine}</span> : null}
      {row.lastRunStatus ? (
        <span className="resource-row-list-item-last-run">
          <StatusPill status={row.lastRunStatus} label={statusLabel(row.lastRunStatus)} {...toneMapProps} />
          {row.lastRunLabel ? <span>{row.lastRunLabel}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

/** Always-visible inline action buttons (never a kebab menu, unlike `ResourceCard`) plus the optional history-expand toggle. */
export function ResourceRowListItemActions({
  row,
  busy,
  canExpandHistory,
  expanded,
  showHistoryLabel,
  hideHistoryLabel,
  onToggleExpand,
  onAction,
}: {
  row: ResourceRowItem;
  busy: boolean;
  canExpandHistory: boolean;
  expanded: boolean;
  showHistoryLabel: string;
  hideHistoryLabel: string;
  onToggleExpand: () => void;
  onAction: (kind: string) => void;
}) {
  return (
    <div className="resource-row-list-item-actions">
      {row.actions.map((action) => (
        <button
          key={action.kind}
          type="button"
          className={action.danger ? 'danger' : undefined}
          disabled={busy || action.disabled}
          onClick={() => onAction(action.kind)}
        >
          {action.label}
        </button>
      ))}
      {canExpandHistory ? (
        <button type="button" aria-expanded={expanded} onClick={onToggleExpand}>
          {expanded ? hideHistoryLabel : showHistoryLabel}
        </button>
      ) : null}
    </div>
  );
}
