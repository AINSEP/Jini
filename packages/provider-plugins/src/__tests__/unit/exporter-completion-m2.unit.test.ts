import { expect, test, vi } from 'vitest';
import { createReportingExporter } from '../../observability-opentelemetry/opentelemetry.js';

test('an exception from the consumer after export completion is not recast as a second export failure', () => {
  const reporter = { initialized: vi.fn(), result: vi.fn() };
  const forceFlush = vi.fn(async () => {});
  const shutdown = vi.fn(async () => {});
  const exporter = createReportingExporter({ reporter, exporter: {
    export(_signal: string, done) { done({ code: 0 }); }, forceFlush, shutdown,
  } });
  const failure = new Error('consumer failed');
  const callback = vi.fn(() => { throw failure; });
  expect(() => exporter.export('payload', callback)).toThrow(failure);
  expect(callback).toHaveBeenCalledExactlyOnceWith({ code: 0 });
  expect(reporter.result).toHaveBeenCalledExactlyOnceWith({ phase: 'export', outcome: 'ok', error: undefined });
});

test('a synchronous exporter failure is sanitized and flush/shutdown retain the borrowed exporter', async () => {
  const cause = new Error('private exporter details');
  const reporter = { initialized: vi.fn(), result: vi.fn() };
  const forceFlush = vi.fn(async () => {});
  const shutdown = vi.fn(async () => {});
  const exporter = createReportingExporter({ reporter, exporter: {
    export() { throw cause; }, forceFlush, shutdown,
  } });
  const callback = vi.fn();
  exporter.export([], callback);
  expect(callback).toHaveBeenCalledExactlyOnceWith({ code: 1, error: new Error('OpenTelemetry export failed') });
  expect(reporter.result).toHaveBeenCalledExactlyOnceWith({ phase: 'export', outcome: 'failed', error: cause });
  await exporter.forceFlush();
  await exporter.shutdown();
  expect(forceFlush).toHaveBeenCalledOnce();
  expect(shutdown).toHaveBeenCalledOnce();
});
