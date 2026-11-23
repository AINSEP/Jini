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
    // `tb-more` is the host's measurement hook (it queries `.tb-more` to fit the phone row).
    expect(button.classList.contains('tb-more')).toBe(true);
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
    rerender(<ToolbarOverflowMenu overflow={{ open: true, toggle }} t={t} />);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
