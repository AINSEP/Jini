import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette.js';
import type { CommandPaletteItem } from '../../types.js';

Element.prototype.scrollIntoView = vi.fn();

const ITEMS: CommandPaletteItem[] = [{ id: '1', name: 'File A', kind: 'file' }];

describe('CommandPalette dismissal', () => {
  it('closes on a mouse-down on the backdrop but not on one inside the panel', () => {
    const onClose = vi.fn();
    render(<CommandPalette items={ITEMS} onSelect={vi.fn()} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole('textbox'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
