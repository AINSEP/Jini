import { useLayoutEffect, useReducer, useRef, type KeyboardEvent, type RefObject } from 'react';
import type { UseComposerResult } from './useComposer.js';

/** Measures visual lines as well as newlines, so a wrapped paragraph keeps native arrow motion. */
function visualLineBounds({ textarea }: { textarea: HTMLTextAreaElement }) {
  if (textarea.clientWidth === 0) return {};
  const computed = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const property of ['font', 'letter-spacing', 'word-spacing', 'line-height', 'text-indent', 'padding', 'tab-size', 'word-break', 'overflow-wrap', 'direction']) {
    mirror.style.setProperty(property, computed.getPropertyValue(property));
  }
  mirror.style.position = 'fixed';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.boxSizing = 'border-box';
  mirror.style.width = `${textarea.clientWidth}px`;
  const text = document.createTextNode(textarea.value);
  mirror.append(text, document.createTextNode('\u200b'));
  document.body.append(mirror);
  try {
    const lineAt = (offset: number) => {
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset);
      return range.getBoundingClientRect().top;
    };
    const first = lineAt(0);
    const last = lineAt(text.length);
    // Both selection endpoints must be on the boundary visual line. Selecting across soft
    // wraps should stay native just like selecting across explicit newline characters.
    const start = lineAt(textarea.selectionStart);
    const end = lineAt(textarea.selectionEnd);
    return { firstLine: Math.abs(start - first) < 1 && Math.abs(end - first) < 1, lastLine: Math.abs(start - last) < 1 && Math.abs(end - last) < 1 };
  } finally {
    mirror.remove();
  }
}

type CaretPlacement = 'start' | 'end';

function placeCaret(textarea: HTMLTextAreaElement, { placement }: { placement: CaretPlacement }): void {
  const offset = placement === 'start' ? 0 : textarea.value.length;
  textarea.setSelectionRange(offset, offset);
}

function hasModifier(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.shiftKey || event.ctrlKey || event.altKey || event.metaKey;
}

/** Keys another handler or an IME already owns, or that an open popup should get instead. */
function isClaimedElsewhere(event: KeyboardEvent<HTMLTextAreaElement>, { popupOpen }: { popupOpen: boolean }): boolean {
  return event.defaultPrevented || popupOpen || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

function isHistoryKey(event: KeyboardEvent<HTMLTextAreaElement>, { popupOpen }: { popupOpen: boolean }): boolean {
  if (hasModifier(event) || isClaimedElsewhere(event, { popupOpen })) return false;
  return ['ArrowUp', 'ArrowDown', 'Escape'].includes(event.key);
}

export function useComposerHistoryKeys(
  { composer, textareaRef }: { composer: UseComposerResult; textareaRef: RefObject<HTMLTextAreaElement | null> },
  { popupOpen = false }: { popupOpen?: boolean } = {},
) {
  const pendingCaretRef = useRef<CaretPlacement | null>(null);
  // A duplicate history entry can equal the current value, so setDraft may bail out.
  // Still commit the caret request now rather than carrying it into the next real edit.
  const [, requestCaretCommit] = useReducer((revision: number) => revision + 1, 0);
  useLayoutEffect(() => {
    const placement = pendingCaretRef.current;
    if (!placement) return;
    pendingCaretRef.current = null;
    const textarea = textareaRef.current;
    if (textarea) placeCaret(textarea, { placement });
  });

  return (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!isHistoryKey(event, { popupOpen })) return false;
    const textarea = event.currentTarget;
    const handled = composer.history?.navigate({
      key: event.key,
      text: textarea.value,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      ...visualLineBounds({ textarea }),
    }) ?? false;
    if (handled) {
      event.preventDefault();
      // React's controlled value lands on the following commit. Placing the caret before
      // that commit clamps it to the OLD draft's length and breaks multiline Down gating.
      // Up stays on the first line of even a multiline recall so repeated Up can browse
      // older entries. Down/Escape go to the end, including when restoring the draft.
      const placement: CaretPlacement = event.key === 'ArrowUp' ? 'start' : 'end';
      pendingCaretRef.current = placement;
      requestCaretCommit();
      // Recalling an identical string may not cause a render; the existing value is safe.
      placeCaret(textarea, { placement });
    }
    return handled;
  };
}
