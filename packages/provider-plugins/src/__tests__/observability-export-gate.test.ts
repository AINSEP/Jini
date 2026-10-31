/** Real SDK and recording transports: runtime eligibility never changes local admission. */
import { expect, test, vi } from 'vitest';
import { NodeClient, createTransport, defaultStackParser } from '@sentry/node';
import { observabilityExportAllowed } from '@jini-ai/diagnostics/observability';
import { reportErrorOnce, runWithErrorReportScope } from '@jini-ai/diagnostics/observability/node';
import { createSentryObservabilityAdapter } from '../observability-sentry/sentry.js';
import { createSentryProvider } from '../observability-sentry/index.js';

const config = { enabled: true as const, dsn: 'https://public@sentry.invalid/1', tracesSampleRate: 1 };
function recorder() {
  const sends: unknown[] = [];
  const transport = (options: Parameters<typeof createTransport>[0]) => createTransport(options, async request => {
    sends.push(request.body);
    return { statusCode: 200 };
  });
  return { sends, transport };
}

test.each([
  ['web checkout / AdminBrowserError', { development: true }, false],
  ['checkout with production labels', { development: true, deployedProduction: true }, false],
  ['unpackaged desktop', { packagedDesktop: false }, false],
  ['packaged desktop and children', { packagedDesktop: true }, true],
  ['deployed production', { deployedProduction: true }, true],
  ['checkout debug override', { development: true, forceEnable: true }, true],
] as const)('%s gates errors, manual test errors, and sampled spans', async (_name, facts, allowed) => {
  const recording = recorder();
  const resource = createSentryProvider({ ...config, environment: 'production' }, {
    transport: recording.transport, exportEnabled: observabilityExportAllowed(facts),
  });
  try {
    const browserError = Object.assign(new Error('browser failure'), { name: 'AdminBrowserError' });
    expect(resource.port.reportError({ error: browserError, context: { operation: 'admin.browser.error' } })).toBeUndefined();
    resource.port.reportError({ error: new Error('manual test'), context: { operation: 'telemetry.test' } });
    resource.port.trackOperation({ name: 'site.publish' }).end({ outcome: 'completed', failed: false });
    expect(Boolean(resource.port.crashUpload)).toBe(allowed);
  } finally { await resource.dispose({}); }
  expect(recording.sends.length > 0).toBe(allowed);
});

test('missing export permission disables the private SDK client without changing admission or request dedup', async () => {
  const recording = recorder();
  const options = vi.spyOn(NodeClient.prototype, 'getOptions');
  const resource = createSentryObservabilityAdapter({ config }, { transport: recording.transport });
  try {
    const scope = { reported: false };
    const error = new Error('same occurrence');
    runWithErrorReportScope({ scope, work() {
      expect(reportErrorOnce({ observability: resource.port, error, operation: 'local' })).toBe(true);
      expect(reportErrorOnce({ observability: resource.port, error, operation: 'local' })).toBe(false);
    } });
    expect(scope.reported).toBe(true);
    expect(options.mock.results.some(result => result.type === 'return' && result.value.enabled === false)).toBe(true);
    expect(resource.port.crashUpload).toBeUndefined();
  } finally { await resource.dispose(); options.mockRestore(); }
  expect(recording.sends).toEqual([]);
});

test('an enabled supplied client cannot bypass a denied gate and remains host-owned', async () => {
  const recording = recorder();
  const client = new NodeClient({ ...config, stackParser: defaultStackParser, integrations: [], enableRuntimeChannelInjection: false, transport: recording.transport });
  const close = vi.spyOn(client, 'close');
  const resource = createSentryObservabilityAdapter({ config }, { client, exportEnabled: false });
  try {
    expect(resource.port.reportError({ error: new Error('blocked'), context: { operation: 'local' } })).toBeUndefined();
    const operation = resource.port.trackOperation({ name: 'blocked' });
    let ran = false;
    operation.run(() => { ran = true; });
    operation.end({ outcome: 'completed', failed: false });
    expect(ran).toBe(true);
    expect(resource.port.crashUpload).toBeUndefined();
    await resource.dispose();
    expect(close).not.toHaveBeenCalled();
    await client.flush(1000);
    expect(recording.sends).toEqual([]);
    expect(client.getOptions().enabled).not.toBe(false);
  } finally { close.mockRestore(); await client.close(1000); }
});

test.each([undefined, false, true])('OTel exportEnabled=%s gates supplied processors and metric readers while retaining local spans', async exportEnabled => {
  const { createOtelObservabilityAdapter } = await import('../observability-opentelemetry/opentelemetry.js');
  const { InMemorySpanExporter, SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
  const { AggregationTemporality, InMemoryMetricExporter, PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics');
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter: metrics, exportIntervalMillis: 60_000 });
  const processor = new SimpleSpanProcessor(spans);
  const resource = createOtelObservabilityAdapter({ config: { enabled: true, serviceName: 'fixture', tracerName: 'fixture', endpoint: 'https://collector.invalid/v1/traces' } }, {
    ...(exportEnabled === undefined ? {} : { exportEnabled }), spanProcessors: [processor], metricReaders: [reader],
  });
  try {
    const op = resource.port.trackOperation({ name: 'local.operation' });
    op.run(() => {
      expect(resource.port.activeTraceIds?.({})?.traceId).toMatch(/^[a-f0-9]{32}$/);
      expect(resource.port.reportError({ error: new Error('failure'), context: { operation: 'local.operation' } })).not.toBe(false);
    });
    op.end({ outcome: 'failed', failed: true });
    expect(spans.getFinishedSpans().length).toBe(exportEnabled === true ? 1 : 0);
    resource.port.metric({ name: 'local.gauge', value: 1 });
    if (exportEnabled === true) await reader.forceFlush();
    expect(metrics.getMetrics().length > 0).toBe(exportEnabled === true);
    expect(resource.port.supportsMetric).toBe(true);
  } finally {
    await resource.dispose();
    if (exportEnabled !== true) { await processor.shutdown(); await reader.shutdown(); }
  }
});


test('saved provider input cannot grant export permission and allowed borrowed clients can still send', async () => {
  const recording = recorder();
  const denied = createSentryProvider({ ...config, exportEnabled: true }, { transport: recording.transport });
  try { denied.port.reportError({ error: new Error('card cannot enable'), context: { operation: 'telemetry.test' } }); }
  finally { await denied.dispose({}); }
  expect(recording.sends).toEqual([]);
  const client = new NodeClient({ ...config, stackParser: defaultStackParser, integrations: [], enableRuntimeChannelInjection: false, transport: recording.transport });
  const allowed = createSentryObservabilityAdapter({ config }, { client, exportEnabled: true });
  try {
    allowed.port.reportError({ error: new Error('allowed'), context: { operation: 'telemetry.test' } });
    await client.flush(1000);
    expect(recording.sends.length).toBe(1);
  } finally { await allowed.dispose(); await client.close(1000); }
});
