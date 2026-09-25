/**
 * @module react/mcp-ui/useMcpUiHost
 *
 * The Host half of the MCP Apps handshake — now backed by the REAL, official `@mcp-ui/client`
 * package (`AppRenderer`) instead of this package's own hand-rolled `postMessage` state machine.
 *
 * ## What changed, and why this file still exists at all
 *
 * The owner's decision (2026-08-18): stop hand-rolling MCP-UI client-side rendering; use
 * `@mcp-ui/client` for real. This hook and {@link ../../features/mcp-ui/sandbox-proxy.js} are that
 * swap's Host-side landing point. `useMcpUiHost`/`McpUiHost` are KEPT — same export names, same
 * subpath (`@jini-ai/ui/mcp-ui`) — because real external consumers may already import them by name;
 * see this session's report for what could and could not be held identical.
 *
 * The wire protocol did NOT change: every existing surface this package generates
 * (`surfaces/document.ts`, `surfaces/bridge.ts`, `surfaces/confirmation.ts`, `surfaces/form.ts`, …)
 * is untouched, and still speaks the same JSON-RPC-over-`postMessage` envelope to `window.parent`
 * that it always has. What makes the swap possible without touching any of those builders is
 * {@link ../../features/mcp-ui/sandbox-proxy.js}'s single-hop relay design — see that module's own
 * doc for the exact mechanism and the security tradeoff it makes.
 *
 * ## What could NOT be held identical — read before assuming parity
 *
 * - **A new REQUIRED option: {@link McpUiHostOptions.sandboxProxyUrl}.** `@mcp-ui/client`'s
 *   `AppRenderer` renders into a real, separately-served page rather than a `srcdoc` string, so
 *   every caller now has to say where that page lives. There is no sane default — see
 *   `sandbox-proxy.ts`'s doc for what has to serve it and where. This is the one addition to
 *   `McpUiHostOptions` that could not be avoided; every other field below is either preserved or a
 *   documented, deliberate reduction.
 * - **`iframeRef` is gone.** `AppRenderer` owns its own iframe internally and does not expose it.
 *   Nothing in this monorepo read `useMcpUiHost(...).iframeRef` outside `McpUiHost.tsx` itself
 *   (verified by search before this swap), so this is believed to be safe, but it is a real removal
 *   from the old `McpUiHostResult` shape, not a preserved one.
 * - **`state` is coarser.** The old hand-rolled state machine could observe
 *   `awaiting-initialize`/`awaiting-initialized` as DISTINCT states because it watched every
 *   handshake message itself. `AppRenderer` does not expose an "initialized" callback (only
 *   `onSizeChanged`, `onError`, and the imperative ref methods) — see {@link McpUiHostState}'s own
 *   doc for exactly what this hook infers instead and the one assumption that inference rests on.
 * - **`teardownAcknowledged` can no longer be genuinely tracked.** `AppRendererHandle.teardownResource()`
 *   is synchronous, fire-and-forget — `@mcp-ui/client` exposes no signal for "the View acknowledged
 *   teardown." The field is kept (so the shape still matches) but can only ever be `null` now. See
 *   {@link McpUiHostResult.teardownAcknowledged}.
 * - **`messageSource` (the test-injection seam) is gone.** There is no `postMessage` listening left
 *   in this file to inject a fake source into — `AppRenderer` owns that internally. Tests against
 *   this hook now drive real `AppRenderer` callbacks instead; see `__tests__/useMcpUiHost.test.tsx`.
 *
 * ## How a consumer uses this hook now
 *
 * `useMcpUiHost` cannot mount DOM by itself — `@mcp-ui/client`'s primitives are React COMPONENTS,
 * not a framework-free state machine a hook can drive imperatively (the old implementation could,
 * because it hand-rolled the iframe and the `postMessage` listening both). So this hook returns
 * {@link McpUiHostResult.rendererProps}: a ready-to-spread props object for `@mcp-ui/client`'s
 * `<AppRenderer>`. `McpUiHost.tsx` is the reference consumer — a caller building custom chrome
 * writes `<AppRenderer key={sessionKey} {...host.rendererProps} />` the same way `McpUiHost.tsx`
 * does, and reads `host.state`/`host.size` to build UI around it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { AppRendererHandle, AppRendererProps } from '@mcp-ui/client';

/**
 * Vestigial after this swap — `@mcp-ui/client` owns the sandbox-proxy-ready handshake internally on
 * a fixed, non-configurable 10s timeout this package cannot change. Kept exported (existing
 * consumers/tests reference it) and repurposed below as this hook's OWN ready-watchdog timeout,
 * which is a real, still-enforced behavior — see {@link McpUiHostOptions.initializedTimeoutMs}.
 */
export const DEFAULT_TEARDOWN_TIMEOUT_MS = 3_000;
/** How long {@link useMcpUiHost} waits for the View's first size report before giving up — see {@link McpUiHostState}. */
export const DEFAULT_INITIALIZED_TIMEOUT_MS = 4_000;

/**
 * Coarser than the old hand-rolled state machine's five states — see this module's own doc for why.
 *
 * `'ready'` is inferred from the View's FIRST `ui/notifications/size-changed` report, not observed
 * directly: `@mcp-ui/client`'s `AppRenderer` exposes no "handshake complete" callback. This is a
 * verified-true, not merely assumed, proxy for every surface `../../features/mcp-ui/surfaces/`
 * generates — `surfaces/bridge.ts`'s `onHandshakeDone` calls `reportSize()` unconditionally, so a
 * Jini-built surface always reports a size the instant it becomes ready. It is NOT a spec guarantee
 * for an arbitrary third-party View that happens to never call `ui/notifications/size-changed`.
 */
export type McpUiHostState = 'awaiting-ready' | 'ready' | 'timed-out' | 'errored' | 'torn-down';

/** One observable protocol moment. Purely informational, same as before — nothing here reads these back. */
export interface McpUiHostEvent {
  readonly direction: 'in' | 'out' | 'rejected' | 'refused' | 'timeout' | 'info';
  readonly note: string;
}

export interface McpUiToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/**
 * Executes a tool a View asked for. Unchanged from before this swap — see this hook's module doc
 * for the verified runtime guarantee that a rejection is relayed to the View as a JSON-RPC error and
 * a resolution is passed through as the `result` UNVALIDATED against any particular shape (checked
 * directly against the installed `@modelcontextprotocol/sdk`'s `Protocol._onrequest`, not assumed).
 */
export type McpUiToolCallHandler = (call: McpUiToolCall) => Promise<unknown> | unknown;

export interface McpUiHostOptions {
  /** The View document. Unchanged in meaning; no longer mounted via `srcdoc` — see this module's doc. */
  readonly html: string;
  /**
   * Where the sandbox proxy page (`../../features/mcp-ui/sandbox-proxy.js`'s `SANDBOX_PROXY_HTML`)
   * is served. NEW, and required — see this module's own doc for why there is no sane default.
   */
  readonly sandboxProxyUrl: URL;
  /**
   * Reported to `@mcp-ui/client` as this View's `toolName`. Purely a label in this package's usage
   * (no live MCP `client` is ever supplied, so `AppRenderer`'s tool/resource-fetching machinery
   * that would otherwise consume this never runs) — defaults to a generic constant when omitted.
   * A caller with a real tool name (e.g. `content_post_delete`) should pass it for clearer
   * diagnostics/telemetry on `@mcp-ui/client`'s side.
   */
  readonly toolName?: string;
  /** Changing this remounts the `<AppRenderer>` a consumer keys by it — see `McpUiHost.tsx`. */
  readonly sessionKey?: string | number;
  readonly onToolCall?: McpUiToolCallHandler;
  /** Handles `ui/open-link`. Omit and the Host refuses the request (mirrors the old behavior). */
  readonly onOpenLink?: (url: string) => void;
  readonly onSizeChanged?: (size: { readonly width: number; readonly height: number }) => void;
  readonly onEvent?: (event: McpUiHostEvent) => void;
  readonly hostInfo?: { readonly name: string; readonly version: string };
  readonly hostContext?: Readonly<Record<string, unknown>>;
  /** How long to wait for the View's first size report before {@link McpUiHostState} becomes `'timed-out'`. */
  readonly initializedTimeoutMs?: number;
}

export interface McpUiHostResult {
  readonly state: McpUiHostState;
  readonly size: { readonly width: number; readonly height: number } | null;
  /** Best-effort: notifies the View, but see {@link teardownAcknowledged} — no acknowledgement is observable anymore. */
  readonly requestTeardown: () => void;
  /**
   * Always `null` after this swap. `@mcp-ui/client`'s `AppRendererHandle.teardownResource()` is
   * synchronous and fire-and-forget; nothing in its public API reports whether a View answered.
   * Kept in this shape (rather than removed) so existing code reading it does not need an unrelated
   * type-level change; see this module's own doc for the follow-up this leaves open.
   */
  readonly teardownAcknowledged: boolean | null;
  /** Spread onto `<AppRenderer key={sessionKey ?? html} {...rendererProps} />` — see this module's own doc. */
  readonly rendererProps: AppRendererProps;
  /**
   * Pass as `ref` on that same `<AppRenderer>` element. Separate from {@link rendererProps} because
   * `ref` is not a member of `AppRendererProps` itself — `AppRenderer` is a `forwardRef` component,
   * so React types it as an addition alongside the props, not a prop.
   */
  readonly rendererRef: RefObject<AppRendererHandle | null>;
}

const DEFAULT_TOOL_NAME = 'mcp-ui-surface';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the Host-side protocol for one View, on top of `@mcp-ui/client`'s `AppRenderer`.
 *
 * @param options - See {@link McpUiHostOptions}.
 * @returns See {@link McpUiHostResult}.
 */
export function useMcpUiHost(options: McpUiHostOptions): McpUiHostResult {
  const { html, sandboxProxyUrl, sessionKey, initializedTimeoutMs = DEFAULT_INITIALIZED_TIMEOUT_MS } = options;

  const [state, setState] = useState<McpUiHostState>('awaiting-ready');
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [teardownAcknowledged] = useState<boolean | null>(null);

  const stateRef = useRef<McpUiHostState>('awaiting-ready');
  const settledRef = useRef(false);
  const handleRef = useRef<AppRendererHandle>(null);

  // Every caller-supplied callback read through a ref, same reasoning as the pre-swap
  // implementation: they are almost always inline arrow functions, and depending on them directly
  // would recreate `rendererProps`'s callbacks (and therefore remount `AppRenderer`, restarting the
  // whole handshake) on every render.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const setStateBoth = useCallback((next: McpUiHostState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const emit = useCallback((direction: McpUiHostEvent['direction'], note: string) => {
    optionsRef.current.onEvent?.({ direction, note });
  }, []);

  const effectiveSessionKey = sessionKey ?? html;

  // The ready-watchdog. See `McpUiHostState`'s own doc for why "first size report" stands in for
  // "handshake complete" here, and this hook's module doc for why `@mcp-ui/client` itself gives us
  // no better signal to watch instead.
  useEffect(() => {
    settledRef.current = false;
    setStateBoth('awaiting-ready');
    setSize(null);
    const timer = setTimeout(() => {
      if (settledRef.current) return;
      settledRef.current = true;
      emit('timeout', `No size report from the View within ${initializedTimeoutMs}ms — treating the handshake as failed`);
      setStateBoth('timed-out');
    }, initializedTimeoutMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effectiveSessionKey intentionally
    // stands in for both `sessionKey` and `html` (mirrors the pre-swap effect's own `[sessionKey, ...]`).
  }, [effectiveSessionKey, initializedTimeoutMs, emit, setStateBoth]);

  const handleSizeChanged = useCallback<NonNullable<AppRendererProps['onSizeChanged']>>(
    (params) => {
      if (!settledRef.current) {
        settledRef.current = true;
        emit('in', 'first size report received — treating the handshake as complete');
        setStateBoth('ready');
      }
      const next = { width: params.width ?? 0, height: params.height ?? 0 };
      setSize(next);
      optionsRef.current.onSizeChanged?.(next);
    },
    [emit, setStateBoth],
  );

  const handleError = useCallback<NonNullable<AppRendererProps['onError']>>(
    (error) => {
      emit('rejected', `AppRenderer error: ${errorMessage(error)}`);
      if (!settledRef.current) {
        settledRef.current = true;
        setStateBoth('errored');
      }
    },
    [emit, setStateBoth],
  );

  const handleCallTool = useCallback<NonNullable<AppRendererProps['onCallTool']>>(
    async (params) => {
      const handler = optionsRef.current.onToolCall;
      if (handler === undefined) {
        emit('refused', 'tools/call received but this host has no tool executor');
        throw new Error('This host executes no tools.');
      }
      const call: McpUiToolCall = {
        name: params.name,
        arguments: (params.arguments ?? {}) as Record<string, unknown>,
      };
      emit('in', `tools/call ${call.name}`);
      try {
        const result = await handler(call);
        emit('out', `tools/call ${call.name} resolved`);
        // See this hook's module doc: verified against the installed MCP SDK that a resolved
        // handler value reaches the View as the JSON-RPC `result` completely unvalidated against
        // any CallToolResult shape. This cast documents that gap; it is not a claim that `result`
        // structurally satisfies CallToolResult.
        return result as Awaited<ReturnType<NonNullable<AppRendererProps['onCallTool']>>>;
      } catch (error) {
        emit('out', `tools/call ${call.name} rejected`);
        throw error;
      }
    },
    [emit],
  );

  const handleOpenLink = useCallback<NonNullable<AppRendererProps['onOpenLink']>>(
    async ({ url }) => {
      const handler = optionsRef.current.onOpenLink;
      if (handler === undefined) {
        emit('refused', 'ui/open-link refused: no handler');
        return { isError: true };
      }
      handler(url);
      emit('out', 'ui/open-link handled');
      return {};
    },
    [emit],
  );

  const requestTeardown = useCallback(() => {
    if (stateRef.current !== 'ready') return;
    handleRef.current?.teardownResource();
    emit(
      'out',
      'requestTeardown sent (fire-and-forget — @mcp-ui/client exposes no acknowledgement signal, see module doc)',
    );
    setStateBoth('torn-down');
  }, [emit, setStateBoth]);

  const rendererProps = useMemo<AppRendererProps>(
    () => ({
      toolName: optionsRef.current.toolName ?? DEFAULT_TOOL_NAME,
      sandbox: { url: sandboxProxyUrl },
      html,
      ...(optionsRef.current.hostInfo === undefined ? {} : { hostInfo: optionsRef.current.hostInfo }),
      ...(optionsRef.current.hostContext === undefined ? {} : { hostContext: optionsRef.current.hostContext }),
      onCallTool: handleCallTool,
      onOpenLink: handleOpenLink,
      onSizeChanged: handleSizeChanged,
      onError: handleError,
      // eslint-disable-next-line react-hooks/exhaustive-deps -- optionsRef.current.toolName/hostInfo/hostContext
      // are read once per `html`/`sandboxProxyUrl` change intentionally, same ref-read pattern as the rest of this hook.
    }),
    [html, sandboxProxyUrl, handleCallTool, handleOpenLink, handleSizeChanged, handleError],
  );

  return { state, size, requestTeardown, teardownAcknowledged, rendererProps, rendererRef: handleRef };
}
