/**
 * @module mcp-ui
 *
 * The MCP Apps (`mcp-ui`) envelope: JSON-RPC 2.0 over `postMessage` between a host and a
 * sandboxed iframe View.
 *
 * MCP Apps became the first official MCP extension (SEP-1865) on 2026-01-26. Jini borrows its
 * **envelope and lifecycle** rather than inventing a message format, because the hard parts are
 * already settled there: request/response correlation by `id`, and the ordering rule that a host
 * MUST NOT send any request or notification to a View before receiving `initialized` — which is
 * the fix for the "posted before the iframe was listening" race.
 *
 * Re-verified 2026-07-28 against the primary source (`github.com/modelcontextprotocol/ext-apps`,
 * both `specification/2026-01-26/apps.mdx` [Stable] and `specification/draft/apps.mdx`) after an
 * audit found the bucket below had the wrong direction for two lifecycle messages and mis-typed a
 * third as fire-and-forget when the spec defines it as a request needing a response:
 *
 * - `ui/notifications/initialized` and `ui/notifications/size-changed` are **View→Host** (the
 *   sequence diagram is unambiguous: `UI ->> H: ui/notifications/initialized`, and the "Host
 *   Behavior" prose for size reads "hosts MUST **listen for** ... notifications **from the
 *   View**"). They were previously bucketed under `MCP_UI_HOST_NOTIFICATIONS`, i.e. backwards —
 *   now under {@link MCP_UI_VIEW_NOTIFICATIONS}.
 * - `ui/resource-teardown` (Host→View) carries an `id` and has success/error response shapes in
 *   the spec's own wire examples, and the prose is explicit: "Host SHOULD wait for a response
 *   before tearing down the resource (to prevent data loss)." That is a request, not a
 *   notification — moved to {@link MCP_UI_HOST_REQUESTS}.
 *
 * The draft spec (not yet Stable, but already fixing the above and adding surface this module
 * now also models) adds: `ui/notifications/request-teardown` (View→Host, the View asking to be
 * torn down), `ui/download-file` and `sampling/createMessage` (View→Host requests), and the
 * Host→App direction of `tools/call`/`tools/list` for Apps that register their own tools (the
 * "App-Provided Tools" section, declared via `appCapabilities.tools` in `ui/initialize`).
 *
 * Two deliberate divergences from the spec, both load-bearing:
 *
 * 1. **Direction.** MCP Apps is primarily View→Host: the embedded UI calls tools. Host→View is a
 *    *fixed* lifecycle set with no generic "host asks the View to do something" (the App-tools
 *    addition above is the one exception, and it is opt-in and capability-gated). Jini's page
 *    verbs therefore ride as an explicitly-namespaced extension ({@link JINI_PAGE_ACTION_METHOD})
 *    — ours, not the spec's, and named so no one mistakes it.
 * 2. **Sandbox.** The spec mandates `sandbox="allow-scripts allow-same-origin"`, which is safe
 *    *there* because the View is served from a separate origin behind a sandbox proxy. A host
 *    serving preview content from its own origin must NOT copy that line: `allow-same-origin`
 *    would hand the embedded document access to the host's origin. See
 *    {@link MCP_UI_SANDBOX_NOTE}.
 *
 * No transport here — this package touches no browser globals. These are pure builders and
 * parsers; the binding that owns the iframe does the posting.
 */

/** Requests the View may send the Host. From the 2026-01-26 [Stable] spec plus the draft's additions (marked below). */
export const MCP_UI_VIEW_METHODS = {
  initialize: 'ui/initialize',
  /** View→Host: call a server tool via the Host's proxy (distinct from {@link MCP_UI_HOST_REQUESTS.callAppTool}, the reverse direction). */
  callTool: 'tools/call',
  readResource: 'resources/read',
  log: 'notifications/message',
  openLink: 'ui/open-link',
  sendMessage: 'ui/message',
  requestDisplayMode: 'ui/request-display-mode',
  updateModelContext: 'ui/update-model-context',
  /** Draft addition. Host-mediated file download from a sandboxed iframe that cannot use `allow-downloads`. */
  downloadFile: 'ui/download-file',
  /** Draft addition. Request an LLM completion from the Host; gated behind `hostCapabilities.sampling`. */
  createMessage: 'sampling/createMessage',
  ping: 'ping',
} as const;

/**
 * Notifications the Host may send the View — fire-and-forget, no response expected or allowed.
 * `initialized`/`size-changed` are NOT here: both are sent BY the View (see
 * {@link MCP_UI_VIEW_NOTIFICATIONS}), and `teardown` is NOT here either: it is a request the Host
 * sends TO the View expecting a response (see {@link MCP_UI_HOST_REQUESTS}).
 */
export const MCP_UI_HOST_NOTIFICATIONS = {
  toolInputPartial: 'ui/notifications/tool-input-partial',
  toolInput: 'ui/notifications/tool-input',
  toolResult: 'ui/notifications/tool-result',
  toolCancelled: 'ui/notifications/tool-cancelled',
  hostContextChanged: 'ui/notifications/host-context-changed',
} as const;

/**
 * Notifications the View may send the Host — fire-and-forget, no response expected or allowed.
 * The spec's own "Notifications (Host → View)" heading in the 2026-01-26 text is misleading for
 * two of these (see the module doc's audit note); the draft spec corrects this by giving these
 * two, plus its own new addition, an explicit "Notifications (View → Host)" heading.
 */
export const MCP_UI_VIEW_NOTIFICATIONS = {
  /** The View→Host handshake completion notification. Host MUST NOT send anything to the View before this arrives. */
  initialized: 'ui/notifications/initialized',
  /** The View SHOULD send this "when rendered content body size changes." */
  sizeChanged: 'ui/notifications/size-changed',
  /** Draft addition. The View asking to be torn down (e.g. a "Done" button); the Host MAY defer or ignore it, but if it accepts, it still owes the View {@link MCP_UI_HOST_REQUESTS.teardown}. */
  requestTeardown: 'ui/notifications/request-teardown',
} as const;

/**
 * Requests the Host may send the View, needing a response. Distinct from
 * {@link MCP_UI_HOST_NOTIFICATIONS} because a caller building a JSON-RPC envelope for one of
 * these must attach an `id` and correlate the reply — using {@link createJsonRpcNotification}
 * here would silently produce a message the View has no `id` to answer, and a Host that then
 * "waits for a response" (the spec's own words) would wait forever.
 */
export const MCP_UI_HOST_REQUESTS = {
  /**
   * Host MUST send this before tearing down the UI resource, for any reason. Per spec: "Host
   * SHOULD wait for a response before tearing down the resource (to prevent data loss)." — this
   * is the message the bug report flagged: bucketing it as a fire-and-forget notification means a
   * Host never learns whether the View acknowledged before disappearing.
   */
  teardown: 'ui/resource-teardown',
  /** Draft addition ("App-Provided Tools"). Host→App: execute a tool the App registered via `appCapabilities.tools`. */
  callAppTool: 'tools/call',
  /** Draft addition. Host→App: list the App's registered tools. */
  listAppTools: 'tools/list',
} as const;

/**
 * Jini's page-action extension. **Not part of MCP Apps** — the namespace is explicit so it can
 * never be mistaken for a spec method, and so a compliant host that does not understand it
 * rejects it as unknown rather than silently mis-handling it.
 */
export const JINI_PAGE_ACTION_METHOD = 'x-jini/page-action';

/**
 * Why a host serving preview content from its own origin must not copy the spec's sandbox line.
 * Kept as an exported string so the reason travels with the code that would otherwise be
 * cargo-culted.
 */
export const MCP_UI_SANDBOX_NOTE =
  'MCP Apps requires sandbox="allow-scripts allow-same-origin" because its Views are served from '
  + 'a separate origin behind a sandbox proxy. When the embedded document is served from the '
  + "host's own origin, allow-same-origin grants it access to the host — use allow-scripts alone.";

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** JSON-RPC 2.0 reserved codes, used so a View's failures read the same as any other client's. */
export const JSON_RPC_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Whether an arbitrary value is a JSON-RPC 2.0 message.
 *
 * Messages arriving over `postMessage` are attacker-influenced input — any page able to reach the
 * frame can post anything. Validate before dispatch; never trust the shape.
 *
 * Found by live adversarial testing against a real sandboxed iframe (2026-07-28), NOT by static
 * review: a request whose `method` is a valid string but whose `id` is present and malformed
 * (e.g. an object, `{ jsonrpc: '2.0', id: { nested: true }, method: 'tools/call' }`) used to pass
 * this check — the `typeof value['method'] === 'string'` branch returned `true` unconditionally,
 * without ever looking at `id`'s type. A Host trusting that then had to build a JSON-RPC response
 * carrying a non-spec `id` back at the View, which the View's own correlation map (keyed by
 * string ids) could never match — not a crash, but a real protocol violation this function exists
 * specifically to catch. Now: if `id` is present at all, its type is checked before anything else,
 * for every message shape (request, notification, or response) — a notification legitimately has
 * no `id`, but a message that HAS one must have a valid one.
 *
 * @param value - The raw `event.data`.
 * @returns True when the value is a well-formed JSON-RPC message.
 */
export function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  if (!isRecord(value) || value['jsonrpc'] !== '2.0') return false;
  if ('id' in value && typeof value['id'] !== 'number' && typeof value['id'] !== 'string') return false;
  const hasId = 'id' in value;
  if (typeof value['method'] === 'string') return true;
  return hasId && ('result' in value || 'error' in value);
}

/** Whether a validated message expects a response (as opposed to being a notification). */
export function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return 'id' in message && typeof (message as JsonRpcRequest).method === 'string';
}

/**
 * Builds a request.
 *
 * @param id - Correlation id, unique per in-flight request. Doubles as the idempotency key: a
 * transport that redelivers (an SSE reconnect, a repeated post) must not execute twice.
 * @param method - Method name.
 * @param params - Optional parameters.
 */
export function createJsonRpcRequest(
  id: number | string,
  method: string,
  params?: Record<string, unknown>,
): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

/** Builds a notification — no `id`, so no response is expected or allowed. */
export function createJsonRpcNotification(
  method: string,
  params?: Record<string, unknown>,
): JsonRpcNotification {
  return { jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) };
}

/** Builds a success response for `id`. */
export function createJsonRpcResult(id: number | string, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

/** Builds an error response for `id`. */
export function createJsonRpcError(
  id: number | string,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/**
 * Builds a Jini page-action request.
 *
 * @param id - Correlation/idempotency id.
 * @param capabilityId - A `page.*` capability id.
 * @param input - Capability arguments.
 * @returns The namespaced extension request.
 */
export function createPageActionRequest(
  id: number | string,
  capabilityId: string,
  input: Record<string, unknown>,
): JsonRpcRequest {
  return createJsonRpcRequest(id, JINI_PAGE_ACTION_METHOD, { capabilityId, input });
}
