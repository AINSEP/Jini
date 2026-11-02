/** Mounts a built browser chart provider's exact bytes in a private jsdom window, from a node-environment
 * test (the artifact test packs with npm and esbuild, which a jsdom test environment breaks). */
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';
import { vi } from 'vitest';

interface BuiltChartInstance { readonly ready?: Promise<void>; destroy(input: Record<string, never>): void }
interface BuiltChartModule {
  mount(input: { element: HTMLElement; spec: Record<string, unknown>; theme: { mode: 'light' } }): BuiltChartInstance;
}
export interface BuiltChartDom {
  /** Mounts one chart, waits for its commit and returns the drawn element and its destroy. */
  draw(required: { spec: Record<string, unknown> }): Promise<{ element: HTMLElement; destroy(): void }>;
  close(): void;
}

/** Browser globals the bundled React and Recharts read at import and render time. */
function browserGlobals({ window }: { window: JSDOM['window'] }): Record<string, unknown> {
  return {
    window, document: window.document, HTMLElement: window.HTMLElement, SVGElement: window.SVGElement, Element: window.Element,
    Node: window.Node, getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    // ResponsiveContainer skips measuring without an observer; its first size comes from the layout below.
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  };
}

/**
 * Loads `javascript` (an absolute path to a built `client/` module) into a fresh jsdom window.
 * Layout is faked like the source tests: a 600x300 frame, text 7px per character.
 * @example const dom = await openBuiltChart({ javascript }); const { element } = await dom.draw({ spec }); dom.close();
 */
export async function openBuiltChart({ javascript }: { javascript: string }, _optional: Record<string, never> = {}): Promise<BuiltChartDom> {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const text = this.id === 'recharts_measurement_span';
    const width = text ? (this.textContent ?? '').length * 7 : 600;
    const height = text ? 14 : 300;
    return { width, height, top: 0, left: 0, bottom: height, right: width, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  for (const [name, value] of Object.entries(browserGlobals({ window }))) vi.stubGlobal(name, value);
  const chart = await import(pathToFileURL(javascript).href) as BuiltChartModule;
  return {
    async draw({ spec }) {
      const element = window.document.createElement('div');
      window.document.body.append(element);
      const instance = chart.mount({ element, spec, theme: { mode: 'light' } });
      await instance.ready;
      return { element, destroy: () => { instance.destroy({}); element.remove(); } };
    },
    close() { vi.unstubAllGlobals(); window.close(); },
  };
}
