import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon, type IconName } from '../Icon.js';

describe('Icon', () => {
  it('renders the attach glyph', () => {
    // No current chat-react component wires up name="attach" (Composer's
    // attach button uses @jini-ai/ui's RemixIcon instead), but it is part of
    // the exported IconName union other consumers of this component may
    // still pass, so it gets a direct render test rather than being cut.
    const { container } = render(<Icon name="attach" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(container.querySelectorAll('path')).toHaveLength(1);
  });

  it('sizes and strokes every glyph from the shared prop set, passing through extra SVG attributes', () => {
    const { container } = render(<Icon name="check" size={20} strokeWidth={2} data-testid="check-icon" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
    expect(svg).toHaveAttribute('stroke-width', '2');
    expect(svg).toHaveAttribute('data-testid', 'check-icon');
  });

  it.each([
    ['spinner', '<path d="M21 12a9 9 0 1 1-6.22-8.56"></path>'],
    ['check', '<path d="M20 6 9 17l-5-5"></path>'],
    ['close', '<path d="M20 4 4 20"></path><path d="m4 4 16 16"></path>'],
    ['chevron-down', '<path d="m6 9 6 6 6-6"></path>'],
    ['chevron-left', '<path d="m15 18-6-6 6-6"></path>'],
    ['chevron-right', '<path d="m9 18 6-6-6-6"></path>'],
    ['attach', '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>'],
    ['file', '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="M8 13h8M8 17h6"></path>'],
    ['image', '<rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-5-5L5 21"></path>'],
    ['x', '<path d="M20 4 4 20"></path><path d="m4 4 16 16"></path>'],
    ['comment', '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>'],
    ['search', '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>'],
    ['plus', '<path d="M12 5v14"></path><path d="M5 12h14"></path>'],
    ['pencil', '<path d="m16 3 5 5L8 21H3v-5L16 3Z"></path><path d="m14 5 5 5"></path>'],
    ['copy', '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>'],
  ] satisfies [IconName, string][])('draws the %s glyph', (name, glyph) => {
    const { container } = render(<Icon name={name} />);
    expect(container.querySelector('svg')?.innerHTML).toBe(glyph);
  });

  it('gives the spinner its spin class', () => {
    const { container } = render(<Icon name="spinner" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('jini-icon-spin');
  });

  it('puts the spin class in front of a caller-supplied class on the spinner', () => {
    const { container } = render(<Icon name="spinner" className="extra" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('jini-icon-spin extra');
  });

  it('passes a caller-supplied class through unchanged on any other glyph', () => {
    const { container } = render(<Icon name="check" className="extra" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('extra');
  });

  it('defaults to a 14px, 1.6-stroke, aria-hidden glyph with no class', () => {
    const { container } = render(<Icon name="check" />);
    const svg = container.querySelector('svg')!;
    expect([svg.getAttribute('width'), svg.getAttribute('stroke-width'), svg.getAttribute('aria-hidden'), svg.getAttribute('class')]).toEqual(['14', '1.6', 'true', null]);
  });
});
