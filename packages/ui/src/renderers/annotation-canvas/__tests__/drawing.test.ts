import { describe, expect, it, vi } from 'vitest';
import { compositeMarksOntoCanvas, drawCaptureTarget, drawNormalizedBox, drawTextMarks, redrawStrokesAndBoxes, textFontSizePx } from '../drawing.js';
import type { CaptureTarget, NormalizedRect, Stroke, TextMark } from '../types.js';

function fakeCtx() {
  const calls: string[] = [];
  const ctx = {
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    clearRect: vi.fn(() => calls.push('clearRect')),
    fillRect: vi.fn(() => calls.push('fillRect')),
    strokeRect: vi.fn(() => calls.push('strokeRect')),
    beginPath: vi.fn(() => calls.push('beginPath')),
    moveTo: vi.fn(() => calls.push('moveTo')),
    lineTo: vi.fn(() => calls.push('lineTo')),
    stroke: vi.fn(() => calls.push('stroke')),
    fillText: vi.fn(() => calls.push('fillText')),
    setLineDash: vi.fn(() => calls.push('setLineDash')),
    measureText: vi.fn(() => ({ width: 42 })),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    font: '',
    textBaseline: '',
    shadowColor: '',
    shadowBlur: 0,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('textFontSizePx', () => {
  it('scales with frame height but never below the minimum', () => {
    expect(textFontSizePx(1000)).toBe(30);
    expect(textFontSizePx(10)).toBe(12);
  });
});

describe('drawNormalizedBox', () => {
  it('fills and strokes a dashed rect', () => {
    const { ctx, calls } = fakeCtx();
    const box: NormalizedRect = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    drawNormalizedBox(ctx, box, 200, 100);
    expect(calls).toEqual(['save', 'setLineDash', 'fillRect', 'strokeRect', 'restore']);
  });
});

describe('redrawStrokesAndBoxes', () => {
  it('clears then draws committed + in-progress strokes and boxes', () => {
    const { ctx, calls } = fakeCtx();
    const strokes: Stroke[] = [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }];
    const boxes: NormalizedRect[] = [{ x: 0, y: 0, width: 0.5, height: 0.5 }];
    redrawStrokesAndBoxes(ctx, { strokes, drawingStroke: null, selectionBoxes: boxes, boxDraft: null }, 100, 100, 1);
    expect(calls[0]).toBe('clearRect');
    expect(calls).toContain('strokeRect'); // from the box
    expect(calls).toContain('moveTo');
    expect(calls).toContain('lineTo');
    expect(calls).toContain('stroke');
  });

  it('skips a stroke with no points', () => {
    const { ctx, calls } = fakeCtx();
    redrawStrokesAndBoxes(ctx, { strokes: [{ points: [] }], drawingStroke: null, selectionBoxes: [], boxDraft: null }, 100, 100, 1);
    expect(calls).not.toContain('moveTo');
  });

  it('includes the in-progress drawing stroke', () => {
    const { ctx, calls } = fakeCtx();
    const drawingStroke: Stroke = { points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] };
    redrawStrokesAndBoxes(ctx, { strokes: [], drawingStroke, selectionBoxes: [], boxDraft: null }, 100, 100, 1);
    expect(calls).toContain('moveTo');
  });

  it('draws an in-progress box draft in addition to committed selection boxes', () => {
    const { ctx, calls } = fakeCtx();
    const boxDraft: NormalizedRect = { x: 0.4, y: 0.4, width: 0.1, height: 0.1 };
    redrawStrokesAndBoxes(ctx, { strokes: [], drawingStroke: null, selectionBoxes: [], boxDraft }, 100, 100, 1);
    // One dashed rect (save/setLineDash/fillRect/strokeRect/restore) for the draft box.
    expect(calls).toEqual(['clearRect', 'save', 'setLineDash', 'fillRect', 'strokeRect', 'restore']);
  });
});

describe('drawTextMarks', () => {
  it('draws one fillText call per non-empty line', () => {
    const { ctx, calls } = fakeCtx();
    const marks: TextMark[] = [
      { id: 1, x: 0.1, y: 0.1, text: 'hello\nworld' },
      { id: 2, x: 0.5, y: 0.5, text: '   ' }, // whitespace-only, skipped
    ];
    drawTextMarks(ctx, marks, 200, 200);
    expect((ctx.fillText as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(calls[0]).toBe('save');
    expect(calls.at(-1)).toBe('restore');
  });
});

describe('drawCaptureTarget', () => {
  it('draws nothing for a null target', () => {
    const { ctx, calls } = fakeCtx();
    drawCaptureTarget(ctx, 1, 1, null);
    expect(calls).toEqual([]);
  });

  it('draws nothing for a zero-size position', () => {
    const { ctx, calls } = fakeCtx();
    const target: CaptureTarget = { position: { x: 0, y: 0, width: 0, height: 10 } };
    drawCaptureTarget(ctx, 1, 1, target);
    expect(calls).toEqual([]);
  });

  it('draws nothing for a non-finite position (a host measurement glitch)', () => {
    const { ctx, calls } = fakeCtx();
    const target: CaptureTarget = { position: { x: NaN, y: 0, width: 10, height: 10 } };
    drawCaptureTarget(ctx, 1, 1, target);
    expect(calls).toEqual([]);
  });

  it('draws the highlight box and label', () => {
    const { ctx, calls } = fakeCtx();
    const target: CaptureTarget = { position: { x: 10, y: 10, width: 50, height: 20 }, label: 'Header' };
    drawCaptureTarget(ctx, 1, 1, target);
    expect(calls).toEqual(['save', 'setLineDash', 'fillRect', 'strokeRect', 'setLineDash', 'fillRect', 'fillText', 'restore']);
  });

  it('falls back to the elementId as the label when no label is set', () => {
    const { ctx, calls } = fakeCtx();
    const target: CaptureTarget = { position: { x: 10, y: 10, width: 50, height: 20 }, elementId: 'submit-button' };
    drawCaptureTarget(ctx, 1, 1, target);
    expect(calls).toContain('fillText');
  });

  it('truncates a label longer than 42 characters before measuring/drawing it', () => {
    const { ctx, calls } = fakeCtx();
    const target: CaptureTarget = {
      position: { x: 10, y: 10, width: 50, height: 20 },
      label: 'This label is intentionally much longer than forty-two characters',
    };
    drawCaptureTarget(ctx, 1, 1, target);
    expect((ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('This label is intentionally much longer...');
  });

  it('draws the box but skips the label when there is no label/elementId', () => {
    const { ctx, calls } = fakeCtx();
    const target: CaptureTarget = { position: { x: 10, y: 10, width: 50, height: 20 } };
    drawCaptureTarget(ctx, 1, 1, target);
    expect(calls).toEqual(['save', 'setLineDash', 'fillRect', 'strokeRect', 'restore']);
  });
});

describe('compositeMarksOntoCanvas', () => {
  it('draws the target, boxes, strokes, and text marks in order', () => {
    const { ctx, calls } = fakeCtx();
    compositeMarksOntoCanvas(
      ctx,
      {
        target: { position: { x: 0, y: 0, width: 10, height: 10 } },
        selectionBoxes: [{ x: 0, y: 0, width: 0.2, height: 0.2 }],
        strokes: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
        textMarks: [{ id: 1, x: 0.1, y: 0.1, text: 'hi' }],
      },
      100,
      100,
      1,
      1,
    );
    expect(calls).toContain('fillRect'); // target + box
    expect(calls).toContain('stroke'); // freehand stroke
    expect(calls).toContain('fillText'); // text mark
  });

  it('skips a stroke with no points', () => {
    const { ctx, calls } = fakeCtx();
    compositeMarksOntoCanvas(
      ctx,
      { target: null, selectionBoxes: [], strokes: [{ points: [] }], textMarks: [] },
      100,
      100,
      1,
      1,
    );
    expect(calls).not.toContain('moveTo');
    expect(calls).not.toContain('stroke');
  });
});
