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
 * Two deliberate divergences, both load-bearing:
 *
 * 1. **Direction.** MCP Apps is View→Host: the embedded UI calls tools. Host→View is a *fixed*
 *    lifecycle set ({@link MCP_UI_HOST_NOTIFICATIONS}) with no generic "host asks the View to do
 *    something". Jini's page verbs therefore ride as an explicitly-namespaced extension
 *    ({@link JINI_PAGE_ACTION_METHOD}) — ours, not the spec's, and named so no one mistakes it.
 * 2. **Sandbox.** The spec mandates `sandbox="allow-scripts allow-same-origin"`, which is safe
 *    *there* because the View is served from a separate origin behind a sandbox proxy. A host
 *    serving preview content from its own origin must NOT copy that line: `allow-same-origin`
 *    would hand the embedded document access to the host's origin. See
 *    {@link MCP_UI_SANDBOX_NOTE}.
 *
 * No transport here — this package touches no browser globals. These are pure builders and
 * parsers; the binding that owns the iframe does the posting.
 */

/** Method names the View may call on the Host. From the 2026-01-26 specification. */
export const MCP_UI_VIEW_METHODS = {
  initialize: 'ui/initialize',
  callTool: 'tools/call',
  readResource: 'resources/read',
  log: 'notifications/message',
  openLink: 'ui/open-link',
  sendMessage: 'ui/message',
  requestDisplayMode: 'ui/request-display-mode',
  updateModelContext: 'ui/update-model-context',
  ping: 'ping',
} as const;

/**
 * Notifications the Host may send the View. This is the complete host→view surface in the
 * specification — note that none of them is a generic page action.
 */
export const MCP_UI_HOST_NOTIFICATIONS = {
  initialized: 'ui/notifications/initialized',
  toolInputPartial: 'ui/notifications/tool-input-partial',
  toolInput: 'ui/notifications/tool-input',
  toolResult: 'ui/notifications/tool-result',
  toolCancelled: 'ui/notifications/tool-cancelled',
  sizeChanged: 'ui/notifications/size-changed',
  hostContextChanged: 'ui/notifications/host-context-changed',
  teardown: 'ui/resource-teardown',
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
 * @param value - The raw `event.data`.
 * @returns True when the value is a well-formed JSON-RPC message.
 */
export function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  if (!isRecord(value) || value['jsonrpc'] !== '2.0') return false;
  const hasId = 'id' in value && (typeof value['id'] === 'number' || typeof value['id'] === 'string');
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
