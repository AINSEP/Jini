import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
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

/**
 * Keeps a split editor/preview pane aligned while scrolling either side, by
 * anchoring on each top-level markdown block's source line vs. its rendered
 * DOM element (falling back to plain ratio-sync when block anchors can't be
 * measured). This is the generic mechanism behind the source component's
 * split-pane markdown viewer — ported without its artifact-status gate, its
 * autosave/upload pipeline, and its shiki-based syntax highlighting (all
 * genuinely OD/product-specific; see `packages/ui/archived provenance ledger`).
 */
export function useMarkdownScrollSync(options: UseMarkdownScrollSyncOptions): UseMarkdownScrollSyncResult {
  const { mode, sourceText, editorRef, previewRef, previewSelector, resyncKey } = options;

  const editorBlockOffsetsRef = useRef<{ width: number; offsets: number[] } | null>(null);
  const scrollSyncFrameRef = useRef<number | null>(null);
  const programmaticScrollClearFrameRef = useRef<number | null>(null);
  const pendingScrollSyncRef = useRef<{ sourcePane: MarkdownScrollPane; targetPane: MarkdownScrollPane } | null>(null);
  const programmaticScrollRef = useRef<{ pane: MarkdownScrollPane; top: number } | null>(null);
  const activePaneRef = useRef<MarkdownScrollPane>('editor');

  const blockLines = useMemo(() => extractMarkdownBlockLines(sourceText), [sourceText]);

  useEffect(() => {
    editorBlockOffsetsRef.current = null;
  }, [sourceText]);

  useEffect(() => {
    return () => {
      if (scrollSyncFrameRef.current !== null) cancelAnimationFrame(scrollSyncFrameRef.current);
      if (programmaticScrollClearFrameRef.current !== null) cancelAnimationFrame(programmaticScrollClearFrameRef.current);
    };
  }, []);

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

  const getEditorBlockOffsets = useCallback((): number[] | null => {
    const editor = editorRef.current;
    if (!editor || blockLines.length === 0) return null;
    const width = editor.clientWidth;
    const cached = editorBlockOffsetsRef.current;
    if (cached && cached.width === width && cached.offsets.length === blockLines.length) {
      return cached.offsets;
    }
    const offsets = measureEditorBlockOffsets(editor, blockLines, sourceText);
    if (!offsets) return null;
    editorBlockOffsetsRef.current = { width, offsets };
    return offsets;
  }, [blockLines, editorRef, sourceText]);

  const applyScrollSync = useCallback(
    (sourcePane: MarkdownScrollPane, targetPane: MarkdownScrollPane) => {
      const source = sourcePane === 'editor' ? editorRef.current : previewRef.current;
      const target = targetPane === 'editor' ? editorRef.current : previewRef.current;
      if (mode !== 'split' || !source || !target) return;
      const editorOffsets = getEditorBlockOffsets();
      const previewOffsets = editorOffsets ? measurePreviewBlockOffsets(previewRef.current!, blockLines.length, previewSelector) : null;
      const targetTop = computeSplitPaneScrollTarget({
        sourcePane,
        source,
        target,
        blockLineCount: blockLines.length,
        editorOffsets,
        previewOffsets,
      });
      if (Math.abs(target.scrollTop - targetTop) < 1) return;
      programmaticScrollRef.current = { pane: targetPane, top: targetTop };
      target.scrollTop = targetTop;
      clearProgrammaticScrollSoon();
    },
    [blockLines.length, clearProgrammaticScrollSoon, editorRef, getEditorBlockOffsets, mode, previewRef, previewSelector],
  );

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

  const shouldIgnoreScroll = useCallback((pane: MarkdownScrollPane, element: HTMLElement): boolean => {
    const programmatic = programmaticScrollRef.current;
    if (programmatic?.pane !== pane) return false;
    if (Math.abs(element.scrollTop - programmatic.top) > 1 && activePaneRef.current === pane) {
      return false;
    }
    programmaticScrollRef.current = null;
    return true;
  }, []);

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
    // — it's initialized to `'editor'` and every writer above assigns a real
    // pane), so it's used directly rather than through a `??` fallback.
    const sourcePane = activePaneRef.current;
    const targetPane = sourcePane === 'preview' ? 'editor' : 'preview';
    scheduleScrollSync(sourcePane, targetPane);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resyncKey intentionally re-triggers this on preview content changes.
  }, [mode, resyncKey, scheduleScrollSync]);

  return { handleEditorScroll, handlePreviewScroll, activatePane };
}
