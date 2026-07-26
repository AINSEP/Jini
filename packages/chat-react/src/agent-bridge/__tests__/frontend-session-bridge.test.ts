import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFrontendSessionBridge } from '../frontend-session-bridge.js';
import type { PageDriver } from '@jini/chat-core';

/**
 * The browser half of agent control, against a scripted daemon.
 *
 * Everything interesting here is about what happens when the connection misbehaves — a reattach,
 * a redelivered invocation, a frame the daemon has not taught this build about. None of that is
 * observable from the happy path, and all of it decides whether a real page ends up double-clicking
 * a button or silently unreachable.
 */

/** Stands in for the browser's own EventSource, so a test can deliver frames on demand. */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  static opened: string[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.last = this;
    FakeEventSource.opened.push(url);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  close(): void {
    this.closed = true;
  }

  /** Delivers one server-sent frame. */
  emit(payload: unknown): void {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const listener of this.listeners.get('message') ?? []) listener({ data });
  }

  fail(event: unknown = new Error('stream down')): void {
    for (const listener of this.listeners.get('error') ?? []) listener(event);
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Every response body this suite POSTs back, in order. */
function postedBodies(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map(([, init]) =>
    JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);
}

function createDriver(overrides: Partial<PageDriver> = {}): PageDriver {
  return {
    findElements: vi.fn(async () => [
      { handle: 'save-button', role: 'button' as const, label: 'Save', labelTruncated: false, page: 'home' },
    ]),
    listPages: vi.fn(async () => ['home']),
    selectOption: vi.fn(async () => undefined),
    describeField: vi.fn(async () => null),
    highlight: vi.fn(async () => undefined),
    scrollTo: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Lets the bridge's own promise chains run to completion. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  FakeEventSource.last = undefined;
  FakeEventSource.opened = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('capability claims', () => {
  it('claims only the chat verbs for a surface with no page driver', () => {
    createFrontendSessionBridge();
    const url = FakeEventSource.opened[0] ?? '';
    expect(url).toContain('capability=chat.send_message');
    expect(url).not.toContain('capability=page.click');
  });

  it('claims the page verbs once a driver is wired', () => {
    createFrontendSessionBridge({ pageDriver: createDriver() });
    expect(FakeEventSource.opened[0]).toContain('capability=page.click');
  });

  it('claims a product prefix so a consumer can expose verbs the engine never heard of', () => {
    createFrontendSessionBridge({ executors: { 'cms.': async () => undefined } });
    expect(FakeEventSource.opened[0]).toContain(`capability=${encodeURIComponent('cms.')}`);
  });

  it('connects to a host-supplied origin when given one', () => {
    createFrontendSessionBridge({ baseUrl: 'http://daemon.test:4317' });
    expect(FakeEventSource.opened[0]).toMatch(/^http:\/\/daemon\.test:4317\/api\/frontend-sessions\/stream\?/);
  });
});

describe('attachment', () => {
  it('resolves ready with the first attachment', async () => {
    const bridge = createFrontendSessionBridge();
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    await expect(bridge.ready).resolves.toEqual({ sessionId: 's1', bindToken: 't1' });
  });

  it('reports no bind token before the daemon has attached the surface', () => {
    expect(createFrontendSessionBridge().bindToken()).toBeUndefined();
  });

  it('replaces the bind token on every reattach, because a stale one binds nothing', async () => {
    // EventSource reconnects by itself. A host that captured `ready`'s token would keep sending
    // the pre-reconnect one, and every later run would fail to bind with nothing to see in the UI.
    const bridge = createFrontendSessionBridge();
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    expect(bridge.bindToken()).toBe('t1');

    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's2', bindToken: 't2' });
    expect(bridge.bindToken()).toBe('t2');
    // `ready` is a one-shot "is it live" signal and deliberately keeps its original value.
    await expect(bridge.ready).resolves.toMatchObject({ bindToken: 't1' });
  });

  it('answers to the session it is currently attached as, not the one it first attached as', async () => {
    const bridge = createFrontendSessionBridge({ pageDriver: createDriver() });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's2', bindToken: 't2' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'page.click', input: { element: 'save-button' } });
    await flush();
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/frontend-sessions/s2/responses');
  });

  it('rejects ready when the daemon refuses the surface outright', async () => {
    const bridge = createFrontendSessionBridge();
    FakeEventSource.last?.emit({ type: 'error', message: 'capability not permitted' });
    await expect(bridge.ready).rejects.toThrow('capability not permitted');
  });

  it('drops the bind token the moment the stream errors, because the daemon already has', async () => {
    // The registry deletes a session's token as soon as its connection goes; keeping it here
    // until the next `attached` frame leaves a gap where a run binds to a surface that is gone.
    const bridge = createFrontendSessionBridge();
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.fail();
    expect(bridge.bindToken()).toBeUndefined();
    await expect(bridge.bridgeAccess.respondSuccess('i1', {})).rejects.toThrow(/not attached yet/);
  });

  it('picks the new token up when the connection comes back', () => {
    const bridge = createFrontendSessionBridge();
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.fail();
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's2', bindToken: 't2' });
    expect(bridge.bindToken()).toBe('t2');
  });

  it('surrenders its bind token when closed, so a torn-down surface cannot strand a run', () => {
    const bridge = createFrontendSessionBridge();
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    bridge.close();
    expect(bridge.bindToken()).toBeUndefined();
    expect(FakeEventSource.last?.closed).toBe(true);
  });
});

describe('routing invocations', () => {
  it('runs a page verb through the driver and answers with its result', async () => {
    const driver = createDriver();
    const bridge = createFrontendSessionBridge({ pageDriver: driver });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'page.click', input: { element: 'save-button' } });
    await flush();

    expect(driver.click).toHaveBeenCalledWith('save-button');
    expect(postedBodies()[0]).toMatchObject({ invocationId: 'i1', ok: true, output: { clicked: 'save-button' } });
    void bridge;
  });

  it('hands chat verbs to the pane instead of serving them here', async () => {
    const seen: string[] = [];
    const bridge = createFrontendSessionBridge({ pageDriver: createDriver() });
    bridge.bridgeAccess.subscribe((action) => seen.push(action.capabilityId));
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'chat.set_draft', input: { text: 'hi' } });
    await flush();

    expect(seen).toEqual(['chat.set_draft']);
    // The pane answers it; the bridge must not have answered on its behalf.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops delivering to a pane that unsubscribed', async () => {
    const seen: string[] = [];
    const bridge = createFrontendSessionBridge();
    bridge.bridgeAccess.subscribe((action) => seen.push(action.capabilityId))();
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'chat.set_draft', input: {} });
    await flush();
    expect(seen).toEqual([]);
  });

  it('routes a product capability to the executor registered for its prefix', async () => {
    const cms = vi.fn(async () => ({ published: true }));
    createFrontendSessionBridge({ executors: { 'cms.': cms } });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'cms.publish', input: { id: 7 } });
    await flush();

    expect(cms).toHaveBeenCalledWith('cms.publish', { id: 7 });
    expect(postedBodies()[0]).toMatchObject({ ok: true, output: { published: true } });
  });

  it('refuses by name when nothing on the page serves the capability', async () => {
    createFrontendSessionBridge();
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'cms.publish', input: {} });
    await flush();
    expect(postedBodies()[0]).toMatchObject({ ok: false, message: 'nothing on this page serves "cms.publish"' });
  });

  it('reports a refusal from the executor rather than swallowing it', async () => {
    const bridge = createFrontendSessionBridge({ pageDriver: createDriver() });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'page.click', input: {} });
    await flush();
    expect(postedBodies()[0]).toMatchObject({ ok: false, message: 'page.click: "element" is required' });
    void bridge;
  });

  it('defaults a missing input to an empty object rather than failing on the frame', async () => {
    const driver = createDriver();
    createFrontendSessionBridge({ pageDriver: driver });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'page.find_elements' });
    await flush();
    expect(driver.findElements).toHaveBeenCalledWith({});
  });

  it('announces every invocation before running it, which is what a user sees as an activity trail', async () => {
    const onInvocation = vi.fn();
    createFrontendSessionBridge({ pageDriver: createDriver(), onInvocation });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'page.click', input: { element: 'save-button' } });
    await flush();
    expect(onInvocation).toHaveBeenCalledWith({ invocationId: 'i1', capabilityId: 'page.click', input: { element: 'save-button' } });
  });
});

describe('replay suppression', () => {
  it('never runs the same invocation twice, because a button is not idempotent', async () => {
    // The daemon redelivers when an answer never arrived. The click already happened.
    const driver = createDriver();
    createFrontendSessionBridge({ pageDriver: driver });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    const frame = { type: 'invocation', invocationId: 'i1', capabilityId: 'page.click', input: { element: 'save-button' } };
    FakeEventSource.last?.emit(frame);
    await flush();
    FakeEventSource.last?.emit(frame);
    await flush();

    expect(driver.click).toHaveBeenCalledTimes(1);
    expect(postedBodies()[1]).toMatchObject({ ok: false, message: 'already executed on this surface' });
  });

  it('does not announce a redelivery as a fresh action', async () => {
    const onInvocation = vi.fn();
    createFrontendSessionBridge({ pageDriver: createDriver(), onInvocation });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    const frame = { type: 'invocation', invocationId: 'i1', capabilityId: 'page.click', input: { element: 'save-button' } };
    FakeEventSource.last?.emit(frame);
    FakeEventSource.last?.emit(frame);
    await flush();
    expect(onInvocation).toHaveBeenCalledTimes(1);
  });

  it('forgets the oldest ids rather than growing without bound on a long-lived tab', async () => {
    const driver = createDriver();
    createFrontendSessionBridge({ pageDriver: driver });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    for (let index = 0; index < 300; index += 1) {
      FakeEventSource.last?.emit({ type: 'invocation', invocationId: `i${index}`, capabilityId: 'page.click', input: { element: 'save-button' } });
    }
    await flush();
    // The very first id has aged out, so its redelivery runs again — the deliberate trade for a
    // bounded set. Recent ids, which are the ones a retry actually concerns, are still protected.
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i0', capabilityId: 'page.click', input: { element: 'save-button' } });
    await flush();
    expect(driver.click).toHaveBeenCalledTimes(301);

    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i299', capabilityId: 'page.click', input: { element: 'save-button' } });
    await flush();
    expect(driver.click).toHaveBeenCalledTimes(301);
  });
});

describe('malformed and unexpected frames', () => {
  it('reports unparseable data instead of throwing inside the event listener', () => {
    const onError = vi.fn();
    createFrontendSessionBridge({ onError });
    FakeEventSource.last?.emit('not json');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('reports a bare JSON null frame through onError, rather than throwing inside the event listener', () => {
    // `JSON.parse('null')` is valid JSON and returns `null` without throwing, so the try/catch
    // around the parse never runs — the very next `frame['type']` read then threw a raw TypeError
    // outside any catch, bypassing onError entirely. `null` is not "unparseable"; it parses fine
    // and is simply not the object shape every frame handler after it assumes.
    const onError = vi.fn();
    createFrontendSessionBridge({ onError });
    expect(() => FakeEventSource.last?.emit('null')).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('ignores a frame type this build has never heard of, so the daemon can grow its vocabulary', async () => {
    const onError = vi.fn();
    createFrontendSessionBridge({ pageDriver: createDriver(), onError });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'heartbeat', at: 1 });
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a stream error to the host', () => {
    const onError = vi.fn();
    createFrontendSessionBridge({ onError });
    FakeEventSource.last?.fail();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('tolerates a stream error with no host listener at all', () => {
    createFrontendSessionBridge();
    expect(() => FakeEventSource.last?.fail()).not.toThrow();
  });
});

describe('answering the daemon', () => {
  it('refuses to answer before the surface has attached, rather than posting to no session', async () => {
    const bridge = createFrontendSessionBridge();
    await expect(bridge.bridgeAccess.respondSuccess('i1', {})).rejects.toThrow(/not attached yet/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the status when the daemon rejects an answer', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 410 });
    const bridge = createFrontendSessionBridge();
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    await expect(bridge.bridgeAccess.respondError('i1', 'nope')).rejects.toThrow(/answering "i1" failed: 410/);
  });

  it('routes a failed answer to onError rather than leaving an unhandled rejection', async () => {
    const onError = vi.fn();
    fetchMock.mockRejectedValue(new Error('offline'));
    createFrontendSessionBridge({ pageDriver: createDriver(), onError });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'page.click', input: { element: 'save-button' } });
    await flush();
    expect(onError).toHaveBeenCalled();
  });

  it('swallows a failed answer when the host registered no error sink', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    createFrontendSessionBridge({ pageDriver: createDriver() });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'page.click', input: { element: 'save-button' } });
    await expect(flush()).resolves.toBeUndefined();
  });

  it('describes a non-Error throw rather than posting "[object Object]"', async () => {
    createFrontendSessionBridge({ executors: { 'cms.': async () => { throw 'plain string blew up'; } } });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'cms.publish', input: {} });
    await flush();
    expect(postedBodies()[0]).toMatchObject({ ok: false, message: 'plain string blew up' });
  });

  it('swallows a failed refusal post when the host registered no error sink', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    createFrontendSessionBridge({ pageDriver: createDriver() });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'page.click', input: {} });
    await expect(flush()).resolves.toBeUndefined();
  });

  it('reports a driver refusal even when posting that refusal also fails', async () => {
    const onError = vi.fn();
    fetchMock.mockRejectedValue(new Error('offline'));
    createFrontendSessionBridge({ pageDriver: createDriver(), onError });
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'page.click', input: {} });
    await flush();
    expect(onError).toHaveBeenCalled();
  });

  it('drops chat listeners on close, so a stale pane cannot keep receiving actions', async () => {
    const seen: string[] = [];
    const bridge = createFrontendSessionBridge();
    bridge.bridgeAccess.subscribe((action) => seen.push(action.capabilityId));
    FakeEventSource.last?.emit({ type: 'attached', sessionId: 's1', bindToken: 't1' });
    bridge.close();
    FakeEventSource.last?.emit({ type: 'invocation', invocationId: 'i1', capabilityId: 'chat.set_draft', input: {} });
    await flush();
    expect(seen).toEqual([]);
  });
});
