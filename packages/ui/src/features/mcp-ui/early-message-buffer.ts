/**
 * @module features/mcp-ui/early-message-buffer
 *
 * A framework-free fix for the exact race `@jini-ai/agentic`'s `mcp-ui-apps.ts` names as its reason
 * for existing: a View can post `ui/initialize` before the Host component has mounted and attached
 * its `window.addEventListener('message', …)`.
 *
 * `postMessage` does not queue for a listener that does not exist yet — posted with nobody
 * listening, a message is gone. The only way a Host survives this is to start listening before the
 * View could possibly have sent anything, and to buffer whatever arrives until a (possibly much
 * later, React-effect-timed) subscriber drains it. A `useEffect`-only listener loses anything posted
 * between mount-commit and effect-run, which a lazy import, a Suspense boundary, or an expensive
 * first render makes a real window rather than a theoretical one.
 *
 * Lives in `features/` — not next to the Host it serves — because it is plain TypeScript with no
 * DOM types and no React, so it is testable in a plain Node environment. The module-scope
 * `window.addEventListener` that feeds it belongs to the React half; see
 * `../../react/mcp-ui/host-message-source.ts`.
 *
 * Ported from `examples/reference-web/src/mcpui-lab-message-buffer.ts` unchanged in behavior.
 */

/**
 * A raw `MessageEvent`, narrowed to the fields this module needs. `source` stays `unknown` (rather
 * than the DOM `MessageEventSource`) so this module carries no DOM lib dependency; the caller
 * compares it by identity against a live iframe's `contentWindow` and it is never inspected here.
 */
export interface BufferedWindowMessage {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

export interface EarlyMessageBuffer {
  /** Delivers to every live subscriber if at least one exists; otherwise appends to the backlog. */
  push(message: BufferedWindowMessage): void;
  /**
   * Installs a live subscriber, immediately draining anything already buffered to it in arrival
   * order.
   *
   * Any number of subscribers may be live at once — a chat transcript can hold several Views, and
   * each needs every message rather than only those posted while it happened to be the most recent
   * subscriber. Each subscriber is responsible for filtering to messages sourced from its own
   * iframe. The returned disposer removes only this handler's own registration.
   */
  subscribe(handler: (message: BufferedWindowMessage) => void): () => void;
  /** Number of messages currently backlogged (no live subscriber yet). Exposed for tests and diagnostics. */
  readonly backlogSize: number;
}

/**
 * Bound so a hostile or confused page flooding `postMessage` at a tab that never subscribes cannot
 * grow this buffer without limit. Oldest-first eviction: if the cap is hit, the newest arrivals are
 * likelier to matter (the most recent handshake attempt) than the oldest.
 */
export const MAX_BUFFERED_MESSAGES = 200;

/**
 * Creates an independent buffer. The React half calls this once at module scope; tests call it
 * fresh per test so buffered state never leaks between cases.
 *
 * @param maxBuffered - Backlog cap. See {@link MAX_BUFFERED_MESSAGES}.
 * @complexity O(1) per push, O(n) per subscribe in the backlog length.
 */
export function createEarlyMessageBuffer(maxBuffered: number = MAX_BUFFERED_MESSAGES): EarlyMessageBuffer {
  const backlog: BufferedWindowMessage[] = [];
  const liveHandlers = new Set<(message: BufferedWindowMessage) => void>();

  return {
    push(message) {
      if (liveHandlers.size > 0) {
        // Snapshot before iterating: a handler that subscribes or unsubscribes synchronously (a
        // Host tearing itself down mid-dispatch) must not mutate the Set out from under the loop.
        for (const handler of [...liveHandlers]) handler(message);
        return;
      }
      backlog.push(message);
      if (backlog.length > maxBuffered) backlog.shift();
    },
    subscribe(handler) {
      liveHandlers.add(handler);
      // Shift one at a time, not splice-all: a handler that calls `push` synchronously must not see
      // a backlog it just extended replayed back at it in the same drain.
      let next = backlog.shift();
      while (next !== undefined) {
        handler(next);
        next = backlog.shift();
      }
      return () => {
        liveHandlers.delete(handler);
      };
    },
    get backlogSize() {
      return backlog.length;
    },
  };
}
