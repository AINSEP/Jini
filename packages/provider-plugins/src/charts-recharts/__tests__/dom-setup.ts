/** DOM test setup for the chart provider's jsdom tests (vitest.config.ts routes `src/charts-*` to jsdom).
 * Imported first by each DOM test file rather than as a package-wide setup file, so the package's
 * node-only provider tests never load React or the DOM matchers. */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => cleanup());

// jsdom has no resize observer. Recharts still measures its actual frame; tests supply only
// browser geometry, and this fake delivers that measurement through the real observer seam.
class LayoutResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = LayoutResizeObserver as unknown as typeof ResizeObserver;
