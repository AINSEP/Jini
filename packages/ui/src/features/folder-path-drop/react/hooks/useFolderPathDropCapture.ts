import type { DragEvent } from 'react';
import { useStableHandler } from '../../../../react/hooks/useStableHandler.js';
import type { FolderPathDropPort } from '../../ports.js';
import { captureFolderPathDrop } from '../../rules.js';
import type { FolderPathDropInsertTargetRef } from '../../types.js';

export interface UseFolderPathDropCaptureOptions {
  /** The host's path lookup; `null`/`undefined` leaves every drop alone. Read at drop time, latest render wins. */
  readonly port: FolderPathDropPort | null | undefined;
  /** The text target, e.g. the ref a chat pane populates with its composer handle. */
  readonly composer: FolderPathDropInsertTargetRef;
  /**
   * Host follow-up for a swallowed folder drop, called after the text is inserted with every
   * recovered path in drop order. Never called for a drop that passed through.
   */
  readonly onFolderPaths?: (paths: readonly string[]) => void;
}

/**
 * A capture-phase drop handler (`onDropCapture`) that turns a folder drop into its path text via
 * `captureFolderPathDrop`. The returned handler's identity never changes, whatever the caller passes
 * each render, so a host that publishes it to another component (or lists it as an effect
 * dependency) is not re-triggered by re-renders.
 *
 * @complexity Time: O(n) in the number of dragged items per drop; space: O(n).
 */
export function useFolderPathDropCapture({
  port,
  composer,
  onFolderPaths,
}: UseFolderPathDropCaptureOptions): (event: DragEvent<Element>) => void {
  return useStableHandler((event: DragEvent<Element>) => {
    const paths = captureFolderPathDrop({ event, port, composer });
    if (paths.length > 0) onFolderPaths?.(paths);
  });
}
