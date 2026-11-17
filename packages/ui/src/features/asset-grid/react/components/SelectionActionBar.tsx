import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';

export interface SelectionActionBarProps {
  selectedIds: string[];
  onSelectAll: () => void;
  onClear: () => void;
  onRequestDelete: () => void;
  /** Host-specific bulk actions (e.g. "add to design system"), rendered before the built-in Delete action. */
  renderBulkActions?: ((selectedIds: string[]) => ReactNode) | undefined;
  useTHook?: typeof useT;
}

export function SelectionActionBar({
  selectedIds,
  onSelectAll,
  onClear,
  onRequestDelete,
  renderBulkActions,
  useTHook = useT,
}: SelectionActionBarProps) {
  const t = useTHook();
  const count = selectedIds.length;

  return (
    <div className="asset-grid-selection-bar">
      <span className="asset-grid-selection-count">{t('{count} selected', { count })}</span>
      <button type="button" className="asset-grid-selection-link" onClick={onSelectAll}>
        {t('Select all')}
      </button>
      <button type="button" className="asset-grid-selection-link" onClick={onClear}>
        {t('Clear')}
      </button>
      <span className="asset-grid-selection-spacer" />
      {renderBulkActions ? renderBulkActions(selectedIds) : null}
      <button type="button" className="asset-grid-selection-delete" onClick={onRequestDelete}>
        {t('Delete {count}', { count })}
      </button>
    </div>
  );
}
