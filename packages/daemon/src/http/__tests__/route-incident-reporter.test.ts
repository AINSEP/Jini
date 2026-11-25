/**
 * @file A route incident goes through the injected `reportInternalError` port and nothing else: one
 * call, no legacy `onInternalError` sink handed along in its second argument, and the answer carries
 * the request ID that port returned. The retired route option is passed in by cast to prove a host
 * that still sets it is not consulted.
 */
import type { ReportRouteInternalError } from '@jini-ai/core/contracts/server';
import { expect, it, vi } from 'vitest';
import { createInMemoryEventLog, createRunLifecycle } from '../../index.js';
import { attachmentLookupRoutes } from '../attachment-lookup-routes.js';
import { createResearchSearchRoute } from '../research.js';
import { runStartRoute } from '../runs.js';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';

interface ReporterCall { readonly required: { readonly report: { readonly error: unknown }; readonly logSource: string; readonly message: string }; readonly optional: unknown }

/** A reporter port that records exactly what each route handed it, and answers with a fixed request ID. */
function recordingReporter(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): { readonly reportInternalError: ReportRouteInternalError; readonly calls: ReporterCall[] } {
  const calls: ReporterCall[] = [];
  const reportInternalError: ReportRouteInternalError = (required, ...rest) => {
    calls.push({ required, optional: rest[0] });
    return { code: 'INTERNAL_ERROR', message: required.message, requestId: `injected-${calls.length}` };
  };
  return { reportInternalError, calls };
}

/** The second argument a route passed carries no legacy sink. */
function expectNoLegacySink({ call }: { readonly call: ReporterCall | undefined }): void {
  expect(call).toBeDefined();
  expect((call!.optional as { onInternalError?: unknown } | undefined)?.onInternalError).toBeUndefined();
}

const legacySink = vi.fn();
const retiredSink = { onInternalError: legacySink } as unknown as Record<string, never>;

it('run start: one injected report, no legacy sink, the injected request ID in the answer', async () => {
  const reporter = recordingReporter();
  const failure = new Error('private startup');
  const deps = { ...retiredSink, reportInternalError: reporter.reportInternalError, lifecycle: createRunLifecycle({ eventLog: createInMemoryEventLog({}) }), onStarted: () => { throw failure; } };
  const result = await runStartRoute.handle({ input: { contextRef: 'ctx-incident' }, deps });
  expect(reporter.calls).toHaveLength(1);
  expectNoLegacySink({ call: reporter.calls[0] });
  expect(reporter.calls[0]!.required.report.error).toBe(failure);
  expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', requestId: 'injected-1' } });
  expect(legacySink).not.toHaveBeenCalled();
});

it('research: one injected report, no legacy sink, the injected request ID in the answer', async () => {
  const reporter = recordingReporter();
  const failure = new Error('upstream down');
  const route = createResearchSearchRoute({ provider: { id: 'host-research', search: async () => { throw failure; } } });
  const deps = { ...retiredSink, reportInternalError: reporter.reportInternalError, baseUrlGuard: { validate: () => ({ ok: true }) } as never, resolveCredentials: async () => ({ apiKey: 'k' }) };
  const result = await route.handle({ input: { query: 'q' }, deps });
  expect(reporter.calls).toHaveLength(1);
  expectNoLegacySink({ call: reporter.calls[0] });
  expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', requestId: 'injected-1' } });
  expect(legacySink).not.toHaveBeenCalled();
});

it('attachment lookup: one host report, no legacy sink, the host request ID in the answer', async () => {
  const reporter = recordingReporter();
  const host = { ...fakeDaemonRouteHost(), reportInternalError: reporter.reportInternalError };
  const store = { resolveForRun: async () => { throw new Error('store down'); }, listPendingForOwner: async () => [] };
  const fetch = serveRoutes({ routes: attachmentLookupRoutes({ store, host }, retiredSink) });
  const response = await fetch(jsonRequest({ path: '/internal/attachment-lookup', method: 'POST' }, { body: { op: 'resolveForRun', ref: 'r', runId: 'run-1' } }));
  expect(response.status).toBe(500);
  expect(reporter.calls).toHaveLength(1);
  expectNoLegacySink({ call: reporter.calls[0] });
  expect(((await response.json()) as { error: { requestId: string } }).error.requestId).toBe('injected-1');
  expect(legacySink).not.toHaveBeenCalled();
});
