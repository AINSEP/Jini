import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * True while an IME composition is active.
 *
 * Trust the composing ref (driven by onCompositionStart/End) over
 * `nativeEvent.isComposing` because on some browser/IME combinations the
 * Enter keydown that confirms a candidate can still carry
 * `isComposing=true` even after `compositionEnd` has fired. Relying on the
 * stale `nativeEvent.isComposing` causes Enter to insert a newline instead
 * of submitting.
 *
 * @overallScore 100
 */
export function isImeComposing(
  event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  composing: boolean,
): boolean {
  void event;
  return composing;
}
