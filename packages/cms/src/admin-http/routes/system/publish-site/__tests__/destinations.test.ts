import { expect, it, vi } from "vitest";
import { createPublishDestinationsRoute } from "../destinations.js";

it("missing peer capability never reads peer rows or identities", async () => {
  const calls: string[] = []; const listPeers = vi.fn(async () => [{ identity: "secret" }]);
  const deps = { loadRegistry: async () => { calls.push("registry"); return "registry"; }, mayReadPeers: async () => { calls.push("peer-grant"); return false; }, listPeers, listDestinations: async ({ peers }: { registry: string; peers: readonly { identity: string }[] }) => ({ peers }) };
  const route = createPublishDestinationsRoute({ deps });
  const result = await route.handle({ input: undefined, deps, context: { id: "owner" }, authorize: async (request) => { expect(request).toEqual({ permission: "system.read", entityType: "site-publish" }); calls.push("authorize"); } });
  expect(result).toEqual({ ok: true, value: { peers: [] } });
  expect(calls).toEqual(["authorize", "registry", "peer-grant"]); expect(listPeers).not.toHaveBeenCalled();
});
