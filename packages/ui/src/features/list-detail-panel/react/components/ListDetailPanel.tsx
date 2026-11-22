import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { findSelectedItem } from '../../rules.js';
import type { ListDetailItem, ListDetailItemRenderState } from '../../types.js';

export interface ListDetailPanelProps<TItem extends ListDetailItem> {
  /** The rows shown in the sidebar list (already filtered/scoped by the host). */
  items: readonly TItem[];
  /** The currently previewed row's id, or `null` for no selection. */
  selectedId: string | null;
  /** Fired when a row is clicked. */
  onSelect: (id: string) => void;
  /** Renders a row's visual content; the panel supplies the interactive wrapper. */
  renderItem: (item: TItem, state: ListDetailItemRenderState) => ReactNode;
  /** Renders the detail pane for the currently selected item. */
  renderDetail: (item: TItem) => ReactNode;
  /** Optional accessible label override for a row's button (defaults to the row's own text content). */
  getItemAriaLabel?: (item: TItem) => string;
  /** Slot above the list — search box, scope tabs, facet filters, a "create" button, etc. */
  header?: ReactNode;
  /** Shown in the sidebar when `items` is empty. */
  emptyListContent?: ReactNode;
  /** Shown in the detail pane when nothing is selected (including an empty list). */
  emptyDetailContent?: ReactNode;
  /** Replaces the sidebar list and detail pane with host-supplied loading placeholders. */
  loading?: boolean;
  loadingSidebarContent?: ReactNode;
  loadingDetailContent?: ReactNode;
  className?: string;
  sidebarClassName?: string;
  listClassName?: string;
  detailClassName?: string;
  itemClassName?: string | ((item: TItem, state: ListDetailItemRenderState) => string);
  'data-testid'?: string;
}

const join = (...classes: Array<string | undefined | false>) => classes.filter(Boolean).join(' ');

/** Busy status region shown in the sidebar or detail pane while the host is loading. */
function LoadingRegion({ variant, testId, children, useTHook = useT }: { variant: 'sidebar' | 'detail'; testId: string; children: ReactNode; useTHook?: typeof useT; }) {
  const t = useTHook();
  return (
    <div
      className={`jini-list-detail-panel-loading-${variant}`}
      role="status"
      aria-busy="true"
      aria-label={t('Loading')}
      data-testid={`${testId}-loading-${variant}`}
    >
      {children}
    </div>
  );
}

/** One selectable row button in the sidebar list. */
function ListItemButton<TItem extends ListDetailItem>({ item, testId, active, itemClassName, getItemAriaLabel, onSelect, renderItem }: {
  item: TItem; testId: string; active: boolean;
  itemClassName: ListDetailPanelProps<TItem>['itemClassName']; getItemAriaLabel: ListDetailPanelProps<TItem>['getItemAriaLabel'];
  onSelect: ListDetailPanelProps<TItem>['onSelect']; renderItem: ListDetailPanelProps<TItem>['renderItem'];
}) {
  const state: ListDetailItemRenderState = { active };
  const resolvedItemClassName = typeof itemClassName === 'function' ? itemClassName(item, state) : itemClassName;
  return (
    <button
      type="button"
      className={join('jini-list-detail-panel-item', active && 'jini-list-detail-panel-item-active', resolvedItemClassName)}
      aria-pressed={active}
      aria-label={getItemAriaLabel?.(item)}
      data-active={active}
      data-testid={`${testId}-item-${item.id}`}
      onClick={() => onSelect(item.id)}
    >
      {renderItem(item, state)}
    </button>
  );
}

/**
 * Generic master-detail (list+preview) navigator shell: a sidebar list of
 * summary rows with a selection state, and a detail pane rendering whichever
 * row is selected. Dumb/presentational — selection state lives in
 * {@link useListDetailSelection} (or the host's own state), not here.
 */
export function ListDetailPanel<TItem extends ListDetailItem>({
  items, selectedId, onSelect, renderItem, renderDetail, getItemAriaLabel, header, emptyListContent, emptyDetailContent,
  loading = false, loadingSidebarContent, loadingDetailContent,
  className, sidebarClassName, listClassName, detailClassName, itemClassName,
  'data-testid': testId = 'list-detail-panel',
}: ListDetailPanelProps<TItem>) {
  const selectedItem = findSelectedItem({ items, selectedId });

  return (
    <div className={join('jini-list-detail-panel', className)} data-testid={testId}>
      <aside className={join('jini-list-detail-panel-sidebar', sidebarClassName)} data-testid={`${testId}-sidebar`}>
        {header}
        {loading ? (
          <LoadingRegion variant="sidebar" testId={testId}>{loadingSidebarContent}</LoadingRegion>
        ) : (
          <div className={join('jini-list-detail-panel-list', listClassName)} data-testid={`${testId}-list`}>
            {items.length === 0
              ? emptyListContent
              : items.map((item) => (
                  <ListItemButton
                    key={item.id} item={item} testId={testId} active={item.id === selectedId} itemClassName={itemClassName}
                    getItemAriaLabel={getItemAriaLabel} onSelect={onSelect} renderItem={renderItem}
                  />
                ))}
          </div>
        )}
      </aside>

      <section className={join('jini-list-detail-panel-detail', detailClassName)} data-testid={`${testId}-detail`}>
        {loading ? (
          <LoadingRegion variant="detail" testId={testId}>{loadingDetailContent}</LoadingRegion>
        ) : null}
        {!loading && selectedItem ? renderDetail(selectedItem) : null}
        {!loading && !selectedItem ? emptyDetailContent : null}
      </section>
    </div>
  );
}
