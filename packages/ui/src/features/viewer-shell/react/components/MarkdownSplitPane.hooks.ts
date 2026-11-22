import type { UseMarkdownScrollSyncResult } from '../hooks/useMarkdownScrollSync.js';

/** Mark the preview as the source of the next synchronized scroll. */
export function createMarkdownPreviewActivator({ activatePane }: { activatePane: UseMarkdownScrollSyncResult['activatePane'] }, _options = {}) {
  return () => activatePane('preview');
}
