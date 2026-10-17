import { afterEach, expect, it, vi } from 'vitest';
import { collectPagePerformance, buildPagePerformanceExpression } from '../web-evidence/page-performance-script.js';

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
