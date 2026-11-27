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

it("binds the saved-selection service receiver lazily and handles classified versus private failures", async () => {
  type Registrar = Parameters<typeof registerExternalMcpOAuthConnectRoutes>[0];
  class Connection extends Error { code = "access-denied"; }
  class Validation extends Error { field = "credentialId"; }
  class Reauth extends Error { code = "REAUTH"; settingsLink = "/settings"; }
  class SecretStoreUnconfigured extends Error {}
  class OAuth extends Error { code = "invalid-token"; retryable = false; operatorAction = "Reconnect"; }
  const selections: unknown[] = [];
  const requireSharedSession = vi.fn();
  const json = vi.fn();
  const incident = vi.fn();
  const privateFailure = new Error("private storage detail");
  const known = new SecretStoreUnconfigured("Set up a site key first");
  let failure: Error | undefined;
  const service = {
    async beginConnect() { throw new Error("must not begin a new grant"); },
    async completeAuthorizationCallback() {},
    async pollDeviceAuthorization() { return { status: "connected" as const }; },
    async disconnect() {},
    async reportAuthFailure(_serverId: string, error: Error) { throw error; },
    tokenResolver: { async resolveAccessToken() { throw new Error("unused"); } },
    async useLocalConnection(input: { serverId: string; actorId: string }) {
      if (this !== service) throw new Error("lost local receiver");
      selections.push(["local", input]);
    },
    async useSharedConnection(input: { serverId: string; actorId: string; credentialId: string }) {
      if (this !== service) throw new Error("lost shared receiver");
      if (failure) throw failure;
      selections.push(["shared", input]);
    },
  } satisfies Registrar["service"];
  const handlers = new Map<string, () => Promise<unknown>>();
  const mountJson: Registrar["mountJson"] = (binding) => {
    if (!binding.spec.path.endsWith("/shared")) return;
    handlers.set(binding.spec.method, async () => {
      const deps = binding.requestDeps({ callbackUrl: () => "https://admin.example.test/callback", requireSharedSession });
      const parsed = await binding.spec.parse({ params: { serverId: "calendar" }, query: {}, body: { credentialId: "saved-7" } });
      if (!parsed.ok) throw new Error("shared route parse failed");
      const run = () => binding.spec.handle({ input: parsed.value, deps, context: { id: "owner-3" }, authorize: async () => {} });
      if (failure === undefined) return run();
      try { await run(); } catch (error) { binding.failure({ error, json, incident }); }
    });
  };
  registerExternalMcpOAuthConnectRoutes({
    mountJson, mountRaw: () => {}, browserPath: "/browser", sharedPermission: "owner-only", operation: "external-mcp-oauth",
    service, makeBinding: () => "binding", bindingCookie: () => "cookie",
    errors: { apiConnection: Connection, validation: Validation, reauth: Reauth, secretStoreUnconfigured: SecretStoreUnconfigured, oauth: OAuth },
    invalidDestination: () => new Error("destination"), invalidCredential: () => new Error("credential"),
    localUnavailable: () => new Error("local unavailable"), sharedUnavailable: () => new Error("shared unavailable"),
    copy: { browserSession: "browser", connectSession: "connect", sharedListSession: "list",
      sharedLocalSession: "select local", sharedSelectSession: "select saved", deviceSignInRefusal: { error: "device", code: "MCP_DEVICE_SIGN_IN_REQUIRED" } },
  });
  const useLocal = handlers.get("delete");
  const useSaved = handlers.get("post");
  if (!useLocal || !useSaved) throw new Error("missing local and shared selection bindings");
  expect(await useLocal()).toEqual({ ok: true, value: { selected: "local" } });
  expect(await useSaved()).toEqual({ ok: true, value: { connected: true } });
  expect(selections).toEqual([
    ["local", { serverId: "calendar", actorId: "owner-3" }],
    ["shared", { serverId: "calendar", actorId: "owner-3", credentialId: "saved-7" }],
  ]);
  expect(requireSharedSession.mock.calls).toEqual([
    [{ message: "select local", permission: "owner-only" }], [{ message: "select saved", permission: "owner-only" }],
  ]);
  failure = known;
  await useSaved();
  failure = privateFailure;
  await useSaved();
  expect(json.mock.calls).toEqual([[{ error: "Set up a site key first", code: "SECRET_STORE_UNCONFIGURED" }, 503]]);
  expect(incident.mock.calls).toEqual([[privateFailure, { operation: "external-mcp-oauth", code: "INTERNAL_ERROR" }]]);
});
