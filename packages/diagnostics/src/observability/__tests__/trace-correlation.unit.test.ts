import { describe, expect, it } from 'vitest';
import { combineObservabilityPorts } from '../fanout.js';
import { createHookObservabilityPort } from '../hooks.js';
import { createNoopObservabilityPort } from '@jini-ai/core/contracts/observability';
import { createTracker } from '../tracker.js';
import type { ErrorReport } from '@jini-ai/core/contracts/observability';
import { createAsyncLocalSpanScope } from '../node.js';
import type { TraceSpanPort } from '../ports.js';

const ids = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) };
const traceparent = `00-${ids.traceId}-${ids.spanId}-01`;

it('uses the first operation tracker that supplies trace IDs, or none when all decline', () => {
  const noop = createNoopObservabilityPort({});
  const later = { traceId: 'c'.repeat(32), spanId: 'd'.repeat(16) };
  const destination = (trace: typeof ids | undefined) => ({
    ...noop,
    trackOperation: (input: Parameters<typeof noop.trackOperation>[0]) =>
      ({ ...noop.trackOperation(input), traceIds: () => trace }),
  });
  const request = { name: 'workspace.publish' };
  const blank = destination(undefined);
  expect(combineObservabilityPorts({ ports: [blank, destination(ids), destination(later)] })
    .trackOperation(request).traceIds?.()).toEqual(ids);
  expect(combineObservabilityPorts({ ports: [blank, blank] }).trackOperation(request).traceIds?.()).toBeUndefined();
});

it('isolates overlapping Node request spans and restores the outer span after a nested scope', async () => {
  const makeSpan = (): TraceSpanPort => ({
    updateName() {}, setAttribute() {}, setStatus() {}, addEvent() {}, end() {},
  });
  const scope = createAsyncLocalSpanScope({});
  const outer = makeSpan(), nested = makeSpan(), concurrent = makeSpan();
  let resume!: () => void;
  const suspended = new Promise<void>(resolve => { resume = resolve; });
  const first = scope.run({ span: outer, fn: async () => {
    await suspended;
    expect(scope.active()).toBe(outer);
    await scope.run({ span: nested, fn: async () => {
      await Promise.resolve();
      expect(scope.active()).toBe(nested);
    } });
    expect(scope.active()).toBe(outer);
  } });
  try {
    expect(scope.active()).toBeUndefined();
    await scope.run({ span: concurrent, fn: async () => {
      await Promise.resolve();
      expect(scope.active()).toBe(concurrent);
    } });
  } finally {
    resume();
    await first;
  }
  expect(scope.active()).toBeUndefined();
});

describe('active trace correlation', () => {
  it('passes the first active provider IDs through hooks and the facade and into error context', () => {
    let active = false;
    const reports: ErrorReport[] = [];
    const noop = createNoopObservabilityPort({});
    const tracing = combineObservabilityPorts({ ports: [
      { ...noop, activeTraceIds() { throw new Error('broken reader'); }, activeTraceparent() { throw new Error('broken reader'); } },
      { ...noop, activeTraceIds: () => active ? ids : undefined, activeTraceparent: () => active ? traceparent : undefined },
      { ...noop, reportError: report => { reports.push(report); } },
    ] });
    const hooked = createHookObservabilityPort({ clock: { nowMs: () => 0 }, requestIdGenerator: { generate: () => 'request' } }, { tracing });
    const tracker = createTracker({ observability: hooked });
    expect(tracker.activeTraceIds?.()).toBeUndefined();
    expect(hooked.activeTraceparent?.()).toBeUndefined();
    active = true;
    expect(tracker.activeTraceIds?.()).toEqual(ids);
    expect(hooked.activeTraceparent?.()).toBe(traceparent);
    tracker.error({ error: new Error('failed') }, { context: { operation: 'site.publish' } });
    expect(reports[0]?.context.trace).toEqual(ids);
    active = false;
    expect(hooked.activeTraceparent?.()).toBeUndefined();
    tracker.error({ error: new Error('outside') }, { context: { operation: 'site.publish' } });
    expect(reports[1]?.context.trace).toBeUndefined();
  });

  it('disabled telemetry never invents a trace', () => {
    expect(createTracker({}).activeTraceIds?.()).toBeUndefined();
    expect(createNoopObservabilityPort({}).activeTraceparent?.()).toBeUndefined();
    const hooked = createHookObservabilityPort({ clock: { nowMs: () => 0 }, requestIdGenerator: { generate: () => 'request' } });
    expect(hooked.activeTraceparent?.()).toBeUndefined();
  });
});
