import { expect, it, vi } from "vitest";
import { createPublishDestinationsRoute, registerPublishDestinationsRoute } from "../destinations.js";

it("missing peer capability never reads peer rows or identities", async () => {
  const calls: string[] = []; const listPeers = vi.fn(async () => [{ identity: "secret" }]);
  const deps = { loadRegistry: async () => { calls.push("registry"); return "registry"; }, mayReadPeers: async () => { calls.push("peer-grant"); return false; }, listPeers, listDestinations: async ({ peers }: { registry: string; peers: readonly { identity: string }[] }) => ({ peers }) };
  const route = createPublishDestinationsRoute({ deps });
  const result = await route.handle({ input: undefined, deps, context: { id: "owner" }, authorize: async (request) => { expect(request).toEqual({ permission: "system.read", entityType: "site-publish" }); calls.push("authorize"); } });
  expect(result).toEqual({ ok: true, value: { peers: [] } });
  expect(calls).toEqual(["authorize", "registry", "peer-grant"]); expect(listPeers).not.toHaveBeenCalled();
});

it('registers one static spec and reads each trust context only after registry admission', async () => {
  const { registerPublishDestinationsRoute } = await import('../destinations.js');
  const order: string[] = []; const peers = vi.fn(async () => [{ id: 'peer', label: 'Peer' }]);
  let current: { granted: boolean } | undefined;
  const trustContext = vi.fn(() => { order.push('trust'); return current; });
  let run!: () => Promise<unknown>;
  const mount = vi.fn<Parameters<typeof registerPublishDestinationsRoute<{ revision: number }, { id: string; label: string }, { count: number }, { granted: boolean }>>[0]['mount']>(input => {
    run = async () => input.spec.handle({ input: undefined, deps: input.requestDeps({ trustContext }), context: { id: 'owner' }, authorize: async () => { order.push('system.read'); } });
  });
  registerPublishDestinationsRoute({ mount, workspaceId: 'ws', operation: 'publish',
    loadRegistry: async () => { order.push('registry'); return { revision: 1 }; }, listPeers: peers,
    listDestinations: async ({ registry, peers }) => ({ count: registry.revision + peers.length }),
    authorize: async () => { order.push('rbac'); return { allowed: false, reason: 'denied' }; },
    authorizeForTrust: trust => async () => { order.push('grant'); return trust.granted ? { allowed: true, reason: '' } : { allowed: false, reason: 'denied' }; },
  });
  expect(mount).toHaveBeenCalledTimes(1); expect(trustContext).not.toHaveBeenCalled();
  expect(await run()).toEqual({ ok: true, value: { count: 1 } });
  expect(peers).not.toHaveBeenCalled();
  current = { granted: true };
  expect(await run()).toEqual({ ok: true, value: { count: 2 } });
  expect(order).toEqual(['system.read', 'registry', 'trust', 'rbac', 'system.read', 'registry', 'trust', 'grant']);
});

it("routes a destination resolver failure to its configured incident operation", () => {
  type Registration = Parameters<typeof registerPublishDestinationsRoute<string, string, string[], never>>[0];
  const mount = vi.fn<Registration["mount"]>();
  registerPublishDestinationsRoute({
    mount, workspaceId: "ws-2", operation: "publish.targets", loadRegistry: async () => "registry", listPeers: async () => [],
    listDestinations: async ({ peers }) => [...peers], authorize: async () => ({ allowed: true, reason: "fixture" }),
    authorizeForTrust: () => { throw new Error("trust was not supplied"); },
  });
  expect(mount).toHaveBeenCalledTimes(1);
  const { failure } = mount.mock.calls[0]![0];
  const internal = new Error("private registry failure");
  const incident = vi.fn();
  failure({ error: internal, incident });
  expect(incident.mock.calls).toEqual([[internal, { operation: "publish.targets", code: "INTERNAL_ERROR" }]]);
});

it("parses a body-less read and rejects a missing principal before loading a registry", async () => {
  const loadRegistry = vi.fn(async () => "registry");
  const deps = { loadRegistry, mayReadPeers: async () => true, listPeers: async () => ["backup"], listDestinations: async ({ peers }: { peers: readonly string[]; registry: string }) => [...peers] };
  const route = createPublishDestinationsRoute({ deps });
  const parsed = await route.parse({ query: {}, params: { workspaceId: "ws-2" }, body: undefined });
  expect(parsed).toEqual({ ok: true, value: undefined });
  if (!parsed.ok) throw new Error("expected read parse");
  await expect(route.handle({ input: parsed.value, deps, authorize: async () => {} })).rejects.toThrow("publish-site route has no authenticated principal");
  expect(loadRegistry.mock.calls).toEqual([]);
});
