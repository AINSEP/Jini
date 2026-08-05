import {
  buildScrollAnchors,
  mapScrollPosition,
  measureEditorBlockOffsets,
  measurePreviewBlockOffsets,
} from '../../utils/markdown-scroll-sync.js';
import type { CommentSideDropEdge, MarkdownScrollPane, ViewerCommentBase } from './types.js';

// ---------------------------------------------------------------------------
// Byte/size formatting
// ---------------------------------------------------------------------------

/** Human-readable file size (`"512 B"` / `"3.4 KB"` / `"1.2 MB"`). Ported
 *  verbatim (no OD coupling in the original — a pure number formatter). */
export function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Comment side-panel: drag-reorder + saved-order bookkeeping
// ---------------------------------------------------------------------------

/** Which edge of the drop target a pointer is over, based on the event's
 *  vertical position relative to the target element's own bounding rect. */
export function dropEdgeForClientY(clientY: number, targetRect: { top: number; height: number }): CommentSideDropEdge {
  return clientY < targetRect.top + targetRect.height / 2 ? 'before' : 'after';
}

/** Recompute an ordered id list after dragging `draggingId` to sit
 *  before/after `targetId`. Returns the original order unchanged if either
 *  id is missing. */
export function reorderCommentIds(
  ids: string[],
  draggingId: string,
  targetId: string,
  edge: CommentSideDropEdge,
): string[] {
  const next = [...ids];
  const from = next.indexOf(draggingId);
  if (from < 0) return next;
  const [draggedId] = next.splice(from, 1);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0 || !draggedId) return ids;
  next.splice(edge === 'after' ? targetIndex + 1 : targetIndex, 0, draggedId);
  return next;
}

/** Append a newly-saved comment id to a persisted order list, reconciling it
 *  against the currently-visible comment ids first (drops ids that are no
 *  longer visible, keeps visible ids not yet in the saved order). Returns the
 *  same array reference when nothing actually changed. */
export function appendSavedCommentOrder(
  currentOrderIds: string[],
  visibleIds: string[],
  savedId: string,
): string[] {
  if (!savedId) return currentOrderIds;
  if (currentOrderIds.includes(savedId) || visibleIds.includes(savedId)) {
    return currentOrderIds;
  }
  const visibleIdSet = new Set(visibleIds);
  const kept = currentOrderIds.filter((id) => visibleIdSet.has(id));
  const missingVisibleIds = visibleIds.filter((id) => !kept.includes(id));
  const base = currentOrderIds.length > 0 ? [...kept, ...missingVisibleIds] : visibleIds;
  const next = [...base, savedId];
  return next.join('\0') === currentOrderIds.join('\0') ? currentOrderIds : next;
}

/** Default "just now / 5 minutes ago / 3 days ago" relative-time formatter.
 *  Pure given a `now` timestamp — callers wrap the result in `t()` at the
 *  call site (see the i18n policy in
 *  `ADS-memory/reports/jini-port/god-components-extraction-plan.md`). Returns a
 *  `{ key, vars }` pair rather than a finished string so a host's `t()` can
 *  supply its own plural/locale-aware phrasing; `key` is always one of a
 *  small fixed set of English template strings. */
export function relativeCommentTimeTranslation(
  timestampMs: number,
  nowMs: number = Date.now(),
): { key: string; vars?: Record<string, number> } {
  const diff = nowMs - timestampMs;
  if (diff < 60_000) return { key: 'Just now' };
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return { key: '{n} minutes ago', vars: { n: mins } };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { key: '{n} hours ago', vars: { n: hours } };
  const days = Math.floor(hours / 24);
  if (days < 7) return { key: '{n} days ago', vars: { n: days } };
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return { key: '{n} weeks ago', vars: { n: weeks } };
  return { key: new Date(timestampMs).toLocaleDateString() };
}

/** Selection-count bookkeeping shared by the comment side-panel. */
export function visibleSelectedCommentIds<TComment extends ViewerCommentBase>(
  comments: TComment[],
  selectedIds: ReadonlySet<string>,
): Set<string> {
  return new Set(comments.filter((comment) => selectedIds.has(comment.id)).map((comment) => comment.id));
}

// ---------------------------------------------------------------------------
// JSON-safe text formatting (used by a plain-text viewer body)
// ---------------------------------------------------------------------------

/** True when re-serializing `text` through `JSON.parse`/`JSON.stringify`
 *  would silently change a number's printed form — e.g. `-0`, or a value
 *  whose decimal digits round-trip differently once parsed into a JS
 *  `number`. When true, callers should display the original text verbatim
 *  instead of a "prettified" re-stringify. */
export function hasPrecisionSensitiveJsonNumberText(text: string): boolean {
  let inString = false;
  let escaped = false;
  const numberTokenPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  for (let i = 0; i < text.length; ) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      i += 1;
      continue;
    }

    numberTokenPattern.lastIndex = i;
    const match = numberTokenPattern.exec(text);
    if (!match) {
      i += 1;
      continue;
    }

    const token = match[0];
    if (isSignedNegativeZeroJsonNumberToken(token)) return true;
    if (/[.eE]/.test(token) && isPrecisionSensitiveJsonNumberToken(token)) return true;
    i = numberTokenPattern.lastIndex;
  }
  return false;
}

function isSignedNegativeZeroJsonNumberToken(token: string): boolean {
  return /^-0(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(token);
}

function isPrecisionSensitiveJsonNumberToken(token: string): boolean {
  const parsed = Number(token);
  if (!Number.isFinite(parsed)) return true;
  // `JSON.stringify` of a finite number always returns a non-empty numeral
  // string ("0" at minimum) — there is no finite input for which it returns
  // "" or another falsy value, so the defensive `!rendered` check this line
  // replaces (present in the original source) could never actually fire.
  const rendered = JSON.stringify(parsed);
  const originalValue = parseJsonNumberTokenAsDecimal(token);
  const renderedValue = parseJsonNumberTokenAsDecimal(rendered);
  return originalValue.coefficient !== renderedValue.coefficient || originalValue.exponent !== renderedValue.exponent;
}

function parseJsonNumberTokenAsDecimal(token: string): { coefficient: bigint; exponent: number } {
  // Both call sites above only ever pass a well-formed decimal/exponential
  // JSON number literal: either a value matched by
  // `hasPrecisionSensitiveJsonNumberText`'s own number-token regex (a strict
  // subset of the pattern below — no leading zeros, always digits either
  // side of `.`) or `JSON.stringify` output of a finite number (guaranteed
  // by the JS spec to already be in this exact shape). So this match is
  // guaranteed to succeed; the non-null assertion exists only to satisfy
  // TypeScript's `RegExpExecArray | null` return type, not because there is
  // a real runtime path where it fails.
  const match = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)!;
  const [, sign, integerPart, fractionPart = '', exponentPart = '0'] = match;
  const coefficient = BigInt(`${sign ?? ''}${integerPart}${fractionPart}`);
  const exponent = Number(exponentPart) - fractionPart.length;
  return normalizeDecimalParts(coefficient, exponent);
}

function normalizeDecimalParts(coefficient: bigint, exponent: number): { coefficient: bigint; exponent: number } {
  if (coefficient === 0n) return { coefficient: 0n, exponent: 0 };
  let normalizedCoefficient = coefficient;
  let normalizedExponent = exponent;
  while (normalizedCoefficient % 10n === 0n) {
    normalizedCoefficient /= 10n;
    normalizedExponent += 1;
  }
  return { coefficient: normalizedCoefficient, exponent: normalizedExponent };
}

/** True when `value` (already `JSON.parse`d) contains any non-finite number
 *  or an integer outside `Number.isSafeInteger` range. */
export function hasUnsafeJsonNumber(value: unknown): boolean {
  if (typeof value === 'number') {
    return !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value));
  }
  if (Array.isArray(value)) return value.some(hasUnsafeJsonNumber);
  if (value && typeof value === 'object') return Object.values(value).some(hasUnsafeJsonNumber);
  return false;
}

/**
 * Pretty-print `text` as JSON when `isJsonLike` is true and doing so is
 * provably safe (no precision loss) — otherwise returns `text` unchanged.
 * `isJsonLike` is a plain boolean the caller derives from its own file-kind
 * check (e.g. `file.name.endsWith('.json')`), not baked in here, since what
 * counts as "this is a JSON file" is host-specific.
 */
export function formatJsonTextForDisplay(text: string, isJsonLike: boolean): string {
  if (!isJsonLike) return text;
  try {
    if (hasPrecisionSensitiveJsonNumberText(text)) return text;
    const parsed = JSON.parse(text) as unknown;
    if (hasUnsafeJsonNumber(parsed)) return text;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Split source/preview pane scroll-sync
// ---------------------------------------------------------------------------

/** Full scrollable range of `element` (0 when there's nothing to scroll). */
export function scrollRange(element: { scrollHeight: number; clientHeight: number }): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

/** `element`'s current scroll position as a 0..1 ratio of its scrollable
 *  range (0 when there's nothing to scroll). */
export function scrollRatio(element: { scrollHeight: number; clientHeight: number; scrollTop: number }): number {
  const range = scrollRange(element);
  return range > 0 ? element.scrollTop / range : 0;
}

/** Inverse of {@link scrollRatio}: the scrollTop that puts `element` at
 *  `ratio` (0..1, clamped) of its scrollable range. */
export function scrollTopForRatio(
  element: { scrollHeight: number; clientHeight: number },
  ratio: number,
): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return scrollRange(element) * clamped;
}

/**
 * Compute the target pane's scrollTop that keeps it aligned with the source
 * pane, given the shared per-block line numbers (from
 * `extractMarkdownBlockLines`, already ported to `../../utils/markdown-scroll-sync.js`).
 * Falls back to plain ratio-sync when block-level anchors can't be measured
 * (e.g. the rendered preview's direct-child count doesn't match the block
 * count — see `measurePreviewBlockOffsets`'s own doc comment).
 */
export function computeSplitPaneScrollTarget(params: {
  sourcePane: MarkdownScrollPane;
  source: { scrollTop: number; scrollHeight: number; clientHeight: number };
  target: { scrollHeight: number; clientHeight: number };
  blockLineCount: number;
  editorOffsets: number[] | null;
  previewOffsets: number[] | null;
}): number {
  const { sourcePane, source, target, blockLineCount, editorOffsets, previewOffsets } = params;
  if (blockLineCount > 0 && editorOffsets && previewOffsets) {
    const isEditorSource = sourcePane === 'editor';
    const sourceOffsets = isEditorSource ? editorOffsets : previewOffsets;
    const targetOffsets = isEditorSource ? previewOffsets : editorOffsets;
    const sourceAnchors = buildScrollAnchors(sourceOffsets, source.scrollHeight);
    const targetAnchors = buildScrollAnchors(targetOffsets, target.scrollHeight);
    const mapped = mapScrollPosition(source.scrollTop, sourceAnchors, targetAnchors);
    return Math.max(0, Math.min(scrollRange(target), mapped));
  }
  return scrollTopForRatio(target, scrollRatio(source));
}

export { measureEditorBlockOffsets, measurePreviewBlockOffsets };
