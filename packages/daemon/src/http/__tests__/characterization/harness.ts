/**
 * @file The one seam of the route characterization suite. Every file in this folder talks to the
 * daemon's HTTP routes only through {@link RouteHarness}, so the same assertions can be re-run
 * unchanged once the routes are returned as data: only {@link startRouteHarness} changes then
 * (today: a real Express app on a real socket with every `register*` function mounted; afterwards:
 * the route lists on an in-memory server). Nothing here is published.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Express, type RequestHandler } from 'express';
import type { RouteHostContext } from '@jini-ai/core/contracts/server';
import { createLocalSameOriginPolicy } from '@jini-ai/core/contracts/server';
import type { ServerRoute } from '@jini-ai/core/contracts/server';
import { reportRouteInternalError } from '@jini-ai/http-kit';
import { createNodeDispatcher, maxReserializedJsonBytes } from '@jini-ai/http-kit/node-bridge';
import { testOriginConfig } from '../fixtures/local-origin.js';
import { fakeDaemonRouteHost } from '../fakes/route-host.js';
import type { DaemonRouteHost } from '../../route-host.js';
import { describeRoutes } from '../../route-table.js';
import { registerActiveContextRoutes } from '../../active-context.js';
import { agentRoutes } from '../../agents.js';
import { registerAttachmentLookupRoutes } from '../../attachment-lookup-routes.js';
import { registerAttachmentRoutes } from '../../attachments.js';
import { componentCatalogRoutes } from '../../component-catalog.js';
import { registerConnectorsRoutes } from '../../connectors.js';
import { registerDaemonStatusRoutes } from '../../daemon-status.js';
import { registerDaemonDbRoutes } from '../../db-ops.js';
import { registerDelegatedToolRoutes } from '../../delegated-tools.js';
import { registerFrontendRequestRoute } from '../../frontend-request-route.js';
import { registerFrontendSessionRoutes } from '../../frontend-sessions.js';
import { registerHealthRoutes } from '../../health.js';
import { registerHostToolsRoutes } from '../../host-tools.js';
import { registerMediaRoutes } from '../../media.js';
import { registerMemoryRoutes } from '../../memory.js';
import { registerMessageRelayRoutes } from '../../message-relay.js';
import { registerModelProxyRoutes } from '../../model-proxy.js';
import { registerRemoteRunEventRoutes } from '../../remote-run-events.js';
import { registerResearchRoutes } from '../../research.js';
import { registerRoutineRoutes } from '../../routines.js';
import { registerRunRoutes } from '../../runs.js';
import { registerTerminalRoutes } from '../../terminals.js';
import { toolCatalogRoutes } from '../../tool-catalog.js';
import { registerToolExecutionRoutes } from '../../tool-execution-routes.js';
import { registerXaiRoutes } from '../../xai.js';

/** The text every stand-in dependency throws. A response that contains it has leaked an internal error. */
export const INTERNAL_FAILURE_MARKER = 'characterization-internal-failure-do-not-leak';

/** The shared secret the harness configures for both bearer gates (tool execution, remote tool bridge). */
export const HARNESS_BEARER_TOKEN = 'characterization-bearer-token';

/** Where the scoped (host-authenticated) frontend-session variant is mounted, beside the default one. */
export const SCOPED_FRONTEND_PREFIX = '/api/scoped-frontend-sessions';

/** One registration as the framework recorded it: the verb (or `USE` for a path gate), the path and the layers in run order. */
export interface DescribedRoute {
  /** The route file that registered it. */
  readonly family: string;
  readonly method: string;
  readonly path: string;
  /** Layer names in run order (`name/arity`; an unnamed function is `anonymous`). The last one answers. */
  readonly layers: readonly string[];
}

export interface RouteHarness {
  /** Sends `request` to the mounted routes; only its path, query, method, headers and body are used. */
  fetch(request: Request, optional?: { client?: { address: string } }): Promise<Response>;
  close(): Promise<void>;
  /** `scheme://host:port` the routes answer on; a same-origin request names it in `Origin`. */
  readonly origin: string;
  /** Every registration, in mount order. */
  readonly routes: readonly DescribedRoute[];
  /** What the host's internal-error sink received, oldest first. */
  readonly internalErrors: readonly unknown[];
}

/** Per-family dependency overrides for a test that needs a route to do real work instead of throwing. */
export type FamilyDeps = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/**
 * A dependency bag whose every member, at any depth, is a function that throws
 * {@link INTERNAL_FAILURE_MARKER} when called, except the members given in `known`. Route groups
 * read their dependencies at request time, so a route that reaches its handler with these fails
 * the way a broken dependency would.
 */
export function throwingDeps(known: Readonly<Record<string, unknown>> = {}): never {
  const fail = (): never => { throw new Error(INTERNAL_FAILURE_MARKER); };
  const failing: unknown = new Proxy(fail, { get: (_target, property) => (typeof property === 'symbol' || property === 'then' ? undefined : failing) });
  return new Proxy({ ...known }, {
    get: (target, property) => {
      if (typeof property === 'symbol' || property === 'then') return undefined;
      return property in target ? (target as Record<string, unknown>)[property] : failing;
    },
    has: () => true,
  }) as never;
}

type Mount = (required: { app: Express; adapter: RouteHostContext; deps: (known?: Readonly<Record<string, unknown>>) => never; mountList: (routes: readonly ServerRoute[]) => void }) => void;

/** Token env for the two bearer gates; never the real process env. */
const gateEnv = { JINI_TOOL_EXEC_TOKEN: HARNESS_BEARER_TOKEN, JINI_REMOTE_TOOL_BRIDGE_TOKEN: HARNESS_BEARER_TOKEN };

/**
 * Every route file, in the order a host mounts them: health ahead of the body parser, the two
 * groups that bring their own parser ahead of the blanket one, then the rest. `'json-parser'` is
 * the blanket `express.json()` the preset mounts (default limit, 100 KB).
 */
const MOUNT_ORDER: readonly (readonly [family: string, mount: Mount] | 'json-parser')[] = [
  ['health', ({ app, adapter, deps }) => registerHealthRoutes({ app, deps: deps(), adapter })],
  ['tool-execution-routes', ({ app, deps }) => {
    // The host's run check is optional; a test that wants one supplies it as this family's `authorizeRun`.
    const { authorizeRun } = deps({ authorizeRun: undefined }) as { authorizeRun: RequestHandler | undefined };
    registerToolExecutionRoutes({ app, executor: deps(), listToolsFor: (deps() as { listToolsFor: never }).listToolsFor }, { env: gateEnv, ...(authorizeRun ? { authorizeRun } : {}) });
  }],
  ['attachment-lookup-routes', ({ app, deps }) => registerAttachmentLookupRoutes({ app, store: deps() })],
  'json-parser',
  ['runs', ({ app, adapter, deps }) => registerRunRoutes({ app, deps: deps(), adapter })],
  ['agents', ({ adapter, deps, mountList }) => mountList(agentRoutes({ deps: deps(), host: routeHost(adapter) }))],
  ['host-tools', ({ app, adapter, deps }) => registerHostToolsRoutes({ app, adapter }, deps())],
  ['model-proxy', ({ app, adapter, deps }) => registerModelProxyRoutes({ app, deps: deps(), adapter })],
  ['active-context', ({ app, adapter, deps }) => registerActiveContextRoutes({ app, deps: deps(), adapter })],
  ['terminals', ({ app, adapter, deps }) => registerTerminalRoutes({ app, deps: deps(), adapter })],
  ['db-ops', ({ app, adapter, deps }) => registerDaemonDbRoutes({ app, deps: deps(), adapter })],
  ['tool-catalog', ({ adapter, deps, mountList }) => mountList(toolCatalogRoutes({ deps: deps(), host: routeHost(adapter) }))],
  ['delegated-tools', ({ app, adapter, deps }) => registerDelegatedToolRoutes({ app, deps: deps(), adapter })],
  ['connectors', ({ app, adapter, deps }) => registerConnectorsRoutes({ app, deps: deps(), adapter })],
  ['research', ({ app, adapter, deps }) => registerResearchRoutes({ app, deps: deps(), adapter })],
  ['xai', ({ app, adapter, deps }) => registerXaiRoutes({ app, deps: deps(), adapter })],
  ['remote-run-events', ({ app, adapter, deps }) => registerRemoteRunEventRoutes({ app, deps: deps({ env: gateEnv, tokenConfig: undefined, timingSafeEqual: undefined }), adapter })],
  ['memory', ({ app, adapter, deps }) => registerMemoryRoutes({ app, deps: deps(), adapter })],
  ['routines', ({ app, adapter, deps }) => registerRoutineRoutes({ app, deps: deps(), adapter })],
  ['media', ({ app, adapter, deps }) => registerMediaRoutes({ app, deps: deps(), adapter })],
  ['frontend-sessions', ({ app, adapter, deps }) => registerFrontendSessionRoutes({ app, deps: deps({ routePrefix: undefined, resolveOwner: undefined }), adapter })],
  ['frontend-sessions (scoped)', ({ app, adapter, deps }) => registerFrontendSessionRoutes({ app, deps: deps({ routePrefix: SCOPED_FRONTEND_PREFIX }), adapter })],
  ['daemon-status', ({ app, adapter, deps }) => registerDaemonStatusRoutes({ app, deps: deps({ requestShutdown: () => undefined }), adapter })],
  ['component-catalog', ({ adapter, deps, mountList }) => mountList(componentCatalogRoutes({ deps: deps(), host: routeHost(adapter) }))],
  ['attachments', ({ app, adapter, deps }) => registerAttachmentRoutes({ app, deps: deps({ acquireActivity: undefined }), adapter })],
  ['message-relay', ({ app, deps }) => registerMessageRelayRoutes({ app, agentExecutor: deps(), runScopedCallers: undefined })],
  ['frontend-request-route', ({ app, deps }) => registerFrontendRequestRoute({ app, path: '/api/frontend-requests', control: deps(), executor: deps(), resolveOwner: (deps() as { resolveOwner: never }).resolveOwner, capabilityIds: ['characterization.capability'] })],
];

/** The host a route list is given: the harness's own origin policy and sink, the real reporter, and the body limit a host derives from the blanket parser (100 KB). */
function routeHost(adapter: RouteHostContext): DaemonRouteHost {
  return { ...fakeDaemonRouteHost(), context: adapter, reportInternalError: reportRouteInternalError, jsonBodyMaxBytes: maxReserializedJsonBytes({ parserLimitBytes: 102_400 }) };
}

/**
 * Mounts a route list at this position, the way the preset and Tovu do: as one layer through the Node
 * bridge, with the parser above it (`parsedBody`) and Express's own answers kept. Each route is recorded
 * as its method, path and gate names, so the route-table pin reads the same for a list as for `app.get`.
 */
function mountRouteList({ app, family, routes, described }: { app: Express; family: string; routes: readonly ServerRoute[]; described: DescribedRoute[] }): void {
  const dispatcher = createNodeDispatcher({}, { expressCompatible: true });
  for (const route of routes) dispatcher.server.route(route);
  app.use((req, res, next) => { void dispatcher.handle({ incoming: req, out: res }, { next, parsedBody: (req as { body?: unknown }).body, locals: res.locals }); });
  for (const route of describeRoutes({ routes })) described.push({ family, method: route.method, path: route.path, layers: route.gates });
}

const layerName = (handler: unknown): string => (typeof handler === 'function' ? `${handler.name || 'anonymous'}/${handler.length}` : String(handler));

/** `app` with its registration methods recorded under `family` before they reach Express. */
function recordingApp({ app, family, routes }: { app: Express; family: string; routes: DescribedRoute[] }): Express {
  const verbs = new Set(['get', 'post', 'put', 'patch', 'delete', 'use']);
  return new Proxy(app, {
    get: (target, property, receiver) => {
      const member: unknown = Reflect.get(target, property, receiver);
      if (typeof property !== 'string' || !verbs.has(property) || typeof member !== 'function') return member;
      return (...args: unknown[]) => {
        if (typeof args[0] === 'string') routes.push({ family, method: property.toUpperCase(), path: args[0], layers: args.slice(1).map(layerName) });
        return (member as (...inner: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

function mountEverything({ app, adapter, familyDeps }: { app: Express; adapter: RouteHostContext; familyDeps: FamilyDeps }): DescribedRoute[] {
  const routes: DescribedRoute[] = [];
  for (const entry of MOUNT_ORDER) {
    if (entry === 'json-parser') {
      app.use(express.json());
      continue;
    }
    const [family, mount] = entry;
    mount({ app: recordingApp({ app, family, routes }), adapter, mountList: (list) => mountRouteList({ app, family, routes: list, described: routes }), deps: (known = {}) => throwingDeps({ onInternalError: adapter.onInternalError, ...known, ...familyDeps[family] }) });
  }
  return routes;
}

/** The request as Node's client must send it: same path, query, method, headers and body, on the harness's own origin. */
async function forward({ request, origin }: { request: Request; origin: string }): Promise<Response> {
  const url = new URL(request.url);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers: request.headers, redirect: 'manual', signal: request.signal };
  if (hasBody) {
    init.body = request.body;
    init.duplex = 'half';
  }
  return fetch(`${origin}${url.pathname}${url.search}`, init);
}

/**
 * Starts every daemon route on `127.0.0.1` behind the real local same-origin policy.
 * @param optional.familyDeps - Real members for one family's dependencies (keyed by the family names in the route table); everything else throws.
 */
export async function startRouteHarness(_required: Record<string, never> = {}, { familyDeps = {} }: { familyDeps?: FamilyDeps } = {}): Promise<RouteHarness> {
  const internalErrors: unknown[] = [];
  const port = { current: 0 };
  const adapter: RouteHostContext = {
    originPolicy: createLocalSameOriginPolicy({ port: () => port.current, env: {}, config: testOriginConfig }),
    onInternalError: (report) => { internalErrors.push(report); },
  };
  const app = express();
  const routes = mountEverything({ app, adapter, familyDeps });
  const server: HttpServer = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port.current = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port.current}`;
  return {
    origin,
    routes,
    internalErrors,
    // A real socket's peer is always loopback here; `client` is honoured once routes run in memory.
    fetch: (request) => forward({ request, origin }),
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

/** `METHOD path [layers]`, one line per registration: the form the route-table pin is written in. */
export function describeRouteTable({ routes }: { routes: readonly DescribedRoute[] }): Record<string, string[]> {
  const table: Record<string, string[]> = {};
  for (const route of routes) (table[route.family] ??= []).push(`${route.method} ${route.path} [${route.layers.join(', ')}]`);
  return table;
}
