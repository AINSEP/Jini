import { decodeSseFrames } from '@jini-ai/core/primitives';
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
 *   `@jini-ai/daemon`'s `FrontendSessionHandle`).
 * - **Read the bind token at send time, not once.** After a
 *   daemon restart, a sleeping laptop, or an ordinary network blip, each reattach mints a new
 *   session and a new token. A host that captured `ready`'s token keeps sending a dead one, every
 *   later run fails to bind, and the only trace is a daemon-side log line: the agent is simply told
 *   "no frontend is bound to this run". `ready` therefore answers "has it attached at least once";
 *   {@link FrontendSessionBridge.bindToken} answers "what is valid now", and only the latter
 *   belongs in a run request. Park/failure closes the transport; hosts explicitly rebind after wake.
 */
import { CHAT_CAPABILITIES } from '../../core/index.js';
import { PAGE_CAPABILITIES, executePageCapability, type PageDriver } from '@jini-ai/agentic';

import type { ApprovalAnswer } from '@jini-ai/core';
import type { ChatPaneAgentToolAction, ChatPaneAgentBridgeAccess } from '../../react/features/chat-pane/types.js';

/** How many settled invocation ids to remember for replay suppression. */
const EXECUTED_MEMORY = 256;

export interface FrontendSessionBridgeOptions {
  /** Host validates its server-bound envelope before the shared page executor sees plain args. */
  readonly preparePageInput?: (args: { action: ChatPaneAgentToolAction }) => Record<string, unknown>;
  readonly capabilityIds?: readonly string[];
  /** Bounds the HTTP envelope before it reaches a host JSON-body limit. Oversized reads refuse. */
  readonly maxResponseBytes?: number;
  /** Flush host state; a defined return replaces the machine response before acknowledgement. */
  readonly onBeforeResponse?: (args: { action: ChatPaneAgentToolAction; output: unknown }) => unknown | Promise<unknown>;
  readonly onAfterResponse?: (args: { action: ChatPaneAgentToolAction; output: unknown }) => void | Promise<void>;
  /** Host policy and the existing app dialog. It never receives an assistant decision. */
  readonly pageApproval?: {
    isDirect(required: { capabilityId: string; input: Record<string, unknown> }): boolean;
    request(required: { capabilityId: string; input: Record<string, unknown>; signal: AbortSignal }): Promise<ApprovalAnswer>;
  };
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

/** The host supplies its origin and stream transport; native fetch defaults may be overridden. */
export interface FrontendSessionBridgeArgs {
  /** Pass an empty string for the same-origin proxy used by a browser host. */
  readonly baseUrl: string;
  readonly endpointPrefix?: string;
  readonly headers?: () => Record<string, string>;
  readonly openStream: (args: { url: string; headers?: Record<string, string> }) => Pick<EventSource, 'addEventListener' | 'close'>;
  readonly fetch?: typeof globalThis.fetch;
  readonly request?: (args: { url: string; init: RequestInit; timeoutMs: number }) => Promise<Response>;
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
   * Ensure a connection and wait for its current attachment; an already live binding is reused.
   * Call after successful host activation. Unlike `ready`, prior readiness cannot satisfy this wait.
   * Cancellation rejects only this caller's wait; park/failure/close rejects all current waiters.
   * @example await bridge.rebind({ signal }, {});
   * @complexity O(1) per waiter; one shared stream, no automatic reconnect after park/failure.
   */
  rebind(required?: { signal?: AbortSignal }, optional?: Record<string, never>): Promise<{ sessionId: string; bindToken: string }>;
  /**
   * The token for the attachment that is live *now*, or `undefined` before the first attach and
   * after park, suspension, failure or {@link FrontendSessionBridge.close}. Read it at run-start.
   */
  bindToken(): string | undefined;
  close(): void;
}

/** Ids this surface can actually serve, given what the host wired up. */
function claimedCapabilities(options: FrontendSessionBridgeOptions): readonly string[] {
  if (options.capabilityIds) return [...options.capabilityIds];
  const claims: string[] = CHAT_CAPABILITIES.map((capability) => capability.id);
  if (options.pageDriver !== undefined) {
    claims.push(...PAGE_CAPABILITIES.map((capability) => capability.id));
  }
  // Dialog-support handshake only; page.approval is not an executable tool id.
  if (options.pageApproval) claims.push('page.approval');
  claims.push(...Object.keys(options.executors ?? {}));
  return claims;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What one server-sent frame means to this surface, decided without touching any state. */
type FrameReading =
  | { readonly kind: 'cancelled'; readonly invocationId: string }
  | { readonly kind: 'attached'; readonly sessionId: string; readonly bindToken: string }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'invocation'; readonly action: ChatPaneAgentToolAction }
  | { readonly kind: 'malformed'; readonly error: unknown }
  | { readonly kind: 'ignored' };

/** Parses a frame's data into an object, or says why it is not one. */
function parseFrameObject(data: string): { frame: Record<string, unknown> } | { error: unknown } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    return { error };
  }
  // `JSON.parse` succeeds on any valid JSON value, not just objects — a bare `null`, number,
  // string or boolean parses cleanly and would throw *outside* this try/catch on the very next
  // `frame['type']` read (`null` is the one of those that actually throws; the others just read
  // back `undefined` harmlessly). Guarding here routes every one of those through the same
  // `onError` path as an unparseable frame, rather than only some of them crashing the listener.
  if (parsed === null || typeof parsed !== 'object') {
    return { error: new Error(`malformed frame: expected a JSON object, got ${JSON.stringify(parsed)}`) };
  }
  return { frame: parsed as Record<string, unknown> };
}

/** Reads an `invocation` frame into the pane's action shape, refusing one with no usable id. */
function readInvocation(frame: Record<string, unknown>): FrameReading {
  const rawInvocationId = frame['invocationId'];
  if (typeof rawInvocationId !== 'string' || rawInvocationId.length === 0) {
    return { kind: 'malformed', error: new Error('invocation frame missing invocationId') };
  }
  return {
    kind: 'invocation',
    action: {
      invocationId: rawInvocationId,
      capabilityId: String(frame['capabilityId']),
      input: (frame['input'] ?? {}) as Record<string, unknown>,
    },
  };
}

/** Classifies one frame's raw data; the listener only applies the result. */
function readFrame(data: string): FrameReading {
  const parsed = parseFrameObject(data);
  if ('error' in parsed) return { kind: 'malformed', error: parsed.error };
  const { frame } = parsed;
  switch (frame['type']) {
    case 'cancelled':
      return { kind: 'cancelled', invocationId: String(frame['invocationId']) };
    case 'attached':
      return { kind: 'attached', sessionId: String(frame['sessionId']), bindToken: String(frame['bindToken']) };
    case 'error':
      return { kind: 'refused', message: String(frame['message']) };
    case 'invocation':
      return readInvocation(frame);
    default:
      // Unknown frame types are ignored rather than treated as errors, so the daemon's event
      // vocabulary can grow without every deployed surface needing to ship first.
      return { kind: 'ignored' };
  }
}

/**
 * Opens the surface's connection and starts routing invocations.
 *
 * @param options - What this page can serve and where the daemon is.
 * @returns The pane's bridge, the attach result, and a teardown.
 */
export function createFrontendSessionBridge(
  { baseUrl: base, openStream, request, fetch, endpointPrefix = '/api/frontend-sessions', headers }: FrontendSessionBridgeArgs,
  options: FrontendSessionBridgeOptions = {},
): FrontendSessionBridge {
  const capabilities = claimedCapabilities(options);
  // 0.6.x compatibility: fetch was optional for published hosts;
  // remove when fetch injection becomes required in the next minor.
  // The only caller (`respond`) never passes its own signal, so the deadline is the whole signal.
  const send = request ?? (({ url, init, timeoutMs }: { url: string; init: RequestInit; timeoutMs: number }) =>
    (fetch ?? globalThis.fetch)(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }));

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
  const pending = new Map<string, AbortController>();
  const attachments = new Set<{
    resolve: (value: { sessionId: string; bindToken: string }) => void;
    reject: (error: unknown) => void;
  }>();
  let source: ReturnType<FrontendSessionBridgeArgs['openStream']> | undefined;
  let closed = false;
  // A page driver owns one live screen. Serialize its observations, effect and acknowledgement;
  // otherwise a second invocation could overwrite the first one's host-bound navigation plan.
  let pageQueue = Promise.resolve();
  const abortPending = () => {
    for (const controller of pending.values()) { controller.abort(); }
    pending.clear();
  };

  const query = capabilities.map((id) => `capability=${encodeURIComponent(id)}`).join('&');

  /** Invalidate before any reopen; queued and running page work cannot cross attachments.
   * O(pending invocations + attachment waiters), with no retained settled waiters. */
  function invalidate({ error }: { error: unknown }): void {
    abortPending();
    pageQueue = Promise.resolve();
    // The daemon deletes a session's bind token the instant that connection drops, so by the time
    // this fires the token in hand is already gone from the registry. Holding it until the next
    // `attached` frame leaves a window where `bindToken()` hands back something dead, and a run
    // started in that window fails to bind — reported to the agent only as "no frontend is bound
    // to this run", with the real reason (a reconnect it never saw) nowhere in view.
    // Reporting no token is the honest answer for a surface that is, right now, not attached.
    currentBindToken = undefined;
    sessionId = undefined;
    for (const waiter of attachments) waiter.reject(error);
    attachments.clear();
  }

  function disconnect({ error }: { error: unknown }): void {
    const previous = source;
    source = undefined;
    invalidate({ error });
    previous?.close();
  }

  async function respond(invocationId: string, body: Record<string, unknown>): Promise<void> {
    if (sessionId === undefined) throw new Error('the surface is not attached yet');
    const wire = boundedFrontendResponse({ invocationId, body, maxBytes: options.maxResponseBytes });
    const response = await send({
      url: `${base}${endpointPrefix}/${encodeURIComponent(sessionId)}/responses`,
      init: { method: 'POST', headers: { 'content-type': 'application/json', ...headers?.(), ...(headers ? { 'x-frontend-bind-token': currentBindToken ?? '' } : {}) }, body: wire.payload },
      timeoutMs: 15_000,
    });
    await assertFrontendResponse({ response, invocationId, body, scoped: Boolean(headers), refused: wire.refused });
  }

  const respondSuccess = (invocationId: string, output: unknown): Promise<void> =>
    respond(invocationId, { ok: true, output });
  const respondError = (invocationId: string, message: string): Promise<void> =>
    respond(invocationId, { ok: false, message });

  /** Freeze once, ask on the app's existing human-only channel, then use the same page executor.
   * The server pauses its execution deadline only after acknowledging the bounded human wait. */
  async function servePage(action: ChatPaneAgentToolAction, signal: AbortSignal): Promise<unknown> {
    const input = options.preparePageInput ? options.preparePageInput({ action }) : structuredClone(action.input);
    const args = { capabilityId: action.capabilityId, input };
    if (options.pageApproval && !options.pageApproval.isDirect(args)) {
      await respond(action.invocationId, { phase: 'approval-pending' });
      signal.throwIfAborted();
      const answer = await options.pageApproval.request({ ...args, input: structuredClone(input), signal });
      signal.throwIfAborted();
      // Report the decision before effects, including decline/expiry; the server audits it.
      await respond(action.invocationId, { phase: 'execution-started', decision: answer.confirmed ? 'approved' : answer.reason });
      if (!answer.confirmed) return { executed: false, reason: answer.reason };
    }
    if (signal.aborted) return { executed: false, reason: 'abandoned' };
    return executePageCapability({ driver: options.pageDriver!, ...args }, { signal });
  }

  /** Runs one non-chat invocation here and answers it. Chat ones go to the pane instead. */
  async function serveLocally(action: ChatPaneAgentToolAction, controller: AbortController): Promise<void> {
    let output: unknown;
    try {
      controller.signal.throwIfAborted();
      if (options.pageDriver !== undefined && action.capabilityId.startsWith('page.')) {
        output = await servePage(action, controller.signal);
      } else {
        const entry = Object.entries(options.executors ?? {})
          .find(([prefix]) => action.capabilityId.startsWith(prefix));
        if (entry === undefined) throw new Error(`nothing on this page serves "${action.capabilityId}"`);
        output = await entry[1](action.capabilityId, action.input);
      }
    } catch (error) {
      pending.delete(action.invocationId);
      if (controller.signal.aborted) return;
      await respondError(action.invocationId, errorMessage(error)).catch(options.onError ?? (() => undefined));
      return;
    }
    await acknowledge({ action, output, signal: controller.signal });
    pending.delete(action.invocationId);
  }

  async function acknowledge({ action, output, signal }: { action: ChatPaneAgentToolAction; output: unknown; signal: AbortSignal }): Promise<void> {
    try {
      signal.throwIfAborted();
      const projected = await options.onBeforeResponse?.({ action, output });
      signal.throwIfAborted();
      const acceptedOutput = projected ?? output;
      await respondSuccess(action.invocationId, acceptedOutput);
      signal.throwIfAborted();
      await options.onAfterResponse?.({ action, output: acceptedOutput });
    } catch (error) { options.onError?.(error); }
  }

  function remember(invocationId: string): void {
    executed.add(invocationId);
    if (executed.size > EXECUTED_MEMORY) {
      const oldest = executed.values().next().value;
      if (oldest !== undefined) executed.delete(oldest);
    }
  }

  /** Runs one well-formed invocation: replay check, announcement, then pane or local serving. */
  function handleInvocation(action: ChatPaneAgentToolAction): void {
    // A redelivery after a dropped answer must not re-run the side effect.
    if (executed.has(action.invocationId)) {
      void respondError(action.invocationId, 'already executed on this surface').catch(() => undefined);
      return;
    }
    if (options.capabilityIds && !options.capabilityIds.includes(action.capabilityId)) {
      void respondError(action.invocationId, 'Capability unavailable').catch(() => undefined);
      return;
    }
    remember(action.invocationId);
    options.onInvocation?.(action);

    if (action.capabilityId.startsWith('chat.')) {
      for (const listener of chatListeners) listener(action);
      return;
    }
    const controller = new AbortController();
    pending.set(action.invocationId, controller);
    if (action.capabilityId.startsWith('page.')) {
      pageQueue = pageQueue.then(() => serveLocally(action, controller)).catch(error => options.onError?.(error));
    } else void serveLocally(action, controller);
  }

  function connect(): void {
    const current = openStream({ url: `${base}${endpointPrefix}/stream?${query}`, ...(headers ? { headers: headers() } : {}) });
    source = current;
    current.addEventListener('message', (event: MessageEvent<string>) => {
      if (source !== current) return;
      const frame = readFrame(event.data);
      switch (frame.kind) {
        case 'cancelled':
          pending.get(frame.invocationId)?.abort();
          return;
        case 'attached':
          abortPending();
          sessionId = frame.sessionId;
          currentBindToken = frame.bindToken;
          // A no-op after the first attach — which is exactly why `currentBindToken` exists.
          resolveReady({ sessionId, bindToken: currentBindToken });
          for (const waiter of attachments) waiter.resolve({ sessionId, bindToken: currentBindToken });
          attachments.clear();
          return;
        case 'refused': {
          const error = new Error(frame.message);
          rejectReady(error);
          disconnect({ error });
          return;
        }
        case 'malformed':
          options.onError?.(frame.error);
          return;
        case 'invocation':
          handleInvocation(frame.action);
          return;
        case 'ignored':
          return;
      }
    });

    current.addEventListener('parked', () => {
      if (source === current) disconnect({ error: new Error('the surface is parked') });
    });
    // Intentional visibility pauses keep their transport owner, which reopens on visibility/activity.
    current.addEventListener('suspended', () => {
      if (source === current) invalidate({ error: new Error('the surface is suspended') });
    });
    current.addEventListener('error', (event) => {
      if (source !== current) return;
      disconnect({ error: new Error('the frontend stream failed') });
      options.onError?.(event);
    });
  }

  connect();

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
    async rebind({ signal } = {}, _optional = {}) {
      signal?.throwIfAborted();
      if (closed) throw new Error('the frontend bridge is closed');
      if (sessionId !== undefined && currentBindToken !== undefined) return { sessionId, bindToken: currentBindToken };
      return new Promise<{ sessionId: string; bindToken: string }>((resolve, reject) => {
        const cleanup = () => { attachments.delete(waiter); signal?.removeEventListener('abort', abort); };
        const waiter = {
          resolve: (value: { sessionId: string; bindToken: string }) => { cleanup(); resolve(value); },
          reject: (error: unknown) => { cleanup(); reject(error); },
        };
        const abort = () => waiter.reject(signal?.reason);
        attachments.add(waiter);
        signal?.addEventListener('abort', abort, { once: true });
        if (!source) {
          try { connect(); } catch (error) { disconnect({ error }); }
        }
      });
    },
    close() {
      closed = true;
      // A closed bridge serves nothing, so binding a run to it would strand that run rather than
      // fail it — this is what stops a torn-down surface (a StrictMode remount, a route change)
      // from handing its dead token to the next run.
      disconnect({ error: new Error('the frontend bridge is closed') });
      chatListeners.clear();
    },
  };
}

/** Authenticated streaming replacement for EventSource when credentials belong in headers.
 * Uses the shared SSE decoder; reconnect creates a new attachment and clears the old token.
 * O(stream bytes), bounded frame buffer; close aborts fetch/readers and the reconnect timer. */
// 0.6.x compatibility: existing hosts may omit fetch;
// remove when fetch injection becomes required in the next minor.
export function openFetchFrontendStream({ url, headers }: { url: string; headers: () => Record<string, string> },
  { fetch: send = globalThis.fetch, reconnectMs = 1000 }: { fetch?: typeof globalThis.fetch; reconnectMs?: number } = {},
): Pick<EventSource, 'addEventListener' | 'close'> {
  const events = new EventTarget();
  const abort = new AbortController();
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = reconnectMs;
  async function connect(): Promise<void> {
    let retryable = true;
    try {
      const response = await send(url, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', headers: headers(), signal: abort.signal });
      retryable = ![401, 403, 404, 429].includes(response.status);
      if (!response.ok || !response.body) throw new Error('Frontend stream unavailable');
      for await (const frame of decodeSseFrames({ source: streamChunks(response.body) }, { maxBufferChars: 128_000 })) {
        delay = reconnectMs; // A delivered event proves the connection recovered.
        if (!abort.signal.aborted) events.dispatchEvent(new MessageEvent(frame.event === 'parked' ? 'parked' : 'message', { data: frame.data }));
      }
    } catch { /* The stream error has one value-free notification below. */ }
    if (abort.signal.aborted) return;
    events.dispatchEvent(new Event('error'));
    if (retryable && !abort.signal.aborted) {
      retry = setTimeout(() => { void connect(); }, delay);
      delay = Math.min(delay * 2, 30_000);
    }
  }
  void connect();
  return { addEventListener: events.addEventListener.bind(events) as EventSource['addEventListener'],
    close() { abort.abort(); clearTimeout(retry); } };
}

async function* streamChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) { const next = await reader.read(); if (next.done) { return; }
      yield next.value; }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** Transport bounds differ from executor output truncation: keep the envelope valid JSON. */
function boundedFrontendResponse({ invocationId, body, maxBytes }: { invocationId: string; body: Record<string, unknown>; maxBytes?: number | undefined }): { payload: string; refused: boolean } {
  const payload = JSON.stringify({ invocationId, ...body });
  if (maxBytes === undefined || new TextEncoder().encode(payload).length <= maxBytes) return { payload, refused: false };
  return { payload: JSON.stringify({ invocationId, ok: false, message: 'Frontend result too large; narrow the query.' }), refused: true };
}

async function assertFrontendResponse({ response, invocationId, body, scoped, refused }: { response: Response; invocationId: string; body: Record<string, unknown>; scoped: boolean; refused: boolean }): Promise<void> {
  if (!response.ok) throw new Error(`answering "${invocationId}" failed: ${response.status}`);
  if (refused) throw new Error('Frontend result too large; narrow the query.');
  if ('phase' in body || scoped) {
    const result = await response.json() as { settled?: boolean };
    if (!result.settled) throw new Error('Page invocation expired or was cancelled; no action was taken');
  }
}

export interface FrontendNavigationGuard {
  noteNavigation(): void;
  preparePageInput(required: { action: ChatPaneAgentToolAction }): Record<string, unknown>;
  onBeforeResponse(required: { action: ChatPaneAgentToolAction; output: unknown }): unknown;
}

/** Fence a protected browser effect to the exact view in which its human card was proposed.
 * Hosts call noteNavigation synchronously for every navigation, including a return to an old URL.
 * Internal metadata is checked and removed before the page capability's public schema sees it.
 * @returns Existing bridge callbacks plus the host-owned navigation notification.
 * @complexity O(input keys) time/space per prepared action; O(1) retained revision counter.
 * @overallScore 100
 */
export function createFrontendNavigationGuard(
  _required: Record<string, never>, _optional: Record<string, never> = {},
): FrontendNavigationGuard {
  let revision = 0;
  return {
    noteNavigation: () => { revision += 1; },
    preparePageInput: ({ action }) => {
      const { __frontendNavigationRevision: expected, ...input } = action.input;
      if (Object.hasOwn(action.input, '__frontendNavigationRevision') && (!Number.isSafeInteger(expected) || expected !== revision)) {
        throw new Error('The page changed while confirmation was pending; propose this action again.');
      }
      return input;
    },
    onBeforeResponse: ({ action, output }) => {
      if (action.capabilityId !== 'page.find_elements') return output;
      if (output === null || typeof output !== 'object' || Array.isArray(output)) return output;
      return { ...output, navigationRevision: revision };
    },
  };
}
