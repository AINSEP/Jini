// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  clamp,
  isTooltipTarget,
  positionTooltip,
  readTooltipTarget,
  sameStyle,
  TooltipLayer,
  tooltipPlacement,
  useTooltipLayer,
} from '../../components/TooltipLayer.js';

// jsdom's PointerEvent support is incomplete/absent depending on version;
// TooltipLayer only relies on `target`/`relatedTarget`, which a plain
// MouseEvent-based polyfill covers fine for these tests.
beforeAll(() => {
  if (typeof globalThis.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      constructor(type: string, params: MouseEventInit = {}) {
        super(type, params);
      }
    }
    // @ts-expect-error -- test-environment polyfill
    globalThis.PointerEvent = PointerEventPolyfill;
  }
});

function Trigger() {
  return (
    <button className="jini-tooltip" data-tooltip="Hello there" data-testid="trigger">
      Hover me
    </button>
  );
}

describe('TooltipLayer', () => {
  it('renders nothing until a tooltip target is hovered', () => {
    render(
      <>
        <Trigger />
        <TooltipLayer />
      </>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows the tooltip text on pointerover and hides it on pointerout', () => {
    render(
      <>
        <Trigger />
        <TooltipLayer />
      </>,
    );
    const trigger = screen.getByTestId('trigger');
    fireEvent.pointerOver(trigger);
    expect(screen.getByRole('tooltip').textContent).toBe('Hello there');

    fireEvent.pointerOut(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('ignores elements without the jini-tooltip class', () => {
    render(
      <>
        <button data-tooltip="nope" data-testid="not-a-trigger">
          Plain button
        </button>
        <TooltipLayer />
      </>,
    );
    fireEvent.pointerOver(screen.getByTestId('not-a-trigger'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('hides on Escape', () => {
    render(
      <>
        <Trigger />
        <TooltipLayer />
      </>,
    );
    fireEvent.pointerOver(screen.getByTestId('trigger'));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

// The exported pure helpers — now directly unit-testable without rendering.
describe('tooltip helpers', () => {
  it('clamp keeps a value within [min, max]', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it('sameStyle compares x, y, and visibility', () => {
    const base = { x: 1, y: 2, visibility: 'visible' as const };
    expect(sameStyle(base, { ...base })).toBe(true);
    expect(sameStyle(base, { ...base, x: 9 })).toBe(false);
    expect(sameStyle(base, { ...base, visibility: 'hidden' })).toBe(false);
  });

  it('tooltipPlacement reads data-tooltip-placement, defaulting to "top"', () => {
    const el = document.createElement('div');
    expect(tooltipPlacement(el)).toBe('top');
    el.dataset.tooltipPlacement = 'bottom';
    expect(tooltipPlacement(el)).toBe('bottom');
    el.dataset.tooltipPlacement = 'left';
    expect(tooltipPlacement(el)).toBe('left');
    el.dataset.tooltipPlacement = 'right';
    expect(tooltipPlacement(el)).toBe('right');
    el.dataset.tooltipPlacement = 'nonsense';
    expect(tooltipPlacement(el)).toBe('top');
  });

  it('isTooltipTarget enforces the class + non-empty data-tooltip + not aria-expanded contract', () => {
    const make = (setup: (el: HTMLElement) => void) => {
      const el = document.createElement('button');
      setup(el);
      return el;
    };
    expect(isTooltipTarget(make((el) => { el.className = 'jini-tooltip'; el.dataset.tooltip = 'hi'; }))).toBe(true);
    expect(isTooltipTarget(make((el) => { el.dataset.tooltip = 'hi'; }))).toBe(false); // no class
    expect(isTooltipTarget(make((el) => { el.className = 'jini-tooltip'; el.dataset.tooltip = '  '; }))).toBe(false); // empty
    expect(isTooltipTarget(make((el) => {
      el.className = 'jini-tooltip'; el.dataset.tooltip = 'hi'; el.setAttribute('aria-expanded', 'true');
    }))).toBe(false); // expanded
    expect(isTooltipTarget(null)).toBe(false);
  });

  it('readTooltipTarget resolves the closest trigger from an inner node', () => {
    const trigger = document.createElement('button');
    trigger.className = 'jini-tooltip';
    trigger.dataset.tooltip = 'hi';
    const inner = document.createElement('span');
    trigger.appendChild(inner);
    document.body.appendChild(trigger);
    expect(readTooltipTarget(inner)).toBe(trigger);
    expect(readTooltipTarget(document.body)).toBeNull();
    expect(readTooltipTarget(null)).toBeNull();
    trigger.remove();
  });
});

// The positioning math against a controlled viewport + element rects.
describe('positionTooltip', () => {
  const originalW = window.innerWidth;
  const originalH = window.innerHeight;
  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });
  afterAll(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalW, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: originalH, configurable: true });
  });

  const withRect = (left: number, top: number, width: number, height: number) => {
    const el = document.createElement('div');
    const r = { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height };
    el.getBoundingClientRect = () => ({ ...r, toJSON: () => r }) as DOMRect;
    return el;
  };

  it('centers above the target for "top"', () => {
    const target = withRect(100, 200, 40, 20);
    const tip = withRect(0, 0, 60, 30);
    expect(positionTooltip(target, tip, 'top')).toEqual({ x: 90, y: 163, visibility: 'visible' });
  });

  it('drops below the target for "bottom"', () => {
    const target = withRect(100, 200, 40, 20);
    const tip = withRect(0, 0, 60, 30);
    expect(positionTooltip(target, tip, 'bottom')).toEqual({ x: 90, y: 227, visibility: 'visible' });
  });

  it('sits to the side and vertically centers for "left" and "right"', () => {
    const target = withRect(100, 200, 40, 20);
    const tip = withRect(0, 0, 60, 30);
    expect(positionTooltip(target, tip, 'left')).toEqual({ x: 33, y: 195, visibility: 'visible' });
    expect(positionTooltip(target, tip, 'right')).toEqual({ x: 147, y: 195, visibility: 'visible' });
  });

  it('clamps to the viewport margin when the target is at the corner', () => {
    const target = withRect(0, 0, 0, 0);
    const tip = withRect(0, 0, 60, 30);
    expect(positionTooltip(target, tip, 'top')).toEqual({ x: 8, y: 8, visibility: 'visible' });
  });
});

// The hook drives all behavior; testable in isolation with no rendered tooltip.
describe('useTooltipLayer', () => {
  const mountTrigger = (attrs: Record<string, string> = {}) => {
    const el = document.createElement('button');
    el.className = 'jini-tooltip';
    el.setAttribute('data-tooltip', 'Hi');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return el;
  };

  it('starts with no tooltip state', () => {
    const { result } = renderHook(() => useTooltipLayer());
    expect(result.current.state).toBeNull();
  });

  it('enters a hidden, unpositioned state when a trigger receives pointerover', () => {
    const trigger = mountTrigger();
    const { result } = renderHook(() => useTooltipLayer());
    act(() => {
      trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    expect(result.current.state?.target).toBe(trigger);
    expect(result.current.state?.text).toBe('Hi');
    expect(result.current.state?.placement).toBe('top');
    // No rendered node to measure, so it stays hidden at the origin.
    expect(result.current.state?.style.visibility).toBe('hidden');
    trigger.remove();
  });

  it('clears state on Escape', () => {
    const trigger = mountTrigger();
    const { result } = renderHook(() => useTooltipLayer());
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    expect(result.current.state).not.toBeNull();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(result.current.state).toBeNull();
    trigger.remove();
  });

  it('suppresses the native title while shown and restores it on hide', () => {
    const trigger = mountTrigger({ title: 'native' });
    renderHook(() => useTooltipLayer());
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    expect(trigger.hasAttribute('title')).toBe(false);
    expect(trigger.getAttribute('data-jini-tooltip-native-title')).toBe('native');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(trigger.getAttribute('title')).toBe('native');
    trigger.remove();
  });

  it('hides on pointerdown activation while keeping the title suppressed', () => {
    const trigger = mountTrigger({ title: 'native' });
    const { result } = renderHook(() => useTooltipLayer());
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    expect(result.current.state).not.toBeNull();
    act(() => trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(result.current.state).toBeNull();
    expect(trigger.hasAttribute('title')).toBe(false);
    trigger.remove();
  });

  it('hides on click', () => {
    const trigger = mountTrigger();
    const { result } = renderHook(() => useTooltipLayer());
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    act(() => trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(result.current.state).toBeNull();
    trigger.remove();
  });

  it('hides on pointercancel', () => {
    const trigger = mountTrigger();
    const { result } = renderHook(() => useTooltipLayer());
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    act(() => trigger.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));
    expect(result.current.state).toBeNull();
    trigger.remove();
  });

  it('shows on keyboard focus and hides on focusout to an unrelated element', () => {
    const trigger = mountTrigger();
    const { result } = renderHook(() => useTooltipLayer());
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })));
    act(() => trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(result.current.state?.target).toBe(trigger);
    act(() => trigger.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(result.current.state).toBeNull();
    trigger.remove();
  });

  it('keeps the tooltip shown when the pointer moves to a child of the trigger', () => {
    const trigger = mountTrigger();
    const child = document.createElement('span');
    trigger.appendChild(child);
    const { result } = renderHook(() => useTooltipLayer());
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    const out = new PointerEvent('pointerout', { bubbles: true });
    Object.defineProperty(out, 'relatedTarget', { value: child });
    act(() => trigger.dispatchEvent(out));
    expect(result.current.state).not.toBeNull();
    trigger.remove();
  });

  it('hides on activation (pointerdown) outside any trigger', () => {
    const trigger = mountTrigger();
    const { result } = renderHook(() => useTooltipLayer());
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    act(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(result.current.state).toBeNull();
    trigger.remove();
  });

  it('re-showing the same target no-ops on unchanged text, updates on changed text', () => {
    const trigger = mountTrigger();
    const { result } = renderHook(() => useTooltipLayer());
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    const first = result.current.state;
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    expect(result.current.state).toBe(first); // identical state object reused
    trigger.setAttribute('data-tooltip', 'Changed');
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    expect(result.current.state?.text).toBe('Changed');
    trigger.remove();
  });

  it('activates (hides) on Enter', () => {
    const trigger = mountTrigger();
    const { result } = renderHook(() => useTooltipLayer());
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(result.current.state).toBeNull();
    trigger.remove();
  });

  it('ignores pointerout / focusin / focusout on a non-trigger', () => {
    const { result } = renderHook(() => useTooltipLayer());
    act(() => document.body.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })));
    act(() => document.body.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    act(() => document.body.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(result.current.state).toBeNull();
  });

  it('on pointer-modality focus, suppresses the native title without showing', () => {
    const trigger = mountTrigger({ title: 'native' });
    renderHook(() => useTooltipLayer());
    act(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    act(() => trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(trigger.hasAttribute('title')).toBe(false);
    expect(trigger.getAttribute('data-jini-tooltip-native-title')).toBe('native');
    trigger.remove();
  });

  it('keeps state on focusout to a child of the trigger', () => {
    const trigger = mountTrigger();
    const child = document.createElement('span');
    trigger.appendChild(child);
    const { result } = renderHook(() => useTooltipLayer());
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })));
    act(() => trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    const out = new FocusEvent('focusout', { bubbles: true });
    Object.defineProperty(out, 'relatedTarget', { value: child });
    act(() => trigger.dispatchEvent(out));
    expect(result.current.state).not.toBeNull();
    trigger.remove();
  });

  it('hides when the target mutates to no longer be a valid trigger', async () => {
    const trigger = mountTrigger();
    const { result } = renderHook(() => useTooltipLayer());
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    expect(result.current.state).not.toBeNull();
    await act(async () => {
      trigger.setAttribute('aria-expanded', 'true');
      await new Promise((r) => setTimeout(r));
    });
    expect(result.current.state).toBeNull();
    trigger.remove();
  });

  it('showTooltip ignores a target with no tooltip text', () => {
    const { result } = renderHook(() => useTooltipLayer());
    const bare = document.createElement('div'); // no data-tooltip
    act(() => result.current.showTooltip(bare));
    expect(result.current.state).toBeNull();
  });

  it('treats a matches(":focus-visible") failure as not-focus-visible', () => {
    const trigger = mountTrigger({ title: 'native' });
    const originalMatches = trigger.matches.bind(trigger);
    // Only :focus-visible throws (unsupported); other selectors (used by closest) still work.
    trigger.matches = (selector: string) => {
      if (selector === ':focus-visible') throw new Error('unsupported pseudo-class');
      return originalMatches(selector);
    };
    renderHook(() => useTooltipLayer());
    act(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); // pointer modality
    act(() => trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    // Caught failure => not shown, but the native title is still suppressed.
    expect(trigger.hasAttribute('title')).toBe(false);
    trigger.remove();
  });
});

// Rendered-component paths: positioning against a real portal node, plus the
// scroll/resize rAF scheduler and lifecycle cleanup.
describe('TooltipLayer positioning, scroll & lifecycle', () => {
  const originalRaf = window.requestAnimationFrame;
  const originalCaf = window.cancelAnimationFrame;
  let rafCbs: Array<FrameRequestCallback | undefined> = [];
  beforeAll(() => {
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCbs.push(cb);
      return rafCbs.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((id: number) => { rafCbs[id - 1] = undefined; }) as typeof window.cancelAnimationFrame;
  });
  afterAll(() => {
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCaf;
  });
  const flushRaf = () => {
    const cbs = rafCbs;
    rafCbs = [];
    for (const cb of cbs) cb?.(0);
  };
  const mountTrigger = (attrs: Record<string, string> = {}) => {
    const el = document.createElement('button');
    el.className = 'jini-tooltip';
    el.setAttribute('data-tooltip', 'Hi');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return el;
  };

  it('positions a rendered tooltip and re-runs position on scroll as a no-op when unchanged', () => {
    const trigger = mountTrigger();
    render(<TooltipLayer />);
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    expect(screen.getByRole('tooltip').textContent).toBe('Hi');
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('scroll')); // second hit takes the "already scheduled" guard
    });
    act(() => flushRaf());
    expect(screen.getByRole('tooltip')).toBeTruthy();
    trigger.remove();
  });

  it('scroll with nothing shown positions nothing', () => {
    render(<TooltipLayer />);
    act(() => window.dispatchEvent(new Event('scroll')));
    act(() => flushRaf());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('drops the tooltip when the target leaves the document', () => {
    const trigger = mountTrigger();
    render(<TooltipLayer />);
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    trigger.remove();
    act(() => window.dispatchEvent(new Event('scroll')));
    act(() => flushRaf());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('drops the tooltip when the target becomes aria-expanded', () => {
    const trigger = mountTrigger();
    render(<TooltipLayer />);
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    act(() => {
      trigger.setAttribute('aria-expanded', 'true');
      window.dispatchEvent(new Event('scroll'));
    });
    act(() => flushRaf());
    expect(screen.queryByRole('tooltip')).toBeNull();
    trigger.remove();
  });

  it('falls back to the current text when data-tooltip is removed under a live tooltip', () => {
    const trigger = mountTrigger();
    render(<TooltipLayer />);
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    act(() => {
      trigger.removeAttribute('data-tooltip');
      window.dispatchEvent(new Event('scroll'));
    });
    act(() => flushRaf());
    expect(screen.getByRole('tooltip').textContent).toBe('Hi');
    trigger.remove();
  });

  it('cancels a pending position frame when hiding', () => {
    const trigger = mountTrigger();
    render(<TooltipLayer />);
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    act(() => window.dispatchEvent(new Event('scroll'))); // schedules a frame
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(screen.queryByRole('tooltip')).toBeNull();
    trigger.remove();
  });

  it('cancels a pending position frame on unmount', () => {
    const trigger = mountTrigger();
    const { unmount } = render(<TooltipLayer />);
    act(() => trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    act(() => window.dispatchEvent(new Event('scroll'))); // schedules a frame
    unmount();
    expect(screen.queryByRole('tooltip')).toBeNull();
    trigger.remove();
  });
});

describe('TooltipLayer with hook override prop', () => {
  it('uses useTooltipLayer hook prop to render a forced hidden state (state 1)', () => {
    const customHook = () => ({
      state: null,
      tooltipRef: { current: null },
      showTooltip: vi.fn(),
      hideTooltip: vi.fn(),
    });

    render(<TooltipLayer useTooltipLayer={customHook} />);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('uses useTooltipLayer hook prop to render a forced visible state with custom text and position (state 2)', () => {
    const dummyTarget = document.createElement('div');
    const customHook = () => ({
      state: {
        target: dummyTarget,
        text: 'Custom Active Tooltip',
        placement: 'top' as const,
        style: {
          x: 100,
          y: 200,
          visibility: 'visible' as const,
        },
      },
      tooltipRef: { current: null },
      showTooltip: vi.fn(),
      hideTooltip: vi.fn(),
    });

    render(<TooltipLayer useTooltipLayer={customHook} />);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toBeTruthy();
    expect(tooltip.textContent).toBe('Custom Active Tooltip');
    expect(tooltip.style.transform).toBe('translate3d(100px, 200px, 0)');
    expect(tooltip.style.visibility).toBe('visible');
  });
});
