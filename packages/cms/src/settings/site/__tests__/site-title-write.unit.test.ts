import assert from "node:assert/strict";
import { test } from "vitest";

import { ForbiddenError, InMemorySettingsRepo, type SetValueRequired, type SettingDefinitionRecord } from "@jini-ai/core/settings";

import {
  clear, COMMENTS_PROVIDER_WRITE_REASON, dedicatedSettingsWriters, refuseDedicatedSettingReset, set,
  type DedicatedSettingsWriter, type SiteSettingsWritePolicies,
} from "../site-title-write.js";

/**
 * @file The chokepoint applies the host's injected `writePolicies.dedicatedWriters`: a generic write
 * without the writer's permission is refused, a permitted write is handed to the writer's
 * `normalize` exactly as the caller built it, and clears/resets of that coordinate are refused.
 */

const WS = "ws-policy";
const NOW = "2026-11-23T00:00:00.000Z";

function definition(namespace: string, key: string): SettingDefinitionRecord {
  return {
    settingId: `${namespace}.${key}`, version: 1, workspaceId: null, namespace, key, ownerKind: "core", ownerId: null,
    schema: { type: "json" }, defaultValue: {}, scopes: 6, secret: false,
    status: "active", aliasOfNamespace: null, aliasOfKey: null, coercionTag: null, createdAt: NOW, updatedAt: NOW,
  };
}

function fixture() {
  const repo = new InMemorySettingsRepo({ definitions: [definition("host.policy", "locked"), definition("core.comments", "provider")] });
  let next = 0;
  const deps = {
    repo, clock: { nowIso: () => NOW, nowMs: () => Date.parse(NOW) }, ids: { newId: () => `id-${(next += 1)}` },
    authorize: async () => ({ allowed: true, reason: "test" }), principals: { findActiveById: async () => null },
  } as unknown as SetValueRequired["deps"];
  const calls: Array<{ required: SetValueRequired }> = [];
  const writer: DedicatedSettingsWriter = {
    namespace: "host.policy", key: "locked", permissionOverride: "host.manage", reason: "Use the host's dedicated path.",
    normalize: (args) => { calls.push(args); return { ...args.required, input: { ...args.required.input, value: { normalized: true } } }; },
  };
  const writePolicies: SiteSettingsWritePolicies = { dedicatedWriters: [writer] };
  const input = { namespace: "host.policy", key: "locked", scope: "workspace" as const, workspaceId: WS, authWorkspaceId: WS, callerPrincipalId: "owner", value: { raw: true } };
  return { repo, deps, calls, writePolicies, input };
}

test("a host dedicated writer refuses a generic write before its normalize hook runs", async () => {
  const f = fixture();
  await assert.rejects(set({ deps: f.deps, input: f.input, writePolicies: f.writePolicies }), (error: unknown) =>
    error instanceof ForbiddenError && error.message === "Use the host's dedicated path.");
  assert.equal(f.calls.length, 0);
});

test("a permitted write reaches the injected normalize hook with the caller's own arguments, and stores its result", async () => {
  const f = fixture();
  const input = { ...f.input, requiredPermissionOverride: "host.manage" };
  const result = await set({ deps: f.deps, input, writePolicies: f.writePolicies });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], { required: { deps: f.deps, input } });
  assert.equal(f.calls[0]?.required.deps, f.deps);
  assert.deepEqual(result.value, { normalized: true });
});

test("clear and namespace reset refuse a host dedicated writer's coordinate", async () => {
  const f = fixture();
  await assert.rejects(clear({ deps: f.deps, input: { ...f.input }, writePolicies: f.writePolicies }), ForbiddenError);
  await assert.rejects(refuseDedicatedSettingReset({ repo: f.repo, input: { namespace: "host.policy", scope: "global" }, writePolicies: f.writePolicies }), ForbiddenError);
});

test("the comments provider stays refused ahead of the host's writers, even with none injected", async () => {
  const f = fixture();
  const none: SiteSettingsWritePolicies = { dedicatedWriters: [] };
  assert.deepEqual(dedicatedSettingsWriters({ writePolicies: f.writePolicies }).map(({ namespace, key }) => `${namespace}.${key}`), ["core.comments.provider", "host.policy.locked"]);
  await assert.rejects(set({ deps: f.deps, input: { ...f.input, namespace: "core.comments", key: "provider", value: "none" }, writePolicies: none }),
    (error: unknown) => error instanceof ForbiddenError && error.message === COMMENTS_PROVIDER_WRITE_REASON);
});
