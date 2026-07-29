import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSseResponse } from '../raw-sse.js';

function makeReqRes() {
  const req = new EventEmitter();
  const res = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() };
  return { req, res };
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
