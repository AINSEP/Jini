import { useCallback, useState } from 'react';
import { COPY_LOCAL_PATH_CONFIRM_MS } from '../../constants.js';
import type { AssetTreeClipboardPort } from '../../ports.js';

export interface UseAssetTreeCopyLocalPathResult {
  /** The path whose "Copied" confirmation is currently showing, or `null`. */
  copiedPath: string | null;
  copyLocalPath: (path: string, localPath: string) => Promise<void>;
}

/**
 * Row menu's "copy local path" action: copies via the clipboard port and
 * shows a transient "Copied" confirmation for `confirmMs` (defaults to
 * {@link COPY_LOCAL_PATH_CONFIRM_MS}, matching the origin's 1600ms).
 */
export function useAssetTreeCopyLocalPath(
  clipboard: AssetTreeClipboardPort,
  confirmMs: number = COPY_LOCAL_PATH_CONFIRM_MS,
): UseAssetTreeCopyLocalPathResult {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const copyLocalPath = useCallback(
    async (path: string, localPath: string) => {
      const copied = await clipboard.copyToClipboard({ text: localPath });
      if (!copied) return;
      setCopiedPath(path);
      setTimeout(() => {
        setCopiedPath((current) => (current === path ? null : current));
      }, confirmMs);
    },
    [clipboard, confirmMs],
  );

  return { copiedPath, copyLocalPath };
}
