// Pointer-drag-resizable split pane: one side has a persisted, clamped width;
// the split container exposes a `style` with the CSS custom properties/grid
// columns needed to render both panes plus a handle. RAF-throttled pointer
// tracking, RTL-aware, keyboard-resizable (arrow keys/Home/End on the handle),
// ResizeObserver-clamped so the primary pane's max width shrinks with the
// container instead of overflowing it, localStorage-persisted (skipped
// entirely outside the browser or when storage is unavailable). Not tied to
// any one feature domain — feature-local hooks live inside their own
// `features/<domain>/react/hooks/` instead.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

export interface UseResizableSplitPaneOptions {
  /** localStorage key the last-committed width persists under. Omit to use a generic, package-neutral default key. */
  storageKey?: string;
  /** Width (px) used before any persisted value is read, and as the Home-key target. Default 460. */
  defaultWidth?: number;
  /** Hard floor (px) the primary pane's width is clamped to. Default 345. */
  minWidth?: number;
  /** Hard ceiling (px) the primary pane's width is clamped to, before container-width narrowing. Default 720. */
  maxWidth?: number;
  /** Width (px) reserved for the drag handle itself in the computed grid-template-columns. Default 8. */
  handleWidth?: number;
  /** Minimum width (px) the secondary pane keeps; the primary pane's effective max shrinks to preserve it. Default 400. */
  minSecondaryWidth?: number;
  /** Pixels moved per ArrowLeft/ArrowRight keypress on the handle. Default 16. */
  keyboardStep?: number;
}

export interface ResizableSplitPaneController {
  /** The primary pane's current committed width (px). */
  width: number;
  /** The primary pane's current effective max width (px), narrowed by container size. */
  maxWidth: number;
  /** The secondary pane's current effective min width (px); 0 once the container is too narrow to guarantee it. */
  secondaryMinWidth: number;
  /** True while a pointer drag is in progress. */
  isResizing: boolean;
  /** Attach to the split container element (the one whose grid-template-columns this hook manages). */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Attach to the drag handle element's onPointerDown. */
  onHandlePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Attach to the drag handle element's onKeyDown (ArrowLeft/ArrowRight/Home/End). */
  onHandleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** Attach to the drag handle element's onBlur — cancels an in-progress drag if focus leaves mid-resize. */
  onHandleBlur: () => void;
  /** Spread onto the split container: sets the CSS custom properties and grid-template-columns for the current width. */
  containerStyle: CSSProperties & {
    '--resizable-split-pane-primary-width': string;
    '--resizable-split-pane-secondary-track': string;
  };
}

const DEFAULT_STORAGE_KEY = 'jini.resizable-split-pane.width';

function clampPreferredWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width)));
}

function clampWidthForMax(width: number, min: number, max: number, effectiveMax: number): number {
  const clampedMax = Math.max(0, Math.min(max, Math.floor(effectiveMax)));
  const clampedMin = Math.min(min, clampedMax);
  return Math.min(clampedMax, Math.max(clampedMin, Math.round(width)));
}

// Exported (despite being module-private in spirit) so their `typeof window
// === 'undefined'` SSR guards can be exercised for real under a
// `@vitest-environment node` companion test — this package's default jsdom
// environment always defines `window`, so that branch is otherwise
// unreachable. See `useResizableSplitPane.ssr.test.ts`.
export function readSavedWidth(storageKey: string, defaultWidth: number, min: number, max: number): number {
  if (typeof window === 'undefined') return defaultWidth;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) ? clampPreferredWidth(parsed, min, max) : defaultWidth;
  } catch {
    return defaultWidth;
  }
}

export function saveWidth(storageKey: string, width: number, min: number, max: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, String(clampPreferredWidth(width, min, max)));
  } catch {
    // localStorage can be unavailable in hardened browser contexts.
  }
}

function applyContainerWidth(
  container: HTMLDivElement | null,
  width: number,
  secondaryTrack: string,
  handleWidth: number,
): void {
  if (!container) return;
  container.style.setProperty('--resizable-split-pane-primary-width', `${width}px`);
  container.style.gridTemplateColumns = `${width}px ${handleWidth}px ${secondaryTrack}`;
}

export function useResizableSplitPane(
  options: UseResizableSplitPaneOptions = {},
): ResizableSplitPaneController {
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const defaultWidth = options.defaultWidth ?? 460;
  const minWidth = options.minWidth ?? 345;
  const maxWidthOption = options.maxWidth ?? 720;
  const handleWidth = options.handleWidth ?? 8;
  const minSecondaryWidth = options.minSecondaryWidth ?? 400;
  const keyboardStep = options.keyboardStep ?? 16;
  const minNormalContainerWidth = minWidth + handleWidth + minSecondaryWidth;

  const [width, setWidth] = useState(() => readSavedWidth(storageKey, defaultWidth, minWidth, maxWidthOption));
  const [maxWidth, setMaxWidth] = useState(maxWidthOption);
  const [secondaryMinWidth, setSecondaryMinWidth] = useState(minSecondaryWidth);
  const [isResizing, setIsResizing] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef(width);
  const preferredWidthRef = useRef(width);
  const resizeStartPreferredWidthRef = useRef(width);
  const maxWidthRef = useRef(maxWidth);
  const resizeStateRef = useRef<{
    startClientX: number;
    startWidth: number;
    isRtl: boolean;
    hasMoved: boolean;
  } | null>(null);
  const pointerCleanupRef = useRef<(() => void) | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const pendingPointerClientXRef = useRef<number | null>(null);

  const secondaryTrack = secondaryMinWidth === 0 ? 'minmax(0, 1fr)' : `minmax(${secondaryMinWidth}px, 1fr)`;

  const renderPreferredWidth = useCallback(
    (preferredWidth: number, effectiveMax = maxWidthRef.current, opts: { commitState?: boolean } = {}): number => {
      const next = clampWidthForMax(preferredWidth, minWidth, maxWidthOption, effectiveMax);
      widthRef.current = next;
      applyContainerWidth(containerRef.current, next, secondaryTrack, handleWidth);
      if (opts.commitState !== false) setWidth(next);
      return next;
    },
    [minWidth, maxWidthOption, secondaryTrack, handleWidth],
  );

  const applyWidth = useCallback(
    (nextWidth: number, opts: { commitState?: boolean } = {}): number => {
      const nextPreferred = clampPreferredWidth(
        clampWidthForMax(nextWidth, minWidth, maxWidthOption, maxWidthRef.current),
        minWidth,
        maxWidthOption,
      );
      preferredWidthRef.current = nextPreferred;
      return renderPreferredWidth(nextPreferred, maxWidthRef.current, opts);
    },
    [renderPreferredWidth, minWidth, maxWidthOption],
  );

  const finishResize = useCallback(
    (saveFinalWidth = true) => {
      pointerCleanupRef.current?.();
      pointerCleanupRef.current = null;
      if (pointerFrameRef.current !== null) {
        cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      pendingPointerClientXRef.current = null;
      resizeStateRef.current = null;
      setIsResizing(false);
      if (saveFinalWidth) {
        const finalWidth = renderPreferredWidth(preferredWidthRef.current);
        saveWidth(storageKey, finalWidth, minWidth, maxWidthOption);
      }
    },
    [renderPreferredWidth, storageKey, minWidth, maxWidthOption],
  );

  useEffect(() => {
    widthRef.current = width;
    applyContainerWidth(containerRef.current, width, secondaryTrack, handleWidth);
  }, [width, secondaryTrack, handleWidth]);

  useEffect(() => {
    maxWidthRef.current = maxWidth;
  }, [maxWidth]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const updateAllowedWidth = () => {
      const containerWidth = container.clientWidth;
      const unmeasured = !Number.isFinite(containerWidth) || containerWidth <= 0;
      const nextSecondaryMin = !unmeasured && containerWidth < minNormalContainerWidth ? 0 : minSecondaryWidth;
      const nextMax =
        unmeasured
          ? maxWidthOption
          : Math.max(0, Math.min(maxWidthOption, Math.floor(containerWidth - handleWidth - nextSecondaryMin)));
      maxWidthRef.current = nextMax;
      setSecondaryMinWidth(nextSecondaryMin);
      setMaxWidth(nextMax);
      renderPreferredWidth(preferredWidthRef.current, nextMax);
    };

    updateAllowedWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateAllowedWidth);
      observer.observe(container);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateAllowedWidth);
    return () => window.removeEventListener('resize', updateAllowedWidth);
  }, [renderPreferredWidth, minNormalContainerWidth, minSecondaryWidth, maxWidthOption, handleWidth]);

  useEffect(() => () => finishResize(false), [finishResize]);

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const container = containerRef.current;
      if (!container) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerCleanupRef.current?.();
      setIsResizing(true);
      resizeStartPreferredWidthRef.current = preferredWidthRef.current;

      const updateWidthFromClientX = (clientX: number) => {
        // Non-null assertion, not a guard: finishResize (the only place
        // resizeStateRef is cleared) always tears down the pointermove
        // listener that reaches this function in the same synchronous call
        // that clears the ref, and also cancels any pending RAF before
        // returning — so no queued pointermove/RAF callback can ever
        // observe a null state here.
        const state = resizeStateRef.current!;
        const delta = clientX - state.startClientX;
        if (delta === 0 && !state.hasMoved) return;
        state.hasMoved = true;
        const rawWidth = state.startWidth + (state.isRtl ? -delta : delta);
        applyWidth(rawWidth, { commitState: false });
      };

      const flushPendingPointerMove = () => {
        if (pointerFrameRef.current !== null) {
          cancelAnimationFrame(pointerFrameRef.current);
          pointerFrameRef.current = null;
        }
        const clientX = pendingPointerClientXRef.current;
        pendingPointerClientXRef.current = null;
        if (clientX !== null) updateWidthFromClientX(clientX);
      };

      resizeStateRef.current = {
        startClientX: event.clientX,
        startWidth: widthRef.current,
        isRtl: window.getComputedStyle(container).direction === 'rtl',
        hasMoved: false,
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        pendingPointerClientXRef.current = moveEvent.clientX;
        if (pointerFrameRef.current !== null) return;
        pointerFrameRef.current = requestAnimationFrame(() => {
          pointerFrameRef.current = null;
          flushPendingPointerMove();
        });
      };
      const handlePointerEnd = () => {
        flushPendingPointerMove();
        finishResize(true);
      };
      const handlePointerCancel = () => {
        flushPendingPointerMove();
        preferredWidthRef.current = resizeStartPreferredWidthRef.current;
        renderPreferredWidth(resizeStartPreferredWidthRef.current);
        finishResize(false);
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerEnd);
        window.removeEventListener('pointercancel', handlePointerCancel);
        window.removeEventListener('blur', handlePointerCancel);
      };

      pointerCleanupRef.current = cleanup;
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerEnd);
      window.addEventListener('pointercancel', handlePointerCancel);
      window.addEventListener('blur', handlePointerCancel);
    },
    [applyWidth, finishResize, renderPreferredWidth],
  );

  const onHandleBlur = useCallback(() => {
    if (!pointerCleanupRef.current) return;
    preferredWidthRef.current = resizeStartPreferredWidthRef.current;
    renderPreferredWidth(resizeStartPreferredWidthRef.current);
    finishResize(false);
  }, [finishResize, renderPreferredWidth]);

  const onHandleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      let nextWidth: number | null = null;
      const container = containerRef.current;
      const isRtl = container ? window.getComputedStyle(container).direction === 'rtl' : false;
      if (event.key === 'ArrowLeft') {
        nextWidth = widthRef.current + (isRtl ? 1 : -1) * keyboardStep;
      } else if (event.key === 'ArrowRight') {
        nextWidth = widthRef.current + (isRtl ? -1 : 1) * keyboardStep;
      } else if (event.key === 'Home') {
        nextWidth = minWidth;
      } else if (event.key === 'End') {
        nextWidth = maxWidthRef.current;
      }
      if (nextWidth === null) return;
      event.preventDefault();
      const next = applyWidth(nextWidth);
      saveWidth(storageKey, next, minWidth, maxWidthOption);
    },
    [applyWidth, keyboardStep, minWidth, maxWidthOption, storageKey],
  );

  return {
    width,
    maxWidth,
    secondaryMinWidth,
    isResizing,
    containerRef,
    onHandlePointerDown,
    onHandleKeyDown,
    onHandleBlur,
    containerStyle: {
      '--resizable-split-pane-primary-width': `${width}px`,
      '--resizable-split-pane-secondary-track': secondaryTrack,
      gridTemplateColumns: `${width}px ${handleWidth}px ${secondaryTrack}`,
    },
  };
}
