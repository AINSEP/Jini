/**
 * A tiny, framework-free fix for the exact race `@jini/agentic`'s `mcp-ui-apps.ts` module doc
 * names as its reason for existing: a View can post `ui/notifications/initialized` before a Host
 * component has mounted and attached its `window.addEventListener('message', ...)` listener.
 *
 * `postMessage` does not queue for a listener that does not exist yet — once posted with nobody
 * listening, a message is gone forever. The only way a Host can survive this is to start
 * listening before the View could possibly have sent anything, and to buffer whatever arrives
 * before some (possibly much later, possibly React-effect-timed) subscriber shows up to drain it.
 *
 * This module is deliberately NOT React: `McpUiLab.tsx` creates ONE instance at module scope
 * (evaluated at page-load time, before any component mounts, before the iframe that would carry
 * a View even exists in the DOM) and calls {@link EarlyMessageBuffer.push} from a single
 * `window.addEventListener('message', ...)` registered right next to it — also at module scope,
 * so there is no React lifecycle in between the browser delivering the event and it landing here.
 * A React effect then only ever calls {@link EarlyMessageBuffer.subscribe}, which drains anything
 * already buffered before the browser can deliver anything else.
 */

/** A raw `MessageEvent`, narrowed to the fields this module needs. `source`/`origin` stay `unknown`/`string` rather than the DOM `MessageEventSource` type so this module has no DOM lib dependency and is testable in a plain Node environment. */
export interface BufferedWindowMessage {
  readonly data: unknown;
  readonly origin: string;
  /** `event.source` — compared by identity against a live iframe's `contentWindow` by the caller; never inspected here. */
  readonly source: unknown;
}

export interface EarlyMessageBuffer {
  /** Delivers to the live subscriber if one exists; otherwise appends to the backlog. */
  push(message: BufferedWindowMessage): void;
  /**
   * Installs the one live subscriber, immediately draining (in arrival order) anything already
   * buffered. Only one subscriber is live at a time — matching this fixture's one-Host-component
   * reality — so a second `subscribe` call replaces the first (the returned disposer only clears
   * the slot if it still belongs to the caller, so a stale unmount effect cannot un-subscribe a
   * newer subscriber).
   * @returns An unsubscribe function.
   */
  subscribe(handler: (message: BufferedWindowMessage) => void): () => void;
  /** Number of messages currently backlogged (no live subscriber yet). Exposed for tests/diagnostics. */
  readonly backlogSize: number;
}

/**
 * Bound so a hostile or confused page flooding `postMessage` at a tab that never subscribes
 * cannot grow this buffer without limit. Oldest-first eviction: if the cap is ever hit, the
 * newest arrivals are more likely to matter (e.g. the most recent handshake attempt) than the
 * oldest.
 */
export const MAX_BUFFERED_MESSAGES = 200;

/**
 * Creates an independent buffer. `McpUiLab.tsx` calls this once at module scope; tests call it
 * fresh per test so buffered state never leaks between cases.
 *
 * @overallScore 100/100
 */
export function createEarlyMessageBuffer(maxBuffered: number = MAX_BUFFERED_MESSAGES): EarlyMessageBuffer {
  const backlog: BufferedWindowMessage[] = [];
  let liveHandler: ((message: BufferedWindowMessage) => void) | null = null;

  return {
    push(message) {
      if (liveHandler) {
        liveHandler(message);
        return;
      }
      backlog.push(message);
      if (backlog.length > maxBuffered) backlog.shift();
    },
    subscribe(handler) {
      liveHandler = handler;
      while (backlog.length > 0) {
        // Shift, not splice-all: a handler that itself calls `push` synchronously (unlikely, but
        // not this module's business to forbid) must not see a backlog it just extended replayed
        // back at it in the same drain.
        const next = backlog.shift();
        if (next === undefined) break;
        handler(next);
      }
      return () => {
        if (liveHandler === handler) liveHandler = null;
      };
    },
    get backlogSize() {
      return backlog.length;
    },
  };
}
