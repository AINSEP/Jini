import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../core/messages.js';
import type { ComposerHistoryStoragePort } from '../../../core/composer-history.js';
import type { ComposerSlots } from '../../slots.js';
import { useComposer } from '../../hooks/useComposer.js';
import { Composer } from '../Composer.js';

const user = (id: string, content: string): ChatMessage => ({ id, role: 'user', content });
function port() {
  let saved: readonly string[] = [];
  return { read: vi.fn(async () => saved), write: vi.fn(async ({ entries }: { entries: readonly string[] }) => { saved = [...entries]; }) };
}
function Harness({ storage, initialDraft = '', initialMessages = [user('old', 'old prompt'), user('last', 'last prompt')], slots, mentionOpen = false }: {
  storage: ComposerHistoryStoragePort;
  initialDraft?: string;
  initialMessages?: ChatMessage[];
  slots?: ComposerSlots;
  mentionOpen?: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const composer = useComposer({ initialDraft, historyMessages: messages, historyScope: 'alice', historyStorage: storage });
  return <Composer composer={mentionOpen ? { ...composer, mention: { open: true, query: 'x', results: [] } } : composer} onSend={() => {
    setMessages((previous) => [...previous, user(`sent-${previous.length}`, composer.draft)]);
    composer.reset();
  }} {...(slots ? { slots } : {})} />;
}
function textarea() { return screen.getByRole('textbox') as HTMLTextAreaElement; }
function press(key: string, start: number, end = start, extra = {}) {
  const input = textarea();
  input.setSelectionRange(start, end);
  return fireEvent.keyDown(input, { key, ...extra });
}

describe('Composer prompt recall keys', () => {
  it('recalls repeatedly and Down restores a non-empty exact draft with its caret at the end', () => {
    const draft = '  a draft\nwith spaces  \n';
    render(<Harness storage={port()} initialDraft={draft} />);
    expect(press('ArrowUp', 3)).toBe(false);
    expect(textarea().value).toBe('last prompt');
    press('ArrowUp', textarea().value.length);
    expect(textarea().value).toBe('old prompt');
    press('ArrowDown', textarea().value.length);
    expect(textarea().value).toBe('last prompt');
    press('ArrowDown', textarea().value.length);
    expect(textarea().value).toBe(draft);
    expect(textarea().selectionStart).toBe(draft.length);
    expect(textarea().selectionEnd).toBe(draft.length);
  });

  it('repeated Up walks multiline recalled entries while Down remains gated to the last line', () => {
    render(<Harness storage={port()} initialDraft="draft" initialMessages={[user('a', 'older\nentry'), user('b', 'newer\nentry')]} />);
    press('ArrowUp', 0);
    expect(textarea().value).toBe('newer\nentry');
    expect(textarea().selectionStart).toBe(0);
    fireEvent.keyDown(textarea(), { key: 'ArrowUp' });
    expect(textarea().value).toBe('older\nentry');
    expect(press('ArrowDown', 0)).toBe(true);
    expect(textarea().value).toBe('older\nentry');
    press('ArrowDown', textarea().value.length);
    expect(textarea().value).toBe('newer\nentry');
    fireEvent.keyDown(textarea(), { key: 'ArrowDown' });
    expect(textarea().value).toBe('draft');
    expect(textarea().selectionStart).toBe(5);
  });

  it('Escape restores an empty draft; copying/selecting recall does not replace the stash', () => {
    render(<Harness storage={port()} />);
    press('ArrowUp', 0);
    textarea().setSelectionRange(0, textarea().value.length);
    fireEvent.copy(textarea());
    press('Escape', 0, textarea().value.length);
    expect(textarea().value).toBe('');
    expect(textarea().selectionStart).toBe(0);
  });

  it('keeps native multiline movement and selections spanning lines', () => {
    const draft = 'first\nmiddle\nlast';
    render(<Harness storage={port()} initialDraft={draft} />);
    expect(press('ArrowUp', 8)).toBe(true);
    expect(press('ArrowDown', 8)).toBe(true);
    expect(press('ArrowUp', 0, 8)).toBe(true);
    expect(textarea().value).toBe(draft);
    press('ArrowUp', 2);
    expect(textarea().value).toBe('last prompt');
  });

  it.each(['shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'isComposing'])('leaves %s arrow events native', (flag) => {
    render(<Harness storage={port()} initialDraft="draft" />);
    expect(press('ArrowUp', 0, 0, { [flag]: true })).toBe(true);
    expect(textarea().value).toBe('draft');
  });

  it('ignores legacy IME keyCode 229 even if isComposing is false', () => {
    render(<Harness storage={port()} initialDraft="draft" />);
    expect(press('ArrowUp', 0, 0, { keyCode: 229 })).toBe(true);
    expect(textarea().value).toBe('draft');
  });

  it('editing recalled text ends browsing; a new browse restores that edited working text', () => {
    render(<Harness storage={port()} initialDraft="original draft" />);
    press('ArrowUp', 0);
    fireEvent.change(textarea(), { target: { value: 'last prompt edited' } });
    expect(press('Escape', 0)).toBe(true);
    expect(textarea().value).toBe('last prompt edited');
    press('ArrowUp', 0);
    expect(textarea().value).toBe('last prompt');
    press('ArrowDown', textarea().value.length);
    expect(textarea().value).toBe('last prompt edited');
  });

  it('sending clears browse state and makes sent text available in a new chat after remount', async () => {
    const storage = port();
    const { unmount } = render(<Harness storage={storage} initialDraft="old working draft" />);
    await waitFor(() => expect(storage.write).toHaveBeenCalled());
    press('ArrowUp', 0);
    fireEvent.change(textarea(), { target: { value: 'amended send' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(textarea().value).toBe('');
    expect(press('Escape', 0)).toBe(true);
    await waitFor(() => expect(storage.write).toHaveBeenLastCalledWith({ scope: 'alice', entries: ['old prompt', 'last prompt', 'amended send'] }, {}));
    unmount();
    const previousWrites = storage.write.mock.calls.length;
    render(<Harness storage={storage} initialMessages={[]} />);
    await waitFor(() => expect(storage.write.mock.calls.length).toBeGreaterThan(previousWrites));
    expect(storage.read).toHaveBeenCalledTimes(2);
    press('ArrowUp', 0);
    expect(textarea().value).toBe('amended send');
  });

  it('sending an unedited recalled entry discards the original draft stash', () => {
    render(<Harness storage={port()} initialDraft="must not come back" />);
    press('ArrowUp', 0);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(textarea().value).toBe('');
    expect(press('Escape', 0)).toBe(true);
    expect(textarea().value).toBe('');
    press('ArrowUp', 0);
    expect(textarea().value).toBe('last prompt');
    press('ArrowDown', textarea().value.length);
    expect(textarea().value).toBe('');
  });

  it('does not recall while a mention popup is open', () => {
    render(<Harness storage={port()} initialDraft="draft" mentionOpen />);
    expect(press('ArrowUp', 0)).toBe(true);
    expect(textarea().value).toBe('draft');
  });

  it('gives slash suggestions and the context menu priority over recall', () => {
    const slots: ComposerSlots = { discoveryGroups: [{ id: 'tools', label: 'Tools', items: [{ id: 'tool', label: 'Tool', kind: 'skill', insertText: 'inserted' }] }] };
    render(<Harness storage={port()} initialDraft="/" slots={slots} />);
    press('ArrowUp', 0);
    expect(textarea().value).toBe('/');
    press('Escape', 1);
    expect(textarea().value).toBe('/');
    fireEvent.click(screen.getByRole('button', { name: 'Add context' }));
    expect(press('ArrowUp', 0)).toBe(true);
    expect(textarea().value).toBe('/');
  });
});
