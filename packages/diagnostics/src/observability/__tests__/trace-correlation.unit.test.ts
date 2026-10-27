import { describe, expect, it } from 'vitest';
import { combineObservabilityPorts } from '../fanout.js';
import { createHookObservabilityPort } from '../hooks.js';
import { createNoopObservabilityPort } from '../noop.js';
import { createTracker } from '../tracker.js';
import type { ErrorReport } from '../ports.js';

const ids = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) };

describe('active trace correlation', () => {
  it('passes the first active provider IDs through hooks and the facade and into error context', () => {
    let active = false;
    const reports: ErrorReport[] = [];
    const noop = createNoopObservabilityPort({});
    const tracing = combineObservabilityPorts({ ports: [
      { ...noop, activeTraceIds() { throw new Error('broken reader'); } },
      { ...noop, activeTraceIds: () => active ? ids : undefined },
      { ...noop, reportError: report => { reports.push(report); } },
    ] });
    const hooked = createHookObservabilityPort({ clock: { nowMs: () => 0 }, requestIdGenerator: { generate: () => 'request' } }, { tracing });
    const tracker = createTracker({ observability: hooked });
    expect(tracker.activeTraceIds?.()).toBeUndefined();
    active = true;
    expect(tracker.activeTraceIds?.()).toEqual(ids);
    tracker.error({ error: new Error('failed') }, { context: { operation: 'site.publish' } });
    expect(reports[0]?.context.trace).toEqual(ids);
    active = false;
    tracker.error({ error: new Error('outside') }, { context: { operation: 'site.publish' } });
    expect(reports[1]?.context.trace).toBeUndefined();
  });

  it('disabled telemetry never invents a trace', () => {
    expect(createTracker({}).activeTraceIds?.()).toBeUndefined();
  });
});
