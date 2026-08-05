import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { SandboxBridgeHandler, SandboxBridgeMessage } from './types.js';

export interface UseSandboxBridgeOptions {
  /** Ref to the sandboxed iframe this bridge talks to. */
  iframeRef: RefObject<HTMLIFrameElement | null>;
  /**
   * Handlers keyed by `message.type`. A message whose `type` has no
   * registered handler is ignored. Re-registering with a new object every
   * render is fine — the latest handlers are always used without
   * re-attaching the underlying `message` listener (see the effect-deps
   * note below).
   */
  handlers: Record<string, SandboxBridgeHandler>;
  /**
   * Restrict outbound `postMessage` (and — since a same-document sandboxed
   * `srcDoc` iframe has an opaque `"null"` origin that can't be checked
   * positionally — inbound acceptance) to a specific origin. Omit to post
   * with `'*'`; inbound messages are still scoped by verifying
   * `event.source` is this exact iframe's `contentWindow`, not by origin.
   */
  targetOrigin?: string;
}

export interface SandboxBridge {
  /** Post a message to the sandboxed iframe's `contentWindow`. No-op if the iframe isn't mounted yet. */
  post(message: SandboxBridgeMessage): void;
}

/**
 * Wire a `window` `message` listener scoped to one sandboxed iframe: every
 * inbound message is checked against `event.source === iframe.contentWindow`
 * before being dispatched (by `message.type`) to a registered handler, and
 * `post()` sends a message to that same iframe. This is deliberately just
 * the transport — it carries no message *vocabulary* of its own. A
 * consuming feature (deck navigation, comment pinning, an inspector panel,
 * …) defines its own message shapes and registers handlers for them.
 *
 * The listener is attached once per mount, not re-attached whenever
 * `handlers` changes identity (a fresh object literal every render is the
 * common case) — the latest `handlers`/`targetOrigin` are read through a
 * ref on every incoming message instead, avoiding the churn (and, if a
 * caller's handler closes over `useT()`'s `t`, the infinite-render-loop
 * gotcha) of listing them as effect dependencies.
 */
export function useSandboxBridge(options: UseSandboxBridgeOptions): SandboxBridge {
  const { iframeRef } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      const data = event.data as SandboxBridgeMessage | null | undefined;
      if (!data || typeof data.type !== 'string') return;
      const handler = optionsRef.current.handlers[data.type];
      handler?.(data);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeRef]);

  const post = useCallback(
    (message: SandboxBridgeMessage) => {
      const iframe = iframeRef.current;
      const contentWindow = iframe?.contentWindow;
      if (!contentWindow) return;
      contentWindow.postMessage(message, optionsRef.current.targetOrigin ?? '*');
    },
    [iframeRef],
  );

  return { post };
}
