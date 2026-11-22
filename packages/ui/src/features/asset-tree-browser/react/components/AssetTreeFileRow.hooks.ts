import { useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { isDoubleActivation } from '../../rules.js';
import type { AssetTreeFileRowProps } from './AssetTreeFileRow.js';

/** Preserve the keyboard double-activation window and menu anchor for this row. */
export function useAssetTreeFileRow({ path, onOpen, onSelectPreview, onOpenMenu }: Pick<AssetTreeFileRowProps, 'path' | 'onOpen' | 'onSelectPreview' | 'onOpenMenu'>, _options = {}) {
  const lastActivationRef = useRef<number | undefined>(undefined);
  function handleNameKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const now = Date.now();
    if (isDoubleActivation({ lastTimestampMs: lastActivationRef.current, nowMs: now })) {
      lastActivationRef.current = undefined;
      onOpen(path);
    } else {
      lastActivationRef.current = now;
      onSelectPreview(path);
    }
  }
  function handleMenuTrigger(event: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>) {
    event.stopPropagation();
    onOpenMenu(path, event.currentTarget.getBoundingClientRect());
  }
  return { handleNameKeyDown, handleMenuTrigger };
}
