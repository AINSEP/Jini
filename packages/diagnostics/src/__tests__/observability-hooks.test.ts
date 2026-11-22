import { test, expect } from 'vitest';
import { createHookObservabilityPort } from '../observability/index.js';
test('request IDs, structured logs and metrics use injected values and finish once', () => {
 const events: unknown[] = []; let tick = 10;
 const port = createHookObservabilityPort({ clock: { nowMs: () => tick }, requestIdGenerator: { generate: () => 'generated-1' } }, {
  logger: { log: event => events.push(event) }, metrics: { recordRequest: event => events.push(event) },
 });
 const request = port.trackRequest({ method: 'GET', path: '/items/123' });
 expect(request.requestId).toBe('generated-1'); tick = 35;
 request.end({ statusCode: 503, routePattern: '/items/:id' });
 request.end({ statusCode: 200, routePattern: '/items/:id' });
 expect(events).toEqual([
  { requestId: 'generated-1', method: 'GET', routePattern: '/items/:id', statusCode: 503, durationMs: 25 },
  { requestId: 'generated-1', method: 'GET', routePattern: '/items/:id', statusCode: 503, durationMs: 25 },
 ]);
 const supplied = port.trackRequest({ method: 'POST', path: '/items' }, { requestId: 'incoming-2' });
 expect(supplied.requestId).toBe('incoming-2');
});
