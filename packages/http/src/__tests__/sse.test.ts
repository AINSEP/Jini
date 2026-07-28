import type { ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createSseChannel, requestedAfterCursor, DEFAULT_MAX_QUEUED_SSE_EVENTS, type SseEvent } from '../sse.js';

interface TestEvent extends SseEvent {
  readonly payload?: string;
}

function makeRes() {
  const closeListeners: Array<() => void> = [];
  const drainListeners: Array<() => void> = [];
  const res = {
    write: vi.fn((_chunk: string) => true),
    statusCode: 0,
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    end: vi.fn(() => {
      res.writableEnded = true;
    }),
    headersSent: false,
    writableEnded: false,
    on: vi.fn((event: string, listener: () => void) => {
      if (event === 'close') closeListeners.push(listener);
      if (event === 'drain') drainListeners.push(listener);
    }),
    emitClose: () => closeListeners.forEach((listener) => listener()),
    emitDrain: () => drainListeners.forEach((listener) => listener()),
  };
  return res;
}

/** The mock above satisfies the narrow surface `createSseChannel` actually calls (`write`/`status`/`setHeader`/`flushHeaders`/`end`/`on`/`writableEnded`) but not Express's full `Response` type — the same cast `runs.test.ts` avoids only by routing calls through an untyped `any` handler map. */
function asResponse(res: ReturnType<typeof makeRes>): ServerResponse {
  return res as unknown as ServerResponse;
}

const event = (opaqueCursor: string, kind = 'data', payload?: string): TestEvent =>
  payload === undefined ? { opaqueCursor, kind } : { opaqueCursor, kind, payload };

describe('@injini/http — sse — createSseChannel', () => {
  it('buffers enqueued events until open() is called, then flushes them in order', () => {
    const res = makeRes();
    const channel = createSseChannel<TestEvent>(asResponse(res));
    channel.enqueue(event('1'));
    channel.enqueue(event('2'));
    expect(res.write).not.toHaveBeenCalled();

    channel.open();

    expect(res.statusCode).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.flushHeaders).toHaveBeenCalledOnce();
    expect(res.write).toHaveBeenCalledTimes(2);
    expect(res.write).toHaveBeenNthCalledWith(1, 'id: 1\nevent: data\ndata: {"opaqueCursor":"1","kind":"data"}\n\n');
    expect(res.write).toHaveBeenNthCalledWith(2, 'id: 2\nevent: data\ndata: {"opaqueCursor":"2","kind":"data"}\n\n');
  });

  it('writes events live once already open', () => {
    const res = makeRes();
    const channel = createSseChannel<TestEvent>(asResponse(res));
    channel.open();
    channel.enqueue(event('1'));
    expect(res.write).toHaveBeenCalledTimes(1);
  });

  it('open() is idempotent', () => {
    const res = makeRes();
    const channel = createSseChannel<TestEvent>(asResponse(res));
    channel.open();
    channel.open();
    expect(res.statusCode).toBe(200);
    expect(res.flushHeaders).toHaveBeenCalledOnce();
  });

  it('a custom formatEvent overrides the default wire format', () => {
    const res = makeRes();
    const channel = createSseChannel<TestEvent>(asResponse(res), { formatEvent: (e) => `custom:${e.opaqueCursor}\n\n` });
    channel.open();
    channel.enqueue(event('42'));
    expect(res.write).toHaveBeenCalledWith('custom:42\n\n');
  });

  describe('backpressure', () => {
    it('stops draining once res.write reports backpressure, and resumes on drain', () => {
      const res = makeRes();
      res.write.mockReturnValueOnce(false); // first write reports backpressure
      const channel = createSseChannel<TestEvent>(asResponse(res));
      channel.open();
      channel.enqueue(event('1'));
      channel.enqueue(event('2'));
      // Only the first event was written; the second is queued behind backpressure.
      expect(res.write).toHaveBeenCalledTimes(1);

      res.emitDrain();
      expect(res.write).toHaveBeenCalledTimes(2);
    });
  });

  describe('overflow (SEC-006)', () => {
    it('ends the channel once the queue exceeds maxQueuedEvents, without writing the excess', () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res), { maxQueuedEvents: 2 });
      // Never opened — events accumulate unbounded-queue-guarded even pre-header.
      channel.enqueue(event('1'));
      channel.enqueue(event('2'));
      expect(channel.isClosed()).toBe(false);
      channel.enqueue(event('3'));
      expect(channel.isClosed()).toBe(true);
      expect(res.end).toHaveBeenCalledOnce();
    });

    it('defaults maxQueuedEvents to 1000', () => {
      expect(DEFAULT_MAX_QUEUED_SSE_EVENTS).toBe(1000);
    });

    it('a further enqueue after closed-by-overflow is a silent no-op', () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res), { maxQueuedEvents: 1 });
      channel.enqueue(event('1'));
      channel.enqueue(event('2')); // overflow, closes
      res.end.mockClear();
      channel.enqueue(event('3'));
      expect(res.end).not.toHaveBeenCalled();
    });
  });

  describe('isEndEvent auto-close', () => {
    it('ends the channel immediately after writing an event isEndEvent flags, without draining events queued behind it', () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res), { isEndEvent: (e) => e.kind === 'end' });
      channel.open();
      channel.enqueue(event('1', 'end'));
      channel.enqueue(event('2', 'data'));
      expect(res.write).toHaveBeenCalledTimes(1);
      expect(res.end).toHaveBeenCalledOnce();
      expect(channel.isClosed()).toBe(true);
    });

    it('never auto-closes when isEndEvent is omitted', () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res));
      channel.open();
      channel.enqueue(event('1', 'end'));
      expect(channel.isClosed()).toBe(false);
    });
  });

  describe('write failures', () => {
    it('ends the channel and calls onWriteError when res.write throws', () => {
      const res = makeRes();
      const boom = new Error('socket hang up');
      res.write.mockImplementationOnce(() => {
        throw boom;
      });
      const onWriteError = vi.fn();
      const channel = createSseChannel<TestEvent>(asResponse(res), { onWriteError });
      channel.open();
      channel.enqueue(event('1'));
      expect(onWriteError).toHaveBeenCalledWith(boom);
      expect(channel.isClosed()).toBe(true);
      expect(res.end).toHaveBeenCalledOnce();
    });

    it('a write failure is silent (no throw back to the caller) when onWriteError is omitted', () => {
      const res = makeRes();
      res.write.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      const channel = createSseChannel<TestEvent>(asResponse(res));
      channel.open();
      expect(() => channel.enqueue(event('1'))).not.toThrow();
    });
  });

  describe('client disconnect', () => {
    it("res's own 'close' event marks the channel closed without calling res.end()", () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res));
      res.emitClose();
      expect(channel.isClosed()).toBe(true);
      expect(res.end).not.toHaveBeenCalled();
    });

    it('is observable via isClosed() before open() was ever called (e.g. disconnect during an async subscribe)', () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res));
      expect(channel.isClosed()).toBe(false);
      res.emitClose();
      expect(channel.isClosed()).toBe(true);
    });
  });

  describe('abandon()', () => {
    it('marks the channel closed and runs onClose callbacks, without touching res at all', () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res));
      const onClose = vi.fn();
      channel.onClose(onClose);
      channel.abandon();
      expect(channel.isClosed()).toBe(true);
      expect(onClose).toHaveBeenCalledOnce();
      expect(res.end).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(0);
    });

    it('is idempotent, matching end()', () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res));
      const onClose = vi.fn();
      channel.onClose(onClose);
      channel.abandon();
      channel.abandon();
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('leaves res untouched even if the channel was already opened (a caller choosing to abandon after open is still safe, just unusual)', () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res));
      channel.open();
      channel.abandon();
      expect(res.end).not.toHaveBeenCalled();
      expect(channel.isClosed()).toBe(true);
    });
  });

  describe('end()', () => {
    it('is idempotent and safe to call multiple times', () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res));
      channel.open();
      channel.end();
      channel.end();
      expect(res.end).toHaveBeenCalledOnce();
    });

    it('does not call res.end() a second time if the response already ended itself', () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res));
      channel.open();
      res.writableEnded = true;
      channel.end();
      expect(res.end).not.toHaveBeenCalled();
      expect(channel.isClosed()).toBe(true);
    });
  });

  describe('onClose', () => {
    it('invokes every registered callback exactly once when the channel closes', () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res));
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      channel.onClose(cb1);
      channel.onClose(cb2);
      channel.end();
      channel.end();
      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });

    it('invokes a callback registered after the channel already closed immediately, synchronously', () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res));
      channel.end();
      const cb = vi.fn();
      channel.onClose(cb);
      expect(cb).toHaveBeenCalledOnce();
    });

    it('a callback that calls onClose again during the close sweep is not invoked twice and does not corrupt the sweep', () => {
      const res = makeRes();
      const channel = createSseChannel<TestEvent>(asResponse(res));
      const late = vi.fn();
      const reentrant = vi.fn(() => channel.onClose(late));
      channel.onClose(reentrant);
      channel.end();
      expect(reentrant).toHaveBeenCalledOnce();
      expect(late).toHaveBeenCalledOnce();
    });
  });
});

describe('@injini/http — sse — requestedAfterCursor', () => {
  it('prefers the Last-Event-ID header over the afterCursor query parameter', () => {
    const req = { get: (name: string) => (name === 'last-event-id' ? 'cursor-header' : undefined), query: { afterCursor: 'cursor-query' } };
    expect(requestedAfterCursor(req)).toBe('cursor-header');
  });

  it('falls back to the afterCursor query parameter when the header is absent', () => {
    const req = { get: () => undefined, query: { afterCursor: 'cursor-query' } };
    expect(requestedAfterCursor(req)).toBe('cursor-query');
  });

  it('returns null when neither is present', () => {
    const req = { get: () => undefined, query: {} };
    expect(requestedAfterCursor(req)).toBeNull();
  });

  it('ignores an empty-string header, falling back to the query parameter', () => {
    const req = { get: () => '', query: { afterCursor: 'cursor-query' } };
    expect(requestedAfterCursor(req)).toBe('cursor-query');
  });

  it('ignores a non-string or empty-string afterCursor query value', () => {
    expect(requestedAfterCursor({ get: () => undefined, query: { afterCursor: 42 } })).toBeNull();
    expect(requestedAfterCursor({ get: () => undefined, query: { afterCursor: '' } })).toBeNull();
  });
});
