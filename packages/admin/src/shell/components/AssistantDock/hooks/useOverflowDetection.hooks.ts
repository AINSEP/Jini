import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * @file Detects whether a ref'd element's CONTENT no longer fits its own box — the trigger for the
 * chat pane's "Show in modal" affordance (owner request, chat-overflow fix 2026-08-30): a button
 * that appears only on content that genuinely doesn't fit, never unconditionally on every card.
 *
 * `ResizeObserver` on the element itself (not a child, not the window) — the same primitive
 * `@jini-ai/chat`'s own `useChatPaneControlsHeight`/`MessageList` sticky-scroll effect already uses,
 * but NOT the same guarantee: `ResizeObserver` only ever reports a change in the OBSERVED ELEMENT'S
 * OWN box (its content-box, by default) — never "this element's content changed" in general, and
 * never a descendant's box on its own. `useChatPaneControlsHeight` gets away with that distinction
 * not mattering because its target (`.jini-chat-pane__controls`) is unclipped: its own box IS sized
 * to its content, so a content change and a box change are the same event there. This element is
 * the opposite on purpose — it exists to catch content that no longer fits a box the surrounding
 * layout holds FIXED (the 380px dock this hook's own module doc opens with) — so the two are NOT
 * interchangeable here: a genuinely fixed-width axis can grow its `scrollWidth` arbitrarily far past
 * `clientWidth` while its own box, by construction, never moves, and `ResizeObserver` will not fire
 * for that. What DOES reliably fire it in this hook's real usage is a change on an axis this
 * element's OWN box is not externally pinned on — concretely, its height: `McpUiHost`
 * (`@jini-ai/ui/mcp-ui`) renders its iframe wrapper at an explicit, JS-driven height (not iframe-
 * intrinsic), and since this wrapper itself has no height of its own, that wrapper's growth (a
 * surface reporting a taller real size asynchronously via `ui/notifications/size-changed` — the same
 * late growth `MessageList.tsx`'s own doc describes) grows THIS element's own content-box height in
 * lockstep, which is a real, observable resize of the element `ResizeObserver` is watching. That
 * stops being true past `McpUiHost`'s own `maxHeight` cap — see the known limitation below — and it
 * was never true for width, since `McpUiHost` renders its iframe at a flat `width: '100%'`
 * regardless of content, so a width overflow through this specific child cannot currently occur at
 * all. The mount-time call below (`setIsOverflowing(isElementOverflowing(el))`, run once
 * synchronously, independent of any observer notification) is what actually covers content already
 * overflowing at first paint on ANY axis, `ResizeObserver` or not — a future caller that reuses this
 * hook against genuinely width-varying, non-iframe content should not assume a later-arriving width
 * change on a pinned axis will be caught the same way.
 *
 * Known limitation, stated rather than silently shipped: `McpUiHost` (`@jini-ai/ui/mcp-ui`) applies
 * its own `maxHeight` cap to the iframe wrapper's inline `height` style before this hook ever sees
 * the box, so a surface whose REAL content is taller than that cap reads as "clipped inside its own
 * iframe" without this wrapper's `scrollHeight` ever exceeding its `clientHeight` — the overflow is
 * real but happens one sandboxed frame away from where this hook measures. Catching that case would
 * need `McpUiHost` itself to expose whether it is currently capped (its reported vs. applied size),
 * which is a `@jini-ai/ui` change with its own rebuild step, not something this hook can see from
 * the outside. This hook reliably covers what it CAN see today: height growth up to that cap (the
 * only overflow axis this specific `McpUiHost`-backed caller can currently produce) plus whatever
 * either axis already looks like at first paint.
 */
export interface UseOverflowDetectionResult<T extends HTMLElement> {
  /** Attach to the element whose rendered content should be checked for overflow. */
  containerRef: RefObject<T | null>;
  /** True once the element's scrollable content exceeds its own box, in either axis. */
  isOverflowing: boolean;
}

/** Slack, in px, before a fractional layout rounding difference counts as "overflowing" — mirrors
 *  `MessageList.tsx`'s own `AT_BOTTOM_THRESHOLD_PX` reasoning for the same kind of sub-pixel noise. */
const OVERFLOW_SLACK_PX = 1;

function isElementOverflowing(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + OVERFLOW_SLACK_PX || el.scrollHeight > el.clientHeight + OVERFLOW_SLACK_PX;
}

/**
 * @returns `containerRef` to attach to the measured element, plus its live overflow state.
 * @complexity Time/space: O(1) per resize notification — one comparison, no accumulation.
 */
export function useOverflowDetection<T extends HTMLElement = HTMLDivElement>(): UseOverflowDetectionResult<T> {
  const containerRef = useRef<T | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(() => setIsOverflowing(isElementOverflowing(el)));
    observer.observe(el);
    setIsOverflowing(isElementOverflowing(el));
    return () => observer.disconnect();
  }, []);

  return { containerRef, isOverflowing };
}
