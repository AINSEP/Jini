/** @file Pins the `api-connection` vault kind: it is a valid scope kind, its default metadata
 * parser accepts no fields (hosts register the owning feature's parser), and a copy to another
 * site skips it without ever opening the sealed row, because its tokens belong to one workspace's
 * sign-in. */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { AesGcmSecretSealer } from "../secret-sealer.aesgcm.js";
import { InMemoryKeyring } from "../keyring.memory.js";
import { InMemoryVaultRepo, SecretsVaultService, VAULT_KINDS, createVaultMetaParsers, type VaultContext,
  type VaultMeta } from "../credential-sets/index.js";

const token = "connection-token-12345678";

function site(workspaceId: string, parsers = createVaultMetaParsers({})) {
  const repo = new InMemoryVaultRepo({});
  const keyring = new InMemoryKeyring({ hkdfSalt: "api-connection-kind-tests" }, { keyId: workspaceId });
  const sealer = new AesGcmSecretSealer({ keyring });
  const service = new SecretsVaultService({ repo, keyring, sealer, authorize: async () => {}, metaParsers: parsers,
    now: () => "2026-10-20T00:00:00Z", newId: () => "generated" });
  const context: VaultContext = { workspaceId, kind: "api-connection", ownerKey: "plugin-a", principalId: null, binding: null };
  return { repo, sealer, service, context };
}

test("api-connection is a vault kind with a parser", () => {
  assert.equal(VAULT_KINDS.includes("api-connection"), true);
  assert.equal(typeof createVaultMetaParsers({})["api-connection"], "function");
});

test("the default api-connection parser accepts empty metadata and refuses any field", () => {
  const parse = createVaultMetaParsers({})["api-connection"];
  assert.deepEqual(parse({ meta: {} }), {});
  assert.throws(() => parse({ meta: { status: "active" } }), { code: "invalid-meta" });
});

test("a host-registered api-connection parser owns the metadata shape", async () => {
  // The vault checks the metadata is a plain JSON object before any registered parser sees it.
  const parser = (input: { meta: unknown }): VaultMeta => ({ ...(input.meta as VaultMeta), checked: true });
  const { service, context } = site("ws", createVaultMetaParsers({}, { parsers: { "api-connection": parser } }));
  const saved = await service.put({ ...context, id: "row-1", expectedRevision: null, provider: null, label: "row-1",
    meta: { status: "active" }, payload: { token } });
  assert.deepEqual(saved.meta, { status: "active", checked: true });
});

test("copying an api-connection row to another site is skipped without opening it", async () => {
  const source = site("source");
  const target = site("target");
  await source.service.put({ ...source.context, id: "row-1", expectedRevision: null, provider: null, label: "row-1", meta: {}, payload: { token } });
  const open = vi.spyOn(source.sealer, "open");
  const result = await target.service.copyToSite({ source: source.service, sourceContext: source.context,
    targetContext: { ...source.context, workspaceId: "target" }, ids: ["row-1"], overwrite: false });
  assert.deepEqual(result, [{ kind: "api-connection", id: "row-1", status: "skipped", reasonCode: "kind-not-copyable" }]);
  assert.equal(open.mock.calls.length, 0);
  assert.equal(await target.repo.find({ workspaceId: "target", id: "row-1" }), null);
});
