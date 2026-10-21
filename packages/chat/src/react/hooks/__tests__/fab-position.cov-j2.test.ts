import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useFabPosition, type FabPositionInput } from '../fab-position.js';

/**
 * `useFabPosition` — the draggable assistant FAB's resting spot, persisted as viewport fractions.
 *
 * Every outside dependency is a port on `FabPositionInput` (storage, the viewport, the document that
 * receives pointer events), so these tests hand it plain fakes: a Map-backed storage, and
 * `EventTarget`s carrying the few properties the hook reads. Geometry used throughout: a 1000×800
 * viewport, a 20px edge margin and a 56px FAB, so the resting range on each axis is [20, 924]
 * horizontally and [20, 724] vertically.
 */
const KEY = 'fab-position';

function fakeStorage(seed: Record<string, string> = {}, { failWrites = false, failReads = false } = {}) {
  const items = new Map(Object.entries(seed));
  return {
    items,
    getItem: (key: string) => {
      if (failReads) throw new DOMException('blocked', 'SecurityError');
      return items.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (failWrites) throw new DOMException('full', 'QuotaExceededError');
      items.set(key, value);
    },
  };
}

function fakeViewport(width = 1000, height = 800) {
  return Object.assign(new EventTarget(), { innerWidth: width, innerHeight: height });
}

function fakeDocument({ withPointerRelease = true } = {}) {
  const releasePointerCapture = vi.fn();
  const target = new EventTarget();
  return Object.assign(target, withPointerRelease ? { releasePointerCapture } : {}, { releasePointerCaptureSpy: releasePointerCapture });
}

type Viewport = ReturnType<typeof fakeViewport>;
type Doc = ReturnType<typeof fakeDocument>;

function setup(
  overrides: Partial<Omit<FabPositionInput, 'viewport' | 'pointerEvents' | 'storage'>> & { viewport?: Viewport; doc?: Doc; storage?: ReturnType<typeof fakeStorage> } = {},
) {
  const { viewport = fakeViewport(), doc = fakeDocument(), storage = fakeStorage(), ...rest } = overrides;
  const base: FabPositionInput = {
    dockOpen: false,
    avoidBottomPx: 0,
    storageKey: KEY,
    storage,
    viewport: viewport as unknown as Window,
    pointerEvents: doc as unknown as Document,
    edgeMargin: 20,
    sizePx: 56,
    dragThresholdPx: 4,
    ...rest,
  };
  const hook = renderHook((props: Partial<FabPositionInput>) => useFabPosition({ ...base, ...props }), { initialProps: {} });
  return { ...hook, viewport, doc, storage };
}

/** A React pointerdown on a FAB whose box ends at (`right`, `bottom`) in viewport coordinates. */
function pointerDown(
  { clientX, clientY, button = 0, right = 980, bottom = 780 }: { clientX: number; clientY: number; button?: number; right?: number; bottom?: number },
) {
  const setPointerCapture = vi.fn();
  const event = {
    button,
    pointerId: 7,
    clientX,
    clientY,
    currentTarget: { getBoundingClientRect: () => ({ right, bottom }), setPointerCapture },
  } as unknown as ReactPointerEvent<HTMLButtonElement>;
  return { event, setPointerCapture };
}

function pointer(type: 'pointermove' | 'pointerup' | 'pointercancel', clientX = 0, clientY = 0): Event {
  return Object.assign(new Event(type), { clientX, clientY });
}

describe('useFabPosition resting position', () => {
  it('starts at the bottom-right default, clamped to the edge margin', () => {
    const { result } = setup();
    expect(result.current.style).toEqual({ right: 20, bottom: 20 });
    expect(result.current.isDragging).toBe(false);
  });

  it('restores a stored fraction pair against the current viewport, clamping out-of-range fractions', () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rightFraction: 0.5, bottomFraction: 0.25, pinnedByUser: true }) });
    expect(setup({ storage }).result.current.style).toEqual({ right: 500, bottom: 200 });

    const wild = fakeStorage({ [KEY]: JSON.stringify({ rightFraction: 7, bottomFraction: -3 }) });
    expect(setup({ storage: wild }).result.current.style).toEqual({ right: 924, bottom: 20 });
  });

  it('migrates the legacy right-edge shape to a spot flush against the right margin', () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ side: 'right', bottomFraction: 0.5 }) });
    expect(setup({ storage }).result.current.style).toEqual({ right: 20, bottom: 400 });
  });

  it('migrates the legacy left-edge shape to a spot flush against the left margin', () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ side: 'left', bottomFraction: 2 }) });
    expect(setup({ storage }).result.current.style).toEqual({ right: 924, bottom: 724 });
  });

  it.each([
    ['an unrecognized shape', JSON.stringify({ side: 'top', bottomFraction: 0.5 })],
    ['a legacy side without a fraction', JSON.stringify({ side: 'left' })],
    ['a half-written fraction pair', JSON.stringify({ rightFraction: 0.5 })],
    ['corrupt JSON', '{not json'],
  ])('falls back to the default for %s', (_label, raw) => {
    expect(setup({ storage: fakeStorage({ [KEY]: raw }) }).result.current.style).toEqual({ right: 20, bottom: 20 });
  });

  it('falls back to the default when storage itself refuses the read', () => {
    expect(setup({ storage: fakeStorage({}, { failReads: true }) }).result.current.style).toEqual({ right: 20, bottom: 20 });
  });

  it('recomputes pixels from the stored fractions on resize and orientation change', () => {
    const viewport = fakeViewport();
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rightFraction: 0.5, bottomFraction: 0.5, pinnedByUser: true }) });
    const { result } = setup({ viewport, storage });
    expect(result.current.style).toEqual({ right: 500, bottom: 400 });

    viewport.innerWidth = 600;
    act(() => { viewport.dispatchEvent(new Event('resize')); });
    expect(result.current.style).toEqual({ right: 300, bottom: 400 });

    viewport.innerHeight = 400;
    act(() => { viewport.dispatchEvent(new Event('orientationchange')); });
    expect(result.current.style).toEqual({ right: 300, bottom: 200 });
  });

  it('stops listening to the viewport on unmount', () => {
    const viewport = fakeViewport();
    const remove = vi.spyOn(viewport, 'removeEventListener');
    const { unmount } = setup({ viewport });
    unmount();
    expect(remove.mock.calls.map(([type]) => type).sort()).toEqual(['orientationchange', 'resize']);
  });
});

describe('useFabPosition dock avoidance', () => {
  it('holds an untouched FAB clear of the open dock on both axes', () => {
    const { result, rerender } = setup();
    rerender({ dockOpen: true, avoidBottomPx: 300, avoidRightPx: 400 });
    expect(result.current.style).toEqual({ right: 420, bottom: 320 });
    rerender({ dockOpen: false, avoidBottomPx: 300, avoidRightPx: 400 });
    expect(result.current.style).toEqual({ right: 20, bottom: 20 });
  });

  it('treats an omitted avoidRightPx as no horizontal clearance', () => {
    const { result, rerender } = setup();
    rerender({ dockOpen: true, avoidBottomPx: 0 });
    expect(result.current.style).toEqual({ right: 20, bottom: 20 });
  });

  it('never pushes the FAB off-screen for a dock larger than the viewport', () => {
    const { result, rerender } = setup();
    rerender({ dockOpen: true, avoidBottomPx: 5000, avoidRightPx: 5000 });
    expect(result.current.style).toEqual({ right: 924, bottom: 724 });
  });

  it('keeps the FAB at the margin on a viewport too small to hold it', () => {
    const { result, rerender } = setup({ viewport: fakeViewport(60, 50) });
    rerender({ dockOpen: true, avoidBottomPx: 10, avoidRightPx: 10 });
    expect(result.current.style).toEqual({ right: 20, bottom: 20 });
  });

  it('applies to a migrated legacy position too, which carries no evidence of deliberate placement', () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ side: 'right', bottomFraction: 0 }) });
    const { result, rerender } = setup({ storage });
    rerender({ dockOpen: true, avoidBottomPx: 0, avoidRightPx: 380 });
    expect(result.current.style).toEqual({ right: 400, bottom: 20 });
  });

  it('respects a position the operator dragged onto the dock', () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rightFraction: 0.1, bottomFraction: 0.1, pinnedByUser: true }) });
    const { result, rerender } = setup({ storage });
    rerender({ dockOpen: true, avoidBottomPx: 300, avoidRightPx: 400 });
    expect(result.current.style).toEqual({ right: 100, bottom: 80 });
  });
});

describe('useFabPosition drag', () => {
  it('follows the pointer past the threshold, persists the drop as pinned fractions, and swallows the trailing click once', () => {
    const { result, doc, storage } = setup();
    const down = pointerDown({ clientX: 500, clientY: 500 });
    act(() => result.current.onPointerDown(down.event));
    expect(down.setPointerCapture).toHaveBeenCalledWith(7);

    act(() => { doc.dispatchEvent(pointer('pointermove', 100, 200)); });
    expect(result.current.isDragging).toBe(true);
    expect(result.current.style).toEqual({ right: 420, bottom: 320 });

    act(() => { doc.dispatchEvent(pointer('pointerup')); });
    expect(doc.releasePointerCaptureSpy).toHaveBeenCalledWith(7);
    expect(result.current.isDragging).toBe(false);
    expect(result.current.style).toEqual({ right: 420, bottom: 320 });
    expect(JSON.parse(storage.items.get(KEY)!)).toEqual({ rightFraction: 0.42, bottomFraction: 0.4, pinnedByUser: true });

    expect(result.current.consumeDragFlag()).toBe(true);
    expect(result.current.consumeDragFlag()).toBe(false);
  });

  it('clamps the live position so a fast drag cannot throw the FAB off-screen', () => {
    const { result, doc } = setup();
    act(() => result.current.onPointerDown(pointerDown({ clientX: 500, clientY: 500 }).event));
    act(() => { doc.dispatchEvent(pointer('pointermove', -5000, 5000)); });
    expect(result.current.style).toEqual({ right: 924, bottom: 20 });
  });

  it('treats movement within the threshold as a click: nothing moves, persists, or is swallowed', () => {
    const { result, doc, storage } = setup();
    act(() => result.current.onPointerDown(pointerDown({ clientX: 500, clientY: 500 }).event));
    act(() => { doc.dispatchEvent(pointer('pointermove', 502, 501)); });
    expect(result.current.isDragging).toBe(false);
    act(() => { doc.dispatchEvent(pointer('pointerup')); });
    expect(storage.items.has(KEY)).toBe(false);
    expect(result.current.style).toEqual({ right: 20, bottom: 20 });
    expect(result.current.consumeDragFlag()).toBe(false);
  });

  it('ends the gesture on pointercancel and detaches every document listener', () => {
    const { result, doc } = setup();
    act(() => result.current.onPointerDown(pointerDown({ clientX: 500, clientY: 500 }).event));
    act(() => { doc.dispatchEvent(pointer('pointermove', 400, 500)); });
    act(() => { doc.dispatchEvent(pointer('pointercancel')); });
    expect(result.current.style).toEqual({ right: 120, bottom: 20 });

    act(() => { doc.dispatchEvent(pointer('pointermove', 0, 0)); });
    expect(result.current.isDragging).toBe(false);
    expect(result.current.style).toEqual({ right: 120, bottom: 20 });
  });

  it('ends a drag on a target without pointer capture support', () => {
    const doc = fakeDocument({ withPointerRelease: false });
    const { result } = setup({ doc });
    act(() => result.current.onPointerDown(pointerDown({ clientX: 500, clientY: 500 }).event));
    act(() => { doc.dispatchEvent(pointer('pointermove', 450, 500)); });
    act(() => { doc.dispatchEvent(pointer('pointerup')); });
    expect(result.current.isDragging).toBe(false);
    expect(result.current.style).toEqual({ right: 70, bottom: 20 });
  });

  it('still moves the FAB for this tab when storage refuses the write', () => {
    const { result, doc } = setup({ storage: fakeStorage({}, { failWrites: true }) });
    act(() => result.current.onPointerDown(pointerDown({ clientX: 500, clientY: 500 }).event));
    act(() => { doc.dispatchEvent(pointer('pointermove', 300, 500)); });
    act(() => { doc.dispatchEvent(pointer('pointerup')); });
    expect(result.current.style).toEqual({ right: 220, bottom: 20 });
  });

  it('ignores a non-primary button so a right-click is never captured as a drag', () => {
    const { result, doc } = setup();
    const down = pointerDown({ clientX: 500, clientY: 500, button: 2 });
    act(() => result.current.onPointerDown(down.event));
    expect(down.setPointerCapture).not.toHaveBeenCalled();
    act(() => { doc.dispatchEvent(pointer('pointermove', 0, 0)); });
    expect(result.current.isDragging).toBe(false);
    expect(result.current.style).toEqual({ right: 20, bottom: 20 });
  });
});
