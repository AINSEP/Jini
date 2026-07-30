import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSseResponse, DEFAULT_MAX_QUEUED_SSE_MESSAGES } from '../raw-sse.js';

function makeReqRes() {
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    writeHead: vi.fn(),
    write: vi.fn().mockReturnValue(true),
    end: vi.fn(),
  });
  return { req, res };
}

/** A response whose `write` reports backpressure from the Nth call onward, as a stalled client's would. */
function makeBackpressuredRes(stallFrom = 1) {
  let calls = 0;
  const res = Object.assign(new EventEmitter(), {
    writeHead: vi.fn(),
    write: vi.fn((_frame: string) => {
      calls += 1;
      return calls < stallFrom;
    }),
    end: vi.fn(),
  });
  return res;
}

describe('createSseResponse', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes text/event-stream headers immediately', () => {
    const { req, res } = makeReqRes();
    createSseResponse(req as any, res as any);
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
  });

  it('send() writes one JSON-serialized data: event', () => {
    const { req, res } = makeReqRes();
    const connection = createSseResponse(req as any, res as any);
    connection.send({ hello: 'world' });
    expect(res.write).toHaveBeenCalledWith('data: {"hello":"world"}\n\n');
  });

  it('close() ends the response and marks the connection closed', () => {
    const { req, res } = makeReqRes();
    const connection = createSseResponse(req as any, res as any);
    expect(connection.closed).toBe(false);
    connection.close();
    expect(connection.closed).toBe(true);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('close() is idempotent — a second call does nothing further', () => {
    const { req, res } = makeReqRes();
    const connection = createSseResponse(req as any, res as any);
    connection.close();
    connection.close();
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('send() after close() is a no-op', () => {
    const { req, res } = makeReqRes();
    const connection = createSseResponse(req as any, res as any);
    connection.close();
    res.write.mockClear();
    connection.send({ x: 1 });
    expect(res.write).not.toHaveBeenCalled();
  });

  it('the keepalive interval writes a ping comment line at the configured cadence', () => {
    const { req, res } = makeReqRes();
    createSseResponse(req as any, res as any, { keepAliveMs: 1000 });
    res.write.mockClear();
    vi.advanceTimersByTime(1000);
    expect(res.write).toHaveBeenCalledWith(': ping\n\n');
    res.write.mockClear();
    vi.advanceTimersByTime(1000);
    expect(res.write).toHaveBeenCalledWith(': ping\n\n');
  });

  it('the keepalive interval stops writing once the connection is closed', () => {
    const { req, res } = makeReqRes();
    const connection = createSseResponse(req as any, res as any, { keepAliveMs: 1000 });
    connection.close();
    res.write.mockClear();
    vi.advanceTimersByTime(5000);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('defaults keepAliveMs to 15000 when not supplied', () => {
    const { req, res } = makeReqRes();
    createSseResponse(req as any, res as any);
    res.write.mockClear();
    vi.advanceTimersByTime(14_999);
    expect(res.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(res.write).toHaveBeenCalledWith(': ping\n\n');
  });

  it("the client disconnecting (the raw request's 'close' event) closes the connection", () => {
    const { req, res } = makeReqRes();
    const connection = createSseResponse(req as any, res as any);
    (req as EventEmitter).emit('close');
    expect(connection.closed).toBe(true);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose exactly once, whether triggered by an explicit close() or a client disconnect', () => {
    const onClose = vi.fn();
    const { req, res } = makeReqRes();
    const connection = createSseResponse(req as any, res as any, { onClose });
    connection.close();
    (req as EventEmitter).emit('close');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('onClose is optional — closing without one does not throw', () => {
    const { req, res } = makeReqRes();
    const connection = createSseResponse(req as any, res as any);
    expect(() => connection.close()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Backpressure (audit finding 9)
// ---------------------------------------------------------------------------

/**
 * `send` used to ignore `res.write()`'s return value entirely, so a client that stopped reading
 * had its backlog buffered inside Node's socket without bound — an unauthenticated memory-
 * exhaustion DoS for any `createSseResponse` consumer, `run-stream` included. `sse.ts`'s
 * `createSseChannel` already had the bounded, drain-aware state machine; these pin the same
 * properties onto this primitive.
 */
describe('createSseResponse — backpressure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops writing once the socket reports backpressure, queueing instead', () => {
    const req = new EventEmitter();
    const res = makeBackpressuredRes(1);
    const connection = createSseResponse(req as any, res as any);
    res.write.mockClear();

    connection.send({ n: 1 });
    connection.send({ n: 2 });
    connection.send({ n: 3 });

    // The first write is what discovers the stall; nothing after it may reach the socket.
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledWith('data: {"n":1}\n\n');
    expect(connection.closed).toBe(false);
  });

  it("flushes the queue in order once the socket emits 'drain'", () => {
    const req = new EventEmitter();
    const res = makeBackpressuredRes(1);
    const connection = createSseResponse(req as any, res as any);
    connection.send({ n: 1 });
    connection.send({ n: 2 });
    connection.send({ n: 3 });
    res.write.mockClear();
    res.write.mockReturnValue(true);

    res.emit('drain');

    expect(res.write.mock.calls.map((call) => call[0])).toEqual([
      'data: {"n":2}\n\n',
      'data: {"n":3}\n\n',
    ]);
  });

  it('drops the connection rather than queueing without bound past the cap', () => {
    const req = new EventEmitter();
    const res = makeBackpressuredRes(1);
    const onClose = vi.fn();
    const connection = createSseResponse(req as any, res as any, { onClose });

    for (let i = 0; i < DEFAULT_MAX_QUEUED_SSE_MESSAGES + 5; i += 1) connection.send({ i });

    expect(connection.closed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit maxQueuedMessages cap', () => {
    const req = new EventEmitter();
    const res = makeBackpressuredRes(1);
    const connection = createSseResponse(req as any, res as any, { maxQueuedMessages: 3 });

    connection.send({ n: 1 }); // written, discovers the stall
    connection.send({ n: 2 }); // queued 1
    connection.send({ n: 3 }); // queued 2
    connection.send({ n: 4 }); // queued 3
    expect(connection.closed).toBe(false);
    connection.send({ n: 5 }); // would be queued 4 — over the cap
    expect(connection.closed).toBe(true);
  });

  it('does not let the keepalive ping accumulate while the socket is stalled', () => {
    const req = new EventEmitter();
    const res = makeBackpressuredRes(1);
    createSseResponse(req as any, res as any, { keepAliveMs: 1000, maxQueuedMessages: 2 });
    res.write.mockClear();

    // 50 keepalive ticks against a socket that never drains must not become 50 buffered writes.
    vi.advanceTimersByTime(50_000);

    expect(res.write.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Client-disconnect detection over a real socket (audit finding 8)
// ---------------------------------------------------------------------------

/**
 * Finding 8 claimed `req.on('close')` fires as soon as a bodyless SSE `GET` is *received* (rather
 * than when the peer actually disconnects), which would tear every stream down immediately. It does
 * not, on any Node this package supports — `IncomingMessage`'s `'close'` fires when the
 * request/response cycle ends or the connection drops, which is precisely the cleanup signal wanted
 * here. A fake `EventEmitter` request cannot tell the difference, so these two drive a real server
 * over a real socket: one proves the stream survives a live idle client, the other proves the
 * disconnect is still detected. Together they are the regression guard that would catch the bug had
 * it been real.
 */
describe('createSseResponse — client-disconnect detection over a real socket', () => {
  it('keeps the stream open while a bodyless GET client stays connected', async () => {
    const closedEarly = await withLiveSseClient((socket) => {
      // Hold the connection open, reading nothing in particular, and see whether the server tore
      // the stream down on its own.
      socket.write('GET /stream HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n');
    });
    expect(closedEarly).toBe(false);
  });

  it('closes the stream when the client actually disconnects', async () => {
    const closedEarly = await withLiveSseClient((socket) => {
      socket.write('GET /stream HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n');
      socket.once('data', () => socket.destroy());
    });
    expect(closedEarly).toBe(true);
  });
});

/**
 * Runs one real SSE request against a real `http` server and resolves whether the connection
 * observed `onClose` within the observation window. `drive` gets the raw client socket so a test
 * can either hold it open or kill it.
 */
async function withLiveSseClient(drive: (socket: import('node:net').Socket) => void): Promise<boolean> {
  let onCloseFired = false;
  const server = createServer((req, res) => {
    const connection = createSseResponse(req, res, {
      keepAliveMs: 50,
      onClose: () => {
        onCloseFired = true;
      },
    });
    connection.send({ hello: 'world' });
  });

  try {
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const { port } = server.address() as { port: number };
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => undefined);
    await new Promise<void>((resolveConnect) => socket.once('connect', resolveConnect));
    drive(socket);
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    socket.destroy();
    return onCloseFired;
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}
