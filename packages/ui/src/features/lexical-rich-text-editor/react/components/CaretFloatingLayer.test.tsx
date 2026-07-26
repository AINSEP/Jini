import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaretFloatingLayerPosition } from '../../rules.js';
import type { CaretRect } from '../../types.js';
import { useCaretFloatingLayerPosition } from '../hooks/useCaretFloatingLayerPosition.js';
import { CaretFloatingLayer } from './CaretFloatingLayer.js';

vi.mock('../hooks/useCaretFloatingLayerPosition.js', () => ({
  useCaretFloatingLayerPosition: vi.fn(),
}));

const mockedHook = vi.mocked(useCaretFloatingLayerPosition);

const CARET: CaretRect = { top: 100, bottom: 120, left: 50, right: 60 };
const POS: CaretFloatingLayerPosition = { left: 50, top: 20, width: 400, maxHeight: 300, placement: 'above' };

describe('CaretFloatingLayer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when open is false', () => {
    mockedHook.mockReturnValue({ pos: POS, layerRef: createRef() });
    const { container } = render(
      <CaretFloatingLayer caret={CARET} open={false}>
        <span>content</span>
      </CaretFloatingLayer>,
    );
    expect(container.innerHTML).toBe('');
    expect(document.body.textContent).not.toContain('content');
  });

  it('renders nothing when caret is null', () => {
    mockedHook.mockReturnValue({ pos: null, layerRef: createRef() });
    render(
      <CaretFloatingLayer caret={null} open={true}>
        <span>content</span>
      </CaretFloatingLayer>,
    );
    expect(document.body.textContent).not.toContain('content');
  });

  it('portals children into document.body with the computed position and placement', () => {
    mockedHook.mockReturnValue({ pos: POS, layerRef: createRef() });
    render(
      <CaretFloatingLayer caret={CARET} open={true}>
        <span>popover content</span>
      </CaretFloatingLayer>,
    );
    const layer = screen.getByText('popover content').closest('.rich-text-caret-floating-layer');
    expect(layer).not.toBeNull();
    expect(layer!.parentElement).toBe(document.body);
    expect(layer).toHaveAttribute('data-placement', 'above');
    expect((layer as HTMLElement).style.left).toBe('50px');
    expect((layer as HTMLElement).style.top).toBe('20px');
    expect((layer as HTMLElement).style.width).toBe('400px');
  });

  it('renders pre-measured off-screen (hidden) before a position is computed', () => {
    mockedHook.mockReturnValue({ pos: null, layerRef: createRef() });
    render(
      <CaretFloatingLayer caret={CARET} open={true}>
        <span>pre-measure</span>
      </CaretFloatingLayer>,
    );
    const layer = screen.getByText('pre-measure').closest('.rich-text-caret-floating-layer');
    expect(layer).toHaveAttribute('data-placement', 'above');
    expect((layer as HTMLElement).style.left).toBe('-9999px');
    expect((layer as HTMLElement).style.visibility).toBe('hidden');
  });

  it('applies a custom className', () => {
    mockedHook.mockReturnValue({ pos: POS, layerRef: createRef() });
    render(
      <CaretFloatingLayer caret={CARET} open={true} className="my-popover">
        <span>x</span>
      </CaretFloatingLayer>,
    );
    expect(screen.getByText('x').closest('.my-popover')).not.toBeNull();
  });

  it('passes boundaryRef through to the position hook', () => {
    mockedHook.mockReturnValue({ pos: POS, layerRef: createRef() });
    const boundaryRef = createRef<HTMLElement>();
    render(
      <CaretFloatingLayer caret={CARET} open={true} boundaryRef={boundaryRef}>
        <span>x</span>
      </CaretFloatingLayer>,
    );
    expect(mockedHook).toHaveBeenCalledWith(CARET, true, boundaryRef);
  });
});
