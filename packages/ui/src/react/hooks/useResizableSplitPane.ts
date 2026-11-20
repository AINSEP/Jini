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
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
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
// unreachable. See `packages/ui/src/react/hooks/__tests__/useResizableSplitPane.test.tsx`.
export function readSavedWidth({ storageKey, defaultWidth, min, max }: { storageKey: string; defaultWidth: number; min: number; max: number }, _optional = {}): number {
  if (typeof window === 'undefined') return defaultWidth;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) ? clampPreferredWidth(parsed, min, max) : defaultWidth;
  } catch {
    return defaultWidth;
  }
}

export function saveWidth({ storageKey, width, min, max }: { storageKey: string; width: number; min: number; max: number }, _optional = {}): void {
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

interface SplitPaneConfig {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidthOption: number;
  handleWidth: number;
  minSecondaryWidth: number;
  keyboardStep: number;
  minNormalContainerWidth: number;
}

function resolveSplitPaneConfig(options: UseResizableSplitPaneOptions): SplitPaneConfig {
  const minWidth = options.minWidth ?? 345;
  const handleWidth = options.handleWidth ?? 8;
  const minSecondaryWidth = options.minSecondaryWidth ?? 400;
  return {
    storageKey: options.storageKey ?? DEFAULT_STORAGE_KEY,
    defaultWidth: options.defaultWidth ?? 460,
    minWidth,
    maxWidthOption: options.maxWidth ?? 720,
    handleWidth,
    minSecondaryWidth,
    keyboardStep: options.keyboardStep ?? 16,
    minNormalContainerWidth: minWidth + handleWidth + minSecondaryWidth,
  };
}

type ApplyWidthOptions = { commitState?: boolean };

interface ContainerMeasurementDeps {
  config: SplitPaneConfig;
  containerRef: RefObject<HTMLDivElement | null>;
  preferredWidthRef: MutableRefObject<number>;
  maxWidthRef: MutableRefObject<number>;
  renderPreferredWidth: (preferredWidth: number, effectiveMax?: number) => number;
  setSecondaryMinWidth: (width: number) => void;
  setMaxWidth: (width: number) => void;
}

/** Re-derives the primary pane's max width (and the secondary's min) whenever the container resizes. */
function useContainerMeasurement({
  config,
  containerRef,
  preferredWidthRef,
  maxWidthRef,
  renderPreferredWidth,
  setSecondaryMinWidth,
  setMaxWidth,
}: ContainerMeasurementDeps) {
  const { maxWidthOption, handleWidth, minSecondaryWidth, minNormalContainerWidth } = config;

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
  }, [renderPreferredWidth, minNormalContainerWidth, minSecondaryWidth, maxWidthOption, handleWidth, containerRef, preferredWidthRef, maxWidthRef, setSecondaryMinWidth, setMaxWidth]);
}

/** The committed/preferred width, its container-narrowed max, and the CSS it renders into the container. */
function useSplitPaneWidth(config: SplitPaneConfig, containerRef: RefObject<HTMLDivElement | null>) {
  const { storageKey, defaultWidth, minWidth, maxWidthOption, handleWidth, minSecondaryWidth } = config;
  const [width, setWidth] = useState(() => readSavedWidth({ storageKey, defaultWidth, min: minWidth, max: maxWidthOption }));
  const [maxWidth, setMaxWidth] = useState(maxWidthOption);
  const [secondaryMinWidth, setSecondaryMinWidth] = useState(minSecondaryWidth);
  const widthRef = useRef(width);
  const preferredWidthRef = useRef(width);
  const maxWidthRef = useRef(maxWidth);

  const secondaryTrack = secondaryMinWidth === 0 ? 'minmax(0, 1fr)' : `minmax(${secondaryMinWidth}px, 1fr)`;

  const renderPreferredWidth = useCallback(
    (preferredWidth: number, effectiveMax = maxWidthRef.current, opts: ApplyWidthOptions = {}): number => {
      const next = clampWidthForMax(preferredWidth, minWidth, maxWidthOption, effectiveMax);
      widthRef.current = next;
      applyContainerWidth(containerRef.current, next, secondaryTrack, handleWidth);
      if (opts.commitState !== false) setWidth(next);
      return next;
    },
    [minWidth, maxWidthOption, secondaryTrack, handleWidth, containerRef],
  );

  const applyWidth = useCallback(
    (nextWidth: number, opts: ApplyWidthOptions = {}): number => {
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

  useEffect(() => {
    widthRef.current = width;
    applyContainerWidth(containerRef.current, width, secondaryTrack, handleWidth);
  }, [width, secondaryTrack, handleWidth, containerRef]);

  useEffect(() => {
    maxWidthRef.current = maxWidth;
  }, [maxWidth]);

  useContainerMeasurement({
    config, containerRef, preferredWidthRef, maxWidthRef, renderPreferredWidth, setSecondaryMinWidth, setMaxWidth,
  });

  return {
    width, maxWidth, secondaryMinWidth, secondaryTrack,
    widthRef, preferredWidthRef, maxWidthRef, renderPreferredWidth, applyWidth,
  };
}

interface DragRefs {
  widthRef: MutableRefObject<number>;
  preferredWidthRef: MutableRefObject<number>;
  resizeStartPreferredWidthRef: MutableRefObject<number>;
  resizeStateRef: MutableRefObject<{
    startClientX: number;
    startWidth: number;
    isRtl: boolean;
    hasMoved: boolean;
  } | null>;
  pointerCleanupRef: MutableRefObject<(() => void) | null>;
  pointerFrameRef: MutableRefObject<number | null>;
  pendingPointerClientXRef: MutableRefObject<number | null>;
}

function useDragRefs(widthRef: DragRefs['widthRef'], preferredWidthRef: DragRefs['preferredWidthRef']): DragRefs {
  const resizeStartPreferredWidthRef = useRef(preferredWidthRef.current);
  const resizeStateRef = useRef<DragRefs['resizeStateRef']['current']>(null);
  const pointerCleanupRef = useRef<(() => void) | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const pendingPointerClientXRef = useRef<number | null>(null);
  return useMemo(
    () => ({
      widthRef,
      preferredWidthRef,
      resizeStartPreferredWidthRef,
      resizeStateRef,
      pointerCleanupRef,
      pointerFrameRef,
      pendingPointerClientXRef,
    }),
    [widthRef, preferredWidthRef],
  );
}

/** Applies the last queued pointer X (RAF-throttled by the caller) to the pane width. */
function createPendingMoveFlusher({ refs, applyWidth }: {
  refs: DragRefs;
  applyWidth: (width: number, opts: ApplyWidthOptions) => number;
}) {
  const updateWidthFromClientX = (clientX: number) => {
    // Non-null assertion, not a guard: finishResize (the only place
    // resizeStateRef is cleared) always tears down the pointermove
    // listener that reaches this function in the same synchronous call
    // that clears the ref, and also cancels any pending RAF before
    // returning — so no queued pointermove/RAF callback can ever
    // observe a null state here.
    const state = refs.resizeStateRef.current!;
    const delta = clientX - state.startClientX;
    if (delta === 0 && !state.hasMoved) return;
    state.hasMoved = true;
    const rawWidth = state.startWidth + (state.isRtl ? -delta : delta);
    applyWidth(rawWidth, { commitState: false });
  };

  return () => {
    if (refs.pointerFrameRef.current !== null) {
      cancelAnimationFrame(refs.pointerFrameRef.current);
      refs.pointerFrameRef.current = null;
    }
    const clientX = refs.pendingPointerClientXRef.current;
    refs.pendingPointerClientXRef.current = null;
    if (clientX !== null) updateWidthFromClientX(clientX);
  };
}

interface PointerDragDeps {
  event: ReactPointerEvent<HTMLElement>;
  container: HTMLDivElement;
  refs: DragRefs;
  applyWidth: (width: number, opts: ApplyWidthOptions) => number;
  restoreStartWidth: () => void;
  finishResize: (saveFinalWidth?: boolean) => void;
}

/** Starts a window-level pointer drag session (move/up/cancel/blur), recording the start state. */
function beginPointerDrag({ event, container, refs, applyWidth, restoreStartWidth, finishResize }: PointerDragDeps) {
  const flushPendingPointerMove = createPendingMoveFlusher({ refs, applyWidth });

  refs.resizeStateRef.current = {
    startClientX: event.clientX,
    startWidth: refs.widthRef.current,
    isRtl: window.getComputedStyle(container).direction === 'rtl',
    hasMoved: false,
  };

  const handlePointerMove = (moveEvent: PointerEvent) => {
    refs.pendingPointerClientXRef.current = moveEvent.clientX;
    if (refs.pointerFrameRef.current !== null) return;
    refs.pointerFrameRef.current = requestAnimationFrame(() => {
      refs.pointerFrameRef.current = null;
      flushPendingPointerMove();
    });
  };
  const handlePointerEnd = () => {
    flushPendingPointerMove();
    finishResize(true);
  };
  const handlePointerCancel = () => {
    flushPendingPointerMove();
    restoreStartWidth();
    finishResize(false);
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerEnd);
    window.removeEventListener('pointercancel', handlePointerCancel);
    window.removeEventListener('blur', handlePointerCancel);
  };

  refs.pointerCleanupRef.current = cleanup;
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerEnd);
  window.addEventListener('pointercancel', handlePointerCancel);
  window.addEventListener('blur', handlePointerCancel);
}

/** Detaches the drag listeners and clears all in-flight drag state. */
function teardownDrag(refs: DragRefs) {
  refs.pointerCleanupRef.current?.();
  refs.pointerCleanupRef.current = null;
  if (refs.pointerFrameRef.current !== null) {
    cancelAnimationFrame(refs.pointerFrameRef.current);
    refs.pointerFrameRef.current = null;
  }
  refs.pendingPointerClientXRef.current = null;
  refs.resizeStateRef.current = null;
}

type SplitPaneWidth = ReturnType<typeof useSplitPaneWidth>;

/** Pointer-drag resizing: the `isResizing` flag, drag session lifecycle, and the handle's pointer/blur handlers. */
function usePointerResize({ config, containerRef, paneWidth }: {
  config: SplitPaneConfig;
  containerRef: RefObject<HTMLDivElement | null>;
  paneWidth: SplitPaneWidth;
}) {
  const { storageKey, minWidth, maxWidthOption } = config;
  const { widthRef, preferredWidthRef, applyWidth, renderPreferredWidth } = paneWidth;
  const [isResizing, setIsResizing] = useState(false);
  const refs = useDragRefs(widthRef, preferredWidthRef);
  const { resizeStartPreferredWidthRef, pointerCleanupRef } = refs;

  const finishResize = useCallback(
    (saveFinalWidth = true) => {
      teardownDrag(refs);
      setIsResizing(false);
      if (saveFinalWidth) {
        const finalWidth = renderPreferredWidth(preferredWidthRef.current);
        saveWidth({ storageKey, width: finalWidth, min: minWidth, max: maxWidthOption });
      }
    },
    [renderPreferredWidth, storageKey, minWidth, maxWidthOption, refs, preferredWidthRef],
  );

  useEffect(() => () => finishResize(false), [finishResize]);

  const restoreStartWidth = useCallback(() => {
    preferredWidthRef.current = resizeStartPreferredWidthRef.current;
    renderPreferredWidth(resizeStartPreferredWidthRef.current);
  }, [preferredWidthRef, resizeStartPreferredWidthRef, renderPreferredWidth]);

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
      beginPointerDrag({ event, container, refs, applyWidth, restoreStartWidth, finishResize });
    },
    [applyWidth, finishResize, restoreStartWidth, containerRef, refs, pointerCleanupRef, resizeStartPreferredWidthRef, preferredWidthRef],
  );

  const onHandleBlur = useCallback(() => {
    if (!pointerCleanupRef.current) return;
    restoreStartWidth();
    finishResize(false);
  }, [finishResize, restoreStartWidth, pointerCleanupRef]);

  return { isResizing, onHandlePointerDown, onHandleBlur };
}


/** ArrowLeft/ArrowRight/Home/End on the handle (RTL-aware), persisting each committed width. */
function useKeyboardResize({ config, containerRef, paneWidth }: {
  config: SplitPaneConfig;
  containerRef: RefObject<HTMLDivElement | null>;
  paneWidth: SplitPaneWidth;
}) {
  const { storageKey, minWidth, maxWidthOption, keyboardStep } = config;
  const { widthRef, maxWidthRef, applyWidth } = paneWidth;

  return useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const container = containerRef.current;
      const isRtl = container ? window.getComputedStyle(container).direction === 'rtl' : false;
      // ArrowRight grows the pane in LTR and shrinks it in RTL; ArrowLeft is the mirror.
      const rightStep = (isRtl ? -1 : 1) * keyboardStep;
      const nextWidth = new Map<string, number>([
        ['ArrowLeft', widthRef.current - rightStep],
        ['ArrowRight', widthRef.current + rightStep],
        ['Home', minWidth],
        ['End', maxWidthRef.current],
      ]).get(event.key);
      if (nextWidth === undefined) return;
      event.preventDefault();
      const next = applyWidth(nextWidth);
      saveWidth({ storageKey, width: next, min: minWidth, max: maxWidthOption });
    },
    [applyWidth, keyboardStep, minWidth, maxWidthOption, storageKey, containerRef, widthRef, maxWidthRef],
  );
}

export function useResizableSplitPane(
  options: UseResizableSplitPaneOptions = {},
): ResizableSplitPaneController {
  const config = resolveSplitPaneConfig(options);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const paneWidth = useSplitPaneWidth(config, containerRef);
  const { isResizing, onHandlePointerDown, onHandleBlur } = usePointerResize({ config, containerRef, paneWidth });
  const onHandleKeyDown = useKeyboardResize({ config, containerRef, paneWidth });
  const { width, maxWidth, secondaryMinWidth, secondaryTrack } = paneWidth;

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
      gridTemplateColumns: `${width}px ${config.handleWidth}px ${secondaryTrack}`,
    },
  };
}
