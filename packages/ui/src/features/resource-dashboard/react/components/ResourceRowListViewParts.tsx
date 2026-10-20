import { ResourceMetrics } from './ResourceMetrics.js';
import { ResourceRowListItem } from './ResourceRowListItem.js';
import type { ResourceRowListViewProps } from './ResourceRowListView.js';

/** TasksView's hero header: eyebrow + title + lede, the metric tiles, and the primary create CTA (only when there is both a handler and a label). */
export function ResourceRowListHero({
  eyebrow,
  title,
  lede,
  metrics,
  metricsAriaLabel,
  createLabel,
  onCreate,
}: Pick<ResourceRowListViewProps, 'eyebrow' | 'title' | 'lede' | 'metrics' | 'metricsAriaLabel' | 'createLabel' | 'onCreate'>) {
  return (
    <header className="resource-row-list-hero">
      <div className="resource-row-list-hero-copy">
        {eyebrow ? <span className="resource-row-list-hero-eyebrow">{eyebrow}</span> : null}
        <h1 className="resource-row-list-hero-title">{title}</h1>
        {lede ? <p className="resource-row-list-hero-lede">{lede}</p> : null}
      </div>
      <div className="resource-row-list-hero-actions">
        <ResourceMetrics metrics={metrics} ariaLabel={metricsAriaLabel} />
        {onCreate && createLabel ? (
          <button type="button" className="resource-row-list-new" onClick={onCreate}>
            {createLabel}
          </button>
        ) : null}
      </div>
    </header>
  );
}

/** The LOAD-failure banner and, independently, the row-action-failure banner (which sits ALONGSIDE the still-visible row list). */
export function ResourceRowListAlerts({
  error,
  errorLabel,
  actionError,
  actionErrorLabel,
}: Pick<ResourceRowListViewProps, 'error' | 'errorLabel' | 'actionError' | 'actionErrorLabel'>) {
  return (
    <>
      {error ? (
        <div className="resource-row-list-error" role="alert">
          {errorLabel ?? error}
        </div>
      ) : null}

      {actionError ? (
        <div className="resource-row-list-action-error" role="alert">
          {actionErrorLabel ?? actionError}
        </div>
      ) : null}
    </>
  );
}

/** The empty state — TasksView's own empty state is itself the create button, so it is clickable only when `onCreate` is given. */
export function ResourceRowListEmpty({ emptyTitle, emptyBody, onCreate }: Pick<ResourceRowListViewProps, 'emptyTitle' | 'emptyBody' | 'onCreate'>) {
  return onCreate ? (
    <button type="button" className="resource-row-list-empty" onClick={onCreate}>
      <strong>{emptyTitle}</strong>
      <span>{emptyBody}</span>
    </button>
  ) : (
    <div className="resource-row-list-empty">
      <strong>{emptyTitle}</strong>
      <span>{emptyBody}</span>
    </div>
  );
}

/** The `<ul>` of `ResourceRowListItem`s, binding each row's id into its per-row callbacks and busy/expanded/history-loading state. */
export function ResourceRowListRows({
  rows,
  isRowBusy,
  statusLabel,
  toneMap,
  canExpandHistory,
  expandedRowId,
  historyLoadingRowId,
  historyByRowId,
  showHistoryLabel,
  hideHistoryLabel,
  historyTitleLabel,
  historyLoadingLabel,
  historyEmptyLabel,
  onToggleExpand,
  onRowAction,
  onHistoryItemAction,
}: Pick<
  ResourceRowListViewProps,
  | 'rows'
  | 'isRowBusy'
  | 'statusLabel'
  | 'toneMap'
  | 'canExpandHistory'
  | 'expandedRowId'
  | 'historyLoadingRowId'
  | 'historyByRowId'
  | 'showHistoryLabel'
  | 'hideHistoryLabel'
  | 'historyTitleLabel'
  | 'historyLoadingLabel'
  | 'historyEmptyLabel'
  | 'onToggleExpand'
  | 'onRowAction'
  | 'onHistoryItemAction'
>) {
  return (
    <ul className="resource-row-list-items">
      {rows.map((row) => (
        <ResourceRowListItem
          key={row.id}
          row={row}
          busy={isRowBusy(row.id)}
          statusLabel={statusLabel}
          {...(toneMap ? { toneMap } : {})}
          canExpandHistory={canExpandHistory}
          expanded={expandedRowId === row.id}
          showHistoryLabel={showHistoryLabel}
          hideHistoryLabel={hideHistoryLabel}
          historyItems={historyByRowId[row.id]}
          historyLoading={historyLoadingRowId === row.id}
          historyTitleLabel={historyTitleLabel}
          historyLoadingLabel={historyLoadingLabel}
          historyEmptyLabel={historyEmptyLabel}
          onToggleExpand={() => onToggleExpand(row.id)}
          onAction={(kind) => onRowAction(row.id, kind)}
          {...(onHistoryItemAction ? { onHistoryItemAction: (historyItemId: string, kind: string) => onHistoryItemAction(row.id, historyItemId, kind) } : {})}
        />
      ))}
    </ul>
  );
}
