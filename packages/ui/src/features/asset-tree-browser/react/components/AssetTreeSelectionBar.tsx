import { useT } from '../../../i18n/index.js';

export interface AssetTreeSelectionBarProps {
  count: number;
  onClear: () => void;
  onDelete: () => void;
  deleting: boolean;
  /** Omit to hide the batch-download action entirely (no `downloadFiles` was supplied to `AssetTreeBrowser`). */
  onDownload?: (() => void) | undefined;
  downloading?: boolean | undefined;
  downloadError?: string | null | undefined;
  useTHook?: typeof useT;
}

/** The batch action bar shown above the listing whenever one or more rows are selected: an optional batch download, delete, and clear-selection. */
export function AssetTreeSelectionBar({
  count,
  onClear,
  onDelete,
  deleting,
  onDownload,
  downloading = false,
  downloadError = null,
  useTHook = useT,
}: AssetTreeSelectionBarProps) {
  const t = useTHook();

  return (
    <div className="jini-asset-tree-batch-bar" data-testid="asset-tree-batch-bar">
      <span className="jini-asset-tree-batch-count">{t('{n} selected', { n: count })}</span>
      <div className="jini-asset-tree-batch-actions">
        {onDownload ? (
          <button type="button" onClick={onDownload} disabled={downloading} aria-busy={downloading}>
            {t('Download')}
          </button>
        ) : null}
        <button
          type="button"
          className="danger"
          data-testid="asset-tree-batch-delete"
          disabled={deleting}
          aria-busy={deleting}
          onClick={onDelete}
        >
          {t('Delete')}
        </button>
        <button type="button" className="jini-asset-tree-batch-clear" onClick={onClear}>
          {t('Clear selection')}
        </button>
      </div>
      {downloadError ? (
        <div className="jini-asset-tree-batch-error" role="alert" data-testid="asset-tree-batch-download-error">
          {downloadError}
        </div>
      ) : null}
    </div>
  );
}
