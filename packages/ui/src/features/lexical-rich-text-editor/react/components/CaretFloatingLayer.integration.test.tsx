// Unlike CaretFloatingLayer.test.tsx (which mocks the position hook to test
// the presentational component in isolation), this file wires the REAL
// `useCaretFloatingLayerPosition` hook end-to-end, per this package's rule
// that a mocked-hook unit test isn't a substitute for exercising the real
// interaction at least once.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CaretRect } from '../../types.js';
import { CaretFloatingLayer } from './CaretFloatingLayer.js';

describe('CaretFloatingLayer (real hook, end-to-end)', () => {
  it('computes and applies a real position for a real caret rect', () => {
    const caret: CaretRect = { top: 400, bottom: 420, left: 100, right: 120 };
    render(
      <CaretFloatingLayer caret={caret} open={true}>
        <span>real popover</span>
      </CaretFloatingLayer>,
    );
    const layer = screen.getByText('real popover').closest('.rich-text-caret-floating-layer');
    expect(layer).not.toBeNull();
    expect(layer!.parentElement).toBe(document.body);
    const style = (layer as HTMLElement).style;
    expect(style.position).toBe('fixed');
    // jsdom gives the unstyled portal element a 0×0 measured size, so the
    // "wanted height" collapses to 0 and top lands at caret.top - gap - 0.
    expect(Number.parseFloat(style.top)).toBe(400 - 8);
    expect(layer).toHaveAttribute('data-placement', 'above');
  });

  it('re-renders as closed and unmounts the portal', () => {
    const caret: CaretRect = { top: 400, bottom: 420, left: 100, right: 120 };
    const { rerender } = render(
      <CaretFloatingLayer caret={caret} open={true}>
        <span>toggle-me</span>
      </CaretFloatingLayer>,
    );
    expect(screen.queryByText('toggle-me')).not.toBeNull();
    rerender(
      <CaretFloatingLayer caret={caret} open={false}>
        <span>toggle-me</span>
      </CaretFloatingLayer>,
    );
    expect(screen.queryByText('toggle-me')).toBeNull();
  });
});
