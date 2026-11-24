/**
 * @file A renderer's mount step, kept out of the host's entry module so it can be tested: find the
 * host element the page ships and render the app into it. The host's entry stays a pure composition
 * root (real `document`, real `createRoot`, the real app); this module owns the one decision in that
 * path, failing loudly when the host element is missing.
 */
import type { ReactNode } from 'react';

/** The slice of a React root this module uses (`react-dom/client` `Root`). */
export interface RendererRoot {
  render(children: ReactNode): void;
}

/** Required inputs: where to look for the host element, how to make a root, and what to render. */
export interface MountRendererDeps {
  /** The slice of `document` used to find the host element. */
  document: { getElementById(id: string): Element | null };
  /** `react-dom/client` `createRoot`, injected so a test can observe the mount. */
  createRoot: (container: Element) => RendererRoot;
  /** The tree to render (in production, the host's app inside `<StrictMode>`). */
  app: ReactNode;
}

/** Optional inputs. */
export interface MountRendererOptions {
  /** Id of the host element; the page is expected to ship `<div id="root">`. */
  rootId?: string;
}

/**
 * Render `app` into the host element. Throws when the element is missing: a blank window with no
 * error is far harder to diagnose than an uncaught error naming the missing element.
 */
export function mountRenderer(deps: MountRendererDeps, options: MountRendererOptions = {}): RendererRoot {
  const { rootId = 'root' } = options;
  const container = deps.document.getElementById(rootId);
  if (container == null) throw new Error(`renderer: #${rootId} missing from index.html`);
  const root = deps.createRoot(container);
  root.render(deps.app);
  return root;
}
