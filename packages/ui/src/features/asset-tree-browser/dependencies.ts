/**
 * The only file in this feature allowed to touch a concrete adapter.
 *
 * Both ports are genuinely browser-generic (the Clipboard API and a handful
 * of `window`/`document` event subscriptions) with no backend-specific
 * shape, so — unlike `features/asset-grid`'s host-required `data` port —
 * this package ships a REAL implementation for both, bound to already-
 * shipped package utilities rather than reimplemented here:
 * `copyToClipboard` from `utils/copy-to-clipboard.ts`, and
 * `subscribeOutsideClickOrEscape`/`subscribeWindowEvent`/`getViewportSize`
 * from `utils/dom-subscriptions.ts`. A host never needs to supply its own
 * `AssetTreeDependencies` at all; `createFakeAssetTreeDependencies` exists
 * for this feature's own hook/component tests (and any host that wants a
 * no-op double in its own tests).
 */
import { copyToClipboard } from '../../utils/copy-to-clipboard.js';
import {
  getViewportSize,
  subscribeOutsideClickOrEscape,
  subscribeWindowEvent,
} from '../../utils/dom-subscriptions.js';
import { filesFromClipboardData, shouldIgnoreClipboardFilePaste } from './rules.js';
import type { AssetTreeClipboardPort, AssetTreeDependencies, AssetTreeDomBridgePort } from './ports.js';

/** A real `navigator.clipboard`-backed clipboard port (with the DOM `execCommand` fallback `copyToClipboard` already implements). */
export function createBrowserAssetTreeClipboardPort(): AssetTreeClipboardPort {
  return { copyToClipboard };
}

/** A real browser-event-backed DOM bridge port. Every method is a no-op subscription outside the browser (SSR) — see `utils/dom-subscriptions.ts`'s own SSR guards. */
export function createBrowserAssetTreeDomBridgePort(): AssetTreeDomBridgePort {
  return {
    subscribeOutsideDismiss(container, onDismiss) {
      return subscribeOutsideClickOrEscape({ container, onClose: onDismiss });
    },
    subscribeGlobalPaste(onFiles) {
      return subscribeWindowEvent({ eventName: 'paste', onEvent: (event) => {
        const clipboardEvent = event as ClipboardEvent;
        if (shouldIgnoreClipboardFilePaste({ target: clipboardEvent.target })) return;
        const files = filesFromClipboardData({ clipboardData: clipboardEvent.clipboardData });
        if (files.length === 0) return;
        onFiles(files);
      } });
    },
    getViewportHeight() {
      return getViewportSize().height;
    },
  };
}

/** Real, SSR-guarded dependencies — the `AssetTreeBrowser` component's default when a host supplies none. */
export function createBrowserAssetTreeDependencies(): AssetTreeDependencies {
  return {
    clipboard: createBrowserAssetTreeClipboardPort(),
    dom: createBrowserAssetTreeDomBridgePort(),
  };
}

export interface FakeAssetTreeDependenciesOptions {
  /** Override the fake clipboard's copy outcome. Defaults to always succeeding. */
  copyToClipboardResult?: boolean;
}

/** An in-memory test double with no real browser API — every subscription is inert until a test fires it manually via the returned handles. */
export function createFakeAssetTreeDependencies(
  options: FakeAssetTreeDependenciesOptions = {},
): AssetTreeDependencies {
  const copyResult = options.copyToClipboardResult ?? true;
  return {
    clipboard: {
      copyToClipboard: () => Promise.resolve(copyResult),
    },
    dom: {
      subscribeOutsideDismiss: () => () => {},
      subscribeGlobalPaste: () => () => {},
      getViewportHeight: () => 768,
    },
  };
}
