import { describe, expect, it, vi } from 'vitest';
import {
  attemptCapture,
  buildMarkToolOptionControllers,
  buildSubmitOptionControllers,
  buildSubmitPayload,
  canAttemptSend,
  deriveCanvasVisibility,
  deriveSendGate,
  deriveSentWarning,
  deriveUndoRedoAvailability,
  describeSubmitFailure,
  selectNoScreenshotMessage,
} from '../useAnnotationCanvas.controller.js';
import { buildSubmitOptionRules, type SubmitOptionRule } from '../../../rules.js';
import type { MarkTool, PreviewSnapshot } from '../../../types.js';

/** Passthrough translator matching `ReturnType<typeof useT>` — returns the key itself so assertions can check on the exact English string, same convention the hook's own tests use. */
const t = (key: string) => key;

describe('deriveCanvasVisibility', () => {
  it('shows the canvas while active, independent of any marks', () => {
    expect(deriveCanvasVisibility({ active: true, hasInk: false, hasBox: false, hasText: false, capturing: false, hideChrome: false })).toEqual({
      showCanvas: true,
      textLayerVisible: true,
      chromeHidden: false,
    });
  });

  it('hides everything once inactive with no lingering marks', () => {
    expect(deriveCanvasVisibility({ active: false, hasInk: false, hasBox: false, hasText: false, capturing: false, hideChrome: false })).toEqual({
      showCanvas: false,
      textLayerVisible: false,
      chromeHidden: false,
    });
  });

  it('keeps the canvas (but not the text layer) visible for a lingering ink/box mark while inactive', () => {
    expect(deriveCanvasVisibility({ active: false, hasInk: true, hasBox: false, hasText: false, capturing: false, hideChrome: false }).showCanvas).toBe(true);
    expect(deriveCanvasVisibility({ active: false, hasInk: true, hasBox: false, hasText: false, capturing: false, hideChrome: false }).textLayerVisible).toBe(false);
    expect(deriveCanvasVisibility({ active: false, hasInk: false, hasBox: true, hasText: false, capturing: false, hideChrome: false }).showCanvas).toBe(true);
  });

  it('keeps both the canvas and the text layer visible for a lingering text mark while inactive', () => {
    const result = deriveCanvasVisibility({ active: false, hasInk: false, hasBox: false, hasText: true, capturing: false, hideChrome: false });
    expect(result.showCanvas).toBe(true);
    expect(result.textLayerVisible).toBe(true);
  });

  it('hides chrome while capturing a snapshot, or when the host asks for it explicitly', () => {
    expect(deriveCanvasVisibility({ active: true, hasInk: false, hasBox: false, hasText: false, capturing: true, hideChrome: false }).chromeHidden).toBe(true);
    expect(deriveCanvasVisibility({ active: true, hasInk: false, hasBox: false, hasText: false, capturing: false, hideChrome: true }).chromeHidden).toBe(true);
  });
});

describe('deriveUndoRedoAvailability', () => {
  it('is false for both when there is nothing to undo/redo', () => {
    expect(deriveUndoRedoAvailability({ undoCount: 0, hasBox: false, redoCount: 0, sending: false })).toEqual({ canUndo: false, canRedo: false });
  });

  it('canUndo is true once a stroke exists or a box draft is in progress', () => {
    expect(deriveUndoRedoAvailability({ undoCount: 1, hasBox: false, redoCount: 0, sending: false }).canUndo).toBe(true);
    expect(deriveUndoRedoAvailability({ undoCount: 0, hasBox: true, redoCount: 0, sending: false }).canUndo).toBe(true);
  });

  it('canRedo is true once something has been undone', () => {
    expect(deriveUndoRedoAvailability({ undoCount: 0, hasBox: false, redoCount: 1, sending: false }).canRedo).toBe(true);
  });

  it('gates both off while a submit is in flight, regardless of history', () => {
    expect(deriveUndoRedoAvailability({ undoCount: 5, hasBox: true, redoCount: 5, sending: true })).toEqual({ canUndo: false, canRedo: false });
  });
});

describe('deriveSendGate', () => {
  const empty = { hasInk: false, hasBox: false, hasText: false, hasCaptureTarget: false, captureViewport: false, noteTrimmed: '', extraFilesCount: 0 };

  it('is false/false with nothing drawn, no target, no note, no attachments', () => {
    expect(deriveSendGate(empty)).toEqual({ shouldCapture: false, canSubmitNow: false });
  });

  it.each([
    ['hasInk', { hasInk: true }],
    ['hasBox', { hasBox: true }],
    ['hasText', { hasText: true }],
    ['hasCaptureTarget', { hasCaptureTarget: true }],
    ['captureViewport', { captureViewport: true }],
  ] as const)('%s alone makes shouldCapture (and therefore canSubmitNow) true', (_name, patch) => {
    const result = deriveSendGate({ ...empty, ...patch });
    expect(result.shouldCapture).toBe(true);
    expect(result.canSubmitNow).toBe(true);
  });

  it('a note or an attachment makes canSubmitNow true without making shouldCapture true', () => {
    expect(deriveSendGate({ ...empty, noteTrimmed: 'hi' })).toEqual({ shouldCapture: false, canSubmitNow: true });
    expect(deriveSendGate({ ...empty, extraFilesCount: 1 })).toEqual({ shouldCapture: false, canSubmitNow: true });
  });
});

describe('canAttemptSend', () => {
  it('refuses while already sending', () => {
    expect(canAttemptSend({ sending: true, canSubmitNow: true, action: 'send', sendDisabled: false })).toBe(false);
  });

  it('refuses when there is nothing to submit', () => {
    expect(canAttemptSend({ sending: false, canSubmitNow: false, action: 'send', sendDisabled: false })).toBe(false);
  });

  it('refuses only the "send" action when sendDisabled is set', () => {
    expect(canAttemptSend({ sending: false, canSubmitNow: true, action: 'send', sendDisabled: true })).toBe(false);
    expect(canAttemptSend({ sending: false, canSubmitNow: true, action: 'draft', sendDisabled: true })).toBe(true);
    expect(canAttemptSend({ sending: false, canSubmitNow: true, action: 'queue', sendDisabled: true })).toBe(true);
  });

  it('allows a normal send', () => {
    expect(canAttemptSend({ sending: false, canSubmitNow: true, action: 'send', sendDisabled: false })).toBe(true);
  });
});

describe('selectNoScreenshotMessage', () => {
  it('uses the whole-viewport wording only when captureViewport is set with no visual mark or target at all', () => {
    expect(selectNoScreenshotMessage({ captureViewport: true, hasInk: false, hasBox: false, hasCaptureTarget: false }, t)).toBe(
      'No screenshot was captured for this annotation.',
    );
  });

  it('falls back to the mark-specific wording once any mark or target is present, even with captureViewport set', () => {
    expect(selectNoScreenshotMessage({ captureViewport: true, hasInk: true, hasBox: false, hasCaptureTarget: false }, t)).toBe('No screenshot was captured for this mark.');
    expect(selectNoScreenshotMessage({ captureViewport: true, hasInk: false, hasBox: true, hasCaptureTarget: false }, t)).toBe('No screenshot was captured for this mark.');
    expect(selectNoScreenshotMessage({ captureViewport: true, hasInk: false, hasBox: false, hasCaptureTarget: true }, t)).toBe('No screenshot was captured for this mark.');
  });

  it('uses the mark-specific wording when captureViewport was never set', () => {
    expect(selectNoScreenshotMessage({ captureViewport: false, hasInk: false, hasBox: false, hasCaptureTarget: false }, t)).toBe('No screenshot was captured for this mark.');
  });
});

describe('attemptCapture', () => {
  const base = { hasInk: false, hasBox: false, hasCaptureTarget: false, captureViewport: false, noteTrimmed: '', extraFilesCount: 0, t };

  it('captures a file from a successful snapshot + composite, naming it from the injected clock', async () => {
    const snap: PreviewSnapshot = { dataUrl: 'data:image/png;base64,x', w: 10, h: 10 };
    const blob = new Blob(['x'], { type: 'image/png' });
    const requestSnapshot = vi.fn(async () => snap);
    const compositeWithBackground = vi.fn(async () => blob);
    const now = () => new Date('2026-01-02T03:04:05.678Z');
    const outcome = await attemptCapture({ ...base, requestSnapshot, compositeWithBackground }, { now });
    expect(outcome.kind).toBe('captured');
    if (outcome.kind !== 'captured') throw new Error('expected captured');
    expect(outcome.file.name).toBe('annotation-2026-01-02T03-04-05-678Z.png');
    expect(outcome.file.type).toBe('image/png');
    expect(compositeWithBackground).toHaveBeenCalledWith(snap);
  });

  it('skips (no warning) when compositing fails to produce a blob but a note is present', async () => {
    const requestSnapshot = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,x', w: 10, h: 10 }) as PreviewSnapshot);
    const compositeWithBackground = vi.fn(async () => null);
    const outcome = await attemptCapture({ ...base, noteTrimmed: 'still send this', requestSnapshot, compositeWithBackground });
    expect(outcome).toEqual({ kind: 'skipped' });
  });

  it('skips (no warning) when compositing fails but extra files are attached', async () => {
    const requestSnapshot = vi.fn(async () => null);
    const compositeWithBackground = vi.fn(async () => null);
    const outcome = await attemptCapture({ ...base, extraFilesCount: 1, requestSnapshot, compositeWithBackground });
    expect(outcome).toEqual({ kind: 'skipped' });
    expect(compositeWithBackground).not.toHaveBeenCalled(); // snap was null, so composite is never reached
  });

  it('warns with the mark-specific message when nothing else can fall back', async () => {
    const requestSnapshot = vi.fn(async () => null);
    const compositeWithBackground = vi.fn(async () => null);
    const outcome = await attemptCapture({ ...base, hasInk: true, requestSnapshot, compositeWithBackground });
    expect(outcome).toEqual({ kind: 'warned', message: 'No screenshot was captured for this mark.' });
  });

  it('warns with the viewport-specific message for a whole-viewport request with no visual mark', async () => {
    const requestSnapshot = vi.fn(async () => null);
    const compositeWithBackground = vi.fn(async () => null);
    const outcome = await attemptCapture({ ...base, captureViewport: true, requestSnapshot, compositeWithBackground });
    expect(outcome).toEqual({ kind: 'warned', message: 'No screenshot was captured for this annotation.' });
  });
});

describe('buildSubmitPayload', () => {
  const base = { file: null, note: '', action: 'send' as const, filePath: undefined, captureTarget: null, markKind: undefined, bounds: undefined, extraFiles: [] };

  it('omits bounds when there is no markKind, even if a bounds value was computed', () => {
    const payload = buildSubmitPayload({ ...base, bounds: { x: 1, y: 2, width: 3, height: 4 } });
    expect(payload.bounds).toBeUndefined();
  });

  it('includes bounds once markKind is set', () => {
    const bounds = { x: 1, y: 2, width: 3, height: 4 };
    const payload = buildSubmitPayload({ ...base, markKind: 'stroke', bounds });
    expect(payload.bounds).toBe(bounds);
  });

  it('prefers the captureTarget file path over the explicit one, and falls back when there is no target', () => {
    expect(buildSubmitPayload({ ...base, filePath: 'a.ts', captureTarget: { filePath: 'b.ts', position: { x: 0, y: 0, width: 0, height: 0 } } }).filePath).toBe('b.ts');
    expect(buildSubmitPayload({ ...base, filePath: 'a.ts', captureTarget: null }).filePath).toBe('a.ts');
  });

  it('omits extraFiles when empty and includes them when present', () => {
    expect(buildSubmitPayload({ ...base, extraFiles: [] }).extraFiles).toBeUndefined();
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    expect(buildSubmitPayload({ ...base, extraFiles: [file] }).extraFiles).toEqual([file]);
  });

  it('passes file/note/action/target straight through', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const captureTarget = { position: { x: 0, y: 0, width: 1, height: 1 } };
    const payload = buildSubmitPayload({ ...base, file, note: 'hi', action: 'queue', captureTarget });
    expect(payload).toMatchObject({ file, note: 'hi', action: 'queue', target: captureTarget });
  });
});

describe('describeSubmitFailure', () => {
  it('uses the port-provided message when present', () => {
    expect(describeSubmitFailure({ ok: false, message: 'boom' }, t)).toBe('boom');
  });

  it('falls back to a default message when the port gives none', () => {
    expect(describeSubmitFailure({ ok: false }, t)).toBe('Could not submit this annotation.');
  });
});

describe('deriveSentWarning', () => {
  it('warns when capture was attempted but no file made it through', () => {
    expect(deriveSentWarning({ shouldCapture: true, file: null, action: 'send' }, t)).toEqual({
      action: 'send',
      message: 'Sent without a screenshot — the note still went through.',
    });
  });

  it('is null once a file was actually captured', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    expect(deriveSentWarning({ shouldCapture: true, file, action: 'send' }, t)).toBeNull();
  });

  it('is null when capture was never attempted in the first place', () => {
    expect(deriveSentWarning({ shouldCapture: false, file: null, action: 'send' }, t)).toBeNull();
  });
});

describe('buildSubmitOptionControllers', () => {
  const submitRules = buildSubmitOptionRules({ canSubmit: true, sendDisabled: false });

  it('maps every rule to a controller, translating labels and pending labels', () => {
    const { submitOptions } = buildSubmitOptionControllers({ submitRules, sendDisabled: false, sendDisabledReason: undefined, submitAction: 'send', t });
    expect(submitOptions.map((o) => o.action)).toEqual(['send', 'draft', 'queue']);
    expect(submitOptions.find((o) => o.action === 'send')).toMatchObject({ label: 'Send', pendingLabel: 'Sending…', enabled: true });
  });

  it('titles the send option with the disabled reason when sendDisabled is set and a reason is given', () => {
    const disabledRules = buildSubmitOptionRules({ canSubmit: true, sendDisabled: true });
    const { submitOptions } = buildSubmitOptionControllers({
      submitRules: disabledRules,
      sendDisabled: true,
      sendDisabledReason: 'A run is already streaming.',
      submitAction: 'send',
      t,
    });
    expect(submitOptions.find((o) => o.action === 'send')!.title).toBe('A run is already streaming.');
    // Non-send actions are unaffected by sendDisabled's title override.
    expect(submitOptions.find((o) => o.action === 'draft')!.title).toBe('Add to input');
  });

  it('falls back to the default unavailable-reason title when sendDisabled has no explicit reason', () => {
    const disabledRules = buildSubmitOptionRules({ canSubmit: true, sendDisabled: true });
    const { submitOptions } = buildSubmitOptionControllers({ submitRules: disabledRules, sendDisabled: true, sendDisabledReason: undefined, submitAction: 'send', t });
    expect(submitOptions.find((o) => o.action === 'send')!.title).toBe('Sending is unavailable right now.');
  });

  it('currentSubmit picks the controller matching submitAction', () => {
    const { submitOptions, currentSubmit } = buildSubmitOptionControllers({ submitRules, sendDisabled: false, sendDisabledReason: undefined, submitAction: 'draft', t });
    expect(currentSubmit).toBe(submitOptions.find((o) => o.action === 'draft'));
  });

  it('currentSubmit falls back to the first option when submitAction has no matching rule (defensive branch, unreachable at the real call site)', () => {
    const partialRules: SubmitOptionRule[] = submitRules.filter((rule) => rule.action !== 'send');
    const { submitOptions, currentSubmit } = buildSubmitOptionControllers({ submitRules: partialRules, sendDisabled: false, sendDisabledReason: undefined, submitAction: 'send', t });
    expect(currentSubmit).toBe(submitOptions[0]);
  });
});

describe('buildMarkToolOptionControllers', () => {
  it('maps every mark-tool rule to a translated controller', () => {
    const { markToolOptions } = buildMarkToolOptionControllers({ markTool: 'box', t });
    expect(markToolOptions).toEqual([
      { tool: 'box', label: 'Box select' },
      { tool: 'pen', label: 'Pen' },
      { tool: 'text', label: 'Text' },
    ]);
  });

  it('currentMarkTool picks the controller matching markTool', () => {
    const { markToolOptions, currentMarkTool } = buildMarkToolOptionControllers({ markTool: 'text', t });
    expect(currentMarkTool).toBe(markToolOptions.find((o) => o.tool === 'text'));
  });

  it('currentMarkTool falls back to the first option for an unrecognized tool (defensive branch, unreachable at the real call site)', () => {
    const { markToolOptions, currentMarkTool } = buildMarkToolOptionControllers({ markTool: 'lasso' as MarkTool, t });
    expect(currentMarkTool).toBe(markToolOptions[0]);
  });
});
