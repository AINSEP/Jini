import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { PublishCredentialSource } from "../types.js";
import type { StaticPublishToolDeps } from "../../publish-tool-deps.js";
import { getStaticPublishCapabilities } from "../../publish-tool-capabilities.js";
import { InMemoryPublishCredentialVerificationCache } from "../verify.js";
import { InMemoryPublishHistoryStore } from "../publish-history.js";
import { credentialTarget, storeFixture } from "../../publish-credentials/__tests__/store-fixture.js";
import { createPublishCredential } from "../../publish-credentials/store.js";

test("B226: changing the default publishing key does not inherit the previous key's valid check", async () => {
  const cache = new InMemoryPublishCredentialVerificationCache();
  const slot = { workspaceId: "ws", target: "host" };
  let basis = { id: "key-a", revision: 1 };
  cache.set({ ...slot, basis }, { status: "valid", message: "accepted", checkedAt: "2026-11-25T00:00:00.000Z" });
  const resolve = vi.fn(async () => assert.fail("readiness must not decrypt or probe"));
  const source: PublishCredentialSource = { resolve, isConfigured: async () => ({ configured: true, basis }) };
  const loaded = { pluginId: "hosting", descriptor: { id: "host", label: "Host", configFields: [] }, module: {} };
  const registry = { get: () => loaded, list: () => [loaded], refusals: [] };
  const deps = { workspaceId: "ws", publishExecutionMode: "hosted-api-only", publishCredentialVerificationCache: cache,
    authorize: async () => ({ allowed: true, reason: "test" }), requireToolPermission: async () => {},
    loadDeployTargets: async () => registry,
    credentialStorePorts: { credentialScopes: ({ deps, workspaceId }: { deps: unknown; workspaceId: string }) => [{ deps, workspaceId, scope: "site" }] },
    vendorCredentialSetRepo: { credentialVault: { open: () => ({ list: async () => [] }), scope: (input: unknown) => input } },
  } as unknown as StaticPublishToolDeps;
  const ctx: ToolExecutionContext = { executionId: "check", principal: { id: "operator" }, run: { id: "run" }, input: {}, signal: new AbortController().signal };
  const historyStore = new InMemoryPublishHistoryStore({ peerKind: "peer", resolvePublishHistoryListLimit: ({ requested }) => requested ?? 20 });
  const before = await getStaticPublishCapabilities({ deps, credentialSource: source, historyStore, ctx });
  assert.equal(before.providers[0]?.ready, true);
  basis = { id: "key-b", revision: 1 };
  const after = await getStaticPublishCapabilities({ deps, credentialSource: source, historyStore, ctx });
  const provider = after.providers[0];
  assert.ok(provider && "verified" in provider);
  assert.equal(provider.ready, false);
  assert.equal(provider.verified, null);
  assert.equal(provider.verifiedAt, null);
  assert.equal(JSON.stringify(after).includes('"basis"'), false);
  assert.equal(cache.get({ ...slot, basis: { id: "key-a", revision: 2 } }), undefined);
  assert.equal(cache.get({ ...slot, basis: { kind: "env" } }), undefined);
  assert.equal(resolve.mock.calls.length, 0);
});

test("disabled and refused plugins disclose activation, not credentials or readiness", async () => {
  const host = credentialTarget("host", "vendor");
  const off = credentialTarget("off", "off-vendor");
  const refused = credentialTarget("broken", "broken-vendor");
  const { deps: store, repo, registry } = storeFixture([host], { withProject: true });
  const isConfigured = vi.fn<PublishCredentialSource["isConfigured"]>(async ({ target, workspaceId }) => {
    assert.deepEqual({ target, workspaceId }, { target: "host", workspaceId: "ws" });
    return { configured: false, reason: "Save a compatible key first" };
  });
  const source: PublishCredentialSource = { isConfigured, resolve: async () => assert.fail("must not open the key") };
  const deps = {
    workspaceId: "ws", publishExecutionMode: "hosted-api-only", authorize: async () => ({ allowed: true }),
    requireToolPermission: async () => {}, loadDeployTargets: async () => ({ ...registry, refusals: ["broken refused", "executable refusal"] }),
    loadInstalledDeployTargets: async (input: { workspaceId: string }) => {
      assert.deepEqual(input, { workspaceId: "ws" });
      return { items: [{ descriptor: host.descriptor, pluginId: host.pluginId, enabled: true },
        { descriptor: off.descriptor, pluginId: off.pluginId, enabled: false },
        { descriptor: refused.descriptor, pluginId: refused.pluginId, enabled: true }], refusals: ["broken refused"] };
    },
    vendorCredentialSetRepo: repo, credentialStorePorts: store,
    publishCredentialVerificationCache: new InMemoryPublishCredentialVerificationCache(),
  } as unknown as StaticPublishToolDeps;
  const ctx: ToolExecutionContext = { executionId: "check", principal: { id: "operator" }, run: { id: "run" }, input: {}, signal: new AbortController().signal };
  const historyStore = new InMemoryPublishHistoryStore({ peerKind: "peer", resolvePublishHistoryListLimit: ({ requested }) => requested ?? 20 });
  const result = await getStaticPublishCapabilities({ deps, credentialSource: source, historyStore, ctx });
  const byId = new Map(result.providers.map(provider => [provider.providerId, provider]));
  assert.deepEqual(result.refusals, ["broken refused", "executable refusal"]);
  assert.deepEqual(byId.get("off"), {
    providerId: "off", label: "off", pluginId: "off-plugin", enabled: false, executable: false,
    ready: false, credentialConfigured: null, savedCredentials: null,
    guidance: "Turn on Agent Plugin 'off-plugin' under Admin → Agent Plugins, then call deployment_get_static_publish_capabilities again. Credentials and readiness have not been inspected for this host.",
  });
  assert.deepEqual(byId.get("broken"), {
    providerId: "broken", label: "broken", pluginId: "broken-plugin", enabled: true, executable: false,
    ready: false, credentialConfigured: null, savedCredentials: null,
    guidance: "The hosting plugin is enabled but its target could not be loaded. Inspect refusals before publishing.",
  });
  assert.equal(byId.get("host")?.guidance, "Save a compatible key first");
  assert.deepEqual(isConfigured.mock.calls, [[{ workspaceId: "ws", target: "host" }]]);
  assert.deepEqual(result.credentialSetup, { toolId: "credential_copy_from_project", message: "Use a saved key to choose from Shared Keys, or enter a new key in the secure card." });
});

test("provider rejections suggest replacement while a network failure suggests verifying again", async () => {
  const host = credentialTarget("host", "vendor");
  const { deps: store, repo, registry } = storeFixture([host]);
  const saved = await createPublishCredential(store, { workspaceId: "ws", label: "Team", connection: { providerId: "host", token: "not-for-model-output-1234" } });
  const cache = new InMemoryPublishCredentialVerificationCache();
  const basis = { id: saved.id, revision: (await repo.vault.find({ workspaceId: "ws", id: saved.id }))!.revision };
  const slot = { workspaceId: "ws", target: "host", basis };
  const source: PublishCredentialSource = { isConfigured: async () => ({ configured: true, basis }), resolve: async () => assert.fail("must not open a saved key") };
  const deps = {
    workspaceId: "ws", publishExecutionMode: "hosted-api-only", authorize: async () => ({ allowed: true }), requireToolPermission: async () => {},
    loadDeployTargets: async () => registry, vendorCredentialSetRepo: repo, credentialStorePorts: store, publishCredentialVerificationCache: cache,
  } as unknown as StaticPublishToolDeps;
  const ctx: ToolExecutionContext = { executionId: "check", principal: { id: "operator" }, run: { id: "run" }, input: {}, signal: new AbortController().signal };
  const historyStore = new InMemoryPublishHistoryStore({ peerKind: "peer", resolvePublishHistoryListLimit: ({ requested }) => requested ?? 20 });
  const checkedAt = "2026-11-25T00:00:00.000Z";
  cache.set(slot, { status: "invalid", checkedAt, message: "token revoked" });
  const invalid = await getStaticPublishCapabilities({ deps, credentialSource: source, historyStore, ctx });
  const rejected = invalid.providers.find(provider => provider.providerId === "host");
  assert.equal(rejected?.guidance, `The saved host credential was rejected by host (checked ${checkedAt}): token revoked Update it in the Static Site tab.`);
  assert.equal(rejected?.ready, false);
  assert.equal("credentialSetup" in invalid, false);
  cache.set(slot, { status: "unreachable", checkedAt, message: "socket timeout" });
  const transient = await getStaticPublishCapabilities({ deps, credentialSource: source, historyStore, ctx });
  const pending = transient.providers.find(provider => provider.providerId === "host");
  assert.equal(pending?.guidance, `The last check of this host credential could not reach host (checked ${checkedAt}): socket timeout This does not mean the credential is bad — try verifying again in the Static Site tab.`);
  assert.equal(pending?.ready, false);
  assert.equal(JSON.stringify(transient).includes("not-for-model-output"), false);
});
