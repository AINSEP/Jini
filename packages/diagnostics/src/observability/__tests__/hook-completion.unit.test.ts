import { expect, it } from 'vitest';
import { createHookObservabilityPort } from '../hooks.js';
import type { RequestObservation } from '../ports.js';

it('records the first completion once with the supplied request ID when no tracing sink is configured', () => {
  let at = 7;
  let generated = 0;
  const events: RequestObservation[] = [];
  const work: string[] = [];
  const observer = createHookObservabilityPort({
    clock: { nowMs: () => at },
    requestIdGenerator: { generate: () => { generated += 1; return 'generated'; } },
  }, { metrics: { recordRequest: event => { events.push(event); } } });
  const request = observer.trackRequest({ method: 'PATCH', path: '/drafts/9' }, { requestId: 'incoming-29' });
  expect(request.run?.(() => { work.push('patched'); return 'saved'; })).toBe('saved');
  at = 28;
  request.end({ statusCode: 202, routePattern: '/drafts/:id' });
  at = 100;
  request.end({ statusCode: 503, routePattern: 'unmatched' });
  expect(work).toEqual(['patched']);
  expect(generated).toBe(0);
  expect(events).toEqual([{ requestId: 'incoming-29', method: 'PATCH', routePattern: '/drafts/:id', statusCode: 202, durationMs: 21 }]);
});
