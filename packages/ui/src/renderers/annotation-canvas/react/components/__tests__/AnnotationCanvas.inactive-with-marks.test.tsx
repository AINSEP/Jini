import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { AnnotationCanvasController } from '../../hooks/useAnnotationCanvas.js';

// `AnnotationCanvas` is a pure presentational shell over `useAnnotationCanvas`'s
// controller (see `../../source-map.md`): `showCanvas`/`textLayerVisible` can
// be `true` while `props.active` is `false` for one render — the render
// where a host has just flipped `active` to `false` but the hook's own
// "reset everything on deactivate" `useEffect` hasn't committed yet. Passive
// effects always flush before `@testing-library/react`'s `act()`-wrapped
// `render`/`rerender` returns, so that transient combination can never
// actually be observed by driving the real hook through a mounted-component
// test — by the time any assertion runs, the reset effect has already
// cleared the marks. It's still real, reachable behavior in production
// (uncontrolled/non-test React scheduling can genuinely paint that frame),
// and it's specifically what the canvas's own `pointerEvents`/`cursor`
// styles (driven directly off `props.active`, independent of the hook's
// internal state) exist to handle: pointer-events must turn off immediately
// once inactive even if the marks are still fading out. Mocking the hook
// module lets this file's own JSX logic be exercised directly for exactly
// that combination, instead of leaving it untested or deleting the styles as
// "dead" when they are not.
vi.mock('../../hooks/useAnnotationCanvas.js', () => ({
  useAnnotationCanvas: vi.fn(),
}));

function fakeController(overrides: Partial<AnnotationCanvasController> = {}): AnnotationCanvasController {
  return {
    wrapRef: { current: null },
    canvasRef: { current: null },
    dockRef: { current: null },
    markToolMenuRef: { current: null },
    submitMenuRef: { current: null },
    fileInputRef: { current: null },
    showCanvas: true,
    textLayerVisible: true,
    chromeHidden: false,
    textFontPx: 16,
    dockPlacement: { layout: 'docked', side: null, style: {} },
    markTool: 'box',
    markToolMenuOpen: false,
    markToolOptions: [],
    currentMarkTool: { tool: 'box', label: 'Box select' },
    setMarkToolMenuOpen: () => {},
    selectMarkTool: () => {},
    textMarks: [],
    updateTextMark: () => {},
    removeTextMark: () => {},
    handleTextBlur: () => {},
    handleTextEscape: () => {},
    autosizeTextArea: () => {},
    registerTextArea: () => {},
    onTextPointerDown: () => {},
    onTextPointerMove: () => {},
    onTextPointerUp: () => {},
    onPointerDown: () => {},
    onPointerMove: () => {},
    onPointerUp: () => {},
    undoStroke: () => {},
    redoStroke: () => {},
    canUndo: false,
    canRedo: false,
    note: '',
    setNote: () => {},
    onNotePaste: () => {},
    onNoteKeyDown: () => {},
    onCompositionStart: () => {},
    onCompositionEnd: () => {},
    extraFiles: [],
    imagePreviews: [],
    previewIndex: null,
    setPreviewIndex: () => {},
    addExtraFiles: () => {},
    onFileInputChange: () => {},
    removeExtraFile: () => {},
    submitAction: 'send',
    submitMenuOpen: false,
    setSubmitMenuOpen: () => {},
    submitOptions: [],
    currentSubmit: { action: 'send', label: 'Send', pendingLabel: 'Sending…', title: 'Send', enabled: true },
    chooseSubmitAction: () => {},
    send: async () => {},
    sending: false,
    canSubmit: false,
    captureWarning: null,
    closeOverlay: () => {},
    ...overrides,
  };
}

describe('AnnotationCanvas (presentational shell, hook mocked) — inactive-with-lingering-marks render', () => {
  it('the canvas is pointer-transparent and shows the default cursor once props.active is false, even while the controller still reports showCanvas/textLayerVisible true', async () => {
    const { useAnnotationCanvas } = await import('../../hooks/useAnnotationCanvas.js');
    vi.mocked(useAnnotationCanvas).mockReturnValue(fakeController({ markTool: 'text' }));
    const { AnnotationCanvas } = await import('../AnnotationCanvas.js');
    const { container } = render(
      <AnnotationCanvas active={false} port={{ onSubmit: async () => ({ ok: true }) }}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    const canvas = container.querySelector('canvas')!;
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveStyle({ pointerEvents: 'none', cursor: 'default' });
  });

  it('is pointer-active with a crosshair cursor once props.active is true (box tool)', async () => {
    const { useAnnotationCanvas } = await import('../../hooks/useAnnotationCanvas.js');
    vi.mocked(useAnnotationCanvas).mockReturnValue(fakeController({ markTool: 'box' }));
    const { AnnotationCanvas } = await import('../AnnotationCanvas.js');
    const { container } = render(
      <AnnotationCanvas active port={{ onSubmit: async () => ({ ok: true }) }}>
        <div>preview</div>
      </AnnotationCanvas>,
    );
    const canvas = container.querySelector('canvas')!;
    expect(canvas).toHaveStyle({ pointerEvents: 'auto', cursor: 'crosshair' });
  });
});
