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
 * The missing-`window` guard in `forwardWindowMessages` is for SSR: importing this module during a server render must not throw.
 * Nothing subscribes there, and the module has no other side effect.
 */
import {
  createEarlyMessageBuffer,
  type BufferedWindowMessage,
  type EarlyMessageBuffer,
} from '../../features/mcp-ui/early-message-buffer.js';

/** The slice of `window` the listener needs. */
export interface MessageEventTarget {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/**
 * Forwards every `message` event on `scope.window` into `into`. A scope without a `window` (a
 * server render) is a no-op — that is the SSR guard, and taking the global scope as a parameter
 * lets both the browser and the server path be exercised from one test environment.
 */
export function forwardWindowMessages(scope: { readonly window?: MessageEventTarget }, into: EarlyMessageBuffer): void {
  const target = scope.window;
  if (!target) return;
  target.addEventListener('message', (event: MessageEvent) => {
    into.push({ data: event.data, origin: event.origin, source: event.source });
  });
}

const buffer = createEarlyMessageBuffer();

// Module scope, on purpose — see the header: this runs at first import, before any Host mounts.
forwardWindowMessages(globalThis as { readonly window?: MessageEventTarget }, buffer);

/** How a Host receives raw window messages. Injectable so a test can drive one without a real `postMessage`. */
export type ViewMessageSource = (handler: (message: BufferedWindowMessage) => void) => () => void;

/** The default {@link ViewMessageSource}: the shared, module-scope buffer above. */
export const subscribeToViewMessages: ViewMessageSource = (handler) => buffer.subscribe(handler);

/** Backlogged message count — diagnostics and tests only. */
export function viewMessageBacklogSize(): number {
  return buffer.backlogSize;
}
