import { describe, expect, it } from 'vitest';
import * as viewerShell from '../index.js';

/**
 * A barrel-only smoke test: every other test in this feature imports from
 * the concrete module (`./rules.js`, `./dependencies.js`, etc.) rather than
 * `./index.js`, so nothing else actually loads/exercises this file's
 * re-export statements. Importing the barrel here both closes that coverage
 * gap and catches a real class of bug — a typo'd or missing re-export name
 * that unit tests hitting the concrete modules directly would never notice.
 */
describe('viewer-shell barrel (index.ts)', () => {
  it('re-exports the constants', () => {
    expect(viewerShell.DEFAULT_VIEWPORT_PRESETS.map((preset) => preset.id)).toEqual(['desktop', 'tablet', 'mobile']);
    expect(viewerShell.COMMENT_SIDE_DRAG_MIME).toEqual(expect.any(String));
    expect(viewerShell.COPY_FEEDBACK_RESET_MS).toBeGreaterThan(0);
  });

  it('re-exports the pure rule functions', () => {
    expect(viewerShell.humanFileSize(512)).toBe('512 B');
    expect(viewerShell.dropEdgeForClientY(10, { top: 0, height: 100 })).toBe('before');
    expect(viewerShell.reorderCommentIds(['a', 'b'], 'a', 'b', 'after')).toEqual(['b', 'a']);
    expect(viewerShell.appendSavedCommentOrder([], ['a'], 'b')).toEqual(['a', 'b']);
    expect(viewerShell.relativeCommentTimeTranslation(0, 1000)).toEqual({ key: 'Just now' });
    expect(viewerShell.visibleSelectedCommentIds([{ id: 'a' }], new Set(['a']))).toEqual(new Set(['a']));
    expect(viewerShell.formatJsonTextForDisplay('{"a":1}', true)).toBe('{\n  "a": 1\n}');
    expect(viewerShell.hasPrecisionSensitiveJsonNumberText('{"a": 42}')).toBe(false);
    expect(viewerShell.hasUnsafeJsonNumber(42)).toBe(false);
    expect(viewerShell.scrollRange({ scrollHeight: 300, clientHeight: 100 })).toBe(200);
    expect(viewerShell.scrollRatio({ scrollHeight: 300, clientHeight: 100, scrollTop: 100 })).toBe(0.5);
    expect(viewerShell.scrollTopForRatio({ scrollHeight: 300, clientHeight: 100 }, 0.5)).toBe(100);
    expect(
      viewerShell.computeSplitPaneScrollTarget({
        sourcePane: 'editor',
        source: { scrollTop: 50, scrollHeight: 200, clientHeight: 100 },
        target: { scrollHeight: 400, clientHeight: 100 },
        blockLineCount: 0,
        editorOffsets: null,
        previewOffsets: null,
      }),
    ).toBe(150);
  });

  it('re-exports the dependency factories and hooks/components as functions', () => {
    expect(typeof viewerShell.createBrowserViewerClipboard).toBe('function');
    expect(typeof viewerShell.createDefaultViewerShellDependencies).toBe('function');
    expect(typeof viewerShell.useCopyToClipboard).toBe('function');
    expect(typeof viewerShell.useWiredCopyToClipboard).toBe('function');
    expect(typeof viewerShell.useCommentReorder).toBe('function');
    expect(typeof viewerShell.useMarkdownScrollSync).toBe('function');
    expect(typeof viewerShell.ViewerShell).toBe('function');
    expect(typeof viewerShell.ViewerEmptyState).toBe('function');
    expect(typeof viewerShell.ViewerFileActions).toBe('function');
    expect(typeof viewerShell.SegmentedToggle).toBe('function');
    expect(typeof viewerShell.ViewportSwitcher).toBe('function');
    expect(typeof viewerShell.ViewportToggleGroup).toBe('function');
    expect(typeof viewerShell.CodeWithLines).toBe('function');
    expect(typeof viewerShell.CodeWrapToggle).toBe('function');
    expect(typeof viewerShell.useCodeWrap).toBe('function');
    expect(typeof viewerShell.JsonPanel).toBe('function');
    expect(typeof viewerShell.ImageViewerBody).toBe('function');
    expect(typeof viewerShell.VideoViewerBody).toBe('function');
    expect(typeof viewerShell.AudioViewerBody).toBe('function');
    expect(typeof viewerShell.SvgSourcePane).toBe('function');
    expect(typeof viewerShell.CommentSidePanel).toBe('function');
    expect(typeof viewerShell.CommentSideDock).toBe('function');
    expect(typeof viewerShell.MarkdownSplitPane).toBe('function');
  });
});
