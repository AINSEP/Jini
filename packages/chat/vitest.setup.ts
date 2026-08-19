import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// Registers jest-dom's DOM matchers (toBeInTheDocument, toHaveAttribute, …) on vitest's `expect`.
import '@testing-library/jest-dom/vitest';

// Unmounts every React tree rendered by @testing-library/react between tests so DOM assertions
// never see leftover markup from a previous test's render().
//
// This file is loaded for EVERY test in the package, including the `src/core/**` suite that
// deliberately runs without a DOM (see `vitest.config.ts`). That is safe and intentional: both
// imports above only register matchers and a hook — neither touches `document` at module load —
// and `cleanup()` is a no-op when nothing has been rendered. The no-jsdom guard on `src/core/**`
// is unaffected; a `window` reference there still fails exactly as loudly as before. Mirrors
// `@jini-ai/admin`'s `vitest.setup.ts`, which makes the identical argument for its own
// `src/core`/`src/server` layers.
afterEach(() => {
  cleanup();
});

// jsdom implements zero layout (no `ResizeObserver`, and every element reports 0 for
// `offsetWidth`/`offsetHeight`/`getBoundingClientRect`). `A2uiSurfaceCard` can now resolve
// registry components (`buildA2uiCatalogFromRegistry`), including recharts' bar/line/pie charts —
// their `ResponsiveContainer` measures its parent via `ResizeObserver` before it will render its
// children at all. This fake invokes its callback once, synchronously, with the target's
// `getBoundingClientRect()` — good enough since neither this package's tests nor its production
// usage need live resize-tracking, just a non-zero initial measurement. Mirrors `@jini-ai/ui`'s
// own identical polyfill (same reasoning, same shape) since this package pulls in the same
// recharts providers via `DEFAULT_INTERACTIVE_UI_REGISTRY`. Guarded (not a hard override) so a
// test that installs its own more specific mock via `vi.stubGlobal` still wins.
if (typeof globalThis !== 'undefined' && typeof globalThis.ResizeObserver === 'undefined') {
  class FakeResizeObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      const rect = target.getBoundingClientRect();
      this.callback([{ target, contentRect: rect } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
}
