// @vitest-environment jsdom
import { act, createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useScrollableTabStrip } from '../react/hooks/useScrollableTabStrip.js';

afterEach(cleanup);
const TABS = [{ id: '/a', label: 'A' }, { id: '/b', label: 'B' }];

/** The injected observer fires on demand; jsdom has no layout or native observer. */
function fakeResizeObserver() {
  const log: string[] = [];
  let fire: () => void = () => undefined;
  class FakeResizeObserver implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      fire = () => callback([], this);
      log.push('created');
    }
    observe() { log.push('observe'); }
    unobserve() {}
    disconnect() { log.push('disconnect'); }
  }
  return { Impl: FakeResizeObserver, log, resize: () => act(() => fire()) };
}

function renderStrip(input: { activeTab: string | null; Impl: typeof ResizeObserver; mounted?: boolean; activeSelector?: string }) {
  const reveals: string[] = [];
  let latest!: ReturnType<typeof useScrollableTabStrip>;
  let activeTab = input.activeTab;
  let tabs = TABS;
  function Strip() {
    latest = useScrollableTabStrip({ activeTab, tabs }, { ResizeObserverImpl: input.Impl, activeSelector: input.activeSelector });
    if (input.mounted === false) return null;
    return createElement('div', { ref: latest.stripRef }, tabs.map((tab) => createElement('button', {
      key: tab.id, role: 'tab',
      'aria-selected': input.activeSelector ? false : tab.id === activeTab,
      className: tab.id === activeTab ? 'is-active' : undefined,
      ref: (node: HTMLButtonElement | null) => { if (node) node.scrollIntoView = () => { reveals.push(tab.id); }; },
    }, tab.label)));
  }
  const view = render(createElement(Strip));
  return {
    current: () => latest,
    reveals,
    select: (id: string) => { activeTab = id; view.rerender(createElement(Strip)); },
    setTabs: (next: typeof TABS) => { tabs = next; view.rerender(createElement(Strip)); },
    unmount: view.unmount,
  };
}

/** Give the strip a layout: jsdom measures every element as zero wide. */
function measure(strip: HTMLElement, dimensions: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
  for (const [name, value] of Object.entries(dimensions)) {
    Object.defineProperty(strip, name, { configurable: true, value, writable: true });
  }
}

test('the strip reveals the active tab and shows arrows only while it overflows', () => {
  const ro = fakeResizeObserver();
  const strip = renderStrip({ activeTab: '/b', Impl: ro.Impl });
  expect(strip.reveals).toEqual(['/b']);
  expect(ro.log).toEqual(['created', 'observe']);
  expect(strip.current().showArrows).toBe(false);
  const node = strip.current().stripRef.current!;
  measure(node, { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
  ro.resize();
  expect(strip.current().overflow).toEqual({ left: false, right: true });
  expect(strip.current().showArrows).toBe(true);
  expect(strip.reveals).toEqual(['/b', '/b']);
  measure(node, { scrollWidth: 600, clientWidth: 300, scrollLeft: 300 });
  act(() => { node.dispatchEvent(new Event('scroll')); });
  expect(strip.current().overflow).toEqual({ left: true, right: false });
  strip.select('/a');
  expect(ro.log).toEqual(['created', 'observe', 'disconnect', 'created', 'observe']);
  expect(strip.reveals.at(-1)).toBe('/a');
  const removeListener = vi.spyOn(node, 'removeEventListener');
  strip.unmount();
  expect(ro.log.at(-1)).toBe('disconnect');
  expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  removeListener.mockRestore();
});

test('the arrows scroll the strip by a fixed step, and arrow keys move between tabs', () => {
  const ro = fakeResizeObserver();
  const strip = renderStrip({ activeTab: '/a', Impl: ro.Impl });
  const node = strip.current().stripRef.current!;
  const scrolls: unknown[] = [];
  node.scrollBy = ((options: ScrollToOptions) => { scrolls.push(options); }) as HTMLElement['scrollBy'];
  strip.current().scrollLeft();
  strip.current().scrollRight();
  expect(scrolls).toEqual([{ left: -200, behavior: 'smooth' }, { left: 200, behavior: 'smooth' }]);
  const tabs = Array.from(node.querySelectorAll('button'));
  const clicked: string[] = [];
  tabs.forEach((tab) => tab.addEventListener('click', () => clicked.push(tab.textContent!)));
  const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
  Object.defineProperty(event, 'target', { value: tabs[0] });
  strip.current().onKeyDown(event);
  expect(clicked).toEqual(['B']);
  expect(document.activeElement).toBe(tabs[1]);
  expect(strip.current().tabIndex({ tabId: '/a' })).toBe(0);
  expect(strip.current().tabIndex({ tabId: '/b' })).toBe(-1);
});

test('with no strip mounted the hook observes nothing and its controls are inert', () => {
  const ro = fakeResizeObserver();
  const strip = renderStrip({ activeTab: null, Impl: ro.Impl, mounted: false });
  expect(ro.log).toEqual([]);
  expect(strip.current().scrollLeft()).toBeUndefined();
  expect(strip.current().scrollRight()).toBeUndefined();
  strip.current().onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  expect(strip.current().tabIndex({ tabId: null })).toBe(0);
});

test('the hook passes the host active selector through on mount and resize', () => {
  const ro = fakeResizeObserver();
  const strip = renderStrip({ activeTab: '/b', Impl: ro.Impl, activeSelector: '.is-active' });
  expect(strip.reveals).toEqual(['/b']);
  ro.resize();
  expect(strip.reveals).toEqual(['/b', '/b']);
});

test('tab IDs and labels re-subscribe while an equivalent new array preserves the subscription', () => {
  const ro = fakeResizeObserver();
  const strip = renderStrip({ activeTab: '/a', Impl: ro.Impl });
  strip.setTabs(TABS.map((tab) => ({ ...tab })));
  expect(ro.log).toEqual(['created', 'observe']);
  strip.setTabs([{ id: '/a', label: 'Renamed' }, TABS[1]!]);
  expect(ro.log).toEqual(['created', 'observe', 'disconnect', 'created', 'observe']);
  strip.setTabs([{ id: '/c', label: 'Renamed' }, TABS[1]!]);
  expect(ro.log).toEqual(['created', 'observe', 'disconnect', 'created', 'observe', 'disconnect', 'created', 'observe']);
  expect(strip.current().tabIndex({ tabId: null })).toBe(0);
});
