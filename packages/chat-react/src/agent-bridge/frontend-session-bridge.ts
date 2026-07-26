/**
 * @module agent-bridge/frontend-session-bridge
 *
 * The browser half of agent-driven frontend control: one SSE connection to the daemon, and the
 * routing that turns each relayed invocation into a call on something in this page.
 *
 * Everything on the server side already existed — `FrontendSessionRegistry` addresses a run to a
 * surface, the frontend-session routes carry invocations out and answers back, and
 * `createFrontendControl` assembles them. `ChatPaneAgentBridgeAccess` declared the contract this
 * satisfies and had **zero implementations**, which is why an agent could reach a tool and the
 * tool could reach nothing.
 *
 * Design notes worth knowing before changing this:
 *
 * - **The connection is owned here, not by `subscribe`.** `ChatPaneAgentBridgeAccess.subscribe` is
 *   called by the chat pane's own effect, so tying the stream's lifetime to it would mean page
 *   control dies when the pane unmounts — and the page is drivable whether or not a chat pane
 *   exists. `subscribe` registers a listener; `close()` tears the connection down.
 * - **Capabilities are claimed from what is actually wired.** The claim sent at connect time is
 *   derived from the presence of a `pageDriver` and the keys of `executors`, never from a static
 *   list. A surface that claims what it cannot serve turns a fast, named refusal into a timeout.
 * - **An executed invocation is never executed twice.** If the stream drops between the daemon
 *   delivering an invocation and this page POSTing the answer, the daemon correctly fails that
 *   call — but the click already happened. Without the `executed` set below, the retry clicks
 *   again. Buttons are not idempotent.
 * - **The bind token never leaves this module except to the host.** It arrives on the `attached`
 *   event and must ride to run-start; it deliberately does not appear in any URL (see
 *   `@jini/daemon`'s `FrontendSessionHandle`).
 */
import { CHAT_CAPABILITIES, PAGE_CAPABILITIES, executePageCapability, type PageDriver } from '@jini/chat-core';

import type { ChatPaneAgentBridgeAccess, ChatPaneAgentToolAction } from '../features/chat-pane/types.js';

/** How many settled invocation ids to remember for replay suppression. */
const EXECUTED_MEMORY = 256;

export interface FrontendSessionBridgeOptions {
  /** Daemon origin. Defaults to same-origin, which is how the dev server proxies `/api`. */
  readonly baseUrl?: string;
  /** Supplying one claims the six `page.*` verbs. Omit for a chat-only surface. */
  readonly pageDriver?: PageDriver;
  /**
   * Product capabilities, keyed by id prefix (`'cms.'`). Each claims every capability under it.
   * This is how a consumer exposes verbs the engine has never heard of.
   */
  readonly executors?: Readonly<Record<string, (capabilityId: string, input: Record<string, unknown>) => Promise<unknown>>>;
  /** Called for every invocation before it runs — the hook a product uses to show an activity trail. */
  readonly onInvocation?: (action: ChatPaneAgentToolAction) => void;
  /** Reported for failures that are nobody's tool call: stream errors, malformed frames. */
  readonly onError?: (error: unknown) => void;
}

export interface FrontendSessionBridge {
  /** Hand this to `ChatPane`'s `agentControl.bridgeAccess`. */
  readonly bridgeAccess: ChatPaneAgentBridgeAccess;
  /** Resolves once the daemon has attached this surface. Include in the run-start request. */
  readonly ready: Promise<{ sessionId: string; bindToken: string }>;
  close(): void;
}

/** Ids this surface can actually serve, given what the host wired up. */
function claimedCapabilities(options: FrontendSessionBridgeOptions): readonly string[] {
  const claims: string[] = CHAT_CAPABILITIES.map((capability) => capability.id);
  if (options.pageDriver !== undefined) {
    claims.push(...PAGE_CAPABILITIES.map((capability) => capability.id));
  }
  for (const [prefix, _executor] of Object.entries(options.executors ?? {})) {
    claims.push(prefix);
  }
  return claims;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Opens the surface's connection and starts routing invocations.
 *
 * @param options - What this page can serve and where the daemon is.
 * @returns The pane's bridge, the attach result, and a teardown.
 */
export function createFrontendSessionBridge(options: FrontendSessionBridgeOptions = {}): FrontendSessionBridge {
  const base = options.baseUrl ?? '';
  const capabilities = claimedCapabilities(options);

  let sessionId: string | undefined;
  let resolveReady: (value: { sessionId: string; bindToken: string }) => void = () => undefined;
  let rejectReady: (error: unknown) => void = () => undefined;
  const ready = new Promise<{ sessionId: string; bindToken: string }>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  /** Chat-pane listeners. The pane registers exactly one; a second host could register another. */
  const chatListeners = new Set<(action: ChatPaneAgentToolAction) => void>();
  /** Invocation ids already run here, so a stream reconnect cannot double-click a button. */
  const executed = new Set<string>();

  const query = capabilities.map((id) => `capability=${encodeURIComponent(id)}`).join('&');
  const source = new EventSource(`${base}/api/frontend-sessions/stream?${query}`);

  async function respond(invocationId: string, body: Record<string, unknown>): Promise<void> {
    if (sessionId === undefined) throw new Error('the surface is not attached yet');
    const response = await fetch(`${base}/api/frontend-sessions/${encodeURIComponent(sessionId)}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invocationId, ...body }),
    });
    if (!response.ok) throw new Error(`answering "${invocationId}" failed: ${response.status}`);
  }

  const respondSuccess = (invocationId: string, output: unknown): Promise<void> =>
    respond(invocationId, { ok: true, output });
  const respondError = (invocationId: string, message: string): Promise<void> =>
    respond(invocationId, { ok: false, message });

  /** Runs one non-chat invocation here and answers it. Chat ones go to the pane instead. */
  async function serveLocally(action: ChatPaneAgentToolAction): Promise<void> {
    let output: unknown;
    try {
      if (options.pageDriver !== undefined && action.capabilityId.startsWith('page.')) {
        output = await executePageCapability(options.pageDriver, action.capabilityId, action.input);
      } else {
        const entry = Object.entries(options.executors ?? {})
          .find(([prefix]) => action.capabilityId.startsWith(prefix));
        if (entry === undefined) throw new Error(`nothing on this page serves "${action.capabilityId}"`);
        output = await entry[1](action.capabilityId, action.input);
      }
    } catch (error) {
      await respondError(action.invocationId, errorMessage(error)).catch(options.onError ?? (() => undefined));
      return;
    }
    await respondSuccess(action.invocationId, output).catch(options.onError ?? (() => undefined));
  }

  function remember(invocationId: string): void {
    executed.add(invocationId);
    if (executed.size > EXECUTED_MEMORY) {
      const oldest = executed.values().next().value;
      if (oldest !== undefined) executed.delete(oldest);
    }
  }

  source.addEventListener('message', (event: MessageEvent<string>) => {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(event.data) as Record<string, unknown>;
    } catch (error) {
      options.onError?.(error);
      return;
    }

    if (frame['type'] === 'attached') {
      sessionId = String(frame['sessionId']);
      resolveReady({ sessionId, bindToken: String(frame['bindToken']) });
      return;
    }
    if (frame['type'] === 'error') {
      rejectReady(new Error(String(frame['message'])));
      return;
    }
    // Unknown frame types are ignored rather than treated as errors, so the daemon's event
    // vocabulary can grow without every deployed surface needing to ship first.
    if (frame['type'] !== 'invocation') return;

    const action: ChatPaneAgentToolAction = {
      invocationId: String(frame['invocationId']),
      capabilityId: String(frame['capabilityId']),
      input: (frame['input'] ?? {}) as Record<string, unknown>,
    };

    // A redelivery after a dropped answer must not re-run the side effect.
    if (executed.has(action.invocationId)) {
      void respondError(action.invocationId, 'already executed on this surface').catch(() => undefined);
      return;
    }
    remember(action.invocationId);
    options.onInvocation?.(action);

    if (action.capabilityId.startsWith('chat.')) {
      for (const listener of chatListeners) listener(action);
      return;
    }
    void serveLocally(action);
  });

  source.addEventListener('error', (event) => options.onError?.(event));

  const bridgeAccess: ChatPaneAgentBridgeAccess = {
    subscribe(onAction) {
      chatListeners.add(onAction);
      // Removes this listener only. The connection outlives any one pane — see the module doc.
      return () => chatListeners.delete(onAction);
    },
    respondSuccess,
    respondError,
  };

  return {
    bridgeAccess,
    ready,
    close() {
      source.close();
      chatListeners.clear();
    },
  };
}
