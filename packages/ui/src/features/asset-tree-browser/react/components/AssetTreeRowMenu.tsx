import type { RefObject } from 'react';
import { useT } from '../../../i18n/index.js';

export interface AssetTreeRowMenuDownload {
  href: string;
  /** Called when the download link is clicked — the orchestrator wires this to close the popover (the download itself happens natively via `href`/`download`). */
  onClick: () => void;
}

export interface AssetTreeRowMenuProps {
  path: string;
  displayName: string;
  top: number;
  left: number;
  /** Attach to this popover's root — the outside-dismiss containment box (see `useAssetTreeRowMenu`). */
  containerRef: RefObject<HTMLDivElement | null>;
  canCopyLocalPath: boolean;
  /** True while this path's "Copied" confirmation is showing. */
  copied: boolean;
  /** Omit to hide the Download action entirely (no `getFileUrl` was supplied to `AssetTreeBrowser`). */
  download?: AssetTreeRowMenuDownload | undefined;
  onOpen: () => void;
  onRename: () => void;
  onCopyLocalPath: () => void;
  onDelete: () => void;
  useTHook?: typeof useT;
}

/**
 * The row `⋯` context menu popover: open in tab / rename / copy local path
 * (disabled unless the host's `getLocalPath` selector resolves one) /
 * download (hidden unless the host supplies `getFileUrl`) / delete.
 * Positioning (`top`/`left`) is computed upstream by
 * `useAssetTreeRowMenu`/`computeMenuPosition`; this component is purely
 * presentational.
 */
export function AssetTreeRowMenu({
  path,
  displayName,
  top,
  left,
  containerRef,
  canCopyLocalPath,
  copied,
  download,
  onOpen,
  onRename,
  onCopyLocalPath,
  onDelete,
  useTHook = useT,
}: AssetTreeRowMenuProps) {
  const t = useTHook();

  return (
    <div
      ref={containerRef}
      data-testid="asset-tree-row-menu-popover"
      className="asset-tree-row-popover"
      style={{ top, left }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" onClick={onOpen}>
        {t('Open')}
      </button>
      <button type="button" onClick={onRename}>
        {t('Rename')}
      </button>
      <button type="button" disabled={!canCopyLocalPath} onClick={onCopyLocalPath}>
        {copied ? t('Copied') : t('Copy local path')}
      </button>
      {download ? (
        <a href={download.href} download={displayName} style={{ textDecoration: 'none' }}>
          <button type="button" onClick={download.onClick}>
            {t('Download')}
          </button>
        </a>
      ) : null}
      <button type="button" className="danger" data-testid={`asset-tree-row-delete-${path}`} onClick={onDelete}>
        {t('Delete')}
      </button>
    </div>
  );
}
