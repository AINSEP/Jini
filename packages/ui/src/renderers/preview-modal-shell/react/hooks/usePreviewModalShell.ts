/**
 * Headless controller for the preview-modal shell — all state/effects,
 * no JSX. `react/components/PreviewModalShell.tsx` is the presentational
 * consumer.
 *
 * Origin: `apps/web/src/components/PreviewModal.tsx`'s component body (the
 * generic-chrome subset — see `../../source-map.md`'s classification). The
 * merged Share/Export popover's state (`templateShareOpen`/
 * `copyShareFeedback`/`socialShareTargets`/...) is deliberately not ported
 * here; that block is OD-specific and out of scope for this shell.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { computeScalerStyle, computeStageScale, findActiveView, resolveInitialViewId, type PreviewModalViewLike } from '../../rules.js';
import type { PreviewModalScalerStyle } from '../../types.js';

export interface UsePreviewModalShellOptions<V extends PreviewModalViewLike> {
  views: readonly V[];
  initialViewId?: string | undefined;
  /** Fired whenever the active view changes — including on first mount with `initialViewId` — so the host can drive lazy fetches. */
  onView?: ((viewId: string) => void) | undefined;
  onClose: () => void;
  sidebarDefaultOpen?: boolean | undefined;
  sidebarOnToggle?: ((open: boolean) => void) | undefined;
  /** When this changes while the sidebar is open, `sidebarOnToggle` re-fires so the host can prime a fresh fetch for the new content. */
  sidebarContentKey?: string | number | undefined;
  /** Logical viewport width the content is assumed to render at before being scaled to fit the stage. Defaults to 1280. */
  designWidth?: number | undefined;
}

export interface PreviewModalShellController<V extends PreviewModalViewLike> {
  activeId: string;
  setActiveId: (id: string) => void;
  activeView: V | undefined;
  fullscreen: boolean;
  enterFullscreen: () => void;
  exitFullscreen: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (next: boolean) => void;
  primaryMenuOpen: boolean;
  setPrimaryMenuOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  stageSize: { w: number; h: number };
  scale: number;
  scalerStyle: PreviewModalScalerStyle;
  stageRef: RefObject<HTMLDivElement | null>;
  stageFrameRef: RefObject<HTMLDivElement | null>;
  primaryMenuRef: RefObject<HTMLDivElement | null>;
}

export function usePreviewModalShell<V extends PreviewModalViewLike>(
  options: UsePreviewModalShellOptions<V>,
): PreviewModalShellController<V> {
  const {
    views,
    initialViewId,
    onView,
    onClose,
    sidebarDefaultOpen = false,
    sidebarOnToggle,
    sidebarContentKey,
    designWidth = 1280,
  } = options;

  const initial = resolveInitialViewId(views, initialViewId);
  const [activeId, setActiveId] = useState<string>(initial);
  const [fullscreen, setFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(sidebarDefaultOpen);
  const [primaryMenuOpen, setPrimaryMenuOpen] = useState(false);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const stageFrameRef = useRef<HTMLDivElement | null>(null);
  const primaryMenuRef = useRef<HTMLDivElement | null>(null);

  // Captured in a ref so the lazy-load effect below depends only on
  // sidebarOpen/sidebarContentKey — a fresh `sidebarOnToggle` identity on
  // every host render would otherwise re-fire the load every render.
  const sidebarToggleRef = useRef(sidebarOnToggle);
  sidebarToggleRef.current = sidebarOnToggle;

  useEffect(() => {
    sidebarToggleRef.current?.(sidebarOpen);
  }, [sidebarOpen, sidebarContentKey]);

  useEffect(() => {
    onView?.(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, onView]);

  // Close on Escape. In fullscreen, the first Escape exits fullscreen
  // instead of dismissing the whole modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (fullscreen) {
        setFullscreen(false);
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, fullscreen]);

  // Mirror native fullscreen state into React so a browser-level Escape
  // (consumed by the browser, not always delivered as a keydown) still
  // clears the `fullscreen` flag in lock-step.
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Outside-click / Escape dismissal for the split-button's secondary menu.
  useEffect(() => {
    if (!primaryMenuOpen) return undefined;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!primaryMenuRef.current?.contains(target)) setPrimaryMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPrimaryMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [primaryMenuOpen]);

  // Lock body scroll while mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Track the stage size so content can render at a fixed logical width and
  // scale to fit. ResizeObserver is missing from some environments (jsdom,
  // older embedded WebViews) — guarded with a window-resize fallback so the
  // shell still mounts, it just loses element-level resize tracking.
  useEffect(() => {
    const el = stageFrameRef.current;
    if (!el) return undefined;
    // clientWidth/Height (layout box), not getBoundingClientRect (transform-
    // aware and lands short during the modal's own entrance animation).
    const measure = () => setStageSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    // A synchronous first measure can land before the modal's entrance
    // layout settles; re-measure next frame so the scaler fills the stage.
    const raf = requestAnimationFrame(measure);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
      };
    }
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Re-measure when the sidebar toggles (the stage width jumps) or the
  // active view changes, so `scale` tracks the current stage width instead
  // of a stale value from the previous layout.
  useEffect(() => {
    const el = stageFrameRef.current;
    if (!el) return undefined;
    const raf = requestAnimationFrame(() => {
      setStageSize({ w: el.clientWidth, h: el.clientHeight });
    });
    return () => cancelAnimationFrame(raf);
  }, [sidebarOpen, activeId]);

  const activeView = findActiveView(views, activeId);
  const scale = computeStageScale(stageSize.w, designWidth);
  const scalerStyle = useMemo(
    () => computeScalerStyle(stageSize, designWidth, scale),
    [scale, stageSize.w, stageSize.h, designWidth],
  );

  function enterFullscreen() {
    const el = stageRef.current;
    if (el && typeof el.requestFullscreen === 'function') {
      el.requestFullscreen()
        .then(() => setFullscreen(true))
        .catch(() => setFullscreen(true));
    } else {
      setFullscreen(true);
    }
  }

  function exitFullscreen() {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    setFullscreen(false);
  }

  return {
    activeId,
    setActiveId,
    activeView,
    fullscreen,
    enterFullscreen,
    exitFullscreen,
    sidebarOpen,
    setSidebarOpen,
    primaryMenuOpen,
    setPrimaryMenuOpen,
    stageSize,
    scale,
    scalerStyle,
    stageRef,
    stageFrameRef,
    primaryMenuRef,
  };
}
