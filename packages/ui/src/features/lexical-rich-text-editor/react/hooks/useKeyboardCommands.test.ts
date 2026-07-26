import { act, renderHook } from '@testing-library/react';
import {
  INSERT_LINE_BREAK_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalCommand,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLexicalWrapper } from '../test-support/lexical-harness.js';
import { useKeyboardCommands } from './useKeyboardCommands.js';

function enterEvent(overrides: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Enter', ...overrides });
}

describe('useKeyboardCommands', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Shift+Enter inserts a line break and prevents default', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onSubmit = vi.fn();
    const onPopoverKey = vi.fn();
    renderHook(() => useKeyboardCommands(false, onSubmit, onPopoverKey), { wrapper });
    const editor = getEditor();
    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand');
    const event = enterEvent({ shiftKey: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_ENTER_COMMAND, event);
    });
    expect(handled).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_LINE_BREAK_COMMAND, false);
    expect(preventDefault).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Cmd/Ctrl+Enter force-submits even when the popover is open', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onSubmit = vi.fn();
    const onPopoverKey = vi.fn();
    renderHook(() => useKeyboardCommands(true, onSubmit, onPopoverKey), { wrapper });
    const editor = getEditor();
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_ENTER_COMMAND, enterEvent({ metaKey: true }));
    });
    expect(handled).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onPopoverKey).not.toHaveBeenCalled();
  });

  it('plain Enter routes to the popover when it is open', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onSubmit = vi.fn();
    const onPopoverKey = vi.fn().mockReturnValue(true);
    renderHook(() => useKeyboardCommands(true, onSubmit, onPopoverKey), { wrapper });
    const editor = getEditor();
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_ENTER_COMMAND, enterEvent());
    });
    expect(onPopoverKey).toHaveBeenCalledWith('Enter');
    expect(handled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('plain Enter submits when no popover is open', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onSubmit = vi.fn();
    const onPopoverKey = vi.fn();
    renderHook(() => useKeyboardCommands(false, onSubmit, onPopoverKey), { wrapper });
    const editor = getEditor();
    act(() => {
      editor.dispatchCommand(KEY_ENTER_COMMAND, enterEvent());
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Enter is ignored while IME composition is in progress', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onSubmit = vi.fn();
    const onPopoverKey = vi.fn();
    renderHook(() => useKeyboardCommands(false, onSubmit, onPopoverKey), { wrapper });
    const editor = getEditor();
    vi.spyOn(editor, 'isComposing').mockReturnValue(true);
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_ENTER_COMMAND, enterEvent());
    });
    expect(handled).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('handles a null event payload on Enter (submits, since no popover/shift/meta apply)', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onSubmit = vi.fn();
    const onPopoverKey = vi.fn();
    renderHook(() => useKeyboardCommands(false, onSubmit, onPopoverKey), { wrapper });
    const editor = getEditor();
    act(() => {
      editor.dispatchCommand(KEY_ENTER_COMMAND, null);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  const popoverNavCases: Array<{
    key: 'ArrowDown' | 'ArrowUp' | 'Tab';
    command: LexicalCommand<KeyboardEvent>;
  }> = [
    { key: 'ArrowDown', command: KEY_ARROW_DOWN_COMMAND },
    { key: 'ArrowUp', command: KEY_ARROW_UP_COMMAND },
    { key: 'Tab', command: KEY_TAB_COMMAND },
  ];

  it.each(popoverNavCases)('$key routes to the popover only while it is open', ({ key, command }) => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onPopoverKey = vi.fn().mockReturnValue(true);
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useKeyboardCommands(open, vi.fn(), onPopoverKey),
      { wrapper, initialProps: { open: false } },
    );
    const editor = getEditor();

    act(() => {
      const handled = editor.dispatchCommand(command, new KeyboardEvent('keydown', { key }));
      expect(handled).toBe(false);
    });
    expect(onPopoverKey).not.toHaveBeenCalled();

    rerender({ open: true });
    act(() => {
      const handled = editor.dispatchCommand(command, new KeyboardEvent('keydown', { key }));
      expect(handled).toBe(true);
    });
    expect(onPopoverKey).toHaveBeenCalledWith(key);
  });

  it('does not route arrow/tab to the popover while IME composition is in progress', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onPopoverKey = vi.fn().mockReturnValue(true);
    renderHook(() => useKeyboardCommands(true, vi.fn(), onPopoverKey), { wrapper });
    const editor = getEditor();
    vi.spyOn(editor, 'isComposing').mockReturnValue(true);
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_ARROW_DOWN_COMMAND, new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    expect(handled).toBe(false);
    expect(onPopoverKey).not.toHaveBeenCalled();
  });

  it('Escape routes to the popover only while it is open', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onPopoverKey = vi.fn().mockReturnValue(true);
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useKeyboardCommands(open, vi.fn(), onPopoverKey),
      { wrapper, initialProps: { open: false } },
    );
    const editor = getEditor();
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_ESCAPE_COMMAND, new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(handled).toBe(false);
    rerender({ open: true });
    act(() => {
      editor.dispatchCommand(KEY_ESCAPE_COMMAND, new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onPopoverKey).toHaveBeenCalledWith('Escape');
  });

  it('rewrites INSERT_PARAGRAPH_COMMAND into a line break (single-paragraph model)', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useKeyboardCommands(false, vi.fn(), vi.fn()), { wrapper });
    const editor = getEditor();
    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand');
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
    });
    expect(handled).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_LINE_BREAK_COMMAND, false);
  });
});
