import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useEmbedChatDialog } from '../dialog.hooks.js';

function Widget() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLDivElement>(null);
  useEmbedChatDialog({ open, onClose: () => setOpen(false), panelRef, launcherRef });
  return <>
    <button>Page action</button>
    <div ref={launcherRef}><button aria-expanded={open} onClick={() => setOpen(!open)}>Chat</button></div>
    <div role="dialog" aria-label="Visitor chat" hidden={!open} ref={panelRef}>
      <button>First</button><textarea aria-label="Question" /><button>Last</button>
    </div>
  </>;
}

it('traps both Tab directions, respects consumed Escape, closes and restores the bubble', () => {
  const { unmount } = render(<Widget />);
  const launcher = screen.getByRole('button', { name: 'Chat' });
  launcher.focus();
  fireEvent.click(launcher);
  const first = screen.getByRole('button', { name: 'First' });
  const last = screen.getByRole('button', { name: 'Last' });
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  consumed.preventDefault();
  fireEvent(last, consumed);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.keyDown(last, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(launcher).toHaveAttribute('aria-expanded', 'false');
  expect(document.activeElement).toBe(launcher);
  unmount();
  fireEvent.keyDown(window, { key: 'Tab' });
});

it('focuses the replacement composer after reset without stealing focus while closed', () => {
  function ResetWidget() {
    const [open, setOpen] = useState(true);
    const [resetKey, setResetKey] = useState(0);
    const panelRef = useRef<HTMLDivElement>(null);
    const launcherRef = useRef<HTMLDivElement>(null);
    useEmbedChatDialog({ open, onClose: () => setOpen(false), panelRef, launcherRef }, { resetKey });
    return <>
      <div ref={launcherRef}><button onClick={() => setResetKey(key => key + 1)}>Reset outside</button></div>
      <div role="dialog" hidden={!open} ref={panelRef} key={resetKey}>
        <button onClick={() => setResetKey(key => key + 1)}>Reset</button><textarea aria-label="Draft" />
      </div>
    </>;
  }
  const { unmount } = render(<ResetWidget />);
  const previous = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  const replacement = screen.getByRole('textbox', { name: 'Draft' });
  expect(replacement).not.toBe(previous);
  expect(replacement).toHaveFocus();
  fireEvent.keyDown(replacement, { key: 'Escape' });
  const outside = screen.getByRole('button', { name: 'Reset outside' });
  expect(outside).toHaveFocus();
  fireEvent.click(outside);
  expect(outside).toHaveFocus();
  unmount();
});
