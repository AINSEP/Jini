/**
 * The generated bridge is a JavaScript *string*, so asserting on its text would only prove it was
 * spelled right. These tests execute the real emitted source instead, against a fake `window` and
 * `document` injected as shadowing parameters via `new Function` — which is what lets the test drive
 * the message listener directly and observe every message the View posts, without needing an engine
 * that runs scripts inside a jsdom iframe.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  SURFACE_BRIDGE_GLOBAL,
  SURFACE_HANDSHAKE_FAILED_ATTRIBUTE,
  renderBridgeScript,
} from '../../surfaces/bridge.js';

interface JsonRpcish {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

interface SurfaceApi {
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
  notify(method: string, params?: Record<string, unknown>): void;
  openLink(url: string): void;
  requestTeardown(): void;
  whenReady(fn: () => void): void;
  hostContext(): unknown;
  isReady(): boolean;
}

function runBridge(options: { resizeObserver?: unknown } = {}) {
  const posted: JsonRpcish[] = [];
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const setAttribute = vi.fn();
  const observe = vi.fn();

  const fakeWindow: Record<string, unknown> = {
    parent: { postMessage: (message: JsonRpcish) => posted.push(message) },
    addEventListener: (_type: string, handler: (event: { data: unknown }) => void) => listeners.push(handler),
  };
  const fakeDocument = {
    documentElement: { scrollWidth: 360, scrollHeight: 240, setAttribute },
  };

  const source = renderBridgeScript({ appName: 'test-surface', appVersion: '2' });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('window', 'document', 'ResizeObserver', source)(
    fakeWindow,
    fakeDocument,
    options.resizeObserver ?? (class {
      constructor(callback: () => void) {
        void callback;
      }
      observe = observe;
    }),
  );

  return {
    posted,
    setAttribute,
    observe,
    api: fakeWindow[SURFACE_BRIDGE_GLOBAL] as SurfaceApi,
    deliver(data: unknown) {
      for (const listener of listeners) listener({ data });
    },
    /** Answers whichever request is still outstanding for `method`. */
    answer(method: string, result: unknown) {
      const request = posted.find((message) => message.method === method);
      this.deliver({ jsonrpc: '2.0', id: request?.id, result });
    },
    async handshake() {
      this.answer('ui/initialize', { protocolVersion: '2026-01-26', hostContext: { theme: 'dark' } });
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('renderBridgeScript', () => {
  it('sends ui/initialize immediately, before anything else', () => {
    const bridge = runBridge();
    expect(bridge.posted).toHaveLength(1);
    expect(bridge.posted[0]).toMatchObject({
      jsonrpc: '2.0',
      method: 'ui/initialize',
      params: { protocolVersion: '2026-01-26', appInfo: { name: 'test-surface', version: '2' }, appCapabilities: {} },
    });
    expect(bridge.posted[0]?.id).toBeTypeOf('string');
  });

  it('sends initialized then size-changed once the Host answers, in that order', async () => {
    const bridge = runBridge();
    await bridge.handshake();
    expect(bridge.posted.slice(1).map((message) => message.method)).toEqual([
      'ui/notifications/initialized',
      'ui/notifications/size-changed',
    ]);
    expect(bridge.posted[2]?.params).toEqual({ width: 360, height: 240 });
    expect(bridge.api.isReady()).toBe(true);
    expect(bridge.api.hostContext()).toEqual({ theme: 'dark' });
  });

  it('exposes a null hostContext when the Host response carries none', async () => {
    const bridge = runBridge();
    bridge.answer('ui/initialize', {});
    await Promise.resolve();
    expect(bridge.api.hostContext()).toBeNull();
  });

  it('observes the document for resizes when ResizeObserver exists', async () => {
    const bridge = runBridge();
    await bridge.handshake();
    expect(bridge.observe).toHaveBeenCalledTimes(1);
  });

  it('skips the observer rather than throwing when ResizeObserver is unavailable', async () => {
    const bridge = runBridge({ resizeObserver: undefined });
    await bridge.handshake();
    expect(bridge.posted.map((message) => message.method)).toContain('ui/notifications/size-changed');
  });

  it('holds a callTool made before the handshake, then sends it as a JSON-RPC tools/call', async () => {
    const bridge = runBridge();
    const pending = bridge.api.callTool('content_post_delete', { id: 'p1', confirmationToken: 'secret' });
    // Nothing but the initialize request has gone out: sending early would earn an invalidRequest.
    expect(bridge.posted).toHaveLength(1);

    await bridge.handshake();
    const call = bridge.posted.find((message) => message.method === 'tools/call');
    expect(call?.params).toEqual({
      name: 'content_post_delete',
      arguments: { id: 'p1', confirmationToken: 'secret' },
    });

    bridge.deliver({ jsonrpc: '2.0', id: call?.id, result: { ok: true } });
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('sends a callTool made after the handshake immediately, and defaults missing arguments to {}', async () => {
    const bridge = runBridge();
    await bridge.handshake();
    const pending = bridge.api.callTool('refresh');
    const call = bridge.posted.find((message) => message.method === 'tools/call');
    expect(call?.params).toEqual({ name: 'refresh', arguments: {} });
    bridge.deliver({ jsonrpc: '2.0', id: call?.id, result: null });
    await expect(pending).resolves.toBeNull();
  });

  it('rejects a call with the Host’s own error message and code', async () => {
    const bridge = runBridge();
    await bridge.handshake();
    const pending = bridge.api.callTool('boom');
    const call = bridge.posted.find((message) => message.method === 'tools/call');
    bridge.deliver({ jsonrpc: '2.0', id: call?.id, error: { code: -32603, message: 'Row is locked' } });
    await expect(pending).rejects.toThrow('Row is locked');
  });

  it('rejects with a generic message when the Host’s error carries no string message', async () => {
    const bridge = runBridge();
    await bridge.handshake();
    const pending = bridge.api.callTool('boom');
    const call = bridge.posted.find((message) => message.method === 'tools/call');
    bridge.deliver({ jsonrpc: '2.0', id: call?.id, error: { code: 'not-a-number' } });
    await expect(pending).rejects.toThrow('Host returned an error');
  });

  it('marks the document and rejects queued calls when the handshake itself fails', async () => {
    const bridge = runBridge();
    const pending = bridge.api.callTool('never-runs');
    const initialize = bridge.posted[0];
    bridge.deliver({ jsonrpc: '2.0', id: initialize?.id, error: { code: -32600, message: 'no handshake' } });
    await expect(pending).rejects.toThrow('no handshake');
    expect(bridge.setAttribute).toHaveBeenCalledWith(SURFACE_HANDSHAKE_FAILED_ATTRIBUTE, 'true');
    expect(bridge.api.isReady()).toBe(false);
  });

  it('answers the Host’s ui/resource-teardown request, so a Host waiting on it is never stalled', () => {
    const bridge = runBridge();
    bridge.deliver({ jsonrpc: '2.0', id: 'host-teardown-1', method: 'ui/resource-teardown', params: { reason: 'x' } });
    expect(bridge.posted.at(-1)).toEqual({ jsonrpc: '2.0', id: 'host-teardown-1', result: {} });
  });

  it('answers an unrecognized Host request with methodNotFound rather than silence', () => {
    const bridge = runBridge();
    bridge.deliver({ jsonrpc: '2.0', id: 7, method: 'ui/some-future-thing' });
    expect(bridge.posted.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32601, message: 'View does not implement ui/some-future-thing' },
    });
  });

  it.each([
    ['a Host notification (no id)', { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {} }],
    ['a non-JSON-RPC object', { hello: 'world' }],
    ['a primitive', 'nope'],
    ['null', null],
    ['a response for an unknown id', { jsonrpc: '2.0', id: 'never-sent', result: 1 }],
  ])('ignores %s without posting anything back', (_label, data) => {
    const bridge = runBridge();
    const before = bridge.posted.length;
    bridge.deliver(data);
    expect(bridge.posted).toHaveLength(before);
  });

  it('runs whenReady callbacks after the handshake, and immediately once already ready', async () => {
    const bridge = runBridge();
    const early = vi.fn();
    bridge.api.whenReady(early);
    expect(early).not.toHaveBeenCalled();

    await bridge.handshake();
    expect(early).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    bridge.api.whenReady(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('never runs a whenReady callback registered after a failed handshake', async () => {
    const bridge = runBridge();
    bridge.deliver({ jsonrpc: '2.0', id: bridge.posted[0]?.id, error: { code: -1, message: 'nope' } });
    await Promise.resolve();
    const afterFailure = vi.fn();
    bridge.api.whenReady(afterFailure);
    expect(afterFailure).not.toHaveBeenCalled();
  });

  it('exposes open-link, teardown-request and raw notify as spec-named notifications', async () => {
    const bridge = runBridge();
    await bridge.handshake();
    bridge.api.openLink('https://example.test/docs');
    bridge.api.requestTeardown();
    bridge.api.notify('notifications/message', { level: 'info', data: 'hi' });
    expect(bridge.posted.slice(-3)).toEqual([
      { jsonrpc: '2.0', method: 'ui/open-link', params: { url: 'https://example.test/docs' } },
      { jsonrpc: '2.0', method: 'ui/notifications/request-teardown' },
      { jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'hi' } },
    ]);
  });

  it('touches no storage API, which would throw SecurityError in an opaque origin', () => {
    const source = renderBridgeScript({ appName: 'a', appVersion: '1' });
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('scrollIntoView');
  });
});
