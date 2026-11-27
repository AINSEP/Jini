import assert from "node:assert/strict";
import { test } from "vitest";

import { ForbiddenError, InMemorySettingsRepo, ValueValidationFailedError, getEffective, type SetValueRequired, type SettingDefinitionRecord } from "@jini-ai/core/settings";

import {
  clear, COMMENTS_PROVIDER_WRITE_REASON, dedicatedSettingsWriters, refuseDedicatedSettingReset, resetNamespace, set,
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

function fixture(extra: SettingDefinitionRecord[] = []) {
  const repo = new InMemorySettingsRepo({ definitions: [definition("host.policy", "locked"), definition("core.comments", "provider"), ...extra] });
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

test("site title bounds trim before measuring, reject blank or oversized titles, and keep the previous value", async () => {
  const f = fixture([{ ...definition("core.site", "title"), schema: { type: "string" }, defaultValue: "Initial" }]);
  const input = { ...f.input, namespace: "core.site", key: "title" };
  const write = (value: string) => set({ deps: f.deps, input: { ...input, value }, writePolicies: f.writePolicies });
  const read = () => getEffective({ deps: { repo: f.repo }, namespace: input.namespace, key: input.key, scopeContext: { workspaceId: WS } });
  await write("  " + "x".repeat(200) + "  ");
  assert.equal((await read())?.value, "x".repeat(200));
  for (const value of [" \t ", "x".repeat(201)]) {
    await assert.rejects(write(value), (error: unknown) => error instanceof ValueValidationFailedError &&
      error.message === "value for 'core.site.title' must be 1..200 characters after trimming");
  }
  assert.equal((await read())?.value, "x".repeat(200));
  assert.equal((await f.repo.listRevisions({ settingId: "core.site.title" })).length, 1);
});

test("visitor enable through an alias requires the host's readiness decision for this workspace", async () => {
  const f = fixture([
    { ...definition("site.assistant", "public_enabled"), workspaceId: WS, defaultValue: false },
    { ...definition("site.assistant", "visitor_alias"), workspaceId: WS, status: "alias", aliasOfNamespace: "site.assistant", aliasOfKey: "public_enabled" },
  ]);
  const save = (value: boolean, canEnablePublicAssistant?: (required: { workspaceId: string }) => Promise<boolean>) =>
    set({ deps: f.deps, input: { ...f.input, namespace: "site.assistant", key: "visitor_alias", value }, writePolicies: f.writePolicies },
      canEnablePublicAssistant ? { canEnablePublicAssistant } : {});
  const calls: unknown[] = [];
  const readiness = async (request: { workspaceId: string }) => { calls.push(request); return calls.length === 2; };
  const read = () => getEffective({ deps: { repo: f.repo }, namespace: "site.assistant", key: "public_enabled", scopeContext: { workspaceId: WS } });
  const refusal = (error: unknown) => error instanceof ValueValidationFailedError &&
    error.message === "Save a usable provider key and a model in AI Assistant before enabling the public assistant.";

  await assert.rejects(save(true), refusal);
  await assert.rejects(save(true, readiness), refusal);
  assert.equal((await read())?.sourceLayer, "default");
  await save(true, readiness);
  assert.equal((await read())?.value, true);
  await save(false);
  assert.equal((await read())?.value, false);
  assert.deepEqual(calls, [{ workspaceId: WS }, { workspaceId: WS }]);
});

test("preview switcher refuses an uncomposed writer and persists the theme policy's normalized proposal", async () => {
  const f = fixture([definition("core.theme", "previewSwitcher")]);
  const input = { ...f.input, namespace: "core.theme", key: "previewSwitcher", value: { enabled: true } };
  const required = { deps: f.deps, input, writePolicies: f.writePolicies };
  await assert.rejects(set(required), (error: unknown) => error instanceof ValueValidationFailedError &&
    error.message === "Theme preview write policy is unavailable.");
  assert.equal(await f.repo.getWorkspaceValue({ workspaceId: WS, settingId: "core.theme.previewSwitcher" }), null);
  const calls: SetValueRequired[] = [];
  await set(required, { preparePreviewSwitcherWrite: async (proposed) => {
    calls.push(proposed);
    return { ...proposed, input: { ...proposed.input, value: { enabled: true, modes: ["compact"] } } };
  } });
  assert.deepEqual(calls, [{ deps: f.deps, input }]);
  assert.deepEqual((await f.repo.getWorkspaceValue({ workspaceId: WS, settingId: "core.theme.previewSwitcher" }))?.valueJson,
    { enabled: true, modes: ["compact"] });
});

test("clears an ordinary workspace value and resets only the requested namespace keys", async () => {
  const f = fixture([definition("core.ui", "palette"), definition("core.ui", "density"), definition("core.ui", "locale")]);
  const target = { ...f.input, namespace: "core.ui" };
  for (const key of ["palette", "density", "locale"]) {
    await set({ deps: f.deps, input: { ...target, key, value: key + "-custom" }, writePolicies: f.writePolicies });
  }
  const read = (key: string) => f.repo.getWorkspaceValue({ workspaceId: WS, settingId: `core.ui.${key}` });
  const cleared = await clear({ deps: f.deps, input: { ...target, key: "palette" }, writePolicies: f.writePolicies });
  assert.equal((await read("palette"))?.state, "cleared");
  assert.equal((await read("palette"))?.seq, cleared.revisionSeq);
  const reset = await resetNamespace({ deps: f.deps, input: target, keysInNamespace: ["density"], writePolicies: f.writePolicies });
  assert.equal(reset.clearedCount, 1);
  assert.deepEqual(reset.revisionSeqs, [(await read("density"))?.seq]);
  assert.equal((await read("density"))?.state, "cleared");
  assert.equal((await read("locale"))?.valueJson, "locale-custom");
});
