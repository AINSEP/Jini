import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MentionEntity, RichTextInputHandle } from '../../types.js';
import { RichTextInput, type RichTextInputProps } from './RichTextInput.js';

const slack: MentionEntity = { id: 'slack', kind: 'connector', label: 'Slack', token: '@Slack' };

function baseProps(overrides: Partial<RichTextInputProps> = {}): RichTextInputProps {
  return {
    placeholder: 'Type a message',
    value: '',
    knownMentions: [],
    onChange: vi.fn(),
    onTriggerChange: vi.fn(),
    onSubmit: vi.fn(),
    popoverOpen: false,
    onPopoverKey: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

function getEditable(): HTMLElement {
  return screen.getByTestId('rich-text-input');
}

describe('RichTextInput', () => {
  it('renders the placeholder and a combobox-role contenteditable', () => {
    render(<RichTextInput {...baseProps()} />);
    // Lexical's `PlainTextPlugin` and `ContentEditable` each accept their
    // own `placeholder` prop and render it independently (one visible, one
    // inside an `aria-hidden` wrapper) — the origin passed the same
    // placeholder element to both, so this duplication is faithfully
    // ported, not a bug introduced here.
    expect(screen.getAllByText('Type a message')).toHaveLength(2);
    const editable = getEditable();
    expect(editable).toHaveAttribute('role', 'combobox');
    expect(editable).toHaveAttribute('aria-expanded', 'false');
    expect(editable).toHaveAttribute('aria-controls', 'rich-text-mention-listbox');
  });

  it('uses a custom testId and mentionListboxId', () => {
    render(<RichTextInput {...baseProps({ testId: 'my-input', mentionListboxId: 'my-listbox' })} />);
    const editable = screen.getByTestId('my-input');
    expect(editable).toHaveAttribute('aria-controls', 'my-listbox');
  });

  it('sets comboboxAria activedescendant/expanded when supplied', () => {
    render(
      <RichTextInput
        {...baseProps({ comboboxAria: { activeId: 'row-2', expanded: true } })}
      />,
    );
    const editable = getEditable();
    expect(editable).toHaveAttribute('aria-expanded', 'true');
    expect(editable).toHaveAttribute('aria-activedescendant', 'row-2');
  });

  it('seeds initial content from `value` (plain text)', () => {
    render(<RichTextInput {...baseProps({ value: 'hello there' })} />);
    expect(getEditable().textContent).toBe('hello there');
  });

  it('seeds a known mention as an atomic pill', () => {
    render(<RichTextInput {...baseProps({ value: 'hi @Slack', knownMentions: [slack] })} />);
    const pill = getEditable().querySelector('[data-mention]');
    expect(pill).not.toBeNull();
    expect(pill).toHaveAttribute('data-mention-id', 'slack');
    expect(pill!.textContent).toBe('@Slack');
  });

  describe('imperative handle', () => {
    it('getText/setText/clear/focus', async () => {
      const ref = createRef<RichTextInputHandle>();
      render(<RichTextInput {...baseProps()} ref={ref} />);
      act(() => {
        ref.current!.setText('abc');
      });
      expect(ref.current!.getText()).toBe('abc');
      act(() => {
        ref.current!.clear();
      });
      expect(ref.current!.getText()).toBe('');
      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
      // Lexical's `editor.focus()` applies the real DOM focus on a
      // microtask (so it lands after the pending update flushes), so a
      // purely synchronous `act()` doesn't observe it yet.
      await act(async () => {
        ref.current!.focus();
        await Promise.resolve();
      });
      expect(focusSpy).toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it('insertText inserts plain text at the caret', () => {
      const ref = createRef<RichTextInputHandle>();
      render(<RichTextInput {...baseProps()} ref={ref} />);
      act(() => {
        ref.current!.insertText('hi there');
      });
      expect(ref.current!.getText()).toBe('hi there');
    });

    it('insertMention inserts an atomic mention node followed by a space', () => {
      const ref = createRef<RichTextInputHandle>();
      render(<RichTextInput {...baseProps({ knownMentions: [slack] })} ref={ref} />);
      act(() => {
        ref.current!.insertMention({ token: '@Slack', entity: slack });
      });
      expect(ref.current!.getText()).toBe('@Slack ');
      const pill = getEditable().querySelector('[data-mention]');
      expect(pill).not.toBeNull();
      expect(pill).toHaveAttribute('data-mention-kind', 'connector');
    });

    it('insertMention falls back to the first configured trigger when mentionTriggerId matches none', () => {
      const ref = createRef<RichTextInputHandle>();
      render(
        <RichTextInput
          {...baseProps({
            knownMentions: [slack],
            triggers: [{ id: 'command', character: '/', anchor: 'line-start' }],
            mentionTriggerId: 'mention', // no trigger with this id exists
          })}
          ref={ref}
        />,
      );
      act(() => {
        ref.current!.insertMention({ token: '@Slack', entity: slack });
      });
      expect(ref.current!.getText()).toBe('@Slack ');
    });

    it("insertMention deletes the active mention-trigger query it's replacing", () => {
      const ref = createRef<RichTextInputHandle>();
      render(<RichTextInput {...baseProps({ knownMentions: [slack] })} ref={ref} />);
      act(() => {
        ref.current!.insertText('hi @sla');
      });
      act(() => {
        ref.current!.insertMention({ token: '@Slack', entity: slack });
      });
      expect(ref.current!.getText()).toBe('hi @Slack ');
    });

    it('replaceActiveTrigger works as the very first action (no prior selection set)', () => {
      const ref = createRef<RichTextInputHandle>();
      render(<RichTextInput {...baseProps()} ref={ref} />);
      act(() => {
        ref.current!.replaceActiveTrigger('hello');
      });
      expect(ref.current!.getText()).toBe('hello');
    });

    it('replaceActiveTrigger drops the active trigger token and inserts text', () => {
      const ref = createRef<RichTextInputHandle>();
      render(<RichTextInput {...baseProps()} ref={ref} />);
      act(() => {
        ref.current!.insertText('hi /he');
      });
      act(() => {
        ref.current!.replaceActiveTrigger('hello!');
      });
      expect(ref.current!.getText()).toBe('hi hello!');
    });

    it('getText collapses stray double newlines', () => {
      const ref = createRef<RichTextInputHandle>();
      render(<RichTextInput {...baseProps()} ref={ref} />);
      act(() => {
        ref.current!.insertText('a\n\n\nb');
      });
      expect(ref.current!.getText()).toBe('a\nb');
    });
  });

  it('calls onChange with the serialized text and mentions on a real edit', () => {
    const onChange = vi.fn();
    const ref = createRef<RichTextInputHandle>();
    render(<RichTextInput {...baseProps({ onChange, knownMentions: [slack] })} ref={ref} />);
    act(() => {
      ref.current!.insertText('hi @Slack');
    });
    expect(onChange).toHaveBeenCalledWith('hi @Slack', [slack]);
  });

  it('calls onTriggerChange when the caret sits inside an @mention query', () => {
    const onTriggerChange = vi.fn();
    const ref = createRef<RichTextInputHandle>();
    render(<RichTextInput {...baseProps({ onTriggerChange })} ref={ref} />);
    act(() => {
      ref.current!.insertText('hi @sla');
    });
    expect(onTriggerChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'mention', query: 'sla' }),
    );
  });

  it('submits on a real Enter keydown with no popover open', () => {
    const onSubmit = vi.fn();
    render(<RichTextInput {...baseProps({ onSubmit })} />);
    fireEvent.keyDown(getEditable(), { key: 'Enter', code: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('routes a real Enter keydown to onPopoverKey while the popover is open', () => {
    const onSubmit = vi.fn();
    const onPopoverKey = vi.fn().mockReturnValue(true);
    render(<RichTextInput {...baseProps({ onSubmit, popoverOpen: true, onPopoverKey })} />);
    fireEvent.keyDown(getEditable(), { key: 'Enter', code: 'Enter' });
    expect(onPopoverKey).toHaveBeenCalledWith('Enter');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('routes a real ArrowDown keydown to onPopoverKey while the popover is open', () => {
    const onPopoverKey = vi.fn().mockReturnValue(true);
    render(<RichTextInput {...baseProps({ popoverOpen: true, onPopoverKey })} />);
    fireEvent.keyDown(getEditable(), { key: 'ArrowDown', code: 'ArrowDown' });
    expect(onPopoverKey).toHaveBeenCalledWith('ArrowDown');
  });

  it('a real Backspace keydown removes a mention immediately before the caret', async () => {
    const ref = createRef<RichTextInputHandle>();
    render(<RichTextInput {...baseProps({ knownMentions: [slack] })} ref={ref} />);
    // `setText` (unlike `insertMention`) leaves the caret immediately after
    // the seeded mention with no trailing space in between — the case
    // `useMentionAtomicNavigation`'s Backspace handler must intercept
    // before Lexical's own default (jsdom-unsupported) text-deletion path
    // ever runs.
    act(() => {
      ref.current!.setText('@Slack');
    });
    const mentionSpan = getEditable().querySelector('[data-mention]');
    expect(mentionSpan).not.toBeNull();
    // A real user's cursor placement syncs the native DOM Selection, which
    // Lexical's native keydown handling reads from directly — `setText`
    // positions Lexical's own internal selection but jsdom doesn't
    // reliably mirror that onto `window.getSelection()` the way a real
    // browser's reconciliation would, so this collapses the native
    // selection to right after the mention <span> by hand.
    const paragraph = mentionSpan!.parentElement!;
    const range = document.createRange();
    range.setStart(paragraph, 1);
    range.collapse(true);
    const domSelection = window.getSelection()!;
    domSelection.removeAllRanges();
    domSelection.addRange(range);
    getEditable().focus();
    await act(async () => {
      fireEvent.keyDown(getEditable(), { key: 'Backspace', code: 'Backspace' });
      await Promise.resolve();
    });
    expect(getEditable().querySelector('[data-mention]')).toBeNull();
  });

  it('a real paste event with files calls onPasteFiles and not plain-text paste', () => {
    const onPasteFiles = vi.fn();
    render(<RichTextInput {...baseProps({ onPasteFiles })} />);
    const file = new File(['data'], 'a.png', { type: 'image/png' });
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', { value: { files: [file] } });
    act(() => {
      getEditable().dispatchEvent(pasteEvent);
    });
    expect(onPasteFiles).toHaveBeenCalledWith([file]);
  });

  it('applies resolveMentionColor to a real mounted mention pill', () => {
    const ref = createRef<RichTextInputHandle>();
    render(
      <RichTextInput
        {...baseProps({ knownMentions: [slack], resolveMentionColor: () => '#abc123' })}
        ref={ref}
      />,
    );
    act(() => {
      ref.current!.insertMention({ token: '@Slack', entity: slack });
    });
    const pill = getEditable().querySelector('[data-mention]') as HTMLElement;
    expect(pill.style.getPropertyValue('--rich-text-mention-color')).toBe('#abc123');
  });

  it('reseeds when `value` changes externally after mount', () => {
    const { rerender } = render(<RichTextInput {...baseProps({ value: 'first' })} />);
    expect(getEditable().textContent).toBe('first');
    rerender(<RichTextInput {...baseProps({ value: 'second' })} />);
    expect(getEditable().textContent).toBe('second');
  });

  it('supports a custom namespace and title', () => {
    render(<RichTextInput {...baseProps({ namespace: 'my-ns', title: 'Custom title' })} />);
    expect(getEditable()).toHaveAttribute('title', 'Custom title');
  });
});
