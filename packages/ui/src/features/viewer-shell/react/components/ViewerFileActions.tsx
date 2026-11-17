import { useT } from '../../../i18n/index.js';

export interface ViewerFileActionsProps {
  /** Omit to hide the download link. */
  downloadUrl?: string;
  /** Omit to hide the open-in-new-tab link. */
  openUrl?: string;
  /** Passed straight to the anchor's `download` attribute. */
  fileName?: string;
  downloadLabel?: string;
  openLabel?: string;
  useTHook?: typeof useT;
}

/**
 * Generic "Download" / "Open" link pair. The source component built its URL
 * from a `projectFileUrl(projectId, file.name)` daemon route — that's
 * host-specific, so this version takes final, already-resolved URLs instead.
 */
export function ViewerFileActions({ downloadUrl, openUrl, fileName, downloadLabel, openLabel, useTHook = useT }: ViewerFileActionsProps) {
  const t = useTHook();
  if (!downloadUrl && !openUrl) return null;
  return (
    <div className="viewer-toolbar-actions">
      {downloadUrl ? (
        <a className="ghost-link" href={downloadUrl} download={fileName}>
          {downloadLabel ?? t('Download')}
        </a>
      ) : null}
      {openUrl ? (
        <a className="ghost-link" href={openUrl} target="_blank" rel="noreferrer noopener">
          {openLabel ?? t('Open')}
        </a>
      ) : null}
    </div>
  );
}
