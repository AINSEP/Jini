import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAB_STRIP_DRAG_HAPTIC_MS, TAB_STRIP_DROP_HAPTIC_MS, TAB_STRIP_ITEM_ID_ATTRIBUTE } from '../../../constants.js';
import type { TabStripHapticsPort } from '../../../ports.js';
import type { TabStripTab } from '../../../types.js';
import { useTabStripDragReorder } from '../../../react/hooks/useTabStripDragReorder.js';

function tab(overrides: Partial<TabStripTab> & { id: string }): TabStripTab {
  return { content: null, ...overrides };
}

function makeDataTransfer() {
  const store = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
  };
}

function makeItemElement(id: string, rect: { left: number; right: number; width: number }): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute(TAB_STRIP_ITEM_ID_ATTRIBUTE, id);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: rect.left,
    right: rect.right,
    width: rect.width,
    top: 0,
    bottom: 0,
    height: 0,
    x: rect.left,
    y: 0,
    toJSON: () => ({}),
  });
  return el;
}

function buildStrip(ids: Array<{ id: string; left: number; right: number; width: number }>): HTMLDivElement {
  const strip = document.createElement('div');
  for (const spec of ids) {
    strip.appendChild(makeItemElement(spec.id, spec));
  }
  document.body.appendChild(strip);
  return strip;
}

describe('useTabStripDragReorder', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts with no active drag', () => {
    const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
    const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
    expect(result.current.draggingTabId).toBeNull();
    expect(result.current.dragOverTarget).toBeNull();
  });

  describe('getItemDragProps', () => {
    it('is not draggable when only one tab exists', () => {
      const tabs = [tab({ id: 'a' })];
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
      expect(result.current.getItemDragProps('a').draggable).toBe(false);
    });

    it('is draggable for an unpinned tab among several', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
      expect(result.current.getItemDragProps('a').draggable).toBe(true);
    });

    it('is not draggable for a pinned tab', () => {
      const tabs = [tab({ id: 'a', pinned: true }), tab({ id: 'b' })];
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
      expect(result.current.getItemDragProps('a').draggable).toBe(false);
    });

    it('is not draggable for a tabId that is not present in tabs', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
      expect(result.current.getItemDragProps('ghost').draggable).toBe(false);
    });

    it('sets dragging state and dataTransfer on drag start', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
      const dataTransfer = makeDataTransfer();
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer } as never);
      });
      expect(result.current.draggingTabId).toBe('a');
      expect(dataTransfer.effectAllowed).toBe('move');
      expect(dataTransfer.getData('text/plain')).toBe('a');
    });

    it('prevents the drag when the tab is not draggable', () => {
      const tabs = [tab({ id: 'a' })];
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
      const preventDefault = vi.fn();
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer(), preventDefault } as never);
      });
      expect(preventDefault).toHaveBeenCalled();
      expect(result.current.draggingTabId).toBeNull();
    });

    it('pulses haptics on drag start', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
      const haptics: TabStripHapticsPort = { pulse: vi.fn() };
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn(), haptics }));
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });
      expect(haptics.pulse).toHaveBeenCalledWith(TAB_STRIP_DRAG_HAPTIC_MS);
    });

    it('suppresses the click that immediately follows a drag, then re-arms after a tick', () => {
      vi.useFakeTimers();
      try {
        const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
        const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
        act(() => {
          result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
        });
        act(() => {
          result.current.getItemDragProps('a').onDragEnd();
        });
        const suppressedClick = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
        act(() => {
          result.current.getItemDragProps('a').onClickCapture(suppressedClick as never);
        });
        expect(suppressedClick.preventDefault).toHaveBeenCalled();
        expect(suppressedClick.stopPropagation).toHaveBeenCalled();

        act(() => {
          vi.advanceTimersByTime(0);
        });
        const laterClick = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
        act(() => {
          result.current.getItemDragProps('a').onClickCapture(laterClick as never);
        });
        expect(laterClick.preventDefault).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('stripDragProps.onDragOver', () => {
    it('reports the nearest drop target and does not reorder in onDrop timing', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' }), tab({ id: 'c' })];
      const onReorder = vi.fn();
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder }));
      const strip = buildStrip([
        { id: 'a', left: 0, right: 100, width: 100 },
        { id: 'b', left: 100, right: 200, width: 100 },
        { id: 'c', left: 200, right: 300, width: 100 },
      ]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });

      const preventDefault = vi.fn();
      const dataTransfer = makeDataTransfer();
      dataTransfer.setData('text/plain', 'a');
      act(() => {
        result.current.stripDragProps.onDragOver({
          clientX: 260,
          target: strip.querySelector('[data-tab-strip-item-id="c"]'),
          dataTransfer,
          preventDefault,
        } as never);
      });

      expect(preventDefault).toHaveBeenCalled();
      expect(dataTransfer.dropEffect).toBe('move');
      expect(result.current.dragOverTarget).toEqual({ tabId: 'c', edge: 'after' });
      expect(onReorder).not.toHaveBeenCalled();
    });

    it('falls back to scanning every item when the pointer is not directly over a tab element (e.g. a gap)', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' }), tab({ id: 'c' })];
      const onReorder = vi.fn();
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder }));
      const strip = buildStrip([
        { id: 'a', left: 0, right: 100, width: 100 },
        { id: 'b', left: 100, right: 200, width: 100 },
        { id: 'c', left: 200, right: 300, width: 100 },
      ]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });

      // Target is the strip container itself (a gap between/after tabs), not
      // one of the `[data-tab-strip-item-id]` items — the direct-hit
      // `closest()` lookup finds nothing, forcing the querySelectorAll scan.
      act(() => {
        result.current.stripDragProps.onDragOver({
          clientX: 260,
          target: strip,
          dataTransfer: makeDataTransfer(),
          preventDefault: vi.fn(),
        } as never);
      });

      expect(result.current.dragOverTarget).toEqual({ tabId: 'c', edge: 'after' });
    });

    it('falls back to the scan instead of throwing when the dragover target is a text node, not an element', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' }), tab({ id: 'c' })];
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
      const strip = buildStrip([
        { id: 'a', left: 0, right: 100, width: 100 },
        { id: 'b', left: 100, right: 200, width: 100 },
        { id: 'c', left: 200, right: 300, width: 100 },
      ]);
      // A tab's label text: `EventTarget` admits a Text node, which has no `closest()`.
      const label = document.createTextNode('Tab b');
      strip.querySelector('[data-tab-strip-item-id="b"]')!.appendChild(label);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });

      act(() => {
        result.current.stripDragProps.onDragOver({
          clientX: 130,
          target: label,
          dataTransfer: makeDataTransfer(),
          preventDefault: vi.fn(),
        } as never);
      });

      expect(result.current.dragOverTarget).toEqual({ tabId: 'b', edge: 'before' });
    });

    it('finds no target (and leaves state untouched) when the only item left in the strip is the drag source itself', () => {
      // Simulates the source's sibling tab(s) having been closed mid-drag —
      // the fallback scan finds only the dragged tab's own element, which it
      // correctly skips, leaving nothing to drop onto.
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
      const onReorder = vi.fn();
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder }));
      const strip = buildStrip([
        { id: 'a', left: 0, right: 100, width: 100 },
        { id: 'b', left: 100, right: 200, width: 100 },
      ]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });
      strip.querySelector('[data-tab-strip-item-id="b"]')!.remove();

      const preventDefault = vi.fn();
      act(() => {
        result.current.stripDragProps.onDragOver({
          clientX: 10,
          target: strip,
          dataTransfer: makeDataTransfer(),
          preventDefault,
        } as never);
      });
      expect(preventDefault).not.toHaveBeenCalled();
      expect(result.current.dragOverTarget).toBeNull();
    });

    it('does not offer the dragged tab itself as a drop target when the pointer is over it, and scans for the nearest other tab', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
      const strip = buildStrip([
        { id: 'a', left: 0, right: 100, width: 100 },
        { id: 'b', left: 100, right: 200, width: 100 },
      ]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });
      act(() => {
        result.current.stripDragProps.onDragOver({
          clientX: 10,
          target: strip.querySelector('[data-tab-strip-item-id="a"]'),
          dataTransfer: makeDataTransfer(),
          preventDefault: vi.fn(),
        } as never);
      });
      expect(result.current.dragOverTarget).toEqual({ tabId: 'b', edge: 'before' });
    });

    it('ignores a hovered tab element that belongs to a different strip, and scans its own tabs instead', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' }), tab({ id: 'c' })];
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
      const strip = buildStrip([
        { id: 'a', left: 0, right: 100, width: 100 },
        { id: 'b', left: 100, right: 200, width: 100 },
        { id: 'c', left: 200, right: 300, width: 100 },
      ]);
      const otherStrip = buildStrip([{ id: 'elsewhere', left: 0, right: 100, width: 100 }]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });
      act(() => {
        result.current.stripDragProps.onDragOver({
          clientX: 260,
          target: otherStrip.querySelector('[data-tab-strip-item-id="elsewhere"]'),
          dataTransfer: makeDataTransfer(),
          preventDefault: vi.fn(),
        } as never);
      });
      expect(result.current.dragOverTarget).toEqual({ tabId: 'c', edge: 'after' });
    });

    it('reorders live during dragover when reorderTiming is "live"', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
      const onReorder = vi.fn();
      const { result } = renderHook(() =>
        useTabStripDragReorder({ tabs, onReorder, reorderTiming: 'live' }),
      );
      const strip = buildStrip([
        { id: 'a', left: 0, right: 100, width: 100 },
        { id: 'b', left: 100, right: 200, width: 100 },
      ]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });
      act(() => {
        result.current.stripDragProps.onDragOver({
          clientX: 180,
          target: strip.querySelector('[data-tab-strip-item-id="b"]'),
          dataTransfer: makeDataTransfer(),
          preventDefault: vi.fn(),
        } as never);
      });
      expect(onReorder).toHaveBeenCalledWith('a', 'b', 'after');
    });

    it('coerces a before-drop onto a pinned tab to after', () => {
      const tabs = [tab({ id: 'entry', pinned: true, draggable: true }), tab({ id: 'a' }), tab({ id: 'b' })];
      const onReorder = vi.fn();
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder }));
      const strip = buildStrip([
        { id: 'entry', left: 0, right: 100, width: 100 },
        { id: 'a', left: 100, right: 200, width: 100 },
        { id: 'b', left: 200, right: 300, width: 100 },
      ]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.getItemDragProps('b').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });
      act(() => {
        result.current.stripDragProps.onDragOver({
          clientX: 10, // left half of the pinned 'entry' tab -> would be 'before'
          target: strip.querySelector('[data-tab-strip-item-id="entry"]'),
          dataTransfer: makeDataTransfer(),
          preventDefault: vi.fn(),
        } as never);
      });
      expect(result.current.dragOverTarget).toEqual({ tabId: 'entry', edge: 'after' });
    });

    it('does nothing when there is no active drag source', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
      const strip = buildStrip([{ id: 'a', left: 0, right: 100, width: 100 }]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      const preventDefault = vi.fn();
      act(() => {
        result.current.stripDragProps.onDragOver({
          clientX: 10,
          target: strip,
          dataTransfer: makeDataTransfer(),
          preventDefault,
        } as never);
      });
      expect(preventDefault).not.toHaveBeenCalled();
      expect(result.current.dragOverTarget).toBeNull();
    });

    it('finds no target when the strip ref is not attached to any element', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });
      // stripRef.current is intentionally left null here (never attached to
      // a rendered element) — a real, if narrow, window between mount and
      // the ref callback firing, or after unmount.
      const preventDefault = vi.fn();
      act(() => {
        result.current.stripDragProps.onDragOver({
          clientX: 10,
          target: null,
          dataTransfer: makeDataTransfer(),
          preventDefault,
        } as never);
      });
      expect(preventDefault).not.toHaveBeenCalled();
      expect(result.current.dragOverTarget).toBeNull();
    });

    it('pulses haptics only when the hovered target actually changes', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' }), tab({ id: 'c' })];
      const haptics: TabStripHapticsPort = { pulse: vi.fn() };
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn(), haptics }));
      const strip = buildStrip([
        { id: 'a', left: 0, right: 100, width: 100 },
        { id: 'b', left: 100, right: 200, width: 100 },
        { id: 'c', left: 200, right: 300, width: 100 },
      ]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });
      (haptics.pulse as ReturnType<typeof vi.fn>).mockClear();

      const overOnce = () =>
        act(() => {
          result.current.stripDragProps.onDragOver({
            clientX: 260,
            target: strip.querySelector('[data-tab-strip-item-id="c"]'),
            dataTransfer: makeDataTransfer(),
            preventDefault: vi.fn(),
          } as never);
        });
      overOnce();
      overOnce();
      expect(haptics.pulse).toHaveBeenCalledTimes(1);
    });
  });

  describe('stripDragProps.onDrop', () => {
    it('calls onReorder with the resolved target and pulses drop haptics, then clears state', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' }), tab({ id: 'c' })];
      const onReorder = vi.fn();
      const haptics: TabStripHapticsPort = { pulse: vi.fn() };
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder, haptics }));
      const strip = buildStrip([
        { id: 'a', left: 0, right: 100, width: 100 },
        { id: 'b', left: 100, right: 200, width: 100 },
        { id: 'c', left: 200, right: 300, width: 100 },
      ]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });

      const preventDefault = vi.fn();
      act(() => {
        result.current.stripDragProps.onDrop({
          clientX: 260,
          target: strip.querySelector('[data-tab-strip-item-id="c"]'),
          dataTransfer: makeDataTransfer(),
          preventDefault,
        } as never);
      });

      expect(preventDefault).toHaveBeenCalled();
      expect(onReorder).toHaveBeenCalledWith('a', 'c', 'after');
      expect(haptics.pulse).toHaveBeenCalledWith(TAB_STRIP_DROP_HAPTIC_MS);
      expect(result.current.draggingTabId).toBeNull();
      expect(result.current.dragOverTarget).toBeNull();
    });

    it('does not call onReorder when there is no source id', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
      const onReorder = vi.fn();
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder }));
      const strip = buildStrip([{ id: 'a', left: 0, right: 100, width: 100 }]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.stripDragProps.onDrop({
          clientX: 10,
          target: strip,
          dataTransfer: makeDataTransfer(),
          preventDefault: vi.fn(),
        } as never);
      });
      expect(onReorder).not.toHaveBeenCalled();
    });

    it('does not call onReorder when a source id exists but no drop target is found', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
      const onReorder = vi.fn();
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder }));
      const strip = buildStrip([
        { id: 'a', left: 0, right: 100, width: 100 },
        { id: 'b', left: 100, right: 200, width: 100 },
      ]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });
      strip.querySelector('[data-tab-strip-item-id="b"]')!.remove();

      const preventDefault = vi.fn();
      act(() => {
        result.current.stripDragProps.onDrop({
          clientX: 10,
          target: strip,
          dataTransfer: makeDataTransfer(),
          preventDefault,
        } as never);
      });
      // preventDefault IS still called (a source id exists, per the drop
      // handler's own unconditional `if (sourceId) event.preventDefault()`)
      // even though no reorder happens.
      expect(preventDefault).toHaveBeenCalled();
      expect(onReorder).not.toHaveBeenCalled();
    });
  });

  describe('stripDragProps.onDragLeave', () => {
    it('clears the drag-over target when leaving to an element outside the strip', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
      const strip = buildStrip([
        { id: 'a', left: 0, right: 100, width: 100 },
        { id: 'b', left: 100, right: 200, width: 100 },
      ]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });
      act(() => {
        result.current.stripDragProps.onDragOver({
          clientX: 150,
          target: strip.querySelector('[data-tab-strip-item-id="b"]'),
          dataTransfer: makeDataTransfer(),
          preventDefault: vi.fn(),
        } as never);
      });
      expect(result.current.dragOverTarget).not.toBeNull();

      const outsideNode = document.createElement('div');
      document.body.appendChild(outsideNode);
      act(() => {
        result.current.stripDragProps.onDragLeave({
          relatedTarget: outsideNode,
          currentTarget: strip,
        } as never);
      });
      expect(result.current.dragOverTarget).toBeNull();
    });

    it('keeps the drag-over target when leaving to a child still inside the strip', () => {
      const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
      const { result } = renderHook(() => useTabStripDragReorder({ tabs, onReorder: vi.fn() }));
      const strip = buildStrip([
        { id: 'a', left: 0, right: 100, width: 100 },
        { id: 'b', left: 100, right: 200, width: 100 },
      ]);
      act(() => {
        (result.current.stripRef as { current: HTMLDivElement | null }).current = strip;
      });
      act(() => {
        result.current.getItemDragProps('a').onDragStart({ dataTransfer: makeDataTransfer() } as never);
      });
      act(() => {
        result.current.stripDragProps.onDragOver({
          clientX: 150,
          target: strip.querySelector('[data-tab-strip-item-id="b"]'),
          dataTransfer: makeDataTransfer(),
          preventDefault: vi.fn(),
        } as never);
      });
      const before = result.current.dragOverTarget;
      act(() => {
        result.current.stripDragProps.onDragLeave({
          relatedTarget: strip.querySelector('[data-tab-strip-item-id="a"]'),
          currentTarget: strip,
        } as never);
      });
      expect(result.current.dragOverTarget).toEqual(before);
    });
  });
});
