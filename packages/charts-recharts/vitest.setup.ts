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
