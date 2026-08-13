// Shared "close this popover/dialog" plumbing. Six independent feature
// extractions each hand-rolled a version of this: a `pointerdown` outside a
// menu's own DOM subtree, or the Escape key anywhere, should close it.
// ViewportSwitcher (viewer-shell) and BrowserViewportControls (browser-chrome)
// wrote byte-for-byte identical `document.addEventListener('pointerdown', ...)`
// + `document.addEventListener('keydown', ...)` pairs; useTabbedDialog
// (tabbed-dialog, called by SettingsDialogShell and any other host of that shell)
// and DeleteConfirmDialog (asset-grid) each wrote the
// Escape-only half of the same pattern (their backdrop already owns the
// outside-click half via its own `onMouseDown`/`onClick`). This hook covers
// both shapes — pass `containerRef` for the full dropdown/menu behavior, omit
// it for Escape-only modal behavior.
//
// The listener logic itself is NOT reimplemented here: it's a thin
// `useEffect` wrapper around `subscribeOutsideClickOrEscape` in
// `../utils/dom-subscriptions.js`, which is the one place that logic lives
// (framework-free, SSR-safe, already unit-tested there). `subscribeOutsideClickOrEscape`
// was updated alongside this hook to use `pointerdown` (matching every real
// call site above) and to accept an omitted container for the Escape-only
// case — see that file's doc comment. This hook only adds the
// React-lifecycle plumbing: `enabled` gating and a latest-callback
// indirection so callers don't have to memoize `onDismiss`.

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { subscribeOutsideClickOrEscape } from '../utils/dom-subscriptions.js';

export interface UseDismissOnOutsideOrEscapeOptions {
  /** Skip attaching any listeners while `false` (e.g. only while a menu is open). Defaults to `true`. */
  enabled?: boolean;
  /**
   * Element whose subtree counts as "inside" — a `pointerdown` outside it
   * calls `onDismiss`. Omit to skip the outside-click listener entirely and
   * only react to Escape (e.g. a modal whose backdrop click is already
   * handled by the caller).
   */
  containerRef?: RefObject<HTMLElement | null>;
}

/**
 * Calls `onDismiss` on a `pointerdown` outside `options.containerRef` (when
 * supplied) or on the Escape key anywhere. A no-op outside the browser (SSR).
 */
export function useDismissOnOutsideOrEscape(
  onDismiss: () => void,
  options: UseDismissOnOutsideOrEscapeOptions = {},
): void {
  const { enabled = true, containerRef } = options;

  // Latest-ref indirection so callers don't need to memoize `onDismiss` for
  // the subscription effect below to stay attached with fresh behavior.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeOutsideClickOrEscape(containerRef, () => onDismissRef.current());
  }, [enabled, containerRef]);
}
