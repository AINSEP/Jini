import { useCallback, useState } from 'react';
import { DEFAULT_ZOOM, DEFAULT_ZOOM_LEVELS } from '../../constants.js';
import { zoomToScale } from '../../rules.js';

export interface ZoomController {
  /** Current zoom, as a whole-number percentage (100 = actual size). */
  zoom: number;
  /** `zoom / 100`, ready to use as a CSS transform scale factor. */
  scale: number;
  isMenuOpen: boolean;
  /** The preset levels offered in the dropdown. */
  levels: readonly number[];
  toggleMenu(): void;
  closeMenu(): void;
  /** Sets zoom to `level` and closes the menu, matching the source's "pick and dismiss" click behavior. */
  setZoom(level: number): void;
}

/** Pure client-side zoom-percentage state — no transport, no host dependency. */
export function useZoomControl(
  levels: readonly number[] = DEFAULT_ZOOM_LEVELS,
  initialZoom: number = DEFAULT_ZOOM,
): ZoomController {
  const [zoom, setZoomState] = useState(initialZoom);
  const [isMenuOpen, setMenuOpen] = useState(false);

  const setZoom = useCallback((level: number) => {
    setZoomState(level);
    setMenuOpen(false);
  }, []);

  return {
    zoom,
    scale: zoomToScale({ zoom }),
    isMenuOpen,
    levels,
    toggleMenu: useCallback(() => setMenuOpen((value) => !value), []),
    closeMenu: useCallback(() => setMenuOpen(false), []),
    setZoom,
  };
}
