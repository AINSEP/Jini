/**
 * @file Mounts route lists on an Express app through the Node bridge the way a host does, for tests that
 * need a real socket (header flush, raw upload bytes, a body parser above). Not published.
 */
import type { Express } from 'express';
import type { RouteHostContext, ServerRoute } from '@jini-ai/core/contracts/server';
import { reportRouteInternalError } from '@jini-ai/http-kit';
import { createNodeDispatcher, maxReserializedJsonBytes } from '@jini-ai/http-kit/node-bridge';
import { attachmentCleanupRoutes, attachmentUploadRoutes } from '../../attachment-routes.js';
import type { AttachmentsHttpDeps } from '../../attachments.js';
import type { DaemonRouteHost } from '../../route-host.js';
import { fakeDaemonRouteHost } from './route-host.js';

/** The host a route list is given: the test's origin context, the real reporter, and the body limit a host derives from a 100 KB parser. */
export function testRouteHost({ context }: { readonly context: RouteHostContext }, _optional: Record<string, never> = {}): DaemonRouteHost {
  return { ...fakeDaemonRouteHost(), context, reportInternalError: reportRouteInternalError, jsonBodyMaxBytes: maxReserializedJsonBytes({ parserLimitBytes: 102_400 }) };
}

/**
 * One layer on `app` serving `routes`. `rawBody` mounts without the parsed body a parser above produced, so a
 * route sees the untouched stream, or no body when a parser already consumed it.
 */
export function mountRoutes({ app, routes }: { readonly app: Pick<Express, 'use'>; readonly routes: readonly ServerRoute[] }, { rawBody = false }: { readonly rawBody?: boolean } = {}): void {
  const dispatcher = createNodeDispatcher({}, { expressCompatible: true });
  for (const route of routes) dispatcher.server.route(route);
  app.use((req, res, next) => { void dispatcher.handle({ incoming: req, out: res }, { next, locals: res.locals, ...(rawBody ? {} : { parsedBody: (req as { body?: unknown }).body }) }); });
}

/** Upload (raw) and cleanup (behind the JSON parser) as a host mounts them, in the order the Express registration had. */
export function mountAttachmentRoutes({ app, deps, adapter }: { readonly app: Pick<Express, 'use'>; readonly deps: AttachmentsHttpDeps; readonly adapter: RouteHostContext }, _optional: Record<string, never> = {}): void {
  const host = testRouteHost({ context: adapter });
  mountRoutes({ app, routes: attachmentUploadRoutes({ deps, host }) }, { rawBody: true });
  mountRoutes({ app, routes: attachmentCleanupRoutes({ deps, host }) });
}
