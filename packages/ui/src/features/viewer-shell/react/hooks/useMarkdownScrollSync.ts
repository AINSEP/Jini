import { useCallback, useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react';
import { extractMarkdownBlockLines } from '../../../../utils/markdown-scroll-sync.js';
import {
  computeSplitPaneScrollTarget,
  measureEditorBlockOffsets,
  measurePreviewBlockOffsets,
} from '../../rules.js';
import type { MarkdownScrollPane, MarkdownSplitPaneMode } from '../../types.js';

export interface UseMarkdownScrollSyncOptions {
  mode: MarkdownSplitPaneMode;
  sourceText: string;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  previewRef: RefObject<HTMLElement | null>;
  /** CSS selector for the rendered preview's root element inside
   *  `previewRef.current`, forwarded to `measurePreviewBlockOffsets`. */
  previewSelector?: string | undefined;
  /** Bump this (e.g. pass the rendered HTML string) whenever the preview's
   *  rendered content changes, so a resync runs even though `sourceText`
   *  itself didn't move (matches the source's own `[html, mode]` effect
   *  dependency). */
  resyncKey?: unknown;
}

export interface UseMarkdownScrollSyncResult {
  handleEditorScroll: () => void;
  handlePreviewScroll: () => void;
  activatePane: (pane: MarkdownScrollPane) => void;
}

type PaneRef = MutableRefObject<MarkdownScrollPane>;
type ProgrammaticScroll = { pane: MarkdownScrollPane; top: number } | null;

/** Cached editor block offsets, invalidated whenever the source text changes. */
function useEditorBlockOffsets({ editorRef, blockLines, sourceText }: {
  editorRef: RefObject<HTMLTextAreaElement | null>;
  blockLines: number[];
  sourceText: string;
}) {
  const editorBlockOffsetsRef = useRef<{ width: number; offsets: number[] } | null>(null);

  useEffect(() => {
    editorBlockOffsetsRef.current = null;
  }, [sourceText]);

  return useCallback((): number[] | null => {
    const editor = editorRef.current;
    if (!editor || blockLines.length === 0) return null;
    const width = editor.clientWidth;
    const cached = editorBlockOffsetsRef.current;
    if (cached && cached.width === width && cached.offsets.length === blockLines.length) {
      return cached.offsets;
    }
    const offsets = measureEditorBlockOffsets({ textarea: editor, blockLines, text: sourceText });
    if (!offsets) return null;
    editorBlockOffsetsRef.current = { width, offsets };
    return offsets;
  }, [blockLines, editorRef, sourceText]);
}

/** Tracks scrolls WE caused so the target pane's resulting scroll event isn't echoed back. */
function useProgrammaticScrollGuard(activePaneRef: PaneRef) {
  const programmaticScrollClearFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef<ProgrammaticScroll>(null);

  const clearProgrammaticScrollSoon = useCallback(() => {
    if (programmaticScrollClearFrameRef.current !== null) {
      cancelAnimationFrame(programmaticScrollClearFrameRef.current);
    }
    programmaticScrollClearFrameRef.current = requestAnimationFrame(() => {
      programmaticScrollClearFrameRef.current = requestAnimationFrame(() => {
        programmaticScrollRef.current = null;
        programmaticScrollClearFrameRef.current = null;
      });
    });
  }, []);

  const shouldIgnoreScroll = useCallback((pane: MarkdownScrollPane, element: HTMLElement): boolean => {
    const programmatic = programmaticScrollRef.current;
    if (programmatic?.pane !== pane) return false;
    if (Math.abs(element.scrollTop - programmatic.top) > 1 && activePaneRef.current === pane) {
      return false;
    }
    programmaticScrollRef.current = null;
    return true;
  }, [activePaneRef]);

  return { programmaticScrollRef, programmaticScrollClearFrameRef, clearProgrammaticScrollSoon, shouldIgnoreScroll };
}

interface ApplyScrollSyncDeps {
  mode: MarkdownSplitPaneMode;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  previewRef: RefObject<HTMLElement | null>;
  previewSelector: string | undefined;
  blockLineCount: number;
  getEditorBlockOffsets: () => number[] | null;
  programmaticScrollRef: MutableRefObject<ProgrammaticScroll>;
  clearProgrammaticScrollSoon: () => void;
}

/** Scrolls the target pane to match the source pane (block-anchored when measurable, else ratio). */
function useApplyScrollSync({
  mode,
  editorRef,
  previewRef,
  previewSelector,
  blockLineCount,
  getEditorBlockOffsets,
  programmaticScrollRef,
  clearProgrammaticScrollSoon,
}: ApplyScrollSyncDeps) {
  return useCallback(
    (sourcePane: MarkdownScrollPane, targetPane: MarkdownScrollPane) => {
      const source = sourcePane === 'editor' ? editorRef.current : previewRef.current;
      const target = targetPane === 'editor' ? editorRef.current : previewRef.current;
      if (mode !== 'split' || !source || !target) return;
      const editorOffsets = getEditorBlockOffsets();
      const previewOffsets = editorOffsets ? measurePreviewBlockOffsets({ pane: previewRef.current!, blockCount: blockLineCount }, { previewSelector }) : null;
      const targetTop = computeSplitPaneScrollTarget({
        sourcePane,
        source,
        target,
        blockLineCount,
        editorOffsets,
        previewOffsets,
      });
      if (Math.abs(target.scrollTop - targetTop) < 1) return;
      programmaticScrollRef.current = { pane: targetPane, top: targetTop };
      target.scrollTop = targetTop;
      clearProgrammaticScrollSoon();
    },
    [blockLineCount, clearProgrammaticScrollSoon, editorRef, getEditorBlockOffsets, mode, previewRef, previewSelector, programmaticScrollRef],
  );
}

type ApplyScrollSync = (sourcePane: MarkdownScrollPane, targetPane: MarkdownScrollPane) => void;

/** Coalesces scroll events into one sync per animation frame. */
function useScrollSyncScheduler(mode: MarkdownSplitPaneMode, applyScrollSync: ApplyScrollSync) {
  const scrollSyncFrameRef = useRef<number | null>(null);
  const pendingScrollSyncRef = useRef<{ sourcePane: MarkdownScrollPane; targetPane: MarkdownScrollPane } | null>(null);

  const scheduleScrollSync = useCallback(
    (sourcePane: MarkdownScrollPane, targetPane: MarkdownScrollPane) => {
      if (mode !== 'split') {
        pendingScrollSyncRef.current = null;
        return;
      }
      pendingScrollSyncRef.current = { sourcePane, targetPane };
      if (scrollSyncFrameRef.current !== null) return;
      scrollSyncFrameRef.current = requestAnimationFrame(() => {
        scrollSyncFrameRef.current = null;
        // `pendingScrollSyncRef.current` is always non-null here: the only
        // writers are this same callback's `{ sourcePane, targetPane }`
        // assignment two lines above (which always runs immediately before
        // a frame is requested) and the mode-effect's cleanup below, which
        // nulls it out *together with* cancelling this very
        // `scrollSyncFrameRef` frame via `cancelAnimationFrame` — so a
        // cancelled frame's callback never actually runs to observe a null
        // value. The non-null assertion exists only to satisfy
        // TypeScript's `| null` ref type, not a real runtime path.
        const pending = pendingScrollSyncRef.current!;
        pendingScrollSyncRef.current = null;
        applyScrollSync(pending.sourcePane, pending.targetPane);
      });
    },
    [applyScrollSync, mode],
  );

  return { scheduleScrollSync, scrollSyncFrameRef, pendingScrollSyncRef };
}

interface ScrollSyncLifecycleDeps {
  mode: MarkdownSplitPaneMode;
  resyncKey: unknown;
  activePaneRef: PaneRef;
  guard: ReturnType<typeof useProgrammaticScrollGuard>;
  scheduler: ReturnType<typeof useScrollSyncScheduler>;
}

/** Cancels pending frames on unmount / when leaving split mode, and resyncs on mode or content changes. */
function useScrollSyncLifecycle({ mode, resyncKey, activePaneRef, guard, scheduler }: ScrollSyncLifecycleDeps) {
  const { scrollSyncFrameRef, pendingScrollSyncRef, scheduleScrollSync } = scheduler;
  const { programmaticScrollClearFrameRef, programmaticScrollRef } = guard;

  useEffect(() => {
    return () => {
      if (scrollSyncFrameRef.current !== null) cancelAnimationFrame(scrollSyncFrameRef.current);
      if (programmaticScrollClearFrameRef.current !== null) cancelAnimationFrame(programmaticScrollClearFrameRef.current);
    };
  }, [scrollSyncFrameRef, programmaticScrollClearFrameRef]);

  useEffect(() => {
    if (mode !== 'split') {
      if (scrollSyncFrameRef.current !== null) {
        cancelAnimationFrame(scrollSyncFrameRef.current);
        scrollSyncFrameRef.current = null;
      }
      if (programmaticScrollClearFrameRef.current !== null) {
        cancelAnimationFrame(programmaticScrollClearFrameRef.current);
        programmaticScrollClearFrameRef.current = null;
      }
      pendingScrollSyncRef.current = null;
      programmaticScrollRef.current = null;
      activePaneRef.current = 'editor';
      return;
    }
    // `activePaneRef.current` is a `MarkdownScrollPane` (never null/undefined
    // — it's initialized to `'editor'` and every writer assigns a real
    // pane), so it's used directly rather than through a `??` fallback.
    const sourcePane = activePaneRef.current;
    const targetPane = sourcePane === 'preview' ? 'editor' : 'preview';
    scheduleScrollSync(sourcePane, targetPane);
    // resyncKey intentionally re-triggers this on preview content changes.
  }, [mode, resyncKey, scheduleScrollSync, scrollSyncFrameRef, programmaticScrollClearFrameRef, pendingScrollSyncRef, programmaticScrollRef, activePaneRef]);
}

/**
 * Keeps a split editor/preview pane aligned while scrolling either side, by
 * anchoring on each top-level markdown block's source line vs. its rendered
 * DOM element (falling back to plain ratio-sync when block anchors can't be
 * measured). This is the generic mechanism behind the source component's
 * split-pane markdown viewer — ported without its artifact-status gate, its
 * autosave/upload pipeline, and its shiki-based syntax highlighting (all
 * genuinely OD/product-specific; see `archived UI provenance ledger`).
 */
export function useMarkdownScrollSync(options: UseMarkdownScrollSyncOptions): UseMarkdownScrollSyncResult {
  const { mode, sourceText, editorRef, previewRef, previewSelector, resyncKey } = options;
  const activePaneRef = useRef<MarkdownScrollPane>('editor');
  const blockLines = useMemo(() => extractMarkdownBlockLines({ markdown: sourceText }), [sourceText]);
  const getEditorBlockOffsets = useEditorBlockOffsets({ editorRef, blockLines, sourceText });
  const guard = useProgrammaticScrollGuard(activePaneRef);
  const applyScrollSync = useApplyScrollSync({
    mode, editorRef, previewRef, previewSelector, blockLineCount: blockLines.length, getEditorBlockOffsets,
    programmaticScrollRef: guard.programmaticScrollRef, clearProgrammaticScrollSoon: guard.clearProgrammaticScrollSoon,
  });
  const scheduler = useScrollSyncScheduler(mode, applyScrollSync);
  const { scheduleScrollSync } = scheduler;
  const { shouldIgnoreScroll } = guard;

  useScrollSyncLifecycle({ mode, resyncKey, activePaneRef, guard, scheduler });

  const handleEditorScroll = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || shouldIgnoreScroll('editor', editor)) return;
    activePaneRef.current = 'editor';
    scheduleScrollSync('editor', 'preview');
  }, [editorRef, scheduleScrollSync, shouldIgnoreScroll]);

  const handlePreviewScroll = useCallback(() => {
    const previewPane = previewRef.current;
    if (!previewPane || shouldIgnoreScroll('preview', previewPane)) return;
    if (activePaneRef.current !== 'preview') return;
    scheduleScrollSync('preview', 'editor');
  }, [previewRef, scheduleScrollSync, shouldIgnoreScroll]);

  const activatePane = useCallback((pane: MarkdownScrollPane) => {
    activePaneRef.current = pane;
  }, []);

  return { handleEditorScroll, handlePreviewScroll, activatePane };
}
