import { useGlobalKeydown } from '../../../../browser/index.js';
import { isTypingTarget } from '../../rules.js';

export interface UseAssetGridKeyboardShortcutsParams {
  active: boolean;
  /** False while a modal/menu the grid doesn't own (upload dialog, a host menu) should own keyboard shortcuts instead. */
  enabled: boolean;
  hasAssets: boolean;
  hasSelection: boolean;
  /** True while a host-owned preview surface is open and should own Escape/Delete instead. */
  isPreviewOpen: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRequestDeleteSelected: () => void;
}

function handleSelectionKey(
  { event, typing, hasSelection, isPreviewOpen, onClearSelection, onRequestDeleteSelected }: Pick<
    UseAssetGridKeyboardShortcutsParams,
    'hasSelection' | 'isPreviewOpen' | 'onClearSelection' | 'onRequestDeleteSelected'
  > & {
    event: KeyboardEvent;
    typing: boolean;
  },
  _options: Record<string, never> = {},
): void {
  if (event.key === 'Escape') {
    if (isPreviewOpen) return; // the preview surface owns Escape while it's open
    if (hasSelection) onClearSelection();
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    if (typing || isPreviewOpen || !hasSelection) return;
    event.preventDefault();
    onRequestDeleteSelected();
  }
}

/** Cmd/Ctrl+A select-all, Escape clear-selection, Delete/Backspace triggers the bulk-delete confirm flow. */
export function useAssetGridKeyboardShortcuts(params: UseAssetGridKeyboardShortcutsParams): void {
  const {
    active,
    enabled,
    hasAssets,
    hasSelection,
    isPreviewOpen,
    onSelectAll,
    onClearSelection,
    onRequestDeleteSelected,
  } = params;

  useGlobalKeydown({
    handler: (e) => {
      if (!enabled) return;
      const typing = isTypingTarget(document.activeElement);
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        if (typing || !hasAssets) return;
        e.preventDefault();
        onSelectAll();
      } else {
        handleSelectionKey({ event: e, typing, hasSelection, isPreviewOpen, onClearSelection, onRequestDeleteSelected });
      }
    },
  }, { enabled: active });
}
