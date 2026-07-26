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
 * - **Read the bind token at send time, not once.** `EventSource` reconnects on its own — after a
 *   daemon restart, a sleeping laptop, or an ordinary network blip — and each reattach mints a new
 *   session and a new token. A host that captured `ready`'s token keeps sending a dead one, every
 *   later run fails to bind, and the only trace is a daemon-side log line: the agent is simply told
 *   "no frontend is bound to this run". `ready` therefore answers "has it attached at least once";
 *   {@link FrontendSessionBridge.bindToken} answers "what is valid now", and only the latter
 *   belongs in a run request.
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
  /**
   * Resolves the *first* time the daemon attaches this surface — an "is it live yet" signal.
   *
   * Its `bindToken` is only correct until the next reconnect, so do not stash it. Call
   * {@link FrontendSessionBridge.bindToken} when building a run request instead.
   */
  readonly ready: Promise<{ sessionId: string; bindToken: string }>;
  /**
   * The token for the attachment that is live *now*, or `undefined` before the first attach and
   * after {@link FrontendSessionBridge.close}. Read it at run-start; see the module doc.
   */
  bindToken(): string | undefined;
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
  /** Replaced on every reattach; a promise resolved once could never carry this. */
  let currentBindToken: string | undefined;
  // Definite assignment rather than no-op placeholders: a Promise executor runs synchronously, so
  // both are set before this line finishes, and placeholders would only add two functions that
  // can never be called.
  let resolveReady!: (value: { sessionId: string; bindToken: string }) => void;
  let rejectReady!: (error: unknown) => void;
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch (error) {
      options.onError?.(error);
      return;
    }
    // `JSON.parse` succeeds on any valid JSON value, not just objects — a bare `null`, number,
    // string or boolean parses cleanly and would throw *outside* this try/catch on the very next
    // `frame['type']` read (`null` is the one of those that actually throws; the others just read
    // back `undefined` harmlessly). Guarding here routes every one of those through the same
    // `onError` path as an unparseable frame, rather than only some of them crashing the listener.
    if (parsed === null || typeof parsed !== 'object') {
      options.onError?.(new Error(`malformed frame: expected a JSON object, got ${JSON.stringify(parsed)}`));
      return;
    }
    const frame = parsed as Record<string, unknown>;

    if (frame['type'] === 'attached') {
      sessionId = String(frame['sessionId']);
      currentBindToken = String(frame['bindToken']);
      // A no-op after the first attach — which is exactly why `currentBindToken` exists.
      resolveReady({ sessionId, bindToken: currentBindToken });
      return;
    }
    if (frame['type'] === 'error') {
      rejectReady(new Error(String(frame['message'])));
      return;
    }
    // Unknown frame types are ignored rather than treated as errors, so the daemon's event
    // vocabulary can grow without every deployed surface needing to ship first.
    if (frame['type'] !== 'invocation') return;

    const rawInvocationId = frame['invocationId'];
    if (typeof rawInvocationId !== 'string' || rawInvocationId.length === 0) {
      options.onError?.(new Error('invocation frame missing invocationId'));
      return;
    }
    const action: ChatPaneAgentToolAction = {
      invocationId: rawInvocationId,
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

  source.addEventListener('error', (event) => {
    // The daemon deletes a session's bind token the instant that connection drops, so by the time
    // this fires the token in hand is already gone from the registry. Holding it until the next
    // `attached` frame leaves a window where `bindToken()` hands back something dead, and a run
    // started in that window fails to bind — reported to the agent only as "no frontend is bound
    // to this run", with the real reason (a reconnect it never saw) nowhere in view.
    // Reporting no token is the honest answer for a surface that is, right now, not attached.
    currentBindToken = undefined;
    sessionId = undefined;
    options.onError?.(event);
  });

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
    bindToken: () => currentBindToken,
    close() {
      source.close();
      chatListeners.clear();
      // A closed bridge serves nothing, so binding a run to it would strand that run rather than
      // fail it — this is what stops a torn-down surface (a StrictMode remount, a route change)
      // from handing its dead token to the next run.
      currentBindToken = undefined;
      sessionId = undefined;
    },
  };
}
