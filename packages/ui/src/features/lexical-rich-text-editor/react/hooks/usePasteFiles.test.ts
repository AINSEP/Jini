import { act, renderHook } from '@testing-library/react';
import { PASTE_COMMAND } from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import { makeLexicalWrapper } from '../test-support/lexical-harness.js';
import { usePasteFiles } from './usePasteFiles.js';

function pasteEventWithFiles(files: File[]): ClipboardEvent {
  const event = new Event('paste') as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { files },
    configurable: true,
  });
  return event;
}

describe('usePasteFiles', () => {
  it('intercepts a paste carrying files and calls onPasteFiles', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onPasteFiles = vi.fn();
    renderHook(() => usePasteFiles(onPasteFiles), { wrapper });
    const editor = getEditor();
    const file = new File(['data'], 'a.png', { type: 'image/png' });
    const event = pasteEventWithFiles([file]);
    const preventDefault = vi.spyOn(event, 'preventDefault');
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(PASTE_COMMAND, event);
    });
    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(onPasteFiles).toHaveBeenCalledWith([file]);
  });

  it('falls through (returns false) when the clipboard has no files', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onPasteFiles = vi.fn();
    renderHook(() => usePasteFiles(onPasteFiles), { wrapper });
    const editor = getEditor();
    const event = pasteEventWithFiles([]);
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(PASTE_COMMAND, event);
    });
    expect(handled).toBe(false);
    expect(onPasteFiles).not.toHaveBeenCalled();
  });

  it('falls through when clipboardData is absent entirely', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => usePasteFiles(vi.fn()), { wrapper });
    const editor = getEditor();
    const event = new Event('paste') as ClipboardEvent;
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(PASTE_COMMAND, event);
    });
    expect(handled).toBe(false);
  });

  it('does not throw when onPasteFiles is omitted and files are present', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => usePasteFiles(undefined), { wrapper });
    const editor = getEditor();
    const event = pasteEventWithFiles([new File(['x'], 'x.txt')]);
    let handled: boolean | undefined;
    expect(() => {
      act(() => {
        handled = editor.dispatchCommand(PASTE_COMMAND, event);
      });
    }).not.toThrow();
    expect(handled).toBe(true);
  });

  it('reads the latest onPasteFiles via ref across re-renders', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: (files: File[]) => void }) => usePasteFiles(cb), {
      wrapper,
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    const editor = getEditor();
    const event = pasteEventWithFiles([new File(['x'], 'x.txt')]);
    act(() => {
      editor.dispatchCommand(PASTE_COMMAND, event);
    });
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });
});
