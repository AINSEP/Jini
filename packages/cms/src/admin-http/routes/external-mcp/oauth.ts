import type { ExternalMcpOAuthService } from '@jini-ai/core/contracts/site/api-connections-hosted-mcp';
import { defineJsonRoute, ok, routeReply, type RouteReply, type RouteInputContext, type JsonRouteAuthorize } from '@jini-ai/core/contracts/server';
import { authorizeExternalMcp, externalMcpActorId, type ExternalMcpRoutePrincipal } from './shared.js';

const BASE = '/api/admin/v1/workspaces/:workspaceId/mcp-servers/:serverId/oauth';

export function externalMcpProviderRefusal({ error }: { error: { code: string; message: string; retryable: boolean; operatorAction: string; retryAfterSeconds?: number } }, _optional = {}): RouteReply {
  // 502 for "we could not reach them", 400 for "they refused us or we asked wrongly" — the two
  // demand different things of the operator (wait/check network vs. check configuration), and
  // collapsing them would tell someone behind a flaky network that their client id is wrong.
  const status = error.code === 'OAUTH_PROVIDER_UNREACHABLE' ? 502 : 400;
  return routeReply({ status, body: { error: error.message, code: error.code, details: { retryable: error.retryable, operatorAction: error.operatorAction,
    ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
  } } });
}

/** Where a connect request saves its sign-in: this browser (undefined) or the shared Mac connection. */
function connectDestination({ body, invalidDestination }: { body: unknown; invalidDestination: (required: Record<string, never>) => Error }, _options = {}): 'shared' | undefined {
  const destination = (body as { destination?: unknown } | undefined)?.destination;
  if (destination !== undefined && destination !== 'shared') throw invalidDestination({});
  return destination;
}

/** The one saved connection id a select request may carry; anything else is refused. */
function savedCredentialId({ body: input, invalidCredential }: { body: unknown; invalidCredential: (required: Record<string, never>) => Error }, _options = {}): string {
  const body = input as Record<string, unknown> | undefined;
  if (!body || Object.keys(body).some(key => key !== 'credentialId')) throw invalidCredential({});
  if (typeof body.credentialId !== 'string' || body.credentialId.length > 512 || !body.credentialId) throw invalidCredential({});
  return body.credentialId;
}

export const externalMcpOAuthConnectRoute = defineJsonRoute<{ serverId: string; body: unknown }, unknown, {
  beginConnect: ExternalMcpOAuthService['beginConnect'];
  callbackUrl(required: { serverId: string }): string;
  requireSharedSession(required: Record<string, never>): void;
  invalidDestination(required: Record<string, never>): Error;
}, ExternalMcpRoutePrincipal>({
  method: 'post', path: `${BASE}/connect`,
  parse: raw => ok({ value: { serverId: String(raw.params.serverId ?? ''), body: raw.body } }),
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeExternalMcp({ authorize });
    const destination = connectDestination({ body: input.body, invalidDestination: deps.invalidDestination });
    if (destination === 'shared') deps.requireSharedSession({});
    const started = await deps.beginConnect({ serverId: input.serverId, actorId: externalMcpActorId({ context }), ...(destination === 'shared' ? { destination } : {}), redirectUri: deps.callbackUrl({ serverId: input.serverId }), delivery: 'hosted' });
    return ok({ value: { auth: started } });
  },
});

export const externalMcpOAuthPollRoute = defineJsonRoute<{ serverId: string }, unknown, { pollDeviceAuthorization: ExternalMcpOAuthService['pollDeviceAuthorization'] }>({
  method: 'post', path: `${BASE}/device/poll`,
  parse: raw => ok({ value: { serverId: String(raw.params.serverId ?? '') } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeExternalMcp({ authorize });
    return ok({ value: await deps.pollDeviceAuthorization({ serverId: input.serverId }) });
  },
});

export const externalMcpSharedListRoute = defineJsonRoute<{ serverId: string }, unknown, {
  requireSharedSession(required: Record<string, never>): void;
  listSharedConnections: ExternalMcpOAuthService['listSharedConnections'];
}, ExternalMcpRoutePrincipal>({
  method: 'get', path: `${BASE}/shared`,
  parse: raw => ok({ value: { serverId: String(raw.params.serverId) } }),
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeExternalMcp({ authorize });
    deps.requireSharedSession({});
    const result = await deps.listSharedConnections?.({ serverId: input.serverId, actorId: externalMcpActorId({ context }) });
    return ok({ value: result ?? { available: false, connections: [], current: null } });
  },
});

export const externalMcpSharedLocalRoute = defineJsonRoute<{ serverId: string }, unknown, {
  requireSharedSession(required: Record<string, never>): void;
  useLocalConnection: ExternalMcpOAuthService['useLocalConnection'];
  unavailable(required: Record<string, never>): Error;
}, ExternalMcpRoutePrincipal>({
  method: 'delete', path: `${BASE}/shared`,
  parse: raw => ok({ value: { serverId: String(raw.params.serverId) } }),
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeExternalMcp({ authorize });
    deps.requireSharedSession({});
    if (!deps.useLocalConnection) throw deps.unavailable({});
    await deps.useLocalConnection({ serverId: input.serverId, actorId: externalMcpActorId({ context }) });
    return ok({ value: { selected: 'local' } });
  },
});

export const externalMcpSharedSelectRoute = defineJsonRoute<{ serverId: string; body: unknown }, unknown, {
  requireSharedSession(required: Record<string, never>): void;
  useSharedConnection: ExternalMcpOAuthService['useSharedConnection'];
  invalidCredential(required: Record<string, never>): Error;
  unavailable(required: Record<string, never>): Error;
}, ExternalMcpRoutePrincipal>({
  method: 'post', path: `${BASE}/shared`,
  parse: raw => ok({ value: { serverId: String(raw.params.serverId), body: raw.body } }),
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeExternalMcp({ authorize });
    deps.requireSharedSession({});
    const credentialId = savedCredentialId({ body: input.body, invalidCredential: deps.invalidCredential });
    if (!deps.useSharedConnection) throw deps.unavailable({});
    await deps.useSharedConnection({ serverId: input.serverId, credentialId, actorId: externalMcpActorId({ context }) });
    return ok({ value: { connected: true } });
  },
});

/** Authenticated, user-opened host hop: one cookie and redirect, never proof in a link.
 * @complexity O(1) plus the existing bounded connect/discovery work for one connection.
 */
export const externalMcpBrowserSignInRoute = {
  method: 'get' as const, bufferedReply: 'redirect' as const,
  async handle({ raw, deps, context, authorize }: {
    raw: RouteInputContext; context?: ExternalMcpRoutePrincipal | undefined; authorize?: JsonRouteAuthorize | undefined;
    deps: {
      beginConnect: ExternalMcpOAuthService['beginConnect'];
      makeBinding(required: Record<string, never>): string;
      callbackUrl(required: { serverId: string }): string;
      bindingCookie(required: { browserBinding: string }): string;
      deviceSignInRefusal: { error: string; code: 'MCP_DEVICE_SIGN_IN_REQUIRED' };
    };
  }, _optional = {}): Promise<Response> {
    await authorizeExternalMcp({ authorize });
    const serverId = String(raw.params.serverId ?? '');
    const browserBinding = deps.makeBinding({});
    const start = await deps.beginConnect({ serverId, actorId: externalMcpActorId({ context }), redirectUri: deps.callbackUrl({ serverId }), browserBinding });
    if (start.kind !== 'redirect_required') return new Response(JSON.stringify(deps.deviceSignInRefusal), { status: 400, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Type': 'application/json; charset=utf-8' } });
    return new Response(null, { status: 302, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': deps.bindingCookie({ browserBinding }), Location: start.authorizationUrl } });
  },
};

export function createExternalMcpBrowserSignInRoute({ path }: { path: string }, _optional = {}): typeof externalMcpBrowserSignInRoute & { path: string } {
  return { ...externalMcpBrowserSignInRoute, path };
}
