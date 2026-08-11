import { openSandboxedPreviewInNewTab } from '../../renderers/index.js';
import type { FullscreenPort, HtmlViewerDependencies, NewTabPreviewPort } from './ports.js';

/** Real browser Fullscreen API binding. Every method is SSR-guarded (`typeof document === 'undefined'`). */
export function createBrowserFullscreenPort(): FullscreenPort {
  return {
    async requestFullscreen(element) {
      if (typeof element.requestFullscreen !== 'function') return;
      await element.requestFullscreen();
    },
    async exitFullscreen() {
      if (typeof document === 'undefined') return;
      if (!document.fullscreenElement || typeof document.exitFullscreen !== 'function') return;
      await document.exitFullscreen();
    },
    fullscreenElement() {
      // `?? null` rather than a bare pass-through: some DOM implementations
      // (e.g. jsdom) leave `document.fullscreenElement` entirely undefined
      // rather than defining it as a getter that returns `null`.
      return typeof document === 'undefined' ? null : (document.fullscreenElement ?? null);
    },
    subscribeFullscreenChange(onChange) {
      if (typeof document === 'undefined') return () => {};
      document.addEventListener('fullscreenchange', onChange);
      return () => document.removeEventListener('fullscreenchange', onChange);
    },
  };
}

/** Reuses `@jini-ai/ui`'s own `./renderers` subpath's `openSandboxedPreviewInNewTab` — the sandboxed-iframe core this whole slice is the first consumer of within this package. */
export function createBrowserNewTabPreviewPort(): NewTabPreviewPort {
  return {
    openInNewTab(html, title) {
      openSandboxedPreviewInNewTab(html, title);
    },
  };
}

export function createDefaultHtmlViewerDependencies(): HtmlViewerDependencies {
  return {
    fullscreen: createBrowserFullscreenPort(),
    newTabPreview: createBrowserNewTabPreviewPort(),
  };
}

// Module-level singleton default, matching `features/version-manager/`'s
// `defaultVersionManagerDependencies` precedent: every wired hook binds to
// this SAME instance rather than each independently constructing its own,
// so two hooks in one tree that both omit `dependencies` still share state
// (e.g. the fullscreen-change subscription).
export const defaultHtmlViewerDependencies: HtmlViewerDependencies = createDefaultHtmlViewerDependencies();
