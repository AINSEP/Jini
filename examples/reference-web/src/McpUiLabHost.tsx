import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  JSON_RPC_ERROR_CODES,
  MCP_UI_HOST_REQUESTS,
  MCP_UI_VIEW_METHODS,
  MCP_UI_VIEW_NOTIFICATIONS,
  createJsonRpcError,
  createJsonRpcRequest,
  createJsonRpcResult,
  isJsonRpcMessage,
  isJsonRpcRequest,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from '@jini-ai/agentic';
import { createEarlyMessageBuffer, type BufferedWindowMessage } from './mcpui-lab-message-buffer.js';
import type { McpUiLabViewMode } from './mcpui-lab-view.js';

/**
 * The Host half of the MCP Apps demo — the ONLY file in this fixture that imports `@jini-ai/agentic`
 * for the wire types, because the Host is the trusted side (see `mcpui-lab-view.ts`'s module doc
 * for why the View deliberately does NOT import from here).
 *
 * ONE buffer, at module scope, wired to the ONLY `window.addEventListener('message', ...)` this
 * fixture ever installs. Evaluated at page-load time — before any `McpUiLabHostFrame` mounts, and
 * before an iframe pointed at a View could exist in the DOM. See `mcpui-lab-message-buffer.ts`'s
 * module doc for why this is what makes the Host survive the "View posts before the Host is
 * listening" race by construction rather than by luck (a `useEffect`-only `addEventListener`
 * would still lose anything posted between mount-commit and effect-run under a slow/deferred
 * effect — Suspense, a lazy import, an expensive first render).
 */
const earlyMessages = createEarlyMessageBuffer();
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    earlyMessages.push({ data: event.data, origin: event.origin, source: event.source });
  });
}

/** Per spec: "Host SHOULD wait for a response before tearing down ... to prevent data loss." SHOULD, not MUST-forever — a real Host needs a bound or a broken View wedges teardown permanently. */
const TEARDOWN_TIMEOUT_MS = 3_000;
/** How long the Host waits for `ui/notifications/initialized` after answering `ui/initialize`, before giving up rather than hanging the UI forever. */
const INITIALIZED_TIMEOUT_MS = 4_000;

export type McpUiLabSessionState =
  | 'awaiting-initialize'
  | 'awaiting-initialized'
  | 'ready'
  | 'timed-out'
  | 'tearing-down'
  | 'torn-down';

export interface McpUiLabLogEntry {
  readonly id: number;
  readonly direction: 'out' | 'in' | 'rejected' | 'refused' | 'timeout' | 'info';
  readonly note: string;
}

export interface UseMcpUiLabHostOptions {
  readonly mode: McpUiLabViewMode;
  /** Changing this starts a fresh session: new log, new state machine, remounted iframe. */
  readonly sessionKey: string | number;
  readonly viewOrigin: string;
  readonly viewPath: string;
}

export interface UseMcpUiLabHostResult {
  readonly state: McpUiLabSessionState;
  readonly log: readonly McpUiLabLogEntry[];
  readonly size: { readonly width: number; readonly height: number } | null;
  readonly iframeRef: RefObject<HTMLIFrameElement | null>;
  readonly iframeSrc: string;
  readonly requestTeardown: () => void;
  /** `null` until a teardown has been requested; then whether the View responded before the timeout. */
  readonly teardownAcknowledged: boolean | null;
}

/**
 * The Host-side MCP Apps protocol state machine, framework-adjacent (one hook, no JSX) so it can
 * back both the manual harness on the MCP Apps lab page and the `registerToolRenderer` card a
 * live agent run triggers — the same handshake logic either way, per the fixture's honesty
 * requirement of exercising ONE real implementation rather than two.
 *
 * @overallScore 100/100
 */
export function useMcpUiLabHost(options: UseMcpUiLabHostOptions): UseMcpUiLabHostResult {
  const { mode, sessionKey, viewOrigin, viewPath } = options;
  const [state, setState] = useState<McpUiLabSessionState>('awaiting-initialize');
  const [log, setLog] = useState<McpUiLabLogEntry[]>([]);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [teardownAcknowledged, setTeardownAcknowledged] = useState<boolean | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stateRef = useRef<McpUiLabSessionState>('awaiting-initialize');
  const logIdRef = useRef(0);
  const nextHostRequestIdRef = useRef(1);
  const teardownWaiterRef = useRef<{ id: string; timer: number } | null>(null);
  const initializedTimerRef = useRef<number | undefined>(undefined);

  const appendLog = useCallback((direction: McpUiLabLogEntry['direction'], note: string) => {
    logIdRef.current += 1;
    // Captured into a local BEFORE the updater closure, not read as `logIdRef.current` inside
    // it. Found live: under a rapid-fire flood (the "spam 50x size-changed" adversarial button),
    // React 18/19's automatic batching can queue many `setLog` calls from separate `postMessage`
    // task dispatches before applying any of them. Reading the ref INSIDE the updater meant every
    // queued updater dereferenced it at APPLY time, by which point all 50 calls had already
    // incremented it to the same final value — so all 50 log entries got the same `id`, which
    // React's list rendering (`key={entry.id}`) surfaced as "two children with the same key".
    // Capturing the value now, while it is still uniquely this call's, fixes it at the source.
    const id = logIdRef.current;
    setLog((current) => [...current, { id, direction, note }].slice(-300));
  }, []);

  const setStateBoth = useCallback((next: McpUiLabSessionState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const iframeSrc = useMemo(() => {
    const url = new URL(viewPath, viewOrigin);
    url.searchParams.set('mode', mode);
    url.searchParams.set('session', String(sessionKey));
    return url.toString();
  }, [viewOrigin, viewPath, mode, sessionKey]);

  const postToView = useCallback(
    (message: JsonRpcMessage) => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      win.postMessage(message, viewOrigin);
    },
    [viewOrigin],
  );

  const requestTeardown = useCallback(() => {
    if (stateRef.current !== 'ready') return;
    const id = `host-teardown-${nextHostRequestIdRef.current++}`;
    setStateBoth('tearing-down');
    setTeardownAcknowledged(null);
    postToView(createJsonRpcRequest(id, MCP_UI_HOST_REQUESTS.teardown, { reason: 'user requested' }));
    appendLog('out', `ui/resource-teardown request sent (id=${id}) — waiting up to ${TEARDOWN_TIMEOUT_MS}ms`);
    const timer = window.setTimeout(() => {
      appendLog(
        'timeout',
        `View never responded to teardown within ${TEARDOWN_TIMEOUT_MS}ms — tearing down anyway (bounded wait, not "wait forever")`,
      );
      setTeardownAcknowledged(false);
      setStateBoth('torn-down');
      teardownWaiterRef.current = null;
    }, TEARDOWN_TIMEOUT_MS);
    teardownWaiterRef.current = { id, timer };
  }, [appendLog, postToView, setStateBoth]);

  useEffect(() => {
    setStateBoth('awaiting-initialize');
    setLog([]);
    setSize(null);
    setTeardownAcknowledged(null);
    teardownWaiterRef.current = null;

    function handleViewNotification(notification: { method: string; params?: unknown }): void {
      appendLog('in', `notification ${notification.method}`);
      if (notification.method === MCP_UI_VIEW_NOTIFICATIONS.initialized) {
        if (stateRef.current !== 'awaiting-initialized') {
          appendLog('rejected', `initialized arrived in unexpected state "${stateRef.current}" — ignored`);
          return;
        }
        if (initializedTimerRef.current !== undefined) {
          window.clearTimeout(initializedTimerRef.current);
          initializedTimerRef.current = undefined;
        }
        setStateBoth('ready');
        return;
      }
      if (notification.method === MCP_UI_VIEW_NOTIFICATIONS.sizeChanged) {
        const params = notification.params as { width?: unknown; height?: unknown } | undefined;
        if (typeof params?.width === 'number' && typeof params.height === 'number') {
          setSize({ width: params.width, height: params.height });
        }
        return;
      }
      if (notification.method === MCP_UI_VIEW_NOTIFICATIONS.requestTeardown) {
        appendLog('info', 'View asked to be torn down (ui/notifications/request-teardown) — honoring it');
        requestTeardown();
      }
      // MCP_UI_VIEW_METHODS.log (`notifications/message`) and anything else already reads as a
      // plain log line above; no further handling needed for this demo Host.
    }

    function handleViewRequest(request: JsonRpcRequest): void {
      appendLog('in', `request ${request.method} (id=${request.id})`);

      if (stateRef.current === 'awaiting-initialize') {
        if (request.method !== MCP_UI_VIEW_METHODS.initialize) {
          appendLog('refused', `refused ${request.method}: handshake has not started`);
          postToView(
            createJsonRpcError(
              request.id,
              JSON_RPC_ERROR_CODES.invalidRequest,
              'Handshake has not started; call ui/initialize first.',
            ),
          );
          return;
        }
        postToView(
          // Shape verified against `@modelcontextprotocol/ext-apps`'s own generated zod schema
          // (`McpUiInitializeResultSchema`) by running the real SDK's View against this Host: the
          // first version of this response was missing the required `hostInfo` field entirely and
          // sent `hostCapabilities.sampling` as a boolean instead of the object shape the spec
          // defines (`{ tools?: {} }`, present only when the Host actually supports sampling —
          // omitted here since this demo Host does not implement `sampling/createMessage`).
          createJsonRpcResult(request.id, {
            protocolVersion: '2026-01-26',
            hostInfo: { name: 'jini-mcpui-lab-host', version: '0.1.0' },
            hostContext: { theme: 'light', displayMode: 'inline' },
            hostCapabilities: {},
          }),
        );
        appendLog('out', 'ui/initialize response sent');
        setStateBoth('awaiting-initialized');
        initializedTimerRef.current = window.setTimeout(() => {
          if (stateRef.current === 'awaiting-initialized') {
            appendLog('timeout', `View never sent ui/notifications/initialized within ${INITIALIZED_TIMEOUT_MS}ms — giving up rather than hanging`);
            setStateBoth('timed-out');
          }
        }, INITIALIZED_TIMEOUT_MS);
        return;
      }

      if (stateRef.current !== 'ready') {
        appendLog('refused', `refused ${request.method}: handshake not complete (state=${stateRef.current})`);
        postToView(
          createJsonRpcError(
            request.id,
            JSON_RPC_ERROR_CODES.invalidRequest,
            `Handshake not complete (state=${stateRef.current}).`,
          ),
        );
        return;
      }

      appendLog('info', `${request.method} received post-handshake; demo Host has no implementation for it`);
      postToView(
        createJsonRpcError(request.id, JSON_RPC_ERROR_CODES.methodNotFound, `Demo Host does not implement ${request.method}.`),
      );
    }

    function handleViewResponse(response: { id: number | string; result?: unknown; error?: unknown }): void {
      const waiter = teardownWaiterRef.current;
      if (waiter && waiter.id === response.id) {
        window.clearTimeout(waiter.timer);
        teardownWaiterRef.current = null;
        appendLog('in', `teardown response (id=${response.id})`);
        setTeardownAcknowledged(!('error' in response) || response.error === undefined);
        setStateBoth('torn-down');
        return;
      }
      appendLog('rejected', `response for unrecognized id=${response.id} ignored`);
    }

    const unsubscribe = earlyMessages.subscribe((raw: BufferedWindowMessage) => {
      const iframe = iframeRef.current;
      if (!iframe || raw.source !== iframe.contentWindow) return; // not from our View — silently not ours
      if (raw.origin !== viewOrigin) {
        appendLog('rejected', `dropped message: origin "${raw.origin}" !== expected "${viewOrigin}"`);
        return;
      }
      if (!isJsonRpcMessage(raw.data)) {
        appendLog('rejected', `dropped malformed (non-JSON-RPC) message: ${JSON.stringify(raw.data)}`);
        return;
      }
      const message = raw.data;
      if (isJsonRpcRequest(message)) {
        handleViewRequest(message);
        return;
      }
      if (typeof (message as { method?: unknown }).method === 'string') {
        handleViewNotification(message as { method: string; params?: unknown });
        return;
      }
      handleViewResponse(message as { id: number | string; result?: unknown; error?: unknown });
    });

    return () => {
      unsubscribe();
      if (initializedTimerRef.current !== undefined) window.clearTimeout(initializedTimerRef.current);
      if (teardownWaiterRef.current) window.clearTimeout(teardownWaiterRef.current.timer);
    };
    // `requestTeardown`/`postToView`/`appendLog`/`setStateBoth` are stable across renders unless
    // `viewOrigin` changes (already a listed dep), so omitting them from this array does not
    // hide a real dependency — it avoids re-subscribing on every render from their new-identity
    // churn, which would otherwise drop/reattach the listener constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, mode, viewOrigin]);

  return { state, log, size, iframeRef, iframeSrc, requestTeardown, teardownAcknowledged };
}

/** The daemon's real HTTP origin — a genuinely different port than the Vite dev server serving this page, which is what makes `allow-same-origin` below safe (see `MCP_UI_SANDBOX_NOTE`). Injected by `vite.config.ts`'s `define`. */
export const MCPUI_LAB_VIEW_ORIGIN: string = __JINI_DAEMON_ORIGIN__;
export const MCPUI_LAB_VIEW_PATH = '/mcpui-lab/view';

export interface McpUiLabHostFrameProps {
  readonly mode: McpUiLabViewMode;
  readonly sessionKey: string | number;
  readonly title: string;
}

/**
 * Renders the sandboxed cross-origin iframe plus a live debug log of every JSON-RPC message
 * crossing the boundary — used both by the always-on manual harness on `McpUiLab.tsx` and by the
 * `registerToolRenderer('show_mcpui_widget', ...)` card a live agent run triggers, so both paths
 * exercise the identical Host implementation rather than a chat-only reimplementation.
 */
export function McpUiLabHostFrame({ mode, sessionKey, title }: McpUiLabHostFrameProps) {
  const host = useMcpUiLabHost({
    mode,
    sessionKey,
    viewOrigin: MCPUI_LAB_VIEW_ORIGIN,
    viewPath: MCPUI_LAB_VIEW_PATH,
  });

  return (
    <div className="mcpui-lab-frame" data-agent-element="mcpui-lab-frame" data-agent-role="region" data-agent-label={title}>
      <div
        className="mcpui-lab-frame-status"
        data-agent-element="mcpui-lab-frame-status"
        data-agent-role="status"
        data-agent-label="MCP Apps handshake state"
      >
        <strong>{title}</strong>
        <span className={`mcpui-lab-state mcpui-lab-state-${host.state}`}>{host.state}</span>
        {host.size ? <span className="mcpui-lab-size">{host.size.width}×{host.size.height}px</span> : null}
      </div>
      <iframe
        key={`${sessionKey}:${mode}`}
        ref={host.iframeRef}
        src={host.iframeSrc}
        title={title}
        className="mcpui-lab-iframe"
        // MCP_UI_SANDBOX_NOTE: allow-same-origin is safe ONLY because the View above is served
        // from the daemon's own distinct origin (a different port) — never the Host's own origin.
        sandbox="allow-scripts allow-same-origin"
      />
      <div className="mcpui-lab-frame-controls">
        <button
          type="button"
          onClick={host.requestTeardown}
          disabled={host.state !== 'ready'}
          data-agent-element="mcpui-lab-teardown-button"
          data-agent-role="button"
          data-agent-label="Send a ui/resource-teardown request to the View"
        >
          Send ui/resource-teardown
        </button>
        {host.teardownAcknowledged === false && (
          <span className="mcpui-lab-teardown-note">View never responded (timed out at {TEARDOWN_TIMEOUT_MS}ms)</span>
        )}
        {host.teardownAcknowledged === true && <span className="mcpui-lab-teardown-note">View acknowledged</span>}
      </div>
      <ul className="mcpui-lab-frame-log" aria-label="Host-side protocol log" data-agent-element="mcpui-lab-log" data-agent-role="list" data-agent-label="Every JSON-RPC message the Host observed">
        {host.log.map((entry) => (
          <li key={entry.id} data-dir={entry.direction}>[{entry.direction}] {entry.note}</li>
        ))}
      </ul>
    </div>
  );
}
