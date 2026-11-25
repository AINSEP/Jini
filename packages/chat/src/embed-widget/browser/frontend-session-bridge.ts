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
 *   derived from the presence of a `page` port and the keys of `executors`, never from a static
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
import type { ChatPagePort } from '../../core/page-port.js';

import type { ApprovalAnswer } from '@jini-ai/core';
import { createInvocationHandler, type InvocationResponder } from './frontend-invocation-handler.js';
import type { ChatPaneAgentToolAction, ChatPaneAgentBridgeAccess } from '../../react/features/chat-pane/types.js';

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
  readonly page?: ChatPagePort;
  /**
   * Product capabilities, keyed by id prefix (`'cms.'`). Each claims every capability under it.
   * This is how a consumer exposes verbs the engine has never heard of.
   */
  readonly executors?: Readonly<Record<string, (capabilityId: string, input: Record<string, unknown>) => Promise<unknown>>>;
  /** Called for every invocation before it runs — the hook a product uses to show an activity trail. */
  readonly onInvocation?: (action: ChatPaneAgentToolAction) => void;
  /** Reported for failures that are nobody's tool call: stream errors, malformed frames. */
  readonly onError?: (error: unknown) => void;
  /**
   * Opt-in run-specific delivery (`acceptRunInvocation`). `begin` is required within it: delivery
   * alone is not permission, so an opted-in invocation never reaches a driver without a claim.
   */
  readonly runInvocations?: { readonly begin: FrontendRunInvocationBegin };
}

/** The host supplies its origin and stream transport; native fetch defaults may be overridden. */
/**
 * Claims one run-delivered invocation on the server before this surface acts on it. Resolves
 * `true` only when the live binding granted the claim. Host composition supplies authentication
 * and the request; this package never imports the server that answers it.
 */
export type FrontendRunInvocationBegin = (required: { runId: string; invocationId: string; signal: AbortSignal }, optional?: Record<string, never>) => Promise<boolean>;

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
  /**
   * Executes one invocation the host received through run-specific delivery (for example an AG-UI
   * tool call it projected into an action carrying the registry-minted invocation id). It reuses
   * the page queue, executors, pending cancellation and response hooks, but always claims first.
   * Throws when the bridge was built without `runInvocations`. Optional on the interface so hosts
   * and fakes that implement the bridge without run-specific delivery stay source-compatible.
   */
  acceptRunInvocation?(required: { runId: string; action: ChatPaneAgentToolAction }, optional?: Record<string, never>): void;
  close(): void;
}

/** Ids this surface can actually serve, given what the host wired up. */
function claimedCapabilities(options: FrontendSessionBridgeOptions): readonly string[] {
  if (options.capabilityIds) return [...options.capabilityIds];
  const claims: string[] = CHAT_CAPABILITIES.map((capability) => capability.id);
  if (options.page !== undefined) {
    claims.push(...options.page.capabilityIds);
  }
  // Dialog-support handshake only; page.approval is not an executable tool id.
  if (options.pageApproval) claims.push('page.approval');
  claims.push(...Object.keys(options.executors ?? {}));
  return claims;
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

type Attached = { sessionId: string; bindToken: string };

interface AttachmentWaiter {
  resolve: (value: Attached) => void;
  reject: (error: unknown) => void;
}

/** The attachment state one bridge instance shares between its lifecycle and result handling. */
interface SessionCore {
  sessionId: string | undefined;
  /** Replaced on every reattach; a promise resolved once could never carry this. */
  bindToken: string | undefined;
  // A page driver owns one live screen. Serialize its observations, effect and acknowledgement;
  // otherwise a second invocation could overwrite the first one's host-bound navigation plan.
  pageQueue: Promise<void>;
  readonly pending: Map<string, AbortController>;
  readonly attachments: Set<AttachmentWaiter>;
}

function abortPending(pending: Map<string, AbortController>): void {
  for (const controller of pending.values()) { controller.abort(); }
  pending.clear();
}

/** Invalidate before any reopen; queued and running page work cannot cross attachments.
 * O(pending invocations + attachment waiters), with no retained settled waiters. */
function invalidateSession({ core, error }: { core: SessionCore; error: unknown }): void {
  abortPending(core.pending);
  core.pageQueue = Promise.resolve();
  // The daemon deletes a session's bind token the instant that connection drops, so by the time
  // this fires the token in hand is already gone from the registry. Holding it until the next
  // `attached` frame leaves a window where `bindToken()` hands back something dead, and a run
  // started in that window fails to bind — reported to the agent only as "no frontend is bound
  // to this run", with the real reason (a reconnect it never saw) nowhere in view.
  // Reporting no token is the honest answer for a surface that is, right now, not attached.
  core.bindToken = undefined;
  core.sessionId = undefined;
  for (const waiter of core.attachments) waiter.reject(error);
  core.attachments.clear();
}

/** Adopt a fresh attachment: drop work from the previous one, then release every waiter. */
function adoptAttachment(
  { frame, core, resolveReady }: { frame: Extract<FrameReading, { kind: 'attached' }>; core: SessionCore; resolveReady: (value: Attached) => void },
  _optional = {},
): void {
  abortPending(core.pending);
  core.sessionId = frame.sessionId;
  core.bindToken = frame.bindToken;
  // A no-op after the first attach — which is exactly why `core.bindToken` exists.
  resolveReady({ sessionId: core.sessionId, bindToken: core.bindToken });
  for (const waiter of core.attachments) waiter.resolve({ sessionId: core.sessionId, bindToken: core.bindToken });
  core.attachments.clear();
}

/** One waiter on the next attachment; cancelling rejects only this caller's wait. */
function awaitAttachment(
  { attachments, signal, connectIfIdle }: { attachments: Set<AttachmentWaiter>; signal: AbortSignal | undefined; connectIfIdle: () => void },
): Promise<Attached> {
  return new Promise<Attached>((resolve, reject) => {
    const cleanup = () => { attachments.delete(waiter); signal?.removeEventListener('abort', abort); };
    const waiter = {
      resolve: (value: Attached) => { cleanup(); resolve(value); },
      reject: (error: unknown) => { cleanup(); reject(error); },
    };
    const abort = () => waiter.reject(signal?.reason);
    attachments.add(waiter);
    signal?.addEventListener('abort', abort, { once: true });
    connectIfIdle();
  });
}

/** What the bridge does for each kind of frame; `cancelled` needs only the pending registry. */
interface FrameActions {
  readonly attach: (frame: Extract<FrameReading, { kind: 'attached' }>) => void;
  readonly refuse: (error: Error) => void;
  readonly malformed: (error: unknown) => void;
  readonly invocation: (action: ChatPaneAgentToolAction) => void;
}

function applyFrame({ frame, pending, actions }: { frame: FrameReading; pending: Map<string, AbortController>; actions: FrameActions }): void {
  switch (frame.kind) {
    case 'cancelled':
      pending.get(frame.invocationId)?.abort();
      return;
    case 'attached':
      actions.attach(frame);
      return;
    case 'refused':
      actions.refuse(new Error(frame.message));
      return;
    case 'malformed':
      actions.malformed(frame.error);
      return;
    case 'invocation':
      actions.invocation(frame.action);
      return;
    case 'ignored':
      return;
  }
}

/** Wires one stream's events to the bridge, ignoring any stream that is no longer the current one. */
function watchStream(
  { current, isCurrent, handlers }: {
    current: Pick<EventSource, 'addEventListener'>;
    isCurrent: () => boolean;
    handlers: { message: (data: string) => void; parked: () => void; suspended: () => void; failed: (event: Event) => void };
  },
): void {
  current.addEventListener('message', (event: MessageEvent<string>) => {
    if (isCurrent()) handlers.message(event.data);
  });
  current.addEventListener('parked', () => {
    if (isCurrent()) handlers.parked();
  });
  // Intentional visibility pauses keep their transport owner, which reopens on visibility/activity.
  current.addEventListener('suspended', () => {
    if (isCurrent()) handlers.suspended();
  });
  current.addEventListener('error', (event) => {
    if (isCurrent()) handlers.failed(event);
  });
}

/** Answers invocations over the HTTP responses endpoint, reading the bind token at send time. */
function createResponder(
  { core, send, base, endpointPrefix, headers, maxResponseBytes }: {
    core: SessionCore;
    send: NonNullable<FrontendSessionBridgeArgs['request']>;
    base: string;
    endpointPrefix: string;
    headers: FrontendSessionBridgeArgs['headers'];
    maxResponseBytes: number | undefined;
  },
): InvocationResponder {
  async function respond(invocationId: string, body: Record<string, unknown>): Promise<void> {
    if (core.sessionId === undefined) throw new Error('the surface is not attached yet');
    const wire = boundedFrontendResponse({ invocationId, body, maxBytes: maxResponseBytes });
    const response = await send({
      url: `${base}${endpointPrefix}/${encodeURIComponent(core.sessionId)}/responses`,
      init: { method: 'POST', headers: { 'content-type': 'application/json', ...headers?.(), ...(headers ? { 'x-frontend-bind-token': core.bindToken ?? '' } : {}) }, body: wire.payload },
      timeoutMs: 15_000,
    });
    await assertFrontendResponse({ response, invocationId, body, scoped: Boolean(headers), refused: wire.refused });
  }
  return {
    respond,
    respondSuccess: (invocationId, output) => respond(invocationId, { ok: true, output }),
    respondError: (invocationId, message) => respond(invocationId, { ok: false, message }),
  };
}

/** 0.6.x compatibility: fetch was optional for published hosts;
 * remove when fetch injection becomes required in the next minor.
 * The only caller (`respond`) never passes its own signal, so the deadline is the whole signal. */
function resolveSend({ request, fetch }: { request: FrontendSessionBridgeArgs['request'] | undefined; fetch: FrontendSessionBridgeArgs['fetch'] | undefined }): NonNullable<FrontendSessionBridgeArgs['request']> {
  return request ?? (({ url, init, timeoutMs }) =>
    (fetch ?? globalThis.fetch)(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }));
}

function createReadySignal(): { ready: Promise<Attached>; resolveReady: (value: Attached) => void; rejectReady: (error: unknown) => void } {
  // Definite assignment rather than no-op placeholders: a Promise executor runs synchronously, so
  // both are set before this line finishes, and placeholders would only add two functions that
  // can never be called.
  let resolveReady!: (value: Attached) => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<Attached>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  return { ready, resolveReady, rejectReady };
}

function createBridgeAccess(
  { chatListeners, responder }: { chatListeners: Set<(action: ChatPaneAgentToolAction) => void>; responder: InvocationResponder },
): ChatPaneAgentBridgeAccess {
  return {
    subscribe(onAction) {
      chatListeners.add(onAction);
      // Removes this listener only. The connection outlives any one pane — see the module doc.
      return () => chatListeners.delete(onAction);
    },
    respondSuccess: responder.respondSuccess,
    respondError: responder.respondError,
  };
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
  const query = claimedCapabilities(options).map((id) => `capability=${encodeURIComponent(id)}`).join('&');
  const { ready, resolveReady, rejectReady } = createReadySignal();
  const core: SessionCore = { sessionId: undefined, bindToken: undefined, pageQueue: Promise.resolve(), pending: new Map(), attachments: new Set() };
  const responder = createResponder({ core, send: resolveSend({ request, fetch }), base, endpointPrefix, headers, maxResponseBytes: options.maxResponseBytes });
  /** Chat-pane listeners. The pane registers exactly one; a second host could register another. */
  const chatListeners = new Set<(action: ChatPaneAgentToolAction) => void>();
  const { handleInvocation, acceptRunInvocation } = createInvocationHandler({ deps: {
    options, responder, pending: core.pending, chatListeners,
    enqueuePage: (work) => { core.pageQueue = core.pageQueue.then(work).catch(error => options.onError?.(error)); },
  } });
  let source: ReturnType<FrontendSessionBridgeArgs['openStream']> | undefined;
  let closed = false;

  function disconnect({ error }: { error: unknown }): void {
    const previous = source;
    source = undefined;
    invalidateSession({ core, error });
    previous?.close();
  }

  const actions: FrameActions = {
    attach: (frame) => adoptAttachment({ frame, core, resolveReady }),
    refuse: (error) => { rejectReady(error); disconnect({ error }); },
    malformed: (error) => options.onError?.(error),
    invocation: handleInvocation,
  };

  function connect(): void {
    const current = openStream({ url: `${base}${endpointPrefix}/stream?${query}`, ...(headers ? { headers: headers() } : {}) });
    source = current;
    watchStream({ current, isCurrent: () => source === current, handlers: {
      message: (data) => applyFrame({ frame: readFrame(data), pending: core.pending, actions }),
      parked: () => disconnect({ error: new Error('the surface is parked') }),
      suspended: () => invalidateSession({ core, error: new Error('the surface is suspended') }),
      failed: (event) => { disconnect({ error: new Error('the frontend stream failed') }); options.onError?.(event); },
    } });
  }

  connect();

  return {
    bridgeAccess: createBridgeAccess({ chatListeners, responder }),
    ready,
    bindToken: () => core.bindToken,
    acceptRunInvocation,
    async rebind({ signal } = {}, _optional = {}) {
      signal?.throwIfAborted();
      if (closed) throw new Error('the frontend bridge is closed');
      if (core.sessionId !== undefined && core.bindToken !== undefined) return { sessionId: core.sessionId, bindToken: core.bindToken };
      return awaitAttachment({ attachments: core.attachments, signal, connectIfIdle: () => {
        if (!source) {
          try { connect(); } catch (error) { disconnect({ error }); }
        }
      } });
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
    const { retryable } = await attemptFrontendStream({
      send, url, headers, signal: abort.signal, events,
      onDelivered: () => { delay = reconnectMs; }, // A delivered event proves the connection recovered.
    });
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

/** One fetch-and-read pass over the stream; says whether its failure, if any, is worth retrying. */
async function attemptFrontendStream(
  { send, url, headers, signal, events, onDelivered }: {
    send: typeof fetch;
    url: string;
    headers: () => Record<string, string>;
    signal: AbortSignal;
    events: EventTarget;
    onDelivered: () => void;
  },
): Promise<{ retryable: boolean }> {
  let retryable = true;
  try {
    const response = await send(url, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', headers: headers(), signal });
    retryable = ![401, 403, 404, 429].includes(response.status);
    if (!response.ok || !response.body) throw new Error('Frontend stream unavailable');
    for await (const frame of decodeSseFrames({ source: streamChunks(response.body) }, { maxBufferChars: 128_000 })) {
      onDelivered();
      if (!signal.aborted) events.dispatchEvent(new MessageEvent(frame.event === 'parked' ? 'parked' : 'message', { data: frame.data }));
    }
  } catch { /* The stream error has one value-free notification below. */ }
  return { retryable };
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
