import { useT } from '../../../i18n/index.js';

export interface AssetTreeUploadErrorBannerProps {
  message: string;
  /** Omit to hide the Dismiss button (the error clears on its own next time — e.g. on the next successful drop). */
  onDismiss?: () => void;
  useTHook?: typeof useT;
}

/** A dismissible banner for a failed drag-drop-folder read (`useAssetTreeDragUpload`'s `dropReadError`). */
export function AssetTreeUploadErrorBanner({ message, onDismiss, useTHook = useT }: AssetTreeUploadErrorBannerProps) {
  const t = useTHook();

  return (
    <div className="jini-asset-tree-upload-banner" data-testid="asset-tree-upload-error-banner">
      <span>{message}</span>
      {onDismiss ? (
        <button type="button" data-testid="asset-tree-upload-error-dismiss" onClick={onDismiss}>
          {t('Dismiss')}
        </button>
      ) : null}
    </div>
  );
}
