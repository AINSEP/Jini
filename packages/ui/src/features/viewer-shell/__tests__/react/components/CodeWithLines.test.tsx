import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodeWithLines } from '../../../react/components/CodeWithLines.js';

describe('CodeWithLines', () => {
  it('renders a line-number gutter matching the text', () => {
    const { container } = render(<CodeWithLines text={'a\nb\nc'} />);
    const gutter = container.querySelector('.gutter');
    const lines = container.querySelector('.lines');
    expect(gutter?.textContent).toBe('1\n2\n3');
    expect(lines?.textContent).toBe('a\nb\nc');
  });

  it('keeps the gutter aligned with a trailing newline', () => {
    const { container } = render(<CodeWithLines text={'a\nb\n'} />);
    const gutter = container.querySelector('.gutter');
    expect(gutter?.textContent).toBe('1\n2\n3');
  });

  it('renders a single-line gutter for a one-line file', () => {
    const { container } = render(<CodeWithLines text="only line" />);
    expect(container.querySelector('.gutter')?.textContent).toBe('1');
  });

  it('wraps as one grid row per line, numbering each line once', () => {
    const { container } = render(<CodeWithLines text={'a\nb\nc'} wrap />);
    expect(container.querySelector('.jini-code-viewer--wrap')).not.toBeNull();
    const numbers = container.querySelectorAll('.jini-code-viewer__line-number');
    expect(Array.from(numbers).map((el) => el.textContent)).toEqual(['1', '2', '3']);
    expect(container.querySelector('.gutter')).toBeNull();
  });
});
