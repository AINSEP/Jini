/// <reference lib="dom" />
/** Numeric-only on-demand page evidence; no DOM content, attributes, URLs or heap objects leave the page. */
export interface PagePerformanceEvidence {
  context: 'fresh-isolated-page';
  /** Chromium exposes an approximate heap; null means this API was unavailable. */
  heap: { usedBytes: number; allocatedBytes: number; limitBytes: number } | null;
  /** Attached light-DOM nodes; excludes shadow roots, detached nodes and iframe documents. */
  domNodes: number;
  domTruncated: boolean;
  mountedHiddenPanels: number;
  hiddenPreElements: number;
  hiddenPreTextChars: number;
  iframes: number;
  /** Buffered tasks since navigation plus a 100ms sample, capped at 200; not field INP. */
  longTasks: { supported: boolean; count: number; totalMs: number; maxMs: number; truncated: boolean };
  suspects: readonly string[];
}

/** Serialized into the browser like collectPageStructure; all runtime references are local or Web APIs.
 * Counts nodes up to a fixed cap and samples buffered navigation long tasks for 100ms. Unsupported
 * heap/long-task APIs remain explicit, never zero measurements. Hidden counts cover the scanned DOM.
 * @returns Numeric evidence from this newly loaded context, never the user's existing admin tab.
 * @complexity O(min(nodes, 100000) * DOM depth) time, O(1) output; the observer caps its event sample at 200.
 */
export async function collectPagePerformance(
  _required: Record<string, never>, _options: Record<string, never> = {},
): Promise<PagePerformanceEvidence> {
  // Helpers stay nested: only this function's source is serialized into the page.
  const maxNodes = 100_000, maxTasks = 200;
  const counts = { domNodes: 0, mountedHiddenPanels: 0, hiddenPreElements: 0, hiddenPreTextChars: 0, iframes: 0 };

  function countElement(element: Element): void {
    const hidden = element.getClientRects().length === 0;
    if (element.tagName === 'IFRAME') counts.iframes++;
    if (element.matches('details:not([open]),[hidden],[aria-hidden="true"]') ||
        (element.getAttribute('role') === 'tabpanel' && hidden)) counts.mountedHiddenPanels++;
    if (element.tagName === 'PRE' && hidden) counts.hiddenPreElements++;
  }

  function countNode(node: Node): void {
    if (node.nodeType === Node.ELEMENT_NODE) countElement(node as Element);
    else if (node.nodeType === Node.TEXT_NODE && node.parentElement?.closest('pre')?.getClientRects().length === 0) {
      // Count text once, without copying hidden output into model context.
      counts.hiddenPreTextChars += node.textContent?.length ?? 0;
    }
  }

  async function sampleLongTasks(): Promise<PagePerformanceEvidence['longTasks']> {
    const longTasks = { supported: false, count: 0, totalMs: 0, maxMs: 0, truncated: false };
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes.includes('longtask')) return longTasks;
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (longTasks.count >= maxTasks) { longTasks.truncated = true; break; }
        longTasks.count++; longTasks.totalMs += entry.duration; longTasks.maxMs = Math.max(longTasks.maxMs, entry.duration);
      }
    });
    try {
      observer.observe({ type: 'longtask', buffered: true });
      longTasks.supported = true;
      await new Promise<void>(resolve => setTimeout(resolve, 100));
    } finally { observer.disconnect(); }
    return longTasks;
  }

  const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
  let node = walker.nextNode();
  while (node && counts.domNodes < maxNodes) {
    counts.domNodes++;
    countNode(node);
    node = walker.nextNode();
  }
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const heap = memory ? { usedBytes: memory.usedJSHeapSize, allocatedBytes: memory.totalJSHeapSize, limitBytes: memory.jsHeapSizeLimit } : null;
  const longTasks = await sampleLongTasks();
  const { domNodes, mountedHiddenPanels, hiddenPreElements, hiddenPreTextChars, iframes } = counts;
  const suspects = [
    hiddenPreElements ? `${hiddenPreElements} hidden pre elements remain mounted with ${hiddenPreTextChars} text characters.` : '',
    mountedHiddenPanels ? `${mountedHiddenPanels} hidden or collapsed panels remain mounted.` : '',
    iframes ? `${iframes} iframes have separate documents; their DOM and heaps are outside this sample.` : '',
    longTasks.count ? `${longTasks.count} long tasks were observed; the longest took ${Math.round(longTasks.maxMs)} ms.` : '',
  ].filter(Boolean);
  return { context: 'fresh-isolated-page', heap, domNodes, domTruncated: node !== null, mountedHiddenPanels, hiddenPreElements, hiddenPreTextChars, iframes, longTasks, suspects };
}

/** Use the same local name shim as the existing DOM evidence script so keepNames bundlers work.
 * @complexity O(script length) for serialization; evaluation is performed only on explicit request.
 */
export function buildPagePerformanceExpression(_required: Record<string, never>, _options = {}): string {
  return `(() => { var __name = function(fn) { return fn; }; return (${collectPagePerformance.toString()})({}); })()`;
}
