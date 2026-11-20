import { useT } from '../../../i18n/index.js';
import type { AssetTreeToolbarAction } from '../../types.js';

export interface AssetTreeEmptyStateProps {
  /** Host-supplied calls to action (e.g. "New file", "Upload"). Defaults to none — this package ships no built-in action. */
  actions?: readonly AssetTreeToolbarAction[];
  useTHook?: typeof useT;
}

/** Shown when the current directory has no files, folders, or persisted (empty) folders at all. */
export function AssetTreeEmptyState({ actions = [], useTHook = useT }: AssetTreeEmptyStateProps) {
  const t = useTHook();

  return (
    <div className="jini-asset-tree-empty" data-testid="asset-tree-empty">
      <div className="jini-asset-tree-empty-pill">
        <span className="jini-asset-tree-empty-title">{t('No files yet')}</span>
        {actions.length > 0 ? (
          <div className="jini-asset-tree-empty-actions">
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                data-testid={action.testId}
                disabled={action.disabled}
                onClick={action.onSelect}
              >
                {t(action.label)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
