// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolbarOverflowMenu } from '../editor/toolbar/ToolbarOverflowMenu.js';

const t = (text: string) => `~${text}`;

describe('ToolbarOverflowMenu', () => {
  it('mirrors the injected controller: aria-expanded follows open, a click calls toggle', () => {
    const toggle = vi.fn();
    const { rerender } = render(<ToolbarOverflowMenu overflow={{ open: false, toggle }} t={t} />);
    const button = screen.getByRole('button', { name: '~More formatting' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    // `data-toolbar-more` is the host's measurement hook (it queries it to fit the phone row);
    // the class is the style hook. No legacy host class is emitted.
    expect(button.hasAttribute('data-toolbar-more')).toBe(true);
    expect(button.className).toBe('jini-post-toolbar__btn jini-post-toolbar__more');
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
    rerender(<ToolbarOverflowMenu overflow={{ open: true, toggle }} t={t} />);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
