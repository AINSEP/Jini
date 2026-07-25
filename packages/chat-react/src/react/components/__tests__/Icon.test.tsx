import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from '../Icon.js';

describe('Icon', () => {
  it('renders the attach glyph', () => {
    // No current chat-react component wires up name="attach" (Composer's
    // attach button uses @jini/ui's RemixIcon instead), but it is part of
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
});
