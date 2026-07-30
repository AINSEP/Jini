/**
 * @module react/mcp-ui/host-message-source
 *
 * The single `window` message listener every MCP-UI Host in the page shares, installed at MODULE
 * scope rather than in a React effect.
 *
 * This is the whole point of `features/mcp-ui/early-message-buffer.ts`, and the placement is the
 * load-bearing part: this module is evaluated when it is first imported — before any Host component
 * has mounted, and therefore before an iframe carrying a View could exist in the DOM. A View that
 * posts `ui/initialize` the instant its script runs is heard, even if the Host's own effect has not
 * run yet, because the listener was already installed and the buffer holds what arrives until a
 * subscriber drains it.
 *
 * Doing this in a `useEffect` instead loses every message posted between mount-commit and effect-run
 * — a window that a lazy import, a Suspense boundary, or one expensive sibling render makes real.
 *
 * The `typeof window` guard is for SSR: importing this module during a server render must not throw.
 * Nothing subscribes there, and the module has no other side effect.
 */
import {
  createEarlyMessageBuffer,
  type BufferedWindowMessage,
} from '../../features/mcp-ui/early-message-buffer.js';

const buffer = createEarlyMessageBuffer();

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    buffer.push({ data: event.data, origin: event.origin, source: event.source });
  });
}

/** How a Host receives raw window messages. Injectable so a test can drive one without a real `postMessage`. */
export type ViewMessageSource = (handler: (message: BufferedWindowMessage) => void) => () => void;

/** The default {@link ViewMessageSource}: the shared, module-scope buffer above. */
export const subscribeToViewMessages: ViewMessageSource = (handler) => buffer.subscribe(handler);

/** Backlogged message count — diagnostics and tests only. */
export function viewMessageBacklogSize(): number {
  return buffer.backlogSize;
}
