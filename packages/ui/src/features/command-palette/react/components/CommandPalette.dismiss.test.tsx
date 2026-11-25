import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette.js';
import { useCommandPaletteView } from './CommandPalette.hooks.js';
import { useWiredCommandPalette } from '../hooks/useCommandPalette.js';
import { useT } from '../../../i18n/index.js';
import type { CommandPaletteItem } from '../../types.js';

Element.prototype.scrollIntoView = vi.fn();

const ITEMS: CommandPaletteItem[] = [
  { id: '1', name: 'File A', kind: 'file' },
  { id: '2', name: 'File B', kind: 'file' },
];

const HOOKS = { useWiredCommandPalette, useTHook: useT, useCommandPaletteViewHook: useCommandPaletteView };

/** A host that opens the palette from its own button; `onHostClose` lets a test move focus the way a host may. */
function Host({ onHostClose }: { onHostClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>opener</button>
      <button>elsewhere</button>
      {open ? (
        <CommandPalette
          items={ITEMS}
          onSelect={vi.fn()}
          onClose={() => {
            onHostClose?.();
            setOpen(false);
          }}
          {...HOOKS}
        />
      ) : null}
    </>
  );
}

function openFromButton() {
  const opener = screen.getByRole('button', { name: 'opener' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe('CommandPalette dismissal', () => {
  it('closes on a mouse-down on the backdrop but not on one inside the panel', () => {
    const onClose = vi.fn();
    render(<CommandPalette items={ITEMS} onSelect={vi.fn()} onClose={onClose} {...HOOKS} />);
    fireEvent.mouseDown(screen.getByRole('textbox'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('arrows move the active option and Escape returns focus to the opener', () => {
    render(<Host />);
    const opener = openFromButton();
    const input = screen.getByRole('textbox');
    expect(input).toHaveFocus();
    const selected = () => screen.getAllByRole('option').map((o) => o.getAttribute('aria-selected'));
    expect(selected()).toEqual(['true', 'false']);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selected()).toEqual(['false', 'true']);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(selected()).toEqual(['true', 'false']);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('does not reclaim focus the host deliberately moved elsewhere on close', () => {
    render(<Host onHostClose={() => screen.getByRole('button', { name: 'elsewhere' }).focus()} />);
    openFromButton();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'elsewhere' })).toHaveFocus();
  });

  it('restores the opener when removal left focus on the body', () => {
    render(<Host onHostClose={() => (document.activeElement as HTMLElement).blur()} />);
    const opener = openFromButton();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(opener).toHaveFocus();
  });
});
