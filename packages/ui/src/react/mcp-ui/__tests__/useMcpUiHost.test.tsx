/**
 * `useMcpUiHost` after the `@mcp-ui/client` swap — see that module's own doc for what changed.
 *
 * `AppRenderer` (the real, unmocked package this hook now sits on top of) owns the actual iframe
 * creation and the sandbox-proxy handshake internally — that machinery is `@mcp-ui/client`'s own
 * tested responsibility, exercised end to end (real card, real iframe, real sandbox attributes) in
 * `McpUiHost.test.tsx` and, live in a real browser, in this session's Playwright verification (see
 * final report). What THIS file verifies is this package's own adapter code: the functions built
 * here to hand to `AppRenderer` as `onCallTool`/`onOpenLink`/`onSizeChanged`/`onError` props.
 *
 * A harness renders `useMcpUiHost` and exposes `rendererProps` so a test can invoke those functions
 * DIRECTLY, exactly as `AppRenderer` would call them once its own real handshake completes. That is
 * still a genuine exercise of real, unmocked code — every function under test here is the actual
 * production closure this package builds and hands to the real library, not a test double.
 */
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMcpUiHost, type McpUiHostOptions, type McpUiHostEvent } from '../useMcpUiHost.js';
import type { AppRendererProps } from '@mcp-ui/client';

const SANDBOX_URL = new URL('https://sandbox.example.test/sandbox_proxy.html');

/** Captures the live `rendererProps`/state from the most recent render, for the test to drive directly. */
let latest: {
  rendererProps: AppRendererProps;
  state: string;
  size: { width: number; height: number } | null;
  requestTeardown: () => void;
  teardownAcknowledged: boolean | null;
} | null = null;

function Harness(props: McpUiHostOptions) {
  const host = useMcpUiHost(props);
  latest = host;
  return null;
}

function renderHarness(props: McpUiHostOptions) {
  const utils = render(<Harness {...props} />);
  return { ...utils, current: () => latest! };
}

afterEach(() => {
  latest = null;
  vi.useRealTimers();
});

describe('useMcpUiHost — rendererProps construction', () => {
  it('passes html and the sandbox proxy url straight through', () => {
    renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL });
    const props = latest!.rendererProps;
    expect(props.html).toBe('<p>hi</p>');
    expect(props.sandbox.url).toBe(SANDBOX_URL);
  });

  it('defaults toolName when omitted, and forwards it when given', () => {
    renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL });
    expect(latest!.rendererProps.toolName).toBe('mcp-ui-surface');

    renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL, toolName: 'content_post_delete' });
    expect(latest!.rendererProps.toolName).toBe('content_post_delete');
  });

  it('forwards hostInfo and hostContext only when given', () => {
    renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL });
    expect(latest!.rendererProps.hostInfo).toBeUndefined();
    expect(latest!.rendererProps.hostContext).toBeUndefined();

    renderHarness({
      html: '<p>hi</p>',
      sandboxProxyUrl: SANDBOX_URL,
      hostInfo: { name: 'jini', version: '1' },
      hostContext: { theme: 'light' },
    });
    expect(latest!.rendererProps.hostInfo).toEqual({ name: 'jini', version: '1' });
    expect(latest!.rendererProps.hostContext).toEqual({ theme: 'light' });
  });
});

describe('useMcpUiHost — state, keyed off the real onSizeChanged callback AppRenderer would call', () => {
  it('starts awaiting-ready, then becomes ready on the first size report — every surface this package builds reports size immediately after its own handshake completes (surfaces/bridge.ts), which is what this inference relies on', () => {
    const { current } = renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL });
    expect(current().state).toBe('awaiting-ready');

    act(() => current().rendererProps.onSizeChanged!({ width: 300, height: 410 }));
    expect(current().state).toBe('ready');
    expect(current().size).toEqual({ width: 300, height: 410 });
  });

  it('forwards the reported size to the caller-supplied onSizeChanged, defaulting missing dimensions to 0', () => {
    const onSizeChanged = vi.fn();
    const { current } = renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL, onSizeChanged });

    act(() => current().rendererProps.onSizeChanged!({ width: 300 }));
    expect(onSizeChanged).toHaveBeenCalledWith({ width: 300, height: 0 });
  });

  it('becomes errored on the real onError callback, before any size report', () => {
    const { current } = renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL });
    act(() => current().rendererProps.onError!(new Error('sandbox proxy failed to load')));
    expect(current().state).toBe('errored');
  });

  it('times out if no size report arrives within initializedTimeoutMs', () => {
    vi.useFakeTimers();
    const { current } = renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL, initializedTimeoutMs: 50 });
    expect(current().state).toBe('awaiting-ready');
    act(() => vi.advanceTimersByTime(50));
    expect(current().state).toBe('timed-out');
  });

  it('does not time out once the handshake has already settled ready', () => {
    vi.useFakeTimers();
    const { current } = renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL, initializedTimeoutMs: 50 });
    act(() => current().rendererProps.onSizeChanged!({ width: 1, height: 1 }));
    expect(current().state).toBe('ready');
    act(() => vi.advanceTimersByTime(50));
    expect(current().state).toBe('ready');
  });

  it('resets to awaiting-ready and re-arms the watchdog when the session key changes', () => {
    vi.useFakeTimers();
    const { current, rerender } = renderHarness({
      html: '<p>one</p>',
      sandboxProxyUrl: SANDBOX_URL,
      sessionKey: 'a',
      initializedTimeoutMs: 50,
    });
    act(() => current().rendererProps.onSizeChanged!({ width: 1, height: 1 }));
    expect(current().state).toBe('ready');

    rerender(<Harness html="<p>two</p>" sandboxProxyUrl={SANDBOX_URL} sessionKey="b" initializedTimeoutMs={50} />);
    expect(current().state).toBe('awaiting-ready');
    act(() => vi.advanceTimersByTime(50));
    expect(current().state).toBe('timed-out');
  });
});

describe('useMcpUiHost — onCallTool (rendererProps.onCallTool, the real function handed to AppRenderer)', () => {
  const extra = {} as Parameters<NonNullable<AppRendererProps['onCallTool']>>[1];

  it('forwards {name, arguments} to onToolCall and returns its resolved value, passed through unvalidated (verified against the MCP SDK — see this hook module doc)', async () => {
    const onToolCall = vi.fn().mockResolvedValue({ delivered: true });
    const { current } = renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL, onToolCall });

    const result = await current().rendererProps.onCallTool!({ name: 'content_post_delete', arguments: { postId: '1' } }, extra);

    expect(onToolCall).toHaveBeenCalledWith({ name: 'content_post_delete', arguments: { postId: '1' } });
    expect(result).toEqual({ delivered: true });
  });

  it('defaults missing arguments to {}', async () => {
    const onToolCall = vi.fn().mockResolvedValue({});
    const { current } = renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL, onToolCall });

    await current().rendererProps.onCallTool!({ name: 'noop' }, extra);
    expect(onToolCall).toHaveBeenCalledWith({ name: 'noop', arguments: {} });
  });

  it('rejects with the handler error when onToolCall rejects, so AppBridge relays it to the View as a JSON-RPC error', async () => {
    const onToolCall = vi.fn().mockRejectedValue(new Error('confirmation expired'));
    const { current } = renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL, onToolCall });

    await expect(current().rendererProps.onCallTool!({ name: 'content_post_delete', arguments: {} }, extra)).rejects.toThrow(
      'confirmation expired',
    );
  });

  it('throws when no onToolCall handler is supplied, matching the old host refusing every tools/call', async () => {
    const { current } = renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL });
    await expect(current().rendererProps.onCallTool!({ name: 'anything', arguments: {} }, extra)).rejects.toThrow(
      'This host executes no tools.',
    );
  });
});

describe('useMcpUiHost — onOpenLink', () => {
  const extra = {} as Parameters<NonNullable<AppRendererProps['onOpenLink']>>[1];

  it('invokes the given handler with the url and returns success', async () => {
    const onOpenLink = vi.fn();
    const { current } = renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL, onOpenLink });

    const result = await current().rendererProps.onOpenLink!({ url: 'https://example.test' }, extra);
    expect(onOpenLink).toHaveBeenCalledWith('https://example.test');
    expect(result).toEqual({});
  });

  it('refuses (isError: true) when no handler is supplied', async () => {
    const { current } = renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL });
    const result = await current().rendererProps.onOpenLink!({ url: 'https://example.test' }, extra);
    expect(result).toEqual({ isError: true });
  });
});

describe('useMcpUiHost — onEvent observability, teardown', () => {
  it('emits an event for every meaningful moment: ready, tool-call resolve/reject, open-link refuse', async () => {
    const onEvent = vi.fn();
    const extra = {} as Parameters<NonNullable<AppRendererProps['onCallTool']>>[1];
    const { current } = renderHarness({
      html: '<p>hi</p>',
      sandboxProxyUrl: SANDBOX_URL,
      onEvent,
      onToolCall: () => Promise.resolve({}),
    });

    act(() => current().rendererProps.onSizeChanged!({ width: 1, height: 1 }));
    await current().rendererProps.onCallTool!({ name: 't', arguments: {} }, extra);
    await current().rendererProps.onOpenLink!({ url: 'https://example.test' }, extra);

    const notes = (onEvent.mock.calls as [McpUiHostEvent][]).map(([event]) => event.note);
    expect(notes.some((note) => note.includes('handshake'))).toBe(true);
    expect(notes.some((note) => note.includes('resolved'))).toBe(true);
    expect(notes.some((note) => note.includes('refused'))).toBe(true);
  });

  it('requestTeardown is a no-op before ready, and moves state to torn-down once ready', () => {
    const { current } = renderHarness({ html: '<p>hi</p>', sandboxProxyUrl: SANDBOX_URL });

    act(() => current().requestTeardown());
    expect(current().state).toBe('awaiting-ready');

    act(() => current().rendererProps.onSizeChanged!({ width: 1, height: 1 }));
    act(() => current().requestTeardown());
    expect(current().state).toBe('torn-down');
    // See useMcpUiHost.ts's module doc: @mcp-ui/client exposes no acknowledgement signal anymore.
    expect(current().teardownAcknowledged).toBeNull();
  });
});
