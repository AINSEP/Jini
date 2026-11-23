import { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createViewEscapeKeyPort } from '../escape-key-port.js';
import { useEmbedChatDialog } from '../dialog.hooks.js';
import { EmbedChatHeader } from '../header.js';
import { createViewEscapeKeyPort as exportedFromEntry } from '../embed.js';

describe('createViewEscapeKeyPort', () => {
  it('is exported from the ./react/embed entry', () => {
    expect(exportedFromEntry).toBe(createViewEscapeKeyPort);
  });

  it('Escape calls onEscape and prevents default in the capture phase', () => {
    const onEscape = vi.fn();
    const dispose = createViewEscapeKeyPort({ view: window }).subscribe({ onEscape });
    const target = document.createElement('button');
    document.body.append(target);
    // A bubble-phase listener on the target itself runs after window capture; it sees the default
    // already prevented only if the port ran in the capture phase.
    let seenPrevented: boolean | undefined;
    target.addEventListener('keydown', event => { seenPrevented = event.defaultPrevented; });
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(seenPrevented).toBe(true);
    dispose();
    target.remove();
  });

  it('non-Escape keys are ignored', () => {
    const onEscape = vi.fn();
    const dispose = createViewEscapeKeyPort({ view: window }).subscribe({ onEscape });
    for (const key of ['Enter', 'Tab', 'a', 'Esc ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(onEscape).not.toHaveBeenCalled();
    dispose();
  });

  it('the disposer removes the capture listener', () => {
    const view = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const dispose = createViewEscapeKeyPort({ view }).subscribe({ onEscape: () => {} });
    expect(view.addEventListener).toHaveBeenCalledTimes(1);
    const [type, handler, capture] = view.addEventListener.mock.calls[0]!;
    expect([type, capture]).toEqual(['keydown', true]);
    dispose();
    expect(view.removeEventListener.mock.calls).toEqual([['keydown', handler, true]]);
    const onEscape = vi.fn();
    const live = createViewEscapeKeyPort({ view: window }).subscribe({ onEscape });
    live();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('a null view subscribes nothing and disposes safely', () => {
    const onEscape = vi.fn();
    const dispose = createViewEscapeKeyPort({ view: null }).subscribe({ onEscape });
    expect(() => dispose()).not.toThrow();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onEscape).not.toHaveBeenCalled();
  });
});

/** The packaged dialog wiring around the packaged header, with the real port on the real window. */
function HostDialog() {
  const [open, setOpen] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLDivElement>(null);
  const [keyboard] = useState(() => createViewEscapeKeyPort({ view: window }));
  useEmbedChatDialog({ open, onClose: () => setOpen(false), panelRef, launcherRef });
  return <>
    <div ref={launcherRef}><button onClick={() => setOpen(true)}>Chat</button></div>
    <div role="dialog" aria-label="Visitor chat" hidden={!open} ref={panelRef}>
      <EmbedChatHeader title="Ask" hasMessages onReset={() => {}} keyboard={keyboard}
        copy={{ eyebrow: '', newThread: 'New thread', cancel: 'Cancel', discard: 'Discard chat' }} />
      <textarea aria-label="Question" />
    </div>
  </>;
}

describe('createViewEscapeKeyPort inside the real embed dialog', () => {
  it('Escape during the discard step cancels the step and the host dialog stays open', () => {
    const { unmount } = render(<HostDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }));
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    act(() => { cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Visitor chat' })).toBeVisible();
    // With no confirm step left, the next Escape belongs to the dialog again.
    const question = screen.getByRole('textbox', { name: 'Question' });
    act(() => { question.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
  });
});
