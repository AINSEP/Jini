import { describe, expect, it, vi } from "vitest";
import { registerOwnerPasskeyRoutes } from "../passkey-routes.js";
import { resolveOwnerPasskeyRouteDeps, answerOwnerPasskeyFailure } from "../passkey-route-deps.js";

describe("owner passkey mount admission", () => {
  it("mounts status and five actions and keeps nonowner status from reading credentials", async () => {
    const routes: Parameters<Parameters<typeof registerOwnerPasskeyRoutes>[0]["mount"]>[0][] = [];
    registerOwnerPasskeyRoutes({ root: "/passkeys", mount: input => { routes.push(input); } });
    expect(routes.map(({ method, path }) => `${method} ${path}`)).toEqual(["post /passkeys/enroll", "post /passkeys/confirm", "post /passkeys/begin-login", "post /passkeys/login", "post /passkeys/remove", "get /passkeys"]);
    const json = vi.fn();
    const passkeyDeps = vi.fn();
    const noStore = vi.fn();
    const admission: Parameters<(typeof routes)[number]["handle"]>[0] = {
      workspaceId: "ws", passkeyDeps, noStore, json,
      authenticate: async () => ({ kind: "tool", principal: { id: "owner" } }), ownerPrincipalId: async () => "owner",
      isJson: vi.fn(), fetchSite: vi.fn(), origin: vi.fn(), body: vi.fn(), byteCount: vi.fn(), rate: vi.fn(),
      retryAfter: vi.fn(), empty: vi.fn(), failure: vi.fn(), signedIn: vi.fn(),
      services: {
        beginOwnerPasskeyEnrollment: vi.fn(), confirmOwnerPasskeyEnrollment: vi.fn(), beginOwnerPasskeyLogin: vi.fn(),
        completeOwnerPasskeyLogin: vi.fn(), removeOwnerPasskey: vi.fn(),
      },
      copy: { ownerRequired: "owner required", origin: "origin", tooLarge: "too large", rate: "rate" },
    };
    await routes[5]!.handle(admission);
    expect(noStore).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith({ isOwner: false, credentials: [] });
    expect(passkeyDeps).not.toHaveBeenCalled();
  });
});

it('reads the credential store once before MFA and uses only the trusted site origin', async () => {
  const { resolveOwnerPasskeyRouteDeps } = await import('../passkey-route-deps.js');
  const order: string[] = [];
  const credentials = {} as Awaited<ReturnType<typeof resolveOwnerPasskeyRouteDeps>>['credentials'];
  const store = vi.fn(() => { order.push('store'); return credentials; });
  const resolved = await resolveOwnerPasskeyRouteDeps({ store,
    mfa: async () => { order.push('mfa'); return {} as Awaited<ReturnType<typeof resolveOwnerPasskeyRouteDeps>>['mfa']; },
    webauthn: () => { order.push('webauthn'); return {} as Awaited<ReturnType<typeof resolveOwnerPasskeyRouteDeps>>['webauthn']; },
    get site() { order.push('site'); return { deps: { derivedPublicOrigin: 'http://localhost:1234' }, localPort: 7890, name: 'Site', copy: { unavailable: 'missing', insecure: 'insecure' } }; },
    unavailableMessage: 'unavailable',
  });
  expect(store).toHaveBeenCalledTimes(1);
  expect(order).toEqual(['store', 'mfa', 'webauthn', 'site']);
  expect(resolved.credentials).toBe(credentials);
  expect(resolved.site).toEqual({ origin: 'http://localhost:7890', rpId: 'localhost', name: 'Site' });
});

it('binds request admission without store reads for nonowners and delegates sign-in', async () => {
  const { bindOwnerPasskeyRoutes } = await import('../passkey-routes.js');
  const routes: { method: string; path: string; handle(req: object, res: object): Promise<void> }[] = [];
  const store = vi.fn(() => ({})); const signedIn = vi.fn(); const noStore = vi.fn(); const json = vi.fn();
  const resolveDeps = vi.fn(resolveOwnerPasskeyRouteDeps);
  const answerFailure = vi.fn(answerOwnerPasskeyFailure);
  const incident = vi.fn();
  const result = { sessionToken: 'signed-in' };
  const bind = bindOwnerPasskeyRoutes({ root: '/passkeys', mount: (input: (typeof routes)[number]) => { routes.push(input); },
    resolveOwnerPasskeyRouteDeps: resolveDeps, answerOwnerPasskeyFailure: answerFailure,
    workspaceId: () => 'ws', store, mfa: async () => ({ seededOwnerPrincipalId: 'owner' }), webauthn: () => ({}),
    site: () => ({ deps: { passkeyOrigin: 'https://trusted.test' }, name: 'Site', copy: { unavailable: 'missing', insecure: 'insecure' } }),
    unavailableMessage: 'missing', authenticate: async () => ({ kind: 'tool', principal: { id: 'other' } }), ownerPrincipalId: async () => 'owner',
    isJson: () => true, header: ({ name }: { name: string }) => name === 'origin' ? 'https://trusted.test' : undefined,
    body: () => ({}), byteCount: () => 2, rate: async () => ({ allowed: true }), noStore, retryAfter: vi.fn(), json, empty: vi.fn(), incident, signedIn,
    services: { completeOwnerPasskeyLogin: async () => result }, copy: {}, operation: 'passkey', incidentOptions: {},
  } as unknown as Parameters<typeof bindOwnerPasskeyRoutes<object, object, object>>[0]);
  bind({}); expect(store).not.toHaveBeenCalled();
  expect(resolveDeps).not.toHaveBeenCalled();
  await routes[5]!.handle({}, {});
  expect(store).not.toHaveBeenCalled(); expect(noStore).toHaveBeenCalledTimes(1);
  expect(resolveDeps).not.toHaveBeenCalled();
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ value: { isOwner: false, credentials: [] } }));
  const req = {}; const res = {};
  await routes[3]!.handle(req, res);
  expect(store).toHaveBeenCalledTimes(1);
  expect(signedIn).toHaveBeenCalledWith({ host: {}, req, res, result });
  expect(resolveDeps).toHaveBeenCalledTimes(1);
  expect(answerFailure).not.toHaveBeenCalled();
  store.mockImplementation(() => { throw new Error('store unavailable'); });
  await routes[3]!.handle(req, res);
  expect(resolveDeps).toHaveBeenCalledTimes(2);
  expect(answerFailure).toHaveBeenCalledWith({ error: expect.objectContaining({ message: 'store unavailable' }),
    json: expect.any(Function), incident: expect.any(Function), operation: 'passkey', incidentOptions: {} });
  expect(incident).toHaveBeenCalledWith({ res, error: expect.objectContaining({ message: 'store unavailable' }), options: {} });
});

it('sets no-store before writing an origin refusal', async () => {
  const { ownerPasskeyActionRoute } = await import('../passkey-routes.js');
  const order: string[] = [];
  const json = vi.fn(() => { order.push('refuse'); });
  await ownerPasskeyActionRoute({ action: 'confirm', admission: {
    noStore: () => { order.push('no-store'); },
    passkeyDeps: async () => ({ site: { origin: 'https://trusted.test' } }),
    isJson: () => false, json, copy: { origin: 'Use the browser' }, failure: vi.fn(),
  } as unknown as Parameters<typeof ownerPasskeyActionRoute>[0]['admission'] });
  expect(order).toEqual(['no-store', 'refuse']);
  expect(json).toHaveBeenCalledWith({ error: 'Use the browser', code: 'PASSKEY_ORIGIN_REFUSED' }, 403);
});
