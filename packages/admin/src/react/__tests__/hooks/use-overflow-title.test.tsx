import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useOverflowTitle } from '../../hooks/use-overflow-title.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('measures overflow on mount, dependency changes, window resize, and observer callbacks, cleaning both listeners', () => {
  let notifyResize: () => void = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const element = document.createElement('span');
  const ref = { current: element };
  let scrollWidth = 101;
  const measure = vi.fn(({ element: measured }: { element: HTMLElement }) => {
    expect(measured).toBe(element);
    return { scrollWidth, clientWidth: 100 };
  });
  const { result, rerender, unmount } = renderHook(({ version }) => useOverflowTitle({ ref, deps: [version] }, { doc: document, measure }), { initialProps: { version: 0 } });
  expect(result.current).toBe(true);
  expect(observe).toHaveBeenCalledWith(element);
  scrollWidth = 100;
  act(() => { window.dispatchEvent(new Event('resize')); });
  expect(result.current).toBe(false);
  scrollWidth = 200;
  act(() => { notifyResize(); });
  expect(result.current).toBe(true);
  scrollWidth = 50;
  rerender({ version: 1 });
  expect(result.current).toBe(false);
  const resizeListeners = add.mock.calls.filter(([type]) => type === 'resize');
  expect(resizeListeners).toHaveLength(2);
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
  for (const [, listener] of resizeListeners) expect(remove).toHaveBeenCalledWith('resize', listener);
  measure.mockClear();
  window.dispatchEvent(new Event('resize'));
  expect(measure).not.toHaveBeenCalled();
});

it('reads native dimensions without an observer, and resets when the ref disappears', () => {
  vi.stubGlobal('ResizeObserver', undefined);
  const element = document.createElement('span');
  Object.defineProperties(element, { scrollWidth: { value: 120 }, clientWidth: { value: 100 } });
  const ref: { current: HTMLElement | null } = { current: element };
  const { result, rerender, unmount } = renderHook(({ version }) => useOverflowTitle({ ref, deps: [version] }), { initialProps: { version: 0 } });
  expect(result.current).toBe(true);
  ref.current = null;
  rerender({ version: 1 });
  expect(result.current).toBe(false);
  unmount();
});
