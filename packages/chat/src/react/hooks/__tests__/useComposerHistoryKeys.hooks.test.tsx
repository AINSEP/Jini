/**
 * @file jsdom has no layout engine: `clientWidth` is always 0 and `Range` has no
 * `getBoundingClientRect`. The visual-line tests stub both — the fake layout puts each
 * `\n`-separated line 20px below the previous one, so "visual line" == "logical line" here.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { useRef, type RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComposerHistoryKeyInput, ComposerHistoryStoragePort } from '../../../core/composer-history.js';
import { useComposer, type UseComposerResult } from '../useComposer.js';
import { useComposerHistoryKeys } from '../useComposerHistoryKeys.hooks.js';

const NO_STORAGE: ComposerHistoryStoragePort = { read: async () => [], write: async () => {} };

interface HarnessProps {
  initial: string;
  /** What `navigate` recalls into the draft; `null` makes it decline (return false). */
  recall?: string | null;
  /** Drop the history controller entirely (`composer.history` undefined). */
  noHistory?: boolean;
  popupOpen?: boolean;
  /** Leave `textareaRef` detached from the rendered textarea. */
  detachRef?: boolean;
  inputs: ComposerHistoryKeyInput[];
  results: boolean[];
}

function Harness({ initial, recall = 'recalled entry text', noHistory = false, popupOpen, detachRef = false, inputs, results }: HarnessProps) {
  const base = useComposer({ initialDraft: initial, historyStorage: NO_STORAGE });
  const navigate = (input: ComposerHistoryKeyInput): boolean => {
    inputs.push(input);
    if (recall === null) return false;
    base.setDraft(recall);
    return true;
  };
  const { history: _omitted, ...withoutHistory } = base;
  const composer: UseComposerResult = noHistory ? withoutHistory : { ...base, history: { navigate, edit: () => {} } };
  const attached = useRef<HTMLTextAreaElement | null>(null);
  const detached = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef: RefObject<HTMLTextAreaElement | null> = detachRef ? detached : attached;
  const onKey = useComposerHistoryKeys({ composer, textareaRef }, popupOpen === undefined ? {} : { popupOpen });
  return <textarea data-testid="ta" ref={attached} value={base.draft} onChange={(e) => base.setDraft(e.target.value)} onKeyDown={(e) => results.push(onKey(e))} />;
}

function setup(props: Omit<HarnessProps, 'inputs' | 'results'>) {
  const inputs: ComposerHistoryKeyInput[] = [];
  const results: boolean[] = [];
  const view = render(<Harness {...props} inputs={inputs} results={results} />);
  const textarea = view.getByTestId('ta') as HTMLTextAreaElement;
  return { textarea, inputs, results };
}

function stubLayout(textarea: HTMLTextAreaElement, width: number) {
  Object.defineProperty(textarea, 'clientWidth', { value: width, configurable: true });
  Range.prototype.getBoundingClientRect = function (this: Range) {
    const before = (this.startContainer.textContent ?? '').slice(0, this.startOffset);
    return new DOMRect(0, before.split('\n').length * 20, 0, 0);
  };
}

afterEach(() => {
  // @ts-expect-error -- removing the test-only stub; jsdom's Range does not define it.
  delete Range.prototype.getBoundingClientRect;
});

describe('useComposerHistoryKeys', () => {
  it('hands ArrowUp to navigate with the text, selection and modifier flags, and reports it handled', () => {
    const { textarea, inputs, results } = setup({ initial: 'draft' });
    textarea.setSelectionRange(2, 3);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(inputs).toEqual([{ key: 'ArrowUp', text: 'draft', selectionStart: 2, selectionEnd: 3, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }]);
    expect(results).toEqual([true]);
  });

  it('places the caret at the start of the recalled text after ArrowUp', () => {
    const { textarea } = setup({ initial: 'draft', recall: 'a much longer recalled entry' });
    textarea.setSelectionRange(5, 5);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(textarea.value).toBe('a much longer recalled entry');
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([0, 0]);
  });

  it('places the caret at the end of the recalled (longer) text after ArrowDown, once the new value commits', () => {
    const { textarea } = setup({ initial: 'ab', recall: 'a much longer recalled entry' });
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([28, 28]);
  });

  it('places the caret at the end after Escape', () => {
    const { textarea } = setup({ initial: 'ab', recall: 'restored draft' });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(textarea.selectionStart).toBe(14);
  });

  it('places the caret even when the recall equals the current value (no re-render of the value)', () => {
    const { textarea } = setup({ initial: 'same text', recall: 'same text' });
    textarea.setSelectionRange(4, 4);
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(textarea.selectionStart).toBe(9);
  });

  it('prevents the default action only when navigate handled the key', () => {
    const handled = setup({ initial: 'x' });
    expect(fireEvent.keyDown(handled.textarea, { key: 'ArrowUp' })).toBe(false);
  });

  it('returns false and leaves the default action when navigate declines', () => {
    const { textarea, results } = setup({ initial: 'x', recall: null });
    expect(fireEvent.keyDown(textarea, { key: 'ArrowUp' })).toBe(true);
    expect(results).toEqual([false]);
  });

  it('returns false when the composer has no history controller', () => {
    const { textarea, results } = setup({ initial: 'x', noHistory: true });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(results).toEqual([false]);
  });

  it.each([['shiftKey'], ['ctrlKey'], ['altKey'], ['metaKey']])('ignores the key when %s is held', (modifier) => {
    const { textarea, inputs, results } = setup({ initial: 'x' });
    fireEvent.keyDown(textarea, { key: 'ArrowUp', [modifier]: true });
    expect([inputs.length, results]).toEqual([0, [false]]);
  });

  it('ignores a key whose default was already prevented', () => {
    const { textarea, inputs, results } = setup({ initial: 'x' });
    textarea.addEventListener('keydown', (e) => e.preventDefault(), { capture: true });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect([inputs.length, results]).toEqual([0, [false]]);
  });

  it('ignores keys while a popup is open', () => {
    const { textarea, inputs, results } = setup({ initial: 'x', popupOpen: true });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect([inputs.length, results]).toEqual([0, [false]]);
  });

  it('ignores keys during IME composition', () => {
    const { textarea, inputs, results } = setup({ initial: 'x' });
    fireEvent.keyDown(textarea, { key: 'ArrowUp', isComposing: true });
    expect([inputs.length, results]).toEqual([0, [false]]);
  });

  it('ignores the legacy IME keyCode 229', () => {
    const { textarea, inputs, results } = setup({ initial: 'x' });
    fireEvent.keyDown(textarea, { key: 'ArrowUp', keyCode: 229 });
    expect([inputs.length, results]).toEqual([0, [false]]);
  });

  it('ignores keys other than ArrowUp, ArrowDown and Escape', () => {
    const { textarea, inputs, results } = setup({ initial: 'x' });
    fireEvent.keyDown(textarea, { key: 'ArrowLeft' });
    expect([inputs.length, results]).toEqual([0, [false]]);
  });

  it('does not touch the caret again after commit when textareaRef is detached', () => {
    const { textarea, results } = setup({ initial: 'ab', recall: 'a much longer recalled entry', detachRef: true });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    // jsdom moves the caret to the end when React writes the new value; with the ref detached
    // the post-commit placement that would move it back to the start never runs.
    expect([results, textarea.selectionStart]).toEqual([[true], 28]);
  });

  it('reports firstLine/lastLine from the measured visual lines when the textarea has a width', () => {
    const { textarea, inputs } = setup({ initial: 'one\ntwo\nthree', recall: null });
    stubLayout(textarea, 200);
    const childCount = document.body.childElementCount;
    textarea.setSelectionRange(1, 2);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    textarea.setSelectionRange(10, 10);
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    textarea.setSelectionRange(5, 5);
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(inputs.map((i) => [i.firstLine, i.lastLine])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
    // The measuring mirror is removed again.
    expect(document.body.childElementCount).toBe(childCount);
  });

  it('treats a selection spanning lines as on neither boundary line', () => {
    const { textarea, inputs } = setup({ initial: 'one\ntwo', recall: null });
    stubLayout(textarea, 200);
    textarea.setSelectionRange(0, 7);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect([inputs[0]?.firstLine, inputs[0]?.lastLine]).toEqual([false, false]);
  });

  it('reports a single-line value as both the first and last line', () => {
    const { textarea, inputs } = setup({ initial: 'single', recall: null });
    stubLayout(textarea, 200);
    textarea.setSelectionRange(3, 3);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect([inputs[0]?.firstLine, inputs[0]?.lastLine]).toEqual([true, true]);
  });

  it('omits firstLine/lastLine when the textarea has no width (not laid out)', () => {
    const { textarea, inputs } = setup({ initial: 'x', recall: null });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect('firstLine' in inputs[0]! || 'lastLine' in inputs[0]!).toBe(false);
  });

  it('removes the measuring mirror even when measuring throws', () => {
    const { textarea, results } = setup({ initial: 'x', recall: null });
    stubLayout(textarea, 200);
    Range.prototype.getBoundingClientRect = () => {
      throw new Error('layout unavailable');
    };
    const childCount = document.body.childElementCount;
    const onError = vi.fn((e: ErrorEvent) => e.preventDefault());
    window.addEventListener('error', onError);
    act(() => {
      fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    });
    window.removeEventListener('error', onError);
    expect(onError.mock.calls[0]?.[0].error).toEqual(new Error('layout unavailable'));
    expect([results, document.body.childElementCount]).toEqual([[], childCount]);
  });
});
