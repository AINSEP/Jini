import { expect, it, vi } from 'vitest';
import { registerExternalMcpOAuthConnectRoutes, registerExternalMcpOAuthPollRoute } from '../oauth.js';

it('mounts browser, saved routes, connect and poll with the original limiter matrix and lazy facts', async () => {
  const order: string[] = [];
  const mounted: { path: string; limited: boolean; run: (origin: string) => Promise<void> }[] = [];
  let optionalReads = 0;
  const service = {
    beginConnect: vi.fn(async (input: { redirectUri: string }) => { order.push(input.redirectUri); return { kind: 'redirect_required', authorizationUrl: 'https://provider.test' }; }),
    pollDeviceAuthorization: vi.fn(async () => ({})),
    get listSharedConnections() { optionalReads++; return async function (this: unknown) { expect(this).toBe(service); return {}; }; },
  };
  const rate = { check: async () => { order.push('rate'); return { allowed: true as const }; }, retryAfter: vi.fn(), json: vi.fn(), message: 'rate' };
  const mountJson: Parameters<typeof registerExternalMcpOAuthConnectRoutes>[0]['mountJson'] = input => {
    mounted.push({ path: input.spec.path, limited: !!input.before, run: async origin => {
      const next = async () => {
        const deps = input.requestDeps({ callbackUrl: () => { order.push('callback'); return origin; }, requireSharedSession: () => { order.push('shared-session'); } });
        const parsed = input.spec.parse({ params: { serverId: 'server' }, body: { destination: 'shared' }, query: {} });
        if (!parsed.ok) throw new Error('parse');
        await input.spec.handle({ input: parsed.value, deps, context: { id: 'owner' }, authorize: async () => { order.push('authorize'); } });
      };
      if (input.before) await input.before({ rate }, next); else await next();
    } });
  };
  const mountRaw: Parameters<typeof registerExternalMcpOAuthConnectRoutes>[0]['mountRaw'] = input => {
    mounted.push({ path: input.spec.path, limited: true, run: async origin => {
      await input.before({ rate, noStore: () => { order.push('no-store'); }, requireSession: () => { order.push('session'); return true; } }, async () => {
        const deps = input.requestDeps({ callbackUrl: () => { order.push('callback'); return origin; } });
        await input.spec.handle({ raw: { params: { serverId: 'server' }, body: {}, query: {} }, deps, context: { id: 'owner' }, authorize: async () => { order.push('authorize'); } });
      });
    } });
  };
  const required = { mountJson, mountRaw, service, browserPath: '/browser', sharedPermission: 'shared', operation: 'oauth', errors: {}, makeBinding: () => 'binding', bindingCookie: () => 'cookie', invalidDestination: () => new Error(), invalidCredential: () => new Error(), localUnavailable: () => new Error(), sharedUnavailable: () => new Error(), copy: { browserSession: 'browser', connectSession: 'connect', sharedListSession: 'list', sharedLocalSession: 'local', sharedSelectSession: 'select', deviceSignInRefusal: { error: 'device', code: 'MCP_DEVICE_SIGN_IN_REQUIRED' } } } as unknown as Parameters<typeof registerExternalMcpOAuthConnectRoutes>[0];
  registerExternalMcpOAuthConnectRoutes(required);
  registerExternalMcpOAuthPollRoute(required);
  expect(mounted.map(route => [route.path.split('/').slice(-2).join('/'), route.limited])).toEqual([
    ['/browser', true], ['oauth/shared', false], ['oauth/shared', true], ['oauth/shared', true], ['oauth/connect', true], ['device/poll', true],
  ]);
  expect(optionalReads).toBe(0); expect(order).toEqual([]);
  await mounted[0]!.run('https://first.test/callback');
  expect(order).toEqual(['no-store', 'rate', 'session', 'authorize', 'callback', 'https://first.test/callback']);
  order.length = 0;
  await mounted[4]!.run('https://second.test/callback');
  expect(order).toEqual(['rate', 'authorize', 'shared-session', 'callback', 'https://second.test/callback']);
  await mounted[1]!.run('unused'); expect(optionalReads).toBe(1);
});
