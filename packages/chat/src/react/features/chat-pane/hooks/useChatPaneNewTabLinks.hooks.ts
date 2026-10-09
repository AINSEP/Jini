/**
 * @module useChatPaneNewTabLinks
 *
 * Every link inside the chat pane opens in a new tab, so following one never navigates the tab the
 * conversation lives in (owner 2026-10-08: "every link"). One capture-phase click guard on the
 * pane's root absorbs every link source at once — markdown in messages, tool cards, host-registered
 * ext-event cards, A2UI surfaces, the header slot — instead of each renderer setting `target` on its
 * own anchors and the next new card forgetting to.
 *
 * Capture phase, then `preventDefault()`: the guard runs before any anchor's own `onClick`, so a
 * router `<Link>` (React Router, TanStack Router — both skip their in-app navigation once
 * `defaultPrevented` is set) does not ALSO navigate the chat's tab after the new tab opens.
 *
 * Left to the browser: modified or non-primary clicks (the browser already opens those however the
 * user asked), anchors that already say `target="_blank"`, `#` same-document anchors, `download`
 * links, `role="button"` anchors (an action, not a link), and any scheme other than http(s) —
 * `mailto:`/`tel:` hand off to another app without navigating the tab anyway.
 *
 * MCP-UI Views render inside a sandboxed iframe, out of this guard's reach; their proxy page
 * forwards link clicks as `ui/open-link` (`@jini-ai/ui/mcp-ui`'s sandbox proxy) instead.
 */
import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

const NEW_TAB_PROTOCOLS = new Set(['http:', 'https:']);

/** Opens `url` in a new tab with no opener or referrer — `rel="noopener noreferrer"` for `window.open`. */
function openInNewTabDefault(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Decides whether a click inside the pane should open a link in a new tab.
 *
 * @param input.event - The click, native (React's `nativeEvent` or a DOM listener's own).
 * @param input.root - The pane root; an anchor outside it (one wrapping the whole pane) is ignored.
 * @returns The anchor's resolved absolute URL to open, or `null` to leave the click to the browser.
 * @complexity O(d) for `closest` over the target's ancestor depth d.
 */
export function newTabLinkHref({ event, root }: { event: MouseEvent; root: Element }): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const link = target.closest('a[href]');
  if (!(link instanceof HTMLAnchorElement) || !root.contains(link)) return null;
  if (link.target === '_blank' || link.hasAttribute('download') || link.getAttribute('role') === 'button') return null;
  if (link.getAttribute('href')!.startsWith('#')) return null;
  return NEW_TAB_PROTOCOLS.has(link.protocol) ? link.href : null;
}

/**
 * The pane root's `onClickCapture` handler: opens qualifying link clicks in a new tab and cancels
 * the in-tab navigation. See this module's doc for what qualifies.
 *
 * @param _required - Reserved; no required inputs.
 * @param options.openInNewTab - Opener port; defaults to `window.open(url, '_blank', 'noopener,noreferrer')`.
 * @returns A stable click-capture handler.
 */
export function useChatPaneNewTabLinks(
  _required: Record<string, never> = {},
  { openInNewTab = openInNewTabDefault }: { openInNewTab?: (url: string) => void } = {},
): (event: ReactMouseEvent<HTMLElement>) => void {
  return useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const href = newTabLinkHref({ event: event.nativeEvent, root: event.currentTarget });
      if (href === null) return;
      event.preventDefault();
      openInNewTab(href);
    },
    [openInNewTab],
  );
}
