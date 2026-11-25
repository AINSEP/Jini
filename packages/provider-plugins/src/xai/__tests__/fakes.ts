/** @file Test host for the xAI route list: a recording reporter, a settable origin policy, and an in-memory server. Not published. */
import type { ReportRouteInternalError, RouteHostContext, SameOriginPolicyPort } from '@jini-ai/core/contracts/server';
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
  { originPolicy, onInternalError, jsonBodyMaxBytes = 1024 * 1024 }: { readonly originPolicy?: SameOriginPolicyPort; readonly onInternalError?: RouteHostContext['onInternalError']; readonly jsonBodyMaxBytes?: number } = {},
): FakeXaiRouteHost {
  const reports: Array<FakeXaiRouteHost['reports'][number]> = [];
  const reportInternalError: ReportRouteInternalError = ({ report, logSource, message }, optional = {}) => {
    const requestId = `req-${reports.length + 1}`;
    reports.push({ report, logSource, message, requestId });
    optional.onInternalError?.({ ...report, correlationId: requestId, logSource });
    return { code: 'INTERNAL_ERROR', message, requestId };
  };
  return {
    context: createTestRouteHost({}, { ...(originPolicy ? { originPolicy } : {}), ...(onInternalError ? { onInternalError } : {}) }),
    reportInternalError,
    jsonBodyMaxBytes,
    reports,
  };
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
