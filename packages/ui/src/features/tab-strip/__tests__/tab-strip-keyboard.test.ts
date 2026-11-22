// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { navigateTabList, nextTabListIndex, revealActiveTab, rovingTabIndex, tabOverflow } from '../scrollable.js';
import { resolveTabBarKeyTarget } from '../react/components/TabBar.hooks.js';

function fixture() {
  const calls: string[] = [];
  const strip = document.createElement('div');
  const tabs = ['All', 'Alpha', 'Beta'].map((name) => {
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    tab.focus = () => calls.push(`focus:${name}`);
    tab.click = () => calls.push(`select:${name}`);
    strip.append(tab);
    return tab;
  });
  return { calls, tabs, strip };
}

test('D-13 arrow keys wrap, Home/End select endpoints and focus the selected tab', () => {
  expect(typeof navigateTabList).toBe('function');
  for (const [key, from, to] of [['ArrowRight', 0, 1], ['ArrowLeft', 0, 2], ['ArrowRight', 2, 0], ['Home', 2, 0], ['End', 0, 2]] as const) {
    const f = fixture();
    let prevented = false;
    const event = new KeyboardEvent('keydown', { key });
    Object.defineProperty(event, 'target', { value: f.tabs[from] });
    event.preventDefault = () => { prevented = true; };
    navigateTabList({ strip: f.strip, event });
    expect(prevented).toBe(true);
    expect(f.calls).toEqual([`focus:${['All', 'Alpha', 'Beta'][to]}`, `select:${['All', 'Alpha', 'Beta'][to]}`]);
  }
});

test('D-13 ignores other controls, vertical keys, and modified shortcuts', () => {
  expect(typeof navigateTabList).toBe('function');
  const extras = [
    { key: 'ArrowDown' }, { key: 'Tab' }, { key: 'ArrowRight', ctrlKey: true },
    { key: 'ArrowRight', metaKey: true }, { key: 'Home', altKey: true },
    { key: 'End', shiftKey: true }, { key: 'ArrowLeft', outside: true },
  ];
  for (const extra of extras) {
    const f = fixture();
    const event = new KeyboardEvent('keydown', extra);
    Object.defineProperty(event, 'target', { value: 'outside' in extra ? document.createElement('button') : f.tabs[0] });
    event.preventDefault = () => { throw new Error('must preserve native key'); };
    navigateTabList({ strip: f.strip, event });
    expect(f.calls).toEqual([]);
  }
});

test('D-13 a single All tab remains navigable', () => {
  expect(typeof navigateTabList).toBe('function');
  const f = fixture();
  f.tabs.slice(1).forEach((tab) => tab.remove());
  const event = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
  Object.defineProperty(event, 'target', { value: f.tabs[0] });
  navigateTabList({ strip: f.strip, event });
  expect(f.calls).toEqual(['focus:All', 'select:All']);
});

// Raw DOM navigation includes every tab; TabBar's separate rule skips disabled tabs.
test('raw DOM navigation and enabled-tab navigation agree on an all-enabled list', () => {
  const tabs = ['all', 'a', 'b'].map((id) => ({ id, label: id, content: null }));
  for (const [index, tab] of tabs.entries()) {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(nextTabListIndex({ key, index, count: tabs.length })).toBe(
        resolveTabBarKeyTarget({ tabs, activeId: tab.id, key }),
      );
    }
  }
  expect(nextTabListIndex({ key: 'Tab', index: 0, count: tabs.length })).toBeUndefined();
});

test('revealActiveTab defaults to ARIA selection and accepts a host selector', () => {
  const strip = document.createElement('div');
  const selected = document.createElement('button');
  const hostSelected = document.createElement('button');
  selected.setAttribute('aria-selected', 'true');
  hostSelected.className = 'is-active';
  const calls: unknown[] = [];
  selected.scrollIntoView = (options) => calls.push(['aria', options]);
  hostSelected.scrollIntoView = (options) => calls.push(['host', options]);
  strip.append(selected, hostSelected);
  revealActiveTab({ strip });
  revealActiveTab({ strip, activeSelector: '.is-active' });
  revealActiveTab({ strip, activeSelector: '.absent' });
  expect(calls).toEqual([
    ['aria', { block: 'nearest', inline: 'nearest' }],
    ['host', { block: 'nearest', inline: 'nearest' }],
  ]);
});

test('roving tabindex keeps the selection in the tab order and falls back to the null tab', () => {
  const tabIds = [null, 'a', 'b'];
  const indices = (activeId: string | null) => tabIds.map((tabId) => rovingTabIndex({ activeId, tabIds, tabId }));
  expect(indices('b')).toEqual([-1, -1, 0]);
  expect(indices('removed')).toEqual([0, -1, -1]);
  expect(indices(null)).toEqual([0, -1, -1]);
});

test('overflow allows one pixel of rounding tolerance at either edge', () => {
  const overflow = (scrollLeft: number) => tabOverflow({ strip: { scrollWidth: 600, clientWidth: 300, scrollLeft } });
  expect(overflow(1)).toEqual({ left: false, right: true });
  expect(overflow(2)).toEqual({ left: true, right: true });
  expect(overflow(298)).toEqual({ left: true, right: true });
  expect(overflow(299)).toEqual({ left: true, right: false });
});
