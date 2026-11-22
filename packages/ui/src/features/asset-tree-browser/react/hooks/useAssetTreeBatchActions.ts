import { useCallback, useState } from 'react';

export interface UseAssetTreeBatchActionsParams {
  selected: ReadonlySet<string>;
  onDeleteFiles: (paths: string[]) => Promise<void> | void;
  /** Omit to disable batch download entirely — the host owns the actual archive endpoint. */
  downloadFiles?: ((paths: string[]) => Promise<{ blob: Blob; filename: string }>) | undefined;
}

export interface UseAssetTreeBatchActionsResult {
  deleting: boolean;
  downloading: boolean;
  downloadError: string | null;
  deleteSelected: () => Promise<void>;
  downloadSelected: () => Promise<void>;
}

/** Triggers a browser "save as" for `blob` under `filename`, then revokes the object URL after a minute — long enough for a slow save-dialog to still resolve it. */
export function triggerBrowserDownload({ blob, filename }: { blob: Blob; filename: string }, _optional = {}): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Batch actions over the current selection: delete (busy-gated, and
 * deliberately does NOT clear `selected` itself on success or failure — the
 * origin `DesignFilesPanel`'s own comment explains why: "confirm-cancel and
 * all-fail paths should leave the user's selection intact for retry"; a
 * successful delete's paths are pruned automatically once the host's
 * `files` prop refreshes, via `useAssetTreeSelection`'s prune effect) and an
 * optional batch download that triggers a browser save for the host-built
 * archive blob.
 */
export function useAssetTreeBatchActions(params: UseAssetTreeBatchActionsParams): UseAssetTreeBatchActionsResult {
  const { selected, onDeleteFiles, downloadFiles } = params;
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const deleteSelected = useCallback(async () => {
    if (deleting) return;
    const paths = [...selected];
    if (paths.length === 0) return;
    setDeleting(true);
    try {
      await onDeleteFiles(paths);
    } finally {
      setDeleting(false);
    }
  }, [deleting, selected, onDeleteFiles]);

  const downloadSelected = useCallback(async () => {
    if (!downloadFiles || downloading) return;
    const paths = [...selected];
    if (paths.length === 0) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const { blob, filename } = await downloadFiles(paths);
      triggerBrowserDownload({ blob, filename });
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  }, [downloadFiles, downloading, selected]);

  return { deleting, downloading, downloadError, deleteSelected, downloadSelected };
}
