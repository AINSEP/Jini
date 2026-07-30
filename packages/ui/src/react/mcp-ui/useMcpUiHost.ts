/**
 * @module react/mcp-ui/useMcpUiHost
 *
 * The Host half of the MCP Apps handshake, as one hook with no JSX — so the same state machine backs
 * the plain `<McpUiHost>` component, the chat-transcript card, and any host-specific shell a
 * consumer writes, rather than each growing its own near-copy.
 *
 * Promoted from `examples/reference-web/src/McpUiLabHost.tsx`, which is a working implementation of
 * exactly this against a real spec-SDK View. Generalized in four ways:
 *
 * 1. **`srcdoc`, not `src`.** The lab points its iframe at a real HTTP origin the daemon serves, so
 *    it can (correctly) use `sandbox="allow-scripts allow-same-origin"` and validate `event.origin`.
 *    A surface built by `features/mcp-ui/surfaces/` has no origin to be served from — it is a string
 *    — so it renders via `srcdoc` under `allow-scripts` alone, and origin validation is replaced by
 *    `event.source` identity. See {@link McpUiHostOptions} and `MCP_UI_VIEW_SANDBOX`.
 * 2. **A real tool executor.** The lab answers every post-handshake request with `methodNotFound`
 *    because it is a protocol demo. Here `tools/call` is forwarded to a caller-supplied port.
 * 3. **No accumulated log state.** The lab renders its own protocol log, so it keeps 300 entries in
 *    React state. A card in a chat transcript should not; observation is an optional callback
 *    ({@link McpUiHostOptions.onEvent}) a consumer can wire to a log, to telemetry, or to nothing.
 * 4. **Injectable message source**, so a test drives the state machine directly.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  JSON_RPC_ERROR_CODES,
  MCP_UI_HOST_REQUESTS,
  MCP_UI_PROTOCOL_VERSION,
  MCP_UI_VIEW_METHODS,
  MCP_UI_VIEW_NOTIFICATIONS,
  createJsonRpcError,
  createJsonRpcRequest,
  createJsonRpcResult,
  isJsonRpcMessage,
  isJsonRpcRequest,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from '../../features/mcp-ui/protocol.js';
import type { BufferedWindowMessage } from '../../features/mcp-ui/early-message-buffer.js';
import { subscribeToViewMessages, type ViewMessageSource } from './host-message-source.js';

/** Per spec: "Host SHOULD wait for a response before tearing down … to prevent data loss." SHOULD, not forever — a broken View would wedge teardown permanently. */
export const DEFAULT_TEARDOWN_TIMEOUT_MS = 3_000;
/** How long the Host waits for `ui/notifications/initialized` after answering `ui/initialize` before giving up rather than showing a frame that never becomes interactive. */
export const DEFAULT_INITIALIZED_TIMEOUT_MS = 4_000;

export type McpUiHostState =
  | 'awaiting-initialize'
  | 'awaiting-initialized'
  | 'ready'
  | 'timed-out'
  | 'tearing-down'
  | 'torn-down';

/** One observable protocol moment. Purely informational — nothing in the state machine reads these back. */
export interface McpUiHostEvent {
  readonly direction: 'in' | 'out' | 'rejected' | 'refused' | 'timeout' | 'info';
  readonly note: string;
}

export interface McpUiToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/**
 * Executes a tool a View asked for.
 *
 * A rejection is not swallowed: it is relayed to the View as a JSON-RPC error carrying the thrown
 * message, which is what lets a confirmation dialog print the real reason instead of hanging on
 * "Working…". Whatever it resolves to is passed through as the JSON-RPC `result` unchanged.
 */
export type McpUiToolCallHandler = (call: McpUiToolCall) => Promise<unknown> | unknown;

export interface McpUiHostOptions {
  /** The View document, mounted via `srcdoc`. */
  readonly html: string;
  /**
   * Changing this starts a fresh session: new state machine, remounted iframe. Defaults to `html`,
   * so replacing the document restarts the handshake — which is required, since the new document's
   * script will send its own `ui/initialize` and a Host still in `ready` would refuse it.
   */
  readonly sessionKey?: string | number;
  /** Omit to answer every `tools/call` with `methodNotFound` — honest for a host with nothing to execute. */
  readonly onToolCall?: McpUiToolCallHandler;
  /** Handles `ui/open-link`. Omit and the Host refuses the request rather than silently dropping it — an isolated frame has no other way to navigate, so a dead link should say so. */
  readonly onOpenLink?: (url: string) => void;
  /** Called on every `ui/notifications/size-changed`, in addition to the returned `size`. */
  readonly onSizeChanged?: (size: { readonly width: number; readonly height: number }) => void;
  /** Observation hook for a log or telemetry. */
  readonly onEvent?: (event: McpUiHostEvent) => void;
  /** Reported to the View in the `ui/initialize` response. */
  readonly hostInfo?: { readonly name: string; readonly version: string };
  /** Reported to the View as `hostContext` — theme and display mode, so a surface can match its embedder. */
  readonly hostContext?: Readonly<Record<string, unknown>>;
  readonly initializedTimeoutMs?: number;
  readonly teardownTimeoutMs?: number;
  /**
   * Injectable for tests; defaults to the shared module-scope window listener.
   *
   * Must be referentially stable — a module constant or a `useCallback` result. Changing it
   * re-subscribes and restarts the session, which is the correct response to a genuinely different
   * transport but is never what an inline arrow recreated each render meant.
   */
  readonly messageSource?: ViewMessageSource;
}

export interface McpUiHostResult {
  readonly state: McpUiHostState;
  /** The View's last reported content size, or `null` if it has not reported one. */
  readonly size: { readonly width: number; readonly height: number } | null;
  /** Attach to the `<iframe>`. The Host authenticates incoming messages against this element's `contentWindow`. */
  readonly iframeRef: RefObject<HTMLIFrameElement | null>;
  /** Sends `ui/resource-teardown` and waits (bounded) for the View's acknowledgement. No-op unless `ready`. */
  readonly requestTeardown: () => void;
  /** `null` until a teardown has been requested; then whether the View answered before the timeout. */
  readonly teardownAcknowledged: boolean | null;
}

const DEFAULT_HOST_INFO = { name: 'jini-mcp-ui-host', version: '1' } as const;
const DEFAULT_HOST_CONTEXT = { theme: 'light', displayMode: 'inline' } as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the Host-side protocol for one View.
 *
 * @param options - See {@link McpUiHostOptions}.
 * @returns See {@link McpUiHostResult}.
 * @complexity O(1) per message.
 */
export function useMcpUiHost(options: McpUiHostOptions): McpUiHostResult {
  const {
    html,
    sessionKey = html,
    initializedTimeoutMs = DEFAULT_INITIALIZED_TIMEOUT_MS,
    teardownTimeoutMs = DEFAULT_TEARDOWN_TIMEOUT_MS,
    messageSource = subscribeToViewMessages,
  } = options;

  const [state, setState] = useState<McpUiHostState>('awaiting-initialize');
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [teardownAcknowledged, setTeardownAcknowledged] = useState<boolean | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stateRef = useRef<McpUiHostState>('awaiting-initialize');
  const nextRequestIdRef = useRef(1);
  const teardownWaiterRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const initializedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Every caller-supplied callback is read through a ref rather than listed as an effect dependency.
  // They are almost always inline arrow functions, so depending on them would tear down and
  // reinstall the message subscription on every render — and a Host that re-subscribes constantly
  // is a Host that can miss a message in the gap, which is the exact failure the early-message
  // buffer exists to prevent.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const emit = useCallback((direction: McpUiHostEvent['direction'], note: string) => {
    optionsRef.current.onEvent?.({ direction, note });
  }, []);

  const setStateBoth = useCallback((next: McpUiHostState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const postToView = useCallback((message: JsonRpcMessage) => {
    const view = iframeRef.current?.contentWindow;
    if (!view) return;
    // '*' is the only possible target: the View has an opaque origin (no `allow-same-origin`), and
    // an opaque origin cannot be named as a `targetOrigin`. The frame's content is this package's
    // own generated document, and its CSP (`SURFACE_CSP`) denies it every outbound channel, so a
    // broad target here is not a broad audience.
    view.postMessage(message, '*');
  }, []);

  const requestTeardown = useCallback(() => {
    if (stateRef.current !== 'ready') return;
    const id = `host-teardown-${nextRequestIdRef.current++}`;
    setStateBoth('tearing-down');
    setTeardownAcknowledged(null);
    postToView(createJsonRpcRequest(id, MCP_UI_HOST_REQUESTS.teardown, { reason: 'host requested' }));
    emit('out', `${MCP_UI_HOST_REQUESTS.teardown} sent (id=${id})`);
    const timer = setTimeout(() => {
      emit('timeout', `View did not acknowledge teardown within ${teardownTimeoutMs}ms — tearing down anyway`);
      setTeardownAcknowledged(false);
      setStateBoth('torn-down');
      teardownWaiterRef.current = null;
    }, teardownTimeoutMs);
    teardownWaiterRef.current = { id, timer };
  }, [emit, postToView, setStateBoth, teardownTimeoutMs]);

  const requestTeardownRef = useRef(requestTeardown);
  useEffect(() => {
    requestTeardownRef.current = requestTeardown;
  });

  useEffect(() => {
    setStateBoth('awaiting-initialize');
    setSize(null);
    setTeardownAcknowledged(null);
    teardownWaiterRef.current = null;
    let disposed = false;

    function handleNotification(method: string, params: unknown): void {
      emit('in', `notification ${method}`);
      if (method === MCP_UI_VIEW_NOTIFICATIONS.initialized) {
        if (stateRef.current !== 'awaiting-initialized') {
          emit('rejected', `initialized arrived in state "${stateRef.current}" — ignored`);
          return;
        }
        // Unconditional, no `!== undefined` guard: reaching `awaiting-initialized` always went
        // through `answerInitialize`, which always arms this timer, and `clearTimeout(undefined)` is
        // a legal no-op anyway — a guard here would be an unreachable branch pretending to be care.
        clearTimeout(initializedTimerRef.current);
        initializedTimerRef.current = undefined;
        setStateBoth('ready');
        return;
      }
      if (method === MCP_UI_VIEW_NOTIFICATIONS.sizeChanged) {
        const reported = params as { width?: unknown; height?: unknown } | undefined;
        if (typeof reported?.width === 'number' && typeof reported.height === 'number') {
          const next = { width: reported.width, height: reported.height };
          setSize(next);
          optionsRef.current.onSizeChanged?.(next);
        }
        return;
      }
      if (method === MCP_UI_VIEW_NOTIFICATIONS.requestTeardown) {
        emit('info', 'View asked to be torn down — honoring it');
        requestTeardownRef.current();
      }
    }

    function answerInitialize(request: JsonRpcRequest): void {
      postToView(
        // Shape verified in the lab against `@modelcontextprotocol/ext-apps`' own generated zod
        // schema (`McpUiInitializeResultSchema`): `hostInfo` is required, and `hostCapabilities` is
        // an object of capability objects — `{}` here because this Host implements neither
        // `sampling/createMessage` nor anything else a capability would advertise. Sending
        // `sampling: true` (a boolean) instead of the object shape is the specific mistake that
        // schema caught.
        createJsonRpcResult(request.id, {
          protocolVersion: MCP_UI_PROTOCOL_VERSION,
          hostInfo: optionsRef.current.hostInfo ?? DEFAULT_HOST_INFO,
          hostContext: optionsRef.current.hostContext ?? DEFAULT_HOST_CONTEXT,
          hostCapabilities: {},
        }),
      );
      emit('out', 'ui/initialize response sent');
      setStateBoth('awaiting-initialized');
      // No "is the state still awaiting-initialized?" guard inside the callback: this timer can
      // only be armed once per session (`answerInitialize` is reachable only from
      // `awaiting-initialize`, and it leaves that state immediately, so a second `ui/initialize`
      // gets the refusal below instead), and both exits from `awaiting-initialized` — the
      // `initialized` notification and the effect cleanup — clear it. A guard here would be an
      // unreachable branch dressed up as defensiveness.
      initializedTimerRef.current = setTimeout(() => {
        emit('timeout', `View never sent ${MCP_UI_VIEW_NOTIFICATIONS.initialized} within ${initializedTimeoutMs}ms`);
        setStateBoth('timed-out');
      }, initializedTimeoutMs);
    }

    function handleToolCall(request: JsonRpcRequest): void {
      const handler = optionsRef.current.onToolCall;
      const params = request.params as { name?: unknown; arguments?: unknown } | undefined;
      if (handler === undefined) {
        emit('refused', 'tools/call received but this host has no tool executor');
        postToView(createJsonRpcError(request.id, JSON_RPC_ERROR_CODES.methodNotFound, 'This host executes no tools.'));
        return;
      }
      if (typeof params?.name !== 'string') {
        emit('rejected', 'tools/call missing a string `name`');
        postToView(createJsonRpcError(request.id, JSON_RPC_ERROR_CODES.invalidParams, 'tools/call requires params.name.'));
        return;
      }
      const args = params.arguments;
      const call: McpUiToolCall = {
        name: params.name,
        arguments: typeof args === 'object' && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {},
      };
      // `Promise.resolve` so a synchronous handler and a synchronous throw both land in the same two
      // branches as an async one — otherwise a handler that threw before its first `await` would
      // escape this frame entirely and never reach the View as an error.
      Promise.resolve()
        .then(() => handler(call))
        .then(
          (result) => {
            if (disposed) return;
            emit('out', `tools/call ${call.name} resolved`);
            postToView(createJsonRpcResult(request.id, result));
          },
          (error: unknown) => {
            if (disposed) return;
            emit('out', `tools/call ${call.name} rejected`);
            postToView(createJsonRpcError(request.id, JSON_RPC_ERROR_CODES.internalError, errorMessage(error)));
          },
        );
    }

    function handleRequest(request: JsonRpcRequest): void {
      emit('in', `request ${request.method} (id=${request.id})`);

      if (stateRef.current === 'awaiting-initialize') {
        if (request.method !== MCP_UI_VIEW_METHODS.initialize) {
          emit('refused', `refused ${request.method}: handshake has not started`);
          postToView(
            createJsonRpcError(
              request.id,
              JSON_RPC_ERROR_CODES.invalidRequest,
              'Handshake has not started; call ui/initialize first.',
            ),
          );
          return;
        }
        answerInitialize(request);
        return;
      }

      if (stateRef.current !== 'ready') {
        emit('refused', `refused ${request.method}: handshake not complete (state=${stateRef.current})`);
        postToView(
          createJsonRpcError(
            request.id,
            JSON_RPC_ERROR_CODES.invalidRequest,
            `Handshake not complete (state=${stateRef.current}).`,
          ),
        );
        return;
      }

      if (request.method === MCP_UI_VIEW_METHODS.callTool) {
        handleToolCall(request);
        return;
      }

      if (request.method === MCP_UI_VIEW_METHODS.openLink) {
        const url = (request.params as { url?: unknown } | undefined)?.url;
        const onOpenLink = optionsRef.current.onOpenLink;
        if (typeof url !== 'string' || onOpenLink === undefined) {
          emit('refused', 'ui/open-link refused: no handler, or no string url');
          postToView(
            createJsonRpcError(request.id, JSON_RPC_ERROR_CODES.invalidRequest, 'This host cannot open links.'),
          );
          return;
        }
        onOpenLink(url);
        postToView(createJsonRpcResult(request.id, {}));
        return;
      }

      emit('refused', `${request.method} is not implemented by this host`);
      postToView(
        createJsonRpcError(request.id, JSON_RPC_ERROR_CODES.methodNotFound, `Host does not implement ${request.method}.`),
      );
    }

    function handleResponse(response: { id: number | string; error?: unknown }): void {
      const waiter = teardownWaiterRef.current;
      if (!waiter || waiter.id !== response.id) {
        emit('rejected', `response for unrecognized id=${String(response.id)} ignored`);
        return;
      }
      clearTimeout(waiter.timer);
      teardownWaiterRef.current = null;
      emit('in', `teardown response (id=${String(response.id)})`);
      setTeardownAcknowledged(response.error === undefined);
      setStateBoth('torn-down');
    }

    const unsubscribe = messageSource((raw: BufferedWindowMessage) => {
      const iframe = iframeRef.current;
      // Identity, not origin. A `srcdoc` frame under `allow-scripts` has an opaque origin, which
      // every such frame reports identically as the string "null" — so `origin === 'null'` proves
      // only "some sandboxed frame", not "OUR sandboxed frame". `event.source` cannot be forged by
      // the poster, so comparing it against this Host's own `contentWindow` is the check that
      // actually distinguishes our View from any other frame on the page.
      if (!iframe || raw.source !== iframe.contentWindow) return;
      if (!isJsonRpcMessage(raw.data)) {
        emit('rejected', 'dropped a malformed (non-JSON-RPC) message');
        return;
      }
      const message = raw.data;
      if (isJsonRpcRequest(message)) {
        handleRequest(message);
        return;
      }
      if (typeof (message as { method?: unknown }).method === 'string') {
        handleNotification((message as { method: string }).method, (message as { params?: unknown }).params);
        return;
      }
      handleResponse(message as { id: number | string; error?: unknown });
    });

    return () => {
      disposed = true;
      unsubscribe();
      clearTimeout(initializedTimerRef.current);
      if (teardownWaiterRef.current) clearTimeout(teardownWaiterRef.current.timer);
    };
  }, [sessionKey, messageSource, initializedTimeoutMs, emit, postToView, setStateBoth]);

  return { state, size, iframeRef, requestTeardown, teardownAcknowledged };
}
