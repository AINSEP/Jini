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
      } else if (e.key === 'Escape') {
        if (isPreviewOpen) return; // the preview surface owns Escape while it's open
        if (hasSelection) onClearSelection();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (typing || isPreviewOpen || !hasSelection) return;
        e.preventDefault();
        onRequestDeleteSelected();
      }
    },
  }, { enabled: active });
}
