import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMcpUiHost, type McpUiHostEvent, type McpUiHostOptions } from '../useMcpUiHost.js';
import type { BufferedWindowMessage } from '../../../features/mcp-ui/early-message-buffer.js';

/** A message source under the test's control, standing in for the module-scope window listener. */
function createTestSource() {
  const handlers = new Set<(message: BufferedWindowMessage) => void>();
  const bus = {
    unsubscribed: 0,
    // Bound once, never recreated: `messageSource` is an effect dependency, so an identity that
    // changed per render would re-subscribe and restart the session on every re-render.
    source: (handler: (message: BufferedWindowMessage) => void) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
        bus.unsubscribed += 1;
      };
    },
    deliver(data: unknown, source: unknown) {
      act(() => {
        for (const handler of [...handlers]) handler({ data, origin: 'null', source });
      });
    },
  };
  return bus;
}

interface HarnessProps extends Omit<McpUiHostOptions, 'html'> {
  html?: string;
  showFrame?: boolean;
}

function Harness({ html = '<p>view</p>', showFrame = true, ...options }: HarnessProps) {
  const host = useMcpUiHost({ html, ...options });
  return (
    <div>
      {showFrame ? <iframe ref={host.iframeRef} title="view" srcDoc={html} sandbox="allow-scripts" /> : null}
      <span data-testid="state">{host.state}</span>
      <span data-testid="size">{host.size === null ? 'none' : `${host.size.width}x${host.size.height}`}</span>
      <span data-testid="ack">{String(host.teardownAcknowledged)}</span>
      <button type="button" onClick={host.requestTeardown}>
        teardown
      </button>
    </div>
  );
}

function frame(): HTMLIFrameElement {
  return screen.getByTitle('view') as HTMLIFrameElement;
}

function viewWindow(): Window {
  return frame().contentWindow!;
}

function spyOnPosts() {
  return vi.spyOn(viewWindow(), 'postMessage').mockImplementation(() => {});
}

function state(): string {
  return screen.getByTestId('state').textContent ?? '';
}

const INITIALIZE = { jsonrpc: '2.0', id: 'v1', method: 'ui/initialize', params: { protocolVersion: '2026-01-26' } };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useMcpUiHost handshake', () => {
  it('starts in awaiting-initialize and answers ui/initialize with a spec-shaped result', () => {
    const bus = createTestSource();
    render(<Harness messageSource={bus.source} />);
    expect(state()).toBe('awaiting-initialize');

    const posts = spyOnPosts();
    bus.deliver(INITIALIZE, viewWindow());

    expect(posts).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        id: 'v1',
        result: {
          protocolVersion: '2026-01-26',
          hostInfo: { name: 'jini-mcp-ui-host', version: '1' },
          hostContext: { theme: 'light', displayMode: 'inline' },
          hostCapabilities: {},
        },
      },
      '*',
    );
    expect(state()).toBe('awaiting-initialized');
  });

  it('reports caller-supplied host identity and context instead of the defaults', () => {
    const bus = createTestSource();
    render(
      <Harness
        messageSource={bus.source}
        hostInfo={{ name: 'example-admin', version: '4.2' }}
        hostContext={{ theme: 'dark', displayMode: 'fullscreen' }}
      />,
    );
    const posts = spyOnPosts();
    bus.deliver(INITIALIZE, viewWindow());
    expect(posts.mock.calls[0]?.[0]).toMatchObject({
      result: { hostInfo: { name: 'example-admin', version: '4.2' }, hostContext: { theme: 'dark', displayMode: 'fullscreen' } },
    });
  });

  it('becomes ready on ui/notifications/initialized', () => {
    const bus = createTestSource();
    render(<Harness messageSource={bus.source} />);
    spyOnPosts();
    bus.deliver(INITIALIZE, viewWindow());
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, viewWindow());
    expect(state()).toBe('ready');
  });

  it('times out rather than hanging when the View never sends initialized', () => {
    const bus = createTestSource();
    const onEvent = vi.fn();
    render(<Harness messageSource={bus.source} onEvent={onEvent} initializedTimeoutMs={50} />);
    spyOnPosts();
    bus.deliver(INITIALIZE, viewWindow());
    act(() => {
      vi.advanceTimersByTime(51);
    });
    expect(state()).toBe('timed-out');
    expect(onEvent.mock.calls.map((call) => (call[0] as McpUiHostEvent).direction)).toContain('timeout');
  });

  it('does not fire the timeout after the handshake already completed', () => {
    const bus = createTestSource();
    render(<Harness messageSource={bus.source} initializedTimeoutMs={50} />);
    spyOnPosts();
    bus.deliver(INITIALIZE, viewWindow());
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, viewWindow());
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(state()).toBe('ready');
  });

  it('ignores a duplicate initialized notification arriving in the wrong state', () => {
    const bus = createTestSource();
    const onEvent = vi.fn();
    render(<Harness messageSource={bus.source} onEvent={onEvent} />);
    spyOnPosts();
    bus.deliver(INITIALIZE, viewWindow());
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, viewWindow());
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, viewWindow());
    expect(state()).toBe('ready');
    expect(onEvent.mock.calls.some((call) => (call[0] as McpUiHostEvent).direction === 'rejected')).toBe(true);
  });

  it('refuses any request that arrives before ui/initialize', () => {
    const bus = createTestSource();
    render(<Harness messageSource={bus.source} />);
    const posts = spyOnPosts();
    bus.deliver({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'x' } }, viewWindow());
    expect(posts.mock.calls[0]?.[0]).toMatchObject({ id: 9, error: { code: -32600 } });
    expect(state()).toBe('awaiting-initialize');
  });

  it('refuses a request that arrives mid-handshake', () => {
    const bus = createTestSource();
    render(<Harness messageSource={bus.source} />);
    const posts = spyOnPosts();
    bus.deliver(INITIALIZE, viewWindow());
    posts.mockClear();
    bus.deliver({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'x' } }, viewWindow());
    expect(posts.mock.calls[0]?.[0]).toMatchObject({
      id: 10,
      error: { code: -32600, message: 'Handshake not complete (state=awaiting-initialized).' },
    });
  });

  it('restarts the session when the session key changes', () => {
    const bus = createTestSource();
    const { rerender } = render(<Harness messageSource={bus.source} sessionKey="a" />);
    spyOnPosts();
    bus.deliver(INITIALIZE, viewWindow());
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, viewWindow());
    expect(state()).toBe('ready');

    rerender(<Harness messageSource={bus.source} sessionKey="b" />);
    expect(state()).toBe('awaiting-initialize');
  });
});

describe('useMcpUiHost message filtering', () => {
  it('ignores a message that did not come from its own frame', () => {
    const bus = createTestSource();
    const onEvent = vi.fn();
    render(<Harness messageSource={bus.source} onEvent={onEvent} />);
    bus.deliver(INITIALIZE, window);
    expect(state()).toBe('awaiting-initialize');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('ignores everything while no frame is mounted', () => {
    const bus = createTestSource();
    render(<Harness messageSource={bus.source} showFrame={false} />);
    bus.deliver(INITIALIZE, window);
    expect(state()).toBe('awaiting-initialize');
  });

  it('drops a malformed, non-JSON-RPC message', () => {
    const bus = createTestSource();
    const onEvent = vi.fn();
    render(<Harness messageSource={bus.source} onEvent={onEvent} />);
    bus.deliver({ hello: 'world' }, viewWindow());
    expect(onEvent).toHaveBeenCalledWith({ direction: 'rejected', note: 'dropped a malformed (non-JSON-RPC) message' });
  });

  it('unsubscribes on unmount', () => {
    const bus = createTestSource();
    const view = render(<Harness messageSource={bus.source} />);
    view.unmount();
    expect(bus.unsubscribed).toBe(1);
  });

  it('falls back to the shared window listener when no source is injected', () => {
    render(<Harness />);
    expect(state()).toBe('awaiting-initialize');
  });
});

describe('useMcpUiHost size reporting', () => {
  function ready(options: Partial<HarnessProps> = {}) {
    const bus = createTestSource();
    render(<Harness messageSource={bus.source} {...options} />);
    const posts = spyOnPosts();
    bus.deliver(INITIALIZE, viewWindow());
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, viewWindow());
    posts.mockClear();
    return { bus, posts };
  }

  it('records a well-formed size and forwards it to onSizeChanged', () => {
    const onSizeChanged = vi.fn();
    const { bus } = ready({ onSizeChanged });
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 360, height: 240 } }, viewWindow());
    expect(screen.getByTestId('size').textContent).toBe('360x240');
    expect(onSizeChanged).toHaveBeenCalledWith({ width: 360, height: 240 });
  });

  it('records a size with no onSizeChanged wired up', () => {
    const { bus } = ready();
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 1, height: 2 } }, viewWindow());
    expect(screen.getByTestId('size').textContent).toBe('1x2');
  });

  it.each([
    ['non-numeric dimensions', { width: '360', height: 240 }],
    ['a missing height', { width: 360 }],
    ['no params at all', undefined],
  ])('ignores a size-changed carrying %s', (_label, params) => {
    const { bus } = ready();
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', ...(params === undefined ? {} : { params }) }, viewWindow());
    expect(screen.getByTestId('size').textContent).toBe('none');
  });

  it('ignores a notification it has no handling for', () => {
    const { bus, posts } = ready();
    bus.deliver({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info' } }, viewWindow());
    expect(state()).toBe('ready');
    expect(posts).not.toHaveBeenCalled();
  });
});

describe('useMcpUiHost tool calls', () => {
  function ready(options: Partial<HarnessProps> = {}) {
    const bus = createTestSource();
    const view = render(<Harness messageSource={bus.source} {...options} />);
    const posts = spyOnPosts();
    bus.deliver(INITIALIZE, viewWindow());
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, viewWindow());
    posts.mockClear();
    return { bus, posts, view };
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('forwards a tools/call to the injected executor and relays its result', async () => {
    const onToolCall = vi.fn(async () => ({ deleted: true }));
    const { bus, posts } = ready({ onToolCall });
    bus.deliver(
      { jsonrpc: '2.0', id: 'c1', method: 'tools/call', params: { name: 'content_post_delete', arguments: { id: 'p1' } } },
      viewWindow(),
    );
    await flush();
    expect(onToolCall).toHaveBeenCalledWith({ name: 'content_post_delete', arguments: { id: 'p1' } });
    expect(posts).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 'c1', result: { deleted: true } }, '*');
  });

  it('defaults missing or non-object arguments to an empty object', async () => {
    const onToolCall = vi.fn(() => 'sync-result');
    const { bus, posts } = ready({ onToolCall });
    bus.deliver({ jsonrpc: '2.0', id: 'c2', method: 'tools/call', params: { name: 'ping', arguments: 'nope' } }, viewWindow());
    await flush();
    expect(onToolCall).toHaveBeenCalledWith({ name: 'ping', arguments: {} });
    expect(posts).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 'c2', result: 'sync-result' }, '*');
  });

  it('relays a rejection as a JSON-RPC error carrying the real reason', async () => {
    const { bus, posts } = ready({
      onToolCall: () => {
        throw new Error('Row is locked');
      },
    });
    bus.deliver({ jsonrpc: '2.0', id: 'c3', method: 'tools/call', params: { name: 'x' } }, viewWindow());
    await flush();
    expect(posts).toHaveBeenCalledWith(
      { jsonrpc: '2.0', id: 'c3', error: { code: -32603, message: 'Row is locked' } },
      '*',
    );
  });

  it('stringifies a non-Error rejection', async () => {
    const { bus, posts } = ready({ onToolCall: () => Promise.reject('plain failure') });
    bus.deliver({ jsonrpc: '2.0', id: 'c4', method: 'tools/call', params: { name: 'x' } }, viewWindow());
    await flush();
    expect(posts).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 'c4', error: { code: -32603, message: 'plain failure' } }, '*');
  });

  it('refuses tools/call with methodNotFound when no executor is wired up', () => {
    const { bus, posts } = ready();
    bus.deliver({ jsonrpc: '2.0', id: 'c5', method: 'tools/call', params: { name: 'x' } }, viewWindow());
    expect(posts).toHaveBeenCalledWith(
      { jsonrpc: '2.0', id: 'c5', error: { code: -32601, message: 'This host executes no tools.' } },
      '*',
    );
  });

  it('rejects a tools/call with no string name', () => {
    const { bus, posts } = ready({ onToolCall: vi.fn() });
    bus.deliver({ jsonrpc: '2.0', id: 'c6', method: 'tools/call', params: { arguments: {} } }, viewWindow());
    expect(posts).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 'c6', error: { code: -32602, message: 'tools/call requires params.name.' } }, '*');
  });

  it('posts nothing once the host has unmounted mid-flight', async () => {
    let settle: (value: unknown) => void = () => {};
    const { bus, posts, view } = ready({ onToolCall: () => new Promise((resolve) => { settle = resolve; }) });
    bus.deliver({ jsonrpc: '2.0', id: 'c7', method: 'tools/call', params: { name: 'slow' } }, viewWindow());
    posts.mockClear();
    view.unmount();
    settle('too late');
    await flush();
    expect(posts).not.toHaveBeenCalled();
  });

  it('posts nothing when a mid-flight call rejects after unmount', async () => {
    let fail: (error: unknown) => void = () => {};
    const { bus, posts, view } = ready({ onToolCall: () => new Promise((_resolve, reject) => { fail = reject; }) });
    bus.deliver({ jsonrpc: '2.0', id: 'c8', method: 'tools/call', params: { name: 'slow' } }, viewWindow());
    posts.mockClear();
    view.unmount();
    fail(new Error('too late'));
    await flush();
    expect(posts).not.toHaveBeenCalled();
  });
});

describe('useMcpUiHost link handling and unknown methods', () => {
  function ready(options: Partial<HarnessProps> = {}) {
    const bus = createTestSource();
    render(<Harness messageSource={bus.source} {...options} />);
    const posts = spyOnPosts();
    bus.deliver(INITIALIZE, viewWindow());
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, viewWindow());
    posts.mockClear();
    return { bus, posts };
  }

  it('forwards ui/open-link to the handler and acknowledges it', () => {
    const onOpenLink = vi.fn();
    const { bus, posts } = ready({ onOpenLink });
    bus.deliver({ jsonrpc: '2.0', id: 'l1', method: 'ui/open-link', params: { url: 'https://example.test' } }, viewWindow());
    expect(onOpenLink).toHaveBeenCalledWith('https://example.test');
    expect(posts).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 'l1', result: {} }, '*');
  });

  it('refuses ui/open-link when no handler is wired up', () => {
    const { bus, posts } = ready();
    bus.deliver({ jsonrpc: '2.0', id: 'l2', method: 'ui/open-link', params: { url: 'https://example.test' } }, viewWindow());
    expect(posts).toHaveBeenCalledWith(
      { jsonrpc: '2.0', id: 'l2', error: { code: -32600, message: 'This host cannot open links.' } },
      '*',
    );
  });

  it('refuses ui/open-link with no string url even when a handler exists', () => {
    const onOpenLink = vi.fn();
    const { bus, posts } = ready({ onOpenLink });
    bus.deliver({ jsonrpc: '2.0', id: 'l3', method: 'ui/open-link', params: {} }, viewWindow());
    expect(onOpenLink).not.toHaveBeenCalled();
    expect(posts.mock.calls[0]?.[0]).toMatchObject({ id: 'l3', error: { code: -32600 } });
  });

  it('answers an unimplemented method with methodNotFound', () => {
    const { bus, posts } = ready();
    bus.deliver({ jsonrpc: '2.0', id: 'x1', method: 'sampling/createMessage', params: {} }, viewWindow());
    expect(posts).toHaveBeenCalledWith(
      { jsonrpc: '2.0', id: 'x1', error: { code: -32601, message: 'Host does not implement sampling/createMessage.' } },
      '*',
    );
  });
});

describe('useMcpUiHost teardown', () => {
  function ready(options: Partial<HarnessProps> = {}) {
    const bus = createTestSource();
    const view = render(<Harness messageSource={bus.source} {...options} />);
    const posts = spyOnPosts();
    bus.deliver(INITIALIZE, viewWindow());
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, viewWindow());
    posts.mockClear();
    return { bus, posts, view };
  }

  function clickTeardown() {
    act(() => {
      screen.getByRole('button', { name: 'teardown' }).click();
    });
  }

  it('sends ui/resource-teardown and settles as acknowledged when the View answers', () => {
    const { bus, posts } = ready();
    clickTeardown();
    expect(state()).toBe('tearing-down');
    const sent = posts.mock.calls[0]?.[0] as { id: string; method: string };
    expect(sent.method).toBe('ui/resource-teardown');

    bus.deliver({ jsonrpc: '2.0', id: sent.id, result: {} }, viewWindow());
    expect(state()).toBe('torn-down');
    expect(screen.getByTestId('ack').textContent).toBe('true');
  });

  it('settles as unacknowledged when the View answers with an error', () => {
    const { bus, posts } = ready();
    clickTeardown();
    const sent = posts.mock.calls[0]?.[0] as { id: string };
    bus.deliver({ jsonrpc: '2.0', id: sent.id, error: { code: -1, message: 'busy' } }, viewWindow());
    expect(screen.getByTestId('ack').textContent).toBe('false');
    expect(state()).toBe('torn-down');
  });

  it('gives up after the bounded wait rather than waiting forever', () => {
    const { posts } = ready({ teardownTimeoutMs: 40 });
    clickTeardown();
    expect(posts).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(41);
    });
    expect(state()).toBe('torn-down');
    expect(screen.getByTestId('ack').textContent).toBe('false');
  });

  it('does nothing when asked to tear down before the handshake completes', () => {
    const bus = createTestSource();
    render(<Harness messageSource={bus.source} />);
    const posts = spyOnPosts();
    clickTeardown();
    expect(posts).not.toHaveBeenCalled();
    expect(state()).toBe('awaiting-initialize');
  });

  it('honors the View asking to be torn down', () => {
    const { bus, posts } = ready();
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/request-teardown' }, viewWindow());
    expect(state()).toBe('tearing-down');
    expect((posts.mock.calls[0]?.[0] as { method: string }).method).toBe('ui/resource-teardown');
  });

  it('ignores a response whose id matches no outstanding request', () => {
    const bus = createTestSource();
    const onEvent = vi.fn();
    render(<Harness messageSource={bus.source} onEvent={onEvent} />);
    spyOnPosts();
    bus.deliver({ jsonrpc: '2.0', id: 'never-sent', result: 1 }, viewWindow());
    expect(onEvent).toHaveBeenCalledWith({ direction: 'rejected', note: 'response for unrecognized id=never-sent ignored' });
  });

  it('ignores a response arriving for a different id than the teardown in flight', () => {
    const { bus, posts } = ready();
    clickTeardown();
    bus.deliver({ jsonrpc: '2.0', id: 'some-other-id', result: {} }, viewWindow());
    expect(state()).toBe('tearing-down');
    void posts;
  });

  it('clears the pending teardown timer when unmounted mid-teardown', () => {
    const { view } = ready({ teardownTimeoutMs: 40 });
    clickTeardown();
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByTestId('state')).toBeNull();
  });

  it('posts nothing when the frame is gone by the time teardown is requested', () => {
    const bus = createTestSource();
    const { rerender } = render(<Harness messageSource={bus.source} sessionKey="k" />);
    const posts = spyOnPosts();
    bus.deliver(INITIALIZE, viewWindow());
    bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, viewWindow());
    posts.mockClear();

    // Same session key, so the state machine stays `ready` while the frame itself unmounts —
    // the case that would otherwise post to a null contentWindow.
    rerender(<Harness messageSource={bus.source} sessionKey="k" showFrame={false} />);
    clickTeardown();
    expect(posts).not.toHaveBeenCalled();
    expect(state()).toBe('tearing-down');
  });
});
