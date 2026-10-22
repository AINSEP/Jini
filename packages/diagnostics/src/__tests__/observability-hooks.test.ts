import { test, expect } from 'vitest';
import { createHookObservabilityPort, createObservabilityPort } from '../observability/index.js';
test('disabled config never constructs exporters or tracing providers', () => {
 const factory = { create: () => { throw new Error('must be lazy'); } };
 const port = createObservabilityPort({ config: { enabled: false }, exporterFactory: factory, tracerProviderFactory: factory });
 expect(() => port.trackRequest({ method: 'GET', path: '/missing' }).end({ statusCode: 404, routePattern: 'unmatched' })).not.toThrow();
});
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
test('enabled config builds the tracing adapter and hands it the host scope', () => {
 const active: unknown[] = [];
 const span = { updateName() {}, setAttribute() {}, setStatus() {}, addEvent() {}, end() {} };
 const port = createObservabilityPort({ config: { enabled: true, serviceName: 's', tracerName: 't', endpoint: 'http://c/v1/traces' },
  exporterFactory: { create: () => ({}) },
  tracerProviderFactory: { create: () => ({ getTracer: () => ({ startSpan: () => span }) }) } },
  { scope: { active: () => undefined, run: ({ span: scoped, fn }) => { active.push(scoped); return fn(); } } });
 expect(port.trackRequest({ method: 'GET', path: '/' }).run!(() => 1)).toBe(1);
 expect(active).toEqual([span]);
});
