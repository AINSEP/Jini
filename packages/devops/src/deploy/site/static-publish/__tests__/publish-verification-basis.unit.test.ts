import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { PublishCredentialSource } from "../types.js";
import type { StaticPublishToolDeps } from "../../publish-tool-deps.js";
import { getStaticPublishCapabilities } from "../../publish-tool-capabilities.js";
import { InMemoryPublishCredentialVerificationCache } from "../verify.js";
import { InMemoryPublishHistoryStore } from "../publish-history.js";

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
  const historyStore = new InMemoryPublishHistoryStore({ resolvePublishHistoryListLimit: ({ requested }) => requested ?? 20 });
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
