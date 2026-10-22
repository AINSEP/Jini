import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryOriginSettingRepo, createVerifiedOrigin, type OriginSettingRepoPort } from "../verified-origin.js";
const WORKSPACE_ID = "workspace-1";

function seedOrigin() {
  return createVerifiedOrigin({
    scheme: "https",
    host: "example.com",
    verifiedAt: "2026-07-16T00:00:00.000Z",
    source: "workspace-setting",
  });
}

function runContractSuite(label: string, makeSeededRepo: () => OriginSettingRepoPort, makeEmptyRepo: () => OriginSettingRepoPort) {
  test(`[${label}] findByWorkspaceId returns null when nothing is registered`, async () => {
    assert.equal(await makeEmptyRepo().findByWorkspaceId({ workspaceId: WORKSPACE_ID }), null);
  });

  test(`[${label}] findByWorkspaceId returns the registered origin`, async () => {
    const found = await makeSeededRepo().findByWorkspaceId({ workspaceId: WORKSPACE_ID });
    assert.deepEqual(found, seedOrigin());
  });

  test(`[${label}] findRedirectAllowlist/findEgressAllowlist return the registered lists, normalized`, async () => {
    const repo = makeSeededRepo();
    assert.deepEqual(await repo.findRedirectAllowlist({ workspaceId: WORKSPACE_ID }), ["allowed.example"]);
    assert.deepEqual(await repo.findEgressAllowlist({ workspaceId: WORKSPACE_ID }), ["api.example.com"]);
  });

  test(`[${label}] findRedirectAllowlist/findEgressAllowlist return [] for an unregistered workspace`, async () => {
    const repo = makeEmptyRepo();
    assert.deepEqual(await repo.findRedirectAllowlist({ workspaceId: WORKSPACE_ID }), []);
    assert.deepEqual(await repo.findEgressAllowlist({ workspaceId: WORKSPACE_ID }), []);
  });
}

runContractSuite(
  "memory",
  () =>
    new InMemoryOriginSettingRepo({ seeds: [
      { workspaceId: WORKSPACE_ID, origin: seedOrigin(), redirectAllowlist: ["Allowed.example"], egressAllowlist: ["api.example.com"] },
    ] }),
  () => new InMemoryOriginSettingRepo({ seeds: [] })
);


test("mutating returned origin and allowlists cannot change the registry's stored trust", async () => {
  const repo = new InMemoryOriginSettingRepo({ seeds: [
    { workspaceId: WORKSPACE_ID, origin: seedOrigin(), redirectAllowlist: ["allowed.example"] },
  ] });
  const origin = await repo.findByWorkspaceId({ workspaceId: WORKSPACE_ID });
  assert.ok(origin); origin.host = "evil.example";
  const hosts = await repo.findRedirectAllowlist({ workspaceId: WORKSPACE_ID }); hosts.push("evil.example");
  assert.equal((await repo.findByWorkspaceId({ workspaceId: WORKSPACE_ID }))?.host, "example.com");
  assert.deepEqual(await repo.findRedirectAllowlist({ workspaceId: WORKSPACE_ID }), ["allowed.example"]);
});
