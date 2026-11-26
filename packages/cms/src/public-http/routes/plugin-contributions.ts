import type { Express, Request, RequestHandler, ErrorRequestHandler, Response, Router } from 'express';
import type { PluginContributionsSnapshot } from '@jini-ai/core/contracts/site/plugins-host';
import type { PluginAuthContext, PluginRouteResult } from '@jini-ai/core/contracts/plugin-sdk';

export type PluginHttpReply =
  | { kind: 'not-found'; status: 404; body: { code: 'NOT_FOUND' } }
  | { kind: 'failed'; status: 500; body: { code: 'PLUGIN_ROUTE_FAILED' } }
  | { kind: 'result'; cacheControl: 'no-store'; response: 'empty'; status: 204 }
  | { kind: 'result'; cacheControl: 'no-store'; response: 'json'; status: number; body: unknown };

/** Whether the durable activation row says the plugin is enabled right now. */
export async function isPluginActivated({ workspaceId, pluginId, getActivation }: {
  workspaceId: string; pluginId: string;
  getActivation(required: { workspaceId: string; pluginId: string }): Promise<{ enabled: boolean } | null | undefined>;
}, _optional = {}): Promise<boolean> {
  const row = await getActivation({ workspaceId, pluginId });
  return Boolean(row?.enabled);
}

export async function invokeLivePluginRoute({ workspaceId, snapshot, route, input, ports }: {
  workspaceId: string; snapshot: PluginContributionsSnapshot; route: PluginContributionsSnapshot['routes'][number];
  input: Pick<Parameters<PluginContributionsSnapshot['routes'][number]['handler']>[0], 'body' | 'params' | 'query'>;
  ports: {
    isActivated(required: { pluginId: string }): Promise<boolean>;
    isLive(required: { snapshot: PluginContributionsSnapshot }): boolean;
    principalIdFor(required: { access: PluginAuthContext['access'] }): string | undefined;
    reportError(required: { pluginId: string; error: unknown }, optional?: Record<string, never>): void;
  };
}, _optional = {}): Promise<PluginHttpReply> {
  try {
    if (!(await ports.isActivated({ pluginId: snapshot.pluginId })) || !ports.isLive({ snapshot })) return { kind: 'not-found', status: 404, body: { code: 'NOT_FOUND' } };
    const principalId = route.access === 'public' ? undefined : ports.principalIdFor({ access: route.access });
    const context: PluginAuthContext = { access: route.access, workspaceId, ...(principalId === undefined ? {} : { principalId }) };
    const result: PluginRouteResult | void = await route.handler({ pluginId: snapshot.pluginId, sdk: snapshot.sdk, auth: context, body: input.body, params: input.params, query: input.query }, {});
    // A disable/reload while the handler awaited must not emit a retired generation's result.
    if (!ports.isLive({ snapshot }) || !(await ports.isActivated({ pluginId: snapshot.pluginId }))) return { kind: 'not-found', status: 404, body: { code: 'NOT_FOUND' } };
    if (result === undefined) return { kind: 'result', cacheControl: 'no-store', response: 'empty', status: 204 };
    return { kind: 'result', cacheControl: 'no-store', response: 'json', status: result.status ?? 200, body: result.body ?? null };
  } catch (error) {
    ports.reportError({ pluginId: snapshot.pluginId, error }, {});
    return { kind: 'failed', status: 500, body: { code: 'PLUGIN_ROUTE_FAILED' } };
  }
}

export interface PluginRouteAuthPorts { readonly member: RequestHandler; readonly admin: RequestHandler }
/** Uses the same operator gate and distinct member cookie resolver as core routes; a member
 * credential never counts as an operator credential. No plugin receives raw tokens or repos. */
export function createPluginRouteAuthPorts({ deps }: { deps: {
  workspaceId: string;
  operatorSession: RequestHandler;
  authorizeOrRespond: (required: { res: Response; params: { principalId: string; permission: string; workspaceId: string; entityType: string; entityId: string } }) => Promise<boolean>;
  activeMemberFromSession: (required: { request: Request }) => Promise<string | null>;
} }, _optional: Record<string, never> = {}): PluginRouteAuthPorts {
  const operatorSession = deps.operatorSession;
  return {
    // The session gate admits operators, including users with no grants. Arbitrary in-process
    // plugin execution needs the same operator permission as plugin tools, not just a cookie.
    admin: (req, res, next) => operatorSession(req, res, error => {
      if (error) { next(error); return; }
      void deps.authorizeOrRespond({ res, params: { principalId: res.locals.principal.id,
        permission: 'admin.plugins.enable', workspaceId: deps.workspaceId,
        entityType: 'plugin', entityId: res.locals.pluginOwnerId,
      } }).then(allowed => { if (allowed) next(); }).catch(next);
    }),
    member: async (req, res, next) => {
      try {
        const memberId = await deps.activeMemberFromSession({ request: req });
        if (!memberId) { res.status(401).json({ code: 'UNAUTHENTICATED' }); return; }
        res.locals.pluginMemberId = memberId;
        next();
      } catch (error) { next(error); }
    },
  };
}
type PluginRoute = PluginContributionsSnapshot['routes'][number];
type PluginRouteDeps = { workspaceId: string; pluginContributions?: { list: (required: Record<string, never>) => readonly PluginContributionsSnapshot[] } | undefined; pluginActivationRepo: { getActivation: (required: { workspaceId: string; pluginId: string }) => Promise<{ enabled: boolean } | null | undefined> } };
type PluginRouteErrorReporter = (required: { pluginId: string; error: unknown }, optional?: Record<string, never>) => void;

const respondNotFound = (res: Response): void => { res.status(404).json({ code: 'NOT_FOUND' }); };

/** Gate before auth and body parsing: a disabled plugin's route answers 404 without reading anything. */
export const requireActivatedPlugin = (deps: PluginRouteDeps, snapshot: PluginContributionsSnapshot): RequestHandler => async (_req, res, next) => {
  try {
    if (!(await isPluginActivated({ workspaceId: deps.workspaceId, pluginId: snapshot.pluginId, getActivation: (input) => deps.pluginActivationRepo.getActivation(input) }))) { respondNotFound(res); return; }
    res.locals.pluginOwnerId = snapshot.pluginId;
    next();
  } catch (error) { next(error); }
};

const invokePluginRoute = (
  { deps, snapshot, route }: { deps: PluginRouteDeps; snapshot: PluginContributionsSnapshot; route: PluginRoute },
  { onError }: { onError: PluginRouteErrorReporter },
): RequestHandler => async (req, res) => {
  const result = await invokeLivePluginRoute({ workspaceId: deps.workspaceId, snapshot, route,
    input: { body: req.body, params: Object.fromEntries(Object.entries(req.params).map(([key, value]) => [key, String(value)])), query: req.query },
    ports: {
      isActivated: ({ pluginId }) => isPluginActivated({ workspaceId: deps.workspaceId, pluginId, getActivation: (input) => deps.pluginActivationRepo.getActivation(input) }),
      isLive: ({ snapshot }) => Boolean(deps.pluginContributions?.list({}).includes(snapshot)),
      principalIdFor: ({ access }) => access === 'admin' ? res.locals.principal?.id : res.locals.pluginMemberId,
      reportError: onError,
    },
  });
  if (result.kind !== 'result') { res.status(result.status).json(result.body); return; }
  res.set('Cache-Control', result.cacheControl);
  if (result.response === 'empty') { res.status(result.status).end(); return; }
  res.status(result.status).json(result.body);
};

const passThrough: RequestHandler = (_req, _res, next) => next();

const pluginRouteErrors: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) { next(error); return; }
  const invalidBody = error?.type === 'entity.parse.failed';
  res.status(invalidBody ? 400 : 500).json({ code: invalidBody ? 'INVALID_BODY' : 'PLUGIN_ROUTE_FAILED' });
};

/** All bodies, including authenticated ones, use the small public cap. The admin middleware
 * owns credential resolution; its parser also selects this cap for the /api/p mount.
 * Auth and a durable activation check precede reading any body. Handler errors are redacted. */
export function registerPluginContributionRoutes(
  { app, deps, auth, kit }: { app: Express; deps: PluginRouteDeps; auth: PluginRouteAuthPorts; kit: { Router: () => Router; parsers: readonly RequestHandler[]; respondToOversizedBody: ErrorRequestHandler; onError: PluginRouteErrorReporter } },
  _optional: Record<string, never> = {},
): void {
  const { parsers, onError } = kit;
  const buildRouter = () => {
    const router = kit.Router();
    for (const snapshot of deps.pluginContributions?.list({}) ?? []) {
      for (const route of snapshot.routes) {
        const guard = route.access === 'public' ? passThrough : auth[route.access];
        router.route(`/${snapshot.pluginId}${route.path}`)[route.method.toLowerCase() as 'get'](requireActivatedPlugin(deps, snapshot), guard, ...parsers, invokePluginRoute({ deps, snapshot, route }, { onError }));
      }
    }
    router.use((_req, response) => respondNotFound(response));
    return router;
  };
  app.use('/api/p', (req, res, next) => buildRouter()(req, res, next));
  app.use('/api/p', kit.respondToOversizedBody);
  app.use('/api/p', pluginRouteErrors);
}
