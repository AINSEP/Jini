import { ResourceRowListAlerts, ResourceRowListEmpty, ResourceRowListHero, ResourceRowListRows } from './ResourceRowListViewParts.js';
import type { ResourceMetric, ResourceRowItem, ResourceRunHistoryItem, ResourceStatusToneMap } from '../../types.js';

export interface ResourceRowListViewProps {
  eyebrow?: string;
  title: string;
  lede?: string;
  metrics: ResourceMetric[];
  metricsAriaLabel: string;
  createLabel?: string;
  onCreate?: () => void;

  loading: boolean;
  error: string | null;
  errorLabel?: string;
  /** A row-action failure — rendered as its own alert ALONGSIDE the row list (which stays visible and interactive), unlike `error`/`errorLabel` (the LOAD failure). */
  actionError?: string | null;
  actionErrorLabel?: string;

  sectionLabel: string;
  loadingLabel: string;
  emptyTitle: string;
  emptyBody: string;

  rows: ResourceRowItem[];
  isRowBusy: (id: string) => boolean;
  statusLabel: (status: string) => string;
  toneMap?: ResourceStatusToneMap;
  canExpandHistory: boolean;
  expandedRowId: string | null;
  historyLoadingRowId: string | null;
  historyByRowId: Record<string, ResourceRunHistoryItem[] | undefined>;
  showHistoryLabel: string;
  hideHistoryLabel: string;
  historyTitleLabel: string;
  historyLoadingLabel: string;
  historyEmptyLabel: string;
  onToggleExpand: (id: string) => void;
  onRowAction: (id: string, kind: string) => void;
  onHistoryItemAction?: (rowId: string, historyItemId: string, actionKind: string) => void;
}

/**
 * Pure composition (props in, JSX out): TasksView's hero header (eyebrow +
 * title + lede + metric tiles + a primary create CTA) followed by the flat
 * "your automations" row-list section — loading, a clickable empty state
 * (TasksView's own empty state is itself the create button), or the rows.
 * The template-gallery and proposals-review sections are deliberately NOT
 * part of this primitive — see `packages/ui/source-map.md`'s "Dropped"
 * list (create-flow and automation-evolution-specific concerns, no
 * DesignsTab analog at all).
 */
export function ResourceRowListView(props: ResourceRowListViewProps) {
  const { loading, rows, sectionLabel, loadingLabel } = props;
  const isEmpty = !loading && rows.length === 0;

  return (
    <section className="resource-row-list">
      <ResourceRowListHero {...props} />

      <ResourceRowListAlerts {...props} />

      <section className="resource-row-list-saved" aria-label={sectionLabel}>
        <div className="resource-row-list-section-head">
          <h2>{sectionLabel}</h2>
          {loading ? <span className="resource-row-list-section-meta">{loadingLabel}</span> : null}
        </div>

        {isEmpty ? <ResourceRowListEmpty {...props} /> : rows.length > 0 ? <ResourceRowListRows {...props} /> : null}
      </section>
    </section>
  );
}
