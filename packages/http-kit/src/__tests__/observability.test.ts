import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import { applyRequestTracking, createRequestTrackingMiddleware, logCompletedRequest } from '../observability.js';

describe('request completion logging', () => {
  const completion = { requestId: 'req-1', method: 'GET', routePattern: '/admin/*', statusCode: 200, durationMs: 10 };

  it.each([200, 304, 400, 404, 499, 500, 503, 599])('keeps %i responses quiet by default, including slow requests', statusCode => {
    const info = vi.fn();
    logCompletedRequest({ ...completion, statusCode, durationMs: 60_000 }, { logger: { info } });
    expect(info).not.toHaveBeenCalled();
  });

  it('logs explicitly enabled slow requests and preserves exact duration in the sink', () => {
    const info = vi.fn();
    const fields = { ...completion, durationMs: 1000.25 };
    logCompletedRequest(fields, { logger: { info }, slowRequestMs: 1000 });
    expect(info.mock.calls).toEqual([[{ message: 'http 200 GET /admin/* 1000ms req=req-1' }, { meta: fields }]]);
  });

  it('uses the configured threshold, including zero', () => {
    const info = vi.fn();
    logCompletedRequest(completion, { logger: { info }, slowRequestMs: 10 });
    expect(info).not.toHaveBeenCalled();
    logCompletedRequest(completion, { logger: { info }, slowRequestMs: 9 });
    logCompletedRequest(completion, { logger: { info }, slowRequestMs: 0 });
    expect(info.mock.calls).toEqual(Array(2).fill([{ message: 'http 200 GET /admin/* 10ms req=req-1' }, { meta: completion }]));
  });

  it.each([NaN, Infinity, -1])('keeps slow logging disabled for invalid threshold %s', slowRequestMs => {
    const info = vi.fn();
    logCompletedRequest(completion, { logger: { info }, slowRequestMs });
    expect(info).not.toHaveBeenCalled();
    const fields = { ...completion, durationMs: 1001 };
    logCompletedRequest(fields, { logger: { info }, slowRequestMs });
    expect(info).not.toHaveBeenCalled();
  });

  it('allows full logging for a fast cached response', () => {
    const info = vi.fn();
    const fields = { ...completion, statusCode: 304 };
    logCompletedRequest(fields, { logger: { info }, logRequests: true });
    expect(info.mock.calls).toEqual([[{ message: 'http 304 GET /admin/* 10ms req=req-1' }, { meta: fields }]]);
  });

  it('keeps the default console adapter silent without options', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      logCompletedRequest({ ...completion, statusCode: 500, durationMs: 60_000 });
      expect(info).not.toHaveBeenCalled();
    } finally { info.mockRestore(); }
  });

  it('prints only one string through the default console adapter', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      logCompletedRequest({ ...completion, statusCode: 500, durationMs: 1234 }, { logRequests: true, slowRequestMs: 0 });
      expect(info.mock.calls).toEqual([['http 500 GET /admin/* 1234ms req=req-1']]);
    } finally { info.mockRestore(); }
  });
});

describe('request tracking Express adapter', () => {
  it('reads the resolved router pattern on finish and keeps concurrent outcomes independent', () => {
    const endA = vi.fn(); const endB = vi.fn();
    const trackRequest = vi.fn().mockReturnValueOnce({ end: endA }).mockReturnValueOnce({ end: endB });
    const middleware = createRequestTrackingMiddleware({ observability: { trackRequest } });
    const reqA = { method: 'GET', path: '/api/items/one', baseUrl: '/api', route: undefined as { path: string } | undefined };
    const reqB = { method: 'POST', path: '/unknown', baseUrl: '' };
    const resA = Object.assign(new EventEmitter(), { statusCode: 200 });
    const resB = Object.assign(new EventEmitter(), { statusCode: 404 });
    const next = vi.fn(); middleware(reqA as never, resA as never, next); middleware(reqB as never, resB as never, next);
    expect(trackRequest.mock.calls).toEqual([[{ method: 'GET', path: '/api/items/one' }], [{ method: 'POST', path: '/unknown' }]]);
    reqA.route = { path: '/items/:id' }; resA.statusCode = 500;
    resB.emit('finish'); resA.emit('finish'); resA.emit('finish');
    expect(endA.mock.calls).toEqual([[{ statusCode: 500, routePattern: '/api/items/:id' }]]);
    expect(endB.mock.calls).toEqual([[{ statusCode: 404, routePattern: 'unmatched' }]]);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('mounts tracking before routing', () => {
    const app = { use: vi.fn() };
    applyRequestTracking({ app: app as never, observability: { trackRequest: () => ({ end: () => {} }) } });
    expect(app.use).toHaveBeenCalledWith(expect.any(Function));
  });

  // Generalized from the host's real-router characterization: requires listening sockets.
  it('records the actual Express router pattern after a matched request', async () => {
    const end = vi.fn(); const app = express();
    applyRequestTracking({ app, observability: { trackRequest: () => ({ end }) } });
    const router = express.Router(); router.get('/items/:id', (_req, res) => res.status(200).send('ok')); app.use('/api', router);
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once('listening', resolve));
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('expected TCP address');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/items/one`); await response.text();
      expect(response.status).toBe(200); expect(end).toHaveBeenCalledWith({ statusCode: 200, routePattern: '/api/items/:id' });
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
