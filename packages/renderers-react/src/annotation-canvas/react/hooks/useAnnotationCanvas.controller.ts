/**
 * Derivation and orchestration helpers extracted from `useAnnotationCanvas`
 * to keep the hook's own cyclomatic/cognitive complexity low — a
 * straight-line move of logic that used to live inline in the hook body or
 * in `send()`, not a behavior change. Kept colocated with the hook (rather
 * than folded into `../../rules.ts`) because a few of these orchestrate
 * injected async side effects (`requestSnapshot`, `compositeWithBackground`)
 * rather than being the DOM-free pure geometry that file is scoped to.
 */
import type { AnnotationAction, AnnotationSubmitDetail, CaptureTarget, MarkTool, PreviewSnapshot, Rect } from '../../types.js';
import { MARK_TOOL_OPTION_RULES, type SubmitOptionRule } from '../../rules.js';
import type { useT } from '../../../react/i18n.js';
import type { MarkToolOptionController, SubmitOptionController } from './useAnnotationCanvas.js';

type Translate = ReturnType<typeof useT>;

/** `showCanvas`/`textLayerVisible`/`chromeHidden` — whether the canvas, text layer, and toolbar chrome should currently render. */
export function deriveCanvasVisibility(input: {
  active: boolean;
  hasInk: boolean;
  hasBox: boolean;
  hasText: boolean;
  capturing: boolean;
  hideChrome: boolean;
}): { showCanvas: boolean; textLayerVisible: boolean; chromeHidden: boolean } {
  const { active, hasInk, hasBox, hasText, capturing, hideChrome } = input;
  return {
    showCanvas: active || hasInk || hasBox || hasText,
    textLayerVisible: active || hasText,
    chromeHidden: capturing || hideChrome,
  };
}

/** `canUndo`/`canRedo` — gated off while a submit is in flight. */
export function deriveUndoRedoAvailability(input: {
  undoCount: number;
  hasBox: boolean;
  redoCount: number;
  sending: boolean;
}): { canUndo: boolean; canRedo: boolean } {
  const { undoCount, hasBox, redoCount, sending } = input;
  return {
    canUndo: (undoCount > 0 || hasBox) && !sending,
    canRedo: redoCount > 0 && !sending,
  };
}

export interface SendGateInput {
  hasInk: boolean;
  hasBox: boolean;
  hasText: boolean;
  hasCaptureTarget: boolean;
  captureViewport: boolean;
  noteTrimmed: string;
  extraFilesCount: number;
}

export interface SendGate {
  /** Whether there's anything to rasterize (a mark, a target, or an explicit whole-viewport request) — drives both the hook's `canSubmit` value and `send()`'s capture attempt. */
  shouldCapture: boolean;
  /** Whether there's anything at all to submit — a capture reason, or a note/attachment on their own. */
  canSubmitNow: boolean;
}

/** Shared by the hook's `canSubmit` value and `send()`'s own gate — both computed the identical chain before this extraction. */
export function deriveSendGate(input: SendGateInput): SendGate {
  const { hasInk, hasBox, hasText, hasCaptureTarget, captureViewport, noteTrimmed, extraFilesCount } = input;
  const shouldCapture = hasInk || hasBox || hasText || hasCaptureTarget || captureViewport;
  const canSubmitNow = shouldCapture || Boolean(noteTrimmed) || extraFilesCount > 0;
  return { shouldCapture, canSubmitNow };
}

/** `send()`'s combined early-return gate: already sending, nothing to submit, or `send` specifically disabled. */
export function canAttemptSend(input: { sending: boolean; canSubmitNow: boolean; action: AnnotationAction; sendDisabled: boolean }): boolean {
  const { sending, canSubmitNow, action, sendDisabled } = input;
  if (sending || !canSubmitNow) return false;
  if (action === 'send' && sendDisabled) return false;
  return true;
}

/** Picks which of the two "no screenshot" warnings applies — the whole-viewport-request wording, or the mark-specific one. */
export function selectNoScreenshotMessage(
  input: { captureViewport: boolean; hasInk: boolean; hasBox: boolean; hasCaptureTarget: boolean },
  t: Translate,
): string {
  const { captureViewport, hasInk, hasBox, hasCaptureTarget } = input;
  return captureViewport && !hasInk && !hasBox && !hasCaptureTarget
    ? t('No screenshot was captured for this annotation.')
    : t('No screenshot was captured for this mark.');
}

export type CaptureAttemptOutcome = { kind: 'captured'; file: File } | { kind: 'warned'; message: string } | { kind: 'skipped' };

/**
 * Runs `send()`'s capture attempt once the caller has already established
 * there's something to capture (`shouldCapture`): rasterize + composite,
 * and — only when the result is genuinely empty-handed with nothing else to
 * fall back to (no note, no attachments) — report a warning instead of a
 * file. Deliberately does *not* own the `shouldCapture` gate itself: `send`
 * only awaits this at all when `shouldCapture` is true, so the
 * nothing-to-capture path stays fully synchronous (no extra microtask tick
 * before `port.onSubmit` fires) exactly as it did before this was split out.
 */
export async function attemptCapture(
  input: {
    hasInk: boolean;
    hasBox: boolean;
    hasCaptureTarget: boolean;
    captureViewport: boolean;
    noteTrimmed: string;
    extraFilesCount: number;
    requestSnapshot: () => Promise<PreviewSnapshot | null>;
    compositeWithBackground: (snap: PreviewSnapshot) => Promise<Blob | null>;
    t: Translate;
  },
  { now = () => new Date() }: { now?: () => Date } = {},
): Promise<CaptureAttemptOutcome> {
  const { hasInk, hasBox, hasCaptureTarget, captureViewport, noteTrimmed, extraFilesCount, requestSnapshot, compositeWithBackground, t } = input;
  const snap = await requestSnapshot();
  const blob = snap ? await compositeWithBackground(snap) : null;
  if (blob) {
    const ts = now().toISOString().replace(/[:.]/g, '-');
    return { kind: 'captured', file: new File([blob], `annotation-${ts}.png`, { type: 'image/png' }) };
  }
  if (noteTrimmed || extraFilesCount > 0) return { kind: 'skipped' };
  return { kind: 'warned', message: selectNoScreenshotMessage({ captureViewport, hasInk, hasBox, hasCaptureTarget }, t) };
}

/** Assembles the `AnnotationSubmitDetail` passed to `port.onSubmit` — the two "omit when empty" ternaries (`bounds`, `extraFiles`) that used to sit inline in the object literal. */
export function buildSubmitPayload(input: {
  file: File | null;
  note: string;
  action: AnnotationAction;
  filePath: string | undefined;
  captureTarget: CaptureTarget | null;
  markKind: 'click' | 'stroke' | 'click+stroke' | undefined;
  bounds: Rect | undefined;
  extraFiles: File[];
}): AnnotationSubmitDetail {
  const { file, note, action, filePath, captureTarget, markKind, bounds, extraFiles } = input;
  return {
    file,
    note,
    action,
    filePath: captureTarget?.filePath || filePath,
    markKind,
    bounds: markKind ? bounds : undefined,
    target: captureTarget,
    extraFiles: extraFiles.length ? extraFiles : undefined,
  };
}

/** Falls back to a default failure message when the port resolves `ok:false` with none of its own. */
export function describeSubmitFailure(result: { ok: boolean; message?: string | undefined }, t: Translate): string {
  return result.message || t('Could not submit this annotation.');
}

/** After a successful submit: flags it when capture was attempted but no file made it through (submitted on note/attachments alone). */
export function deriveSentWarning(
  input: { shouldCapture: boolean; file: File | null; action: AnnotationAction },
  t: Translate,
): { action: AnnotationAction; message: string } | null {
  const { shouldCapture, file, action } = input;
  return shouldCapture && !file ? { action, message: t('Sent without a screenshot — the note still went through.') } : null;
}

/** Builds every `SubmitOptionController` (send/draft/queue) plus the currently-selected one. */
export function buildSubmitOptionControllers(input: {
  submitRules: SubmitOptionRule[];
  sendDisabled: boolean;
  sendDisabledReason: string | undefined;
  submitAction: AnnotationAction;
  t: Translate;
}): { submitOptions: SubmitOptionController[]; currentSubmit: SubmitOptionController } {
  const { submitRules, sendDisabled, sendDisabledReason, submitAction, t } = input;
  const submitOptions: SubmitOptionController[] = submitRules.map((rule) => ({
    action: rule.action,
    label: t(rule.labelKey),
    pendingLabel: t(rule.pendingLabelKey),
    title: rule.action === 'send' && sendDisabled ? sendDisabledReason ?? t('Sending is unavailable right now.') : t(rule.labelKey),
    enabled: rule.enabled,
  }));
  // The `?? submitOptions[0]!` fallback is a TS-only safety net: at the
  // hook's real call site `submitAction` is typed `AnnotationAction`, and
  // `buildSubmitOptionRules` always returns exactly one entry per
  // `AnnotationAction` value, so `.find` can never actually miss there —
  // not covered by a test for the same reason a `!` assertion isn't. As a
  // standalone pure function, though, a caller can supply a `submitRules`
  // list that omits `submitAction`'s entry, which is exactly how this
  // module's own tests exercise the fallback honestly.
  const currentSubmit = submitOptions.find((opt) => opt.action === submitAction) ?? submitOptions[0]!;
  return { submitOptions, currentSubmit };
}

/** Builds every `MarkToolOptionController` (box/pen/text) plus the currently-selected one. */
export function buildMarkToolOptionControllers(input: { markTool: MarkTool; t: Translate }): {
  markToolOptions: MarkToolOptionController[];
  currentMarkTool: MarkToolOptionController;
} {
  const { markTool, t } = input;
  const markToolOptions: MarkToolOptionController[] = MARK_TOOL_OPTION_RULES.map((rule) => ({ tool: rule.tool, label: t(rule.labelKey) }));
  // Same reasoning as `buildSubmitOptionControllers`'s `currentSubmit` above:
  // `markTool` is typed `MarkTool` and `MARK_TOOL_OPTION_RULES` covers every
  // `MarkTool` value, so `.find` can never miss at the real call site.
  const currentMarkTool = markToolOptions.find((item) => item.tool === markTool) ?? markToolOptions[0]!;
  return { markToolOptions, currentMarkTool };
}
