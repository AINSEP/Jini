import { afterEach, expect, it, vi } from 'vitest';
import { collectPagePerformance, buildPagePerformanceExpression } from '../page-performance-script.js';

afterEach(() => vi.unstubAllGlobals());

function install(nodes: object[]) {
  let index = 0;
  vi.stubGlobal('document', { createTreeWalker: () => ({ nextNode: () => nodes[index++] ?? null }) });
  vi.stubGlobal('NodeFilter', { SHOW_ALL: -1 });
  vi.stubGlobal('Node', class {
    static ELEMENT_NODE = 1;
    static TEXT_NODE = 3;
  });
  vi.stubGlobal('performance', {});
  vi.stubGlobal('PerformanceObserver', undefined);
}
const element = (tagName: string, hidden = false, panel = false) => ({ nodeType: 1, tagName,
  getClientRects: () => ({ length: hidden ? 0 : 1 }), matches: () => panel, getAttribute: () => null,
});

it('reports hidden mounted output and iframes without revealing text; missing APIs are unknown', async () => {
  const pre = element('PRE', true);
  install([element('DIV', true, true), pre, { nodeType: 3, textContent: 'SECRET', parentElement: { closest: () => pre } }, element('IFRAME')]);
  const result = await collectPagePerformance({});
  expect(result).toMatchObject({ context: 'fresh-isolated-page', heap: null, domNodes: 4, domTruncated: false, mountedHiddenPanels: 1, hiddenPreElements: 1, hiddenPreTextChars: 6, iframes: 1, longTasks: { supported: false, count: 0 } });
  expect(result.suspects).toContain('1 hidden pre elements remain mounted with 6 text characters.');
  expect(JSON.stringify(result)).not.toContain('SECRET');
});

it('bounds DOM traversal and explicitly reports a partial count', async () => {
  install([]);
  vi.stubGlobal('document', { createTreeWalker: () => ({ nextNode: () => element('DIV') }) });
  const result = await collectPagePerformance({});
  expect(result.domNodes).toBe(100_000);
  expect(result.domTruncated).toBe(true);
});

it('reports heap and bounded buffered long tasks, and disconnects the observer', async () => {
  install([]);
  vi.stubGlobal('performance', { memory: { usedJSHeapSize: 120, totalJSHeapSize: 200, jsHeapSizeLimit: 500 } });
  const disconnect = vi.fn(), observe = vi.fn();
  vi.stubGlobal('PerformanceObserver', class {
    static supportedEntryTypes = ['longtask'];
    constructor(private callback: (list: { getEntries(): { duration: number }[] }) => void) {}
    observe(options: unknown) { observe(options); this.callback({ getEntries: () => Array.from({ length: 201 }, () => ({ duration: 75 })) }); }
    disconnect = disconnect;
  });
  const result = await collectPagePerformance({});
  expect(result.heap).toEqual({ usedBytes: 120, allocatedBytes: 200, limitBytes: 500 });
  expect(result.longTasks).toEqual({ supported: true, count: 200, totalMs: 15000, maxMs: 75, truncated: true });
  expect(observe).toHaveBeenCalledWith({ type: 'longtask', buffered: true });
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(buildPagePerformanceExpression({})).toContain('var __name');
});

const tabpanel = (hidden: boolean) => ({ ...element('DIV', hidden), getAttribute: (name: string) => name === 'role' ? 'tabpanel' : null });
const text = (textContent: string | null, pre: object | null) => ({ nodeType: 3, textContent, parentElement: { closest: () => pre } });

it('counts a hidden tab panel as mounted but not a visible one', async () => {
  install([tabpanel(true), tabpanel(false)]);
  const result = await collectPagePerformance({});
  expect(result.mountedHiddenPanels).toBe(1);
  expect(result.suspects).toEqual(['1 hidden or collapsed panels remain mounted.']);
});

it('counts only text inside a hidden pre, and an empty text node as zero characters', async () => {
  install([text('outside', null), text('shown', element('PRE')), text(null, element('PRE', true)), { nodeType: 3, textContent: 'orphan', parentElement: null }, { nodeType: 8 }]);
  const result = await collectPagePerformance({});
  expect(result).toMatchObject({ domNodes: 5, hiddenPreTextChars: 0, hiddenPreElements: 0, suspects: [] });
});

it('names iframes and the longest long task among the suspects', async () => {
  install([element('IFRAME')]);
  vi.stubGlobal('PerformanceObserver', class {
    static supportedEntryTypes = ['longtask'];
    constructor(private callback: (list: { getEntries(): { duration: number }[] }) => void) {}
    observe() { this.callback({ getEntries: () => [{ duration: 60.4 }, { duration: 120.6 }] }); }
    disconnect() {}
  });
  const result = await collectPagePerformance({});
  expect(result.longTasks).toEqual({ supported: true, count: 2, totalMs: 181, maxMs: 120.6, truncated: false });
  expect(result.suspects).toEqual([
    '1 iframes have separate documents; their DOM and heaps are outside this sample.',
    '2 long tasks were observed; the longest took 121 ms.',
  ]);
});

it('reports long tasks as unsupported when the observer lacks the longtask entry type', async () => {
  install([]);
  vi.stubGlobal('PerformanceObserver', class { static supportedEntryTypes = ['paint']; });
  const result = await collectPagePerformance({});
  expect(result.longTasks).toEqual({ supported: false, count: 0, totalMs: 0, maxMs: 0, truncated: false });
});

it('disconnects the observer and propagates the failure when observing throws', async () => {
  install([]);
  const disconnect = vi.fn();
  vi.stubGlobal('PerformanceObserver', class {
    static supportedEntryTypes = ['longtask'];
    observe() { throw new Error('observer rejected longtask'); }
    disconnect = disconnect;
  });
  await expect(collectPagePerformance({})).rejects.toThrow('observer rejected longtask');
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it('evaluates as a standalone expression with only Web APIs in scope', async () => {
  install([element('PRE', true), text('abc', element('PRE', true))]);
  const result = await (0, eval)(buildPagePerformanceExpression({}));
  expect(result).toMatchObject({ domNodes: 2, hiddenPreElements: 1, hiddenPreTextChars: 3 });
});
