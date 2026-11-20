// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  PALETTE_TWEAKS_SWATCHES,
  PaletteTweaks,
  nextPaletteSelection,
  paletteItemClassName,
  resolvePalettePreview,
  usePaletteDismiss,
  usePaletteHover,
} from '../../components/PaletteTweaks.js';

// --- Pure derivations -------------------------------------------------------

describe('PaletteTweaks pure helpers', () => {
  it('resolvePalettePreview: original previews nothing, null restores the selection, a palette previews itself', () => {
    expect(resolvePalettePreview({ target: 'original', selected: 'coral' })).toBeNull();
    expect(resolvePalettePreview({ target: null, selected: 'coral' })).toBe('coral');
    expect(resolvePalettePreview({ target: null, selected: null })).toBeNull();
    expect(resolvePalettePreview({ target: 'electric', selected: 'coral' })).toBe('electric');
  });

  it('nextPaletteSelection toggles: re-picking the selected palette deselects it', () => {
    expect(nextPaletteSelection({ selected: 'electric', id: 'electric' })).toBeNull(); // deselect
    expect(nextPaletteSelection({ selected: 'coral', id: 'electric' })).toBe('electric'); // switch
    expect(nextPaletteSelection({ selected: null, id: 'electric' })).toBe('electric'); // fresh pick
  });

  it('paletteItemClassName appends selected/hovered modifiers', () => {
    expect(paletteItemClassName({ selected: false, hovered: false })).toBe('palette-tweaks-item');
    expect(paletteItemClassName({ selected: true, hovered: false })).toBe('palette-tweaks-item selected');
    expect(paletteItemClassName({ selected: false, hovered: true })).toBe('palette-tweaks-item hovered');
    expect(paletteItemClassName({ selected: true, hovered: true })).toBe('palette-tweaks-item selected hovered');
  });

  it('PALETTE_TWEAKS_SWATCHES exposes the five curated palettes', () => {
    expect(PALETTE_TWEAKS_SWATCHES.map((p) => p.id)).toEqual([
      'coral', 'electric', 'acid-forest', 'risograph', 'mono-noir',
    ]);
    expect(PALETTE_TWEAKS_SWATCHES.every((p) => p.stripe.length === 4)).toBe(true);
  });
});

// --- usePaletteHover --------------------------------------------------------

describe('usePaletteHover', () => {
  it('starts with nothing hovered', () => {
    const { result } = renderHook(() =>
      usePaletteHover({ open: true, selected: 'coral', onPreview: vi.fn() }),
    );
    expect(result.current.hovered).toBeNull();
  });

  it('setHover(palette) sets hover and previews that palette', () => {
    const onPreview = vi.fn();
    const { result } = renderHook(() =>
      usePaletteHover({ open: true, selected: 'coral', onPreview }),
    );
    act(() => result.current.setHover('electric'));
    expect(result.current.hovered).toBe('electric');
    expect(onPreview).toHaveBeenLastCalledWith('electric');
  });

  it("setHover('original') previews nothing", () => {
    const onPreview = vi.fn();
    const { result } = renderHook(() =>
      usePaletteHover({ open: true, selected: 'coral', onPreview }),
    );
    act(() => result.current.setHover('original'));
    expect(result.current.hovered).toBe('original');
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it('setHover(null) restores the current selection preview', () => {
    const onPreview = vi.fn();
    const { result } = renderHook(() =>
      usePaletteHover({ open: true, selected: 'coral', onPreview }),
    );
    act(() => result.current.setHover(null));
    expect(result.current.hovered).toBeNull();
    expect(onPreview).toHaveBeenLastCalledWith('coral');
  });

  it('clears hover and cancels the preview when the picker closes', () => {
    const onPreview = vi.fn();
    const { result, rerender } = renderHook(
      ({ open }) => usePaletteHover({ open, selected: 'coral', onPreview }),
      { initialProps: { open: true } },
    );
    act(() => result.current.setHover('electric'));
    expect(result.current.hovered).toBe('electric');
    onPreview.mockClear();
    rerender({ open: false });
    expect(result.current.hovered).toBeNull();
    expect(onPreview).toHaveBeenCalledWith(null);
  });
});

// --- usePaletteDismiss ------------------------------------------------------

describe('usePaletteDismiss', () => {
  it('returns a ref that starts unattached (null)', () => {
    const { result } = renderHook(() => usePaletteDismiss({ open: true, onClose: vi.fn() }));
    expect(result.current.current).toBeNull();
  });

  it('does nothing on a document mousedown while the root ref is unattached (defensive guard)', () => {
    const onClose = vi.fn();
    renderHook(() => usePaletteDismiss({ open: true, onClose }));
    // The returned ref is never attached to a node here, so rootRef.current
    // stays null and the outside-click handler must bail out early.
    act(() => document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape while open', () => {
    const onClose = vi.fn();
    renderHook(() => usePaletteDismiss({ open: true, onClose }));
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not attach listeners when closed', () => {
    const onClose = vi.fn();
    renderHook(() => usePaletteDismiss({ open: false, onClose }));
    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

// --- Component --------------------------------------------------------------

describe('PaletteTweaks', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <PaletteTweaks open={false} selected={null} onChange={vi.fn()} onPreview={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('marks "Original" selected (with a check) when selected is null', () => {
    render(
      <PaletteTweaks open selected={null} onChange={vi.fn()} onPreview={vi.fn()} onClose={vi.fn()} />,
    );
    const originalRow = screen.getByText('Original').closest('li')!;
    expect(originalRow.getAttribute('aria-selected')).toBe('true');
    expect(originalRow.querySelector('.palette-tweaks-check')).not.toBeNull();
  });

  it('renders every curated palette with its stripe chips', () => {
    const { container } = render(
      <PaletteTweaks open selected={null} onChange={vi.fn()} onPreview={vi.fn()} onClose={vi.fn()} />,
    );
    for (const p of PALETTE_TWEAKS_SWATCHES) {
      expect(screen.getByText(p.label)).toBeTruthy();
    }
    // Original chip + 5 palettes x 4 chips each = 21 chips total.
    expect(container.querySelectorAll('.palette-tweaks-chip').length).toBe(1 + PALETTE_TWEAKS_SWATCHES.length * 4);
  });

  it('shows the check on the selected palette and not on Original', () => {
    render(
      <PaletteTweaks open selected="electric" onChange={vi.fn()} onPreview={vi.fn()} onClose={vi.fn()} />,
    );
    const electricRow = screen.getByText('Electric').closest('li')!;
    const originalRow = screen.getByText('Original').closest('li')!;
    expect(electricRow.querySelector('.palette-tweaks-check')).not.toBeNull();
    expect(electricRow.getAttribute('aria-selected')).toBe('true');
    expect(originalRow.querySelector('.palette-tweaks-check')).toBeNull();
    expect(originalRow.getAttribute('aria-selected')).toBe('false');
  });

  it('calls onChange and onClose when a palette is picked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <PaletteTweaks open selected={null} onChange={onChange} onPreview={vi.fn()} onClose={onClose} />,
    );
    await user.click(screen.getByText('Electric'));
    expect(onChange).toHaveBeenCalledWith('electric');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('deselects an already-selected palette on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PaletteTweaks open selected="electric" onChange={onChange} onPreview={vi.fn()} onClose={vi.fn()} />,
    );
    await user.click(screen.getByText('Electric'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('picks Original (null) and closes when the Original row is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <PaletteTweaks open selected="electric" onChange={onChange} onPreview={vi.fn()} onClose={onClose} />,
    );
    await user.click(screen.getByText('Original'));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('previews on hover and restores the selection preview on mouse leave', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    render(
      <PaletteTweaks open selected="coral" onChange={vi.fn()} onPreview={onPreview} onClose={vi.fn()} />,
    );
    await user.hover(screen.getByText('Electric'));
    expect(onPreview).toHaveBeenLastCalledWith('electric');
    await user.unhover(screen.getByText('Electric'));
    expect(onPreview).toHaveBeenLastCalledWith('coral');
  });

  it('marks the hovered row (and the Original row) with the hovered class and clears it on leave', () => {
    render(
      <PaletteTweaks open selected="coral" onChange={vi.fn()} onPreview={vi.fn()} onClose={vi.fn()} />,
    );
    const electricRow = screen.getByText('Electric').closest('li')!;
    fireEvent.mouseEnter(electricRow);
    expect(electricRow.classList.contains('hovered')).toBe(true);
    fireEvent.mouseLeave(electricRow);
    expect(electricRow.classList.contains('hovered')).toBe(false);

    const originalRow = screen.getByText('Original').closest('li')!;
    fireEvent.mouseEnter(originalRow);
    expect(originalRow.classList.contains('hovered')).toBe(true);
    fireEvent.mouseLeave(originalRow);
    expect(originalRow.classList.contains('hovered')).toBe(false);
  });

  it('closes on an outside mousedown but not on an inside one', () => {
    const onClose = vi.fn();
    render(
      <PaletteTweaks open selected={null} onChange={vi.fn()} onPreview={vi.fn()} onClose={onClose} />,
    );
    fireEvent.mouseDown(screen.getByRole('dialog')); // inside -> ignored
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body); // outside -> closes
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape but ignores other keys', () => {
    const onClose = vi.fn();
    render(
      <PaletteTweaks open selected={null} onChange={vi.fn()} onPreview={vi.fn()} onClose={onClose} />,
    );
    fireEvent.keyDown(document, { key: 'ArrowDown' }); // ignored
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
