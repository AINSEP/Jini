/**
 * @module useChatPaneControlsHeight
 *
 * `.jini-chat-pane__controls` (composer, suggestions row, status messages) is deliberately an
 * absolutely-positioned overlay rather than a flex sibling that pushes the transcript up — see
 * `styles.ts`'s own comment on that rule for the gradient-fade reasoning. Positioning it out of
 * flow means the browser's layout engine no longer reserves room for it automatically, so
 * `.jini-message-list` has to reserve that space itself via `padding-bottom` — and until this hook,
 * that reservation was a hardcoded guess (240px) that a live render had already outgrown once before
 * (the comment records the prior incident: 170px measured against a 179.75px composer, clipping the
 * last message's tail under the overlay).
 *
 * A hardcoded reservation can only ever be as good as the day someone last measured the composer —
 * an attachment tray, a wrapped multi-line draft, or a taller runtime picker popover each grow
 * `.jini-chat-pane__controls` independently of anything this package's CSS author can predict. This
 * hook removes the guessing: it measures the controls' real rendered height live via
 * `ResizeObserver` and publishes it as a CSS custom property on a shared ancestor, which
 * `.jini-message-list`'s `padding-bottom` reads via `calc(var(--jini-chat-controls-height, 240px) +
 * …)` — the same 240px stays as the *fallback* for environments without `ResizeObserver` (SSR,
 * `McpUiHost.test.tsx`-style environments without the polyfill), so nothing regresses where this
 * hook can't run; live browsers get the exact number instead of a guess that can go stale.
 *
 * The measured value is written to `rootRef`, not `controlsRef` itself — CSS custom properties
 * inherit to descendants only, and `.jini-message-list` is a SIBLING of `.jini-chat-pane__controls`
 * (both children of `.jini-chat-pane__body`), not a descendant of it. The nearest ancestor common to
 * both is the pane's own root `<section>`, so that is where the property has to live for
 * `.jini-message-list` to read it at all.
 */
import { useEffect, useRef } from 'react';

export const CHAT_PANE_CONTROLS_HEIGHT_CSS_VAR = '--jini-chat-controls-height';

export interface UseChatPaneControlsHeightResult {
  /** Attach to the pane's root element — the nearest ancestor shared by both `.jini-message-list` and `.jini-chat-pane__controls`. */
  rootRef: React.RefObject<HTMLElement | null>;
  /** Attach to `.jini-chat-pane__controls` — the element whose real height is measured. */
  controlsRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Keeps {@link CHAT_PANE_CONTROLS_HEIGHT_CSS_VAR} on the pane root in sync with the controls
 * overlay's actual rendered height.
 *
 * @returns Two refs to attach — see {@link UseChatPaneControlsHeightResult}.
 * @complexity O(1) per resize notification.
 */
export function useChatPaneControlsHeight(): UseChatPaneControlsHeightResult {
  const rootRef = useRef<HTMLElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const controls = controlsRef.current;
    if (!root || !controls || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // Rounded up: a fractional px short would let one glyph's descender clip against the
      // gradient's opaque end, which `Math.ceil` never risks understating.
      root.style.setProperty(CHAT_PANE_CONTROLS_HEIGHT_CSS_VAR, `${Math.ceil(entry.contentRect.height)}px`);
    });
    observer.observe(controls);
    return () => observer.disconnect();
  }, []);

  return { rootRef, controlsRef };
}
