import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { computeMenuPosition, type MenuAnchorRect } from '../../rules.js';
import type { AssetTreeDomBridgePort } from '../../ports.js';
import type { AssetTreeMenuPosition } from '../../types.js';

export interface UseAssetTreeRowMenuResult {
  menuPos: AssetTreeMenuPosition | null;
  /** Attach to the popover's root element — used as the outside-dismiss containment box. */
  containerRef: RefObject<HTMLDivElement | null>;
  openMenuFor: (path: string, anchor: MenuAnchorRect) => void;
  closeMenu: () => void;
}

/**
 * The row `⋯` context menu's open/positioned/dismiss state. Positioning is
 * the pure viewport-flip math from `rules.ts`'s `computeMenuPosition`;
 * dismissal (outside pointerdown or Escape) is wired through the
 * `AssetTreeDomBridgePort` so it stays fake-able in tests.
 */
export function useAssetTreeRowMenu(dom: AssetTreeDomBridgePort): UseAssetTreeRowMenuResult {
  const [menuPos, setMenuPos] = useState<AssetTreeMenuPosition | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const openMenuFor = useCallback(
    (path: string, anchor: MenuAnchorRect) => {
      const { top, left } = computeMenuPosition(anchor, dom.getViewportHeight());
      setMenuPos({ path, top, left });
    },
    [dom],
  );

  const closeMenu = useCallback(() => setMenuPos(null), []);

  useEffect(() => {
    if (!menuPos) return undefined;
    return dom.subscribeOutsideDismiss(containerRef, closeMenu);
  }, [menuPos, dom, closeMenu]);

  return { menuPos, containerRef, openMenuFor, closeMenu };
}
