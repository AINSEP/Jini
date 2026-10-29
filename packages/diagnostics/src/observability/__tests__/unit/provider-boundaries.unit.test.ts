import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTelemetryDeliveryMonitor, describeTelemetryFailure } from '../../delivery.js';
import { describeReportedError } from '../../errors.js';
import { combineObservabilityPorts } from '../../fanout.js';
import { createHookObservabilityPort } from '../../hooks.js';
import { createNoopObservabilityPort } from '../../noop.js';
import { createOtelObservabilityPort, errorType } from '../../otel.js';
import { redactedError, reportErrorOnce, runWithErrorReportScope } from '../../report-error.js';
import { createTelemetryTestProbe } from '../../telemetry-test.js';
import { createNoopTracker } from '../../tracker-noop.js';
import { createTracker, createTrackerWarning } from '../../tracker.js';
import type { ObservabilityPort, TraceSpanPort } from '../../ports.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('sanitized delivery failures', () => {
  it.each([null, undefined, false, 17, 'private endpoint'])('reduces primitive %j to a fixed label', error => {
    expect(describeTelemetryFailure({ error })).toEqual({ errorClass: 'Error' });
  });
  it.each([99, 100, 599, 600, 200.5, NaN, Infinity])('bounds HTTP status %s', status => {
    const expected = status === 100 || status === 599 ? { statusCode: status } : {};
    expect(describeTelemetryFailure({ error: { status, name: 'TimeoutError' } })).toEqual({ errorClass: 'TimeoutError', ...expected });
  });
  it('uses fallback status fields without accepting numeric strings or arbitrary names', () => {
    expect(describeTelemetryFailure({ error: { code: 503, name: 123 } })).toEqual({ errorClass: 'Error', statusCode: 503 });
    expect(describeTelemetryFailure({ error: { statusCode: 0, status: 503 } })).toEqual({ errorClass: 'Error' });
    expect(describeTelemetryFailure({ error: { statusCode: null, status: '503', code: 502 } })).toEqual({ errorClass: 'Error' });
  });
  it('returns detached shutdown evidence and omits an unavailable status in warnings', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
    const warn = vi.fn();
    const monitor = createTelemetryDeliveryMonitor({ warn });
    monitor.report({ providerId: 'p', report: { phase: 'shutdown', outcome: 'failed', host: 'collector', errorClass: 'AbortError' } });
    const expected = { providerId: 'p', lastExport: null, lastShutdown: { phase: 'shutdown', outcome: 'failed', host: 'collector', errorClass: 'AbortError', at: '2026-10-29T00:00:00.000Z' } };
    expect(monitor.read({})).toEqual([expected]);
    monitor.read({})[0]!.lastShutdown!.host = 'tampered';
    expect(monitor.read({})).toEqual([expected]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('observability: p shutdown failed (AbortError, host collector)');
  });
});

describe('error text and incident admission', () => {
  it.each([undefined, '', 42])('omits non-text or empty stack %j', stack => {
    const error = new TypeError('failure');
    Object.defineProperty(error, 'stack', { value: stack, configurable: true });
    expect(describeReportedError({ error })).toEqual({ type: 'TypeError', message: 'failure' });
  });
  it.each([{ error: 'failure', expected: { type: 'string', message: 'failure' } },
    { error: null, expected: { type: 'object', message: 'object' } },
    { error: 3, expected: { type: 'number', message: 'number' } }])('describes non-Error $error without inventing a stack', ({ error, expected }) => {
    expect(describeReportedError({ error })).toEqual(expected);
  });
  it('preserves a missing stack when exact-secret redaction requires a copy', () => {
    const error = new RangeError('failure: private-value'); delete error.stack;
    const copy = redactedError({ error }, { exactSecrets: ['private-value'] });
    expect(copy).not.toBe(error);
    expect(copy.name).toBe('RangeError');
    expect(copy.message).toBe('failure: [REDACTED:exact_secret]');
    expect(Object.hasOwn(copy, 'stack')).toBe(false);
    expect(error.message).toBe('failure: private-value');
  });
  it('reuses an outer occurrence only when requested and starts a scope when none exists', () => {
    const reportError = vi.fn();
    const observability = { ...createNoopObservabilityPort({}), reportError };
    const error = new Error('failure');
    const send = () => reportErrorOnce({ observability, error, operation: 'work' });
    const outer = { reported: false }, inner = { reported: false };
    runWithErrorReportScope({ scope: outer, work: () => {
      expect(runWithErrorReportScope({ scope: inner, work: send }, { reuseCurrent: true })).toBe(true);
      expect(outer.reported).toBe(true); expect(inner.reported).toBe(false);
      expect(send()).toBe(false);
      expect(runWithErrorReportScope({ scope: inner, work: send })).toBe(true);
    } });
    const fresh = { reported: false };
    expect(runWithErrorReportScope({ scope: fresh, work: send }, { reuseCurrent: true })).toBe(true);
    expect(fresh.reported).toBe(true); expect(reportError).toHaveBeenCalledTimes(3);
  });
  it('keeps declined async admission retryable and does not deduplicate primitive throws', async () => {
    const reportError = vi.fn().mockResolvedValue(false);
    const observability = { ...createNoopObservabilityPort({}), reportError };
    const scope = { reported: false };
    await runWithErrorReportScope({ scope, work: async () => {
      expect(reportErrorOnce({ observability, error: 'failure', operation: 'work' })).toBe(false);
      await Promise.resolve();
      expect(scope.reported).toBe(false);
      reportError.mockReturnValue(undefined);
      expect(reportErrorOnce({ observability, error: 'failure', operation: 'work' }, { level: 'warning' })).toBe(true);
      expect(reportErrorOnce({ observability, error: 'failure', operation: 'work' })).toBe(true);
      expect(scope.reported).toBe(true);
    } });
    expect(reportError).toHaveBeenCalledTimes(3);
    expect(reportError.mock.calls[1]![0].context).toEqual({ operation: 'work', level: 'warning' });
  });
});

describe('optional provider signals', () => {
  it('delegates every hook signal and clamps a backwards request clock', () => {
    let at = 20;
    const base = createNoopObservabilityPort({});
    const ids = { traceId: 'trace', spanId: 'span' };
    const tracing: ObservabilityPort = { ...base, supportsMetric: true, activeTraceIds: () => ids,
      trackRequest: vi.fn(() => ({ run: <T>(fn: () => T): T => fn(), end: vi.fn() })),
      trackDbQuery: vi.fn(base.trackDbQuery), trackOutboundCall: vi.fn(base.trackOutboundCall),
      trackAgentRun: vi.fn(base.trackAgentRun), trackOperation: vi.fn(base.trackOperation),
      metric: vi.fn(), reportError: vi.fn(() => true) };
    const log = vi.fn();
    const hooks = createHookObservabilityPort({ clock: { nowMs: () => at }, requestIdGenerator: { generate: () => 'id' } }, { tracing, logger: { log } });
    expect(hooks.supportsMetric).toBe(true); expect(hooks.activeTraceIds!()).toBe(ids);
    const request = hooks.trackRequest({ method: 'GET', path: '/' });
    expect(request.run!(() => 7)).toBe(7); at = 10;
    request.end({ statusCode: 200, routePattern: '/' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ requestId: 'id', method: 'GET', durationMs: 0, statusCode: 200, routePattern: '/' });
    const db = { system: 'sqlite' }, outbound = { method: 'GET', url: 'https://collector/' }, agent = { runId: 'run' }, options = { agentName: 'agent' };
    hooks.trackDbQuery(db); hooks.trackOutboundCall(outbound); hooks.trackAgentRun(agent, options);
    expect(tracing.trackDbQuery).toHaveBeenCalledWith(db);
    expect(tracing.trackOutboundCall).toHaveBeenCalledWith(outbound);
    expect(tracing.trackAgentRun).toHaveBeenCalledWith(agent, options);
    const metric = { name: 'work', value: 3 }, metricOptions = { kind: 'counter' as const };
    hooks.metric(metric, metricOptions);
    expect(tracing.metric).toHaveBeenCalledWith(metric, metricOptions);
    const operation = { name: 'work' }, report = { error: new Error('failure'), context: { operation: 'work' } };
    hooks.trackOperation(operation);
    expect(tracing.trackOperation).toHaveBeenCalledWith(operation);
    expect(hooks.reportError(report)).toBe(true);
    expect(tracing.reportError).toHaveBeenCalledWith(report);
    const { activeTraceIds: _activeTraceIds, ...legacySignals } = base;
    const legacy = createHookObservabilityPort({ clock: { nowMs: () => 0 }, requestIdGenerator: { generate: () => 'id' } }, { tracing: legacySignals });
    expect(legacy.activeTraceIds!()).toBeUndefined(); expect(legacy.supportsMetric).toBe(false);
  });
  it('advertises metrics only when a live destination explicitly supports them', () => {
    const base = createNoopObservabilityPort({});
    const { supportsMetric: _supportsMetric, ...legacy } = base;
    expect(combineObservabilityPorts({ ports: [legacy] }).supportsMetric).toBe(false);
    expect(combineObservabilityPorts({ ports: [legacy, { ...base, supportsMetric: true }] }).supportsMetric).toBe(true);
    expect(combineObservabilityPorts({ ports: [base] }).supportsMetric).toBe(false);
  });
  it('noop tracker runs work and accepts outcome updates without manufacturing trace IDs', async () => {
    const tracker = createNoopTracker({});
    expect(tracker.activeTraceIds!()).toBeUndefined();
    const result = { saved: true };
    expect(await tracker.trace({ name: 'work', run: span => { span.setOutcome({ outcome: 'completed', failed: false }); return result; } })).toBe(result);
    const failure = new Error('application failure');
    await expect(tracker.trace({ name: 'work', run: () => { throw failure; } })).rejects.toBe(failure);
  });
  it('warns once through the default sink and preserves request and agent defaults', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const notify = createTrackerWarning({}); notify(); notify();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[tracker] a telemetry provider failed; application work continues');
    const requestEnd = vi.fn(), agentEnd = vi.fn(), requestStart = vi.fn(() => ({ end: requestEnd })), agentStart = vi.fn(() => ({ run: <T>(fn: () => T): T => fn(), end: agentEnd }));
    const tracker = createTracker({ observability: { ...createNoopObservabilityPort({}), trackRequest: requestStart, trackAgentRun: agentStart } });
    expect(tracker.activeTraceIds!()).toBeUndefined();
    await tracker.trace({ name: 'request', run: () => 'ok' }, { request: { method: 'GET', path: '/' } });
    await tracker.trace({ name: 'agent', run: () => 'ok' }, { agent: { runId: 'r' } });
    expect(requestStart).toHaveBeenCalledWith({ method: 'GET', path: '/' }, {});
    expect(requestEnd).toHaveBeenCalledTimes(1);
    expect(requestEnd).toHaveBeenCalledWith({ statusCode: 500, routePattern: 'unmatched' });
    expect(agentStart).toHaveBeenCalledWith({ runId: 'r' }, {});
    expect(agentEnd).toHaveBeenCalledTimes(1);
    expect(agentEnd).toHaveBeenCalledWith({ status: 'succeeded' });
  });
  it('observes discarded rejected provider results while preserving application work', async () => {
    const fault = vi.fn(), end = vi.fn();
    const adapter: ObservabilityPort = { ...createNoopObservabilityPort({}), trackOperation: () => ({
      run: <T>(_work: () => T): T => Promise.reject(new Error('provider')) as T, end,
    }) };
    const port = combineObservabilityPorts({ ports: [adapter] }, { onFailure: fault });
    expect(port.trackOperation({ name: 'work' }).run(() => 7)).toBe(7);
    await Promise.resolve(); expect(fault).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
  });
});

it('probe receipts ignore malformed inputs and incidental signals inside the diagnostic scope', async () => {
  const probe = createTelemetryTestProbe({});
  const tracker = createTracker({ productAnalytics: { identify() {}, capture() {
    for (const input of [null, undefined, 0, '', 'telemetry_test']) probe.accepted({ providerId: 'invalid', method: 'capture', input });
    for (const method of ['reportError', 'trackOperation', 'metric', 'capture', 'identify']) {
      probe.accepted({ providerId: 'incidental', method, input: { name: 'other', context: { operation: 'other' } }, supportsMetric: true });
    }
    probe.accepted({ providerId: 'incidental', method: 'reportError', input: {} });
    const receipt = { providerId: 'analytics', method: 'capture', input: { name: 'telemetry_test' } };
    probe.accepted(receipt); probe.accepted(receipt);
  } } });
  expect(await probe.send({ tracker, error: new Error('diagnostic'), userId: 'user' })).toEqual({ providers: [{ providerId: 'analytics', signals: ['analytics'] }] });
});

it('OTel reports active IDs only when the host supplies them and keeps metrics inert', () => {
  const ids = { traceId: 'trace', spanId: 'span' };
  const span: TraceSpanPort = { ids: () => ids, updateName() {}, setAttribute() {}, setStatus() {}, addEvent() {}, end() {} };
  const startSpan = vi.fn(() => span);
  const deps = { config: { enabled: true as const, serviceName: 's', tracerName: 't', endpoint: 'https://collector/' },
    exporterFactory: { create: () => ({}) }, tracerProviderFactory: { create: () => ({ getTracer: () => ({ startSpan }) }) } };
  const scoped = createOtelObservabilityPort(deps, { scope: { active: () => span, run: ({ fn }) => fn() } });
  expect(scoped.activeTraceIds!()).toBe(ids);
  scoped.metric({ name: 'work', value: 1 }); expect(startSpan).not.toHaveBeenCalled();
  const { ids: _ids, ...legacySpan } = span;
  const legacy = createOtelObservabilityPort(deps, { scope: { active: () => legacySpan, run: ({ fn }) => fn() } });
  expect(legacy.activeTraceIds!()).toBeUndefined();
  const error = new Error('safe'); error.name = '';
  expect(errorType(error)).toBe('Error');
});
