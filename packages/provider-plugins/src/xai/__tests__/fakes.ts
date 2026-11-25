/** @file Test host for the xAI route list: a recording reporter, a settable origin policy, and an in-memory server. Not published. */
import type { ReportRouteInternalError, SameOriginPolicyPort } from '@jini-ai/core/contracts/server';
import { createInMemoryServer, createTestRouteHost } from '@jini-ai/core/contracts/server/testing';
import type { ServerRoute } from '@jini-ai/core/contracts/server';
import type { XaiRouteHost } from '../routes.js';

export interface FakeXaiRouteHost extends XaiRouteHost {
  /** Every internal error the routes reported, oldest first. */
  readonly reports: readonly { readonly report: { readonly error: unknown }; readonly logSource: string; readonly message: string; readonly requestId: string }[];
}

/**
 * @param optional.originPolicy - Who counts as same-origin; everyone by default.
 * @param optional.jsonBodyMaxBytes - The host's body limit; 1 MiB by default.
 */
export function fakeXaiRouteHost(
  _required: Record<string, never> = {},
  { originPolicy, recordIncident, jsonBodyMaxBytes = 1024 * 1024 }: { readonly originPolicy?: SameOriginPolicyPort; readonly recordIncident?: (incident: never) => void; readonly jsonBodyMaxBytes?: number } = {},
): FakeXaiRouteHost {
  const reports: Array<FakeXaiRouteHost['reports'][number]> = [];
  const reportInternalError: ReportRouteInternalError = ({ report, logSource, message }) => {
    const requestId = `req-${reports.length + 1}`;
    reports.push({ report, logSource, message, requestId });
    // The host's one reporter owns the incident; a test that injected one reads what it recorded.
    recordIncident?.({ ...report, correlationId: requestId, logSource } as never);
    return { code: 'INTERNAL_ERROR', message, requestId };
  };
  return {
    context: createTestRouteHost({}, { ...(originPolicy ? { originPolicy } : {}) }),
    reportInternalError,
    jsonBodyMaxBytes,
    reports,
  };
}

const recordingHosts = new WeakMap<ReportRouteInternalError, FakeXaiRouteHost>();

/** A reporter a test injects through deps; each incident goes to `record`, as the host's one reporter would see it. */
export function injectedRecordingReporter({ record }: { readonly record: (incident: never) => void }, _optional: Record<string, never> = {}): ReportRouteInternalError {
  const host = fakeXaiRouteHost({}, { recordIncident: record });
  recordingHosts.set(host.reportInternalError, host);
  return host.reportInternalError;
}

/** The host a served test mounts: a reporter made by {@link injectedRecordingReporter} in `deps` stands in for the host's (a real host injects its one reporter). */
export function withInjectedReporter<H extends FakeXaiRouteHost>({ host, deps }: { readonly host: H; readonly deps: object }, _optional: Record<string, never> = {}): H {
  const injected = (deps as { readonly reportInternalError?: ReportRouteInternalError }).reportInternalError;
  const recording = injected === undefined ? undefined : recordingHosts.get(injected);
  return recording === undefined ? host : { ...host, reportInternalError: recording.reportInternalError, reports: recording.reports };
}

/** Mounts `routes` on an in-memory server and returns its `fetch`. */
export function serveRoutes({ routes }: { readonly routes: readonly ServerRoute[] }, _optional: Record<string, never> = {}): ReturnType<typeof createInMemoryServer>['fetch'] {
  const { server, fetch } = createInMemoryServer();
  for (const route of routes) server.route(route);
  return fetch;
}

/** A JSON request to `http://local<path>`. */
export function jsonRequest({ path, method = 'GET' }: { readonly path: string; readonly method?: string }, { body }: { readonly body?: unknown } = {}): Request {
  const init: RequestInit = { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) };
  return new Request(`http://local${path}`, init);
}
