import assert from "node:assert/strict";
import { test } from "vitest";

import { ForbiddenError } from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import type { SettingsRepoPort } from "../ports.js";
import { purgeTenantSettings } from "../purge-service.js";
import { set } from "../write-service.js";
import { InMemoryPrincipalRepo } from "../../identity/index.js";
import type { SettingDefinitionRecord } from "../types.js";

/**
 * T026 (AC-12, INV-06) — the ledgered tenant/principal purge: authorize once,
 * then append a redacted `op='purge'` revision per affected row before
 * deleting it, all in one transaction; prior revision rows must remain in
 * the ledger untouched (ADR-028 §5).
 */

const clock = { nowIso: () => "2026-07-12T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const alwaysDeny = async () => ({ allowed: false, reason: "no_grant" });
const NOW = "2026-07-12T00:00:00.000Z";

function definition(key: string, overrides: Partial<SettingDefinitionRecord> = {}): SettingDefinitionRecord {
  return {
    settingId: `setting-${key}`,
    version: 1,
    workspaceId: null,
    namespace: "core.ns",
    key,
    ownerKind: "core",
    ownerId: null,
    schema: { type: "string" },
    defaultValue: "default",
    scopes: 1 | 2 | 4,
    secret: false,
    status: "active",
    aliasOfNamespace: null,
    aliasOfKey: null,
    coercionTag: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Records the order `appendRevision` vs `delete*Value` calls happen in, delegating to a real repo underneath. */
function wrapWithCallLog(repo: SettingsRepoPort, log: string[]): SettingsRepoPort {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== "function") return original;
      if (prop === "appendRevision" || prop === "deleteWorkspaceValue" || prop === "deleteUserValue") {
        return async (...args: unknown[]) => {
          log.push(String(prop));
          return (original as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return original.bind(target);
    },
  });
}

test("purgeTenantSettings (full tenant, no principalId) purges every workspace- and user-scope row for the workspace, each with a redacted op='purge' revision, in one call (AC-12)", async () => {
  const defA = definition("a", { scopes: 2 }); // workspace-scoped
  const defB = definition("b", { scopes: 4 }); // user-scoped
  const repo = new InMemorySettingsRepo({ definitions: [defA, defB] });
  const principals = new InMemoryPrincipalRepo([
    { id: "p-1", workspaceId: "ws-1", kind: "user", displayName: "P1", status: "active", createdAt: NOW },
    { id: "p-2", workspaceId: "ws-1", kind: "user", displayName: "P2", status: "active", createdAt: NOW },
  ]);
  const writeDeps = { repo, clock, ids, authorize: alwaysAllow, principals };

  await set({
    deps: writeDeps,
    input: { namespace: "core.ns", key: "a", scope: "workspace", value: "x", workspaceId: "ws-1", callerPrincipalId: "actor-1" },
  });
  await set({
    deps: writeDeps,
    input: { namespace: "core.ns", key: "b", scope: "user", value: "y", workspaceId: "ws-1", principalId: "p-1", callerPrincipalId: "actor-1" },
  });
  await set({
    deps: writeDeps,
    input: { namespace: "core.ns", key: "b", scope: "user", value: "z", workspaceId: "ws-1", principalId: "p-2", callerPrincipalId: "actor-1" },
  });

  const priorRevsA = await repo.listRevisions({ settingId: defA.settingId });
  const priorRevsB = await repo.listRevisions({ settingId: defB.settingId });
  assert.equal(priorRevsA.length, 1);
  assert.equal(priorRevsB.length, 2);

  const result = await purgeTenantSettings({
    deps: { repo, clock, authorize: alwaysAllow },
    input: { workspaceId: "ws-1", callerPrincipalId: "actor-1" },
  });

  assert.equal(result.purgedCount, 3);

  // rows deleted
  assert.equal(await repo.getWorkspaceValue({ workspaceId: "ws-1", settingId: defA.settingId }), null);
  assert.equal(await repo.getUserValue({ workspaceId: "ws-1", principalId: "p-1", settingId: defB.settingId }), null);
  assert.equal(await repo.getUserValue({ workspaceId: "ws-1", principalId: "p-2", settingId: defB.settingId }), null);

  // prior 'set' revisions remain, plus a new redacted 'purge' revision appended after them
  const revsA = await repo.listRevisions({ settingId: defA.settingId });
  const revsB = await repo.listRevisions({ settingId: defB.settingId });
  assert.equal(revsA.length, 2);
  assert.equal(revsA[0]!.op, "set");
  assert.equal(revsA[1]!.op, "purge");
  assert.equal(revsA[1]!.beforeJson, null);
  assert.equal(revsA[1]!.afterJson, null);

  // both p-1 and p-2 wrote to the same setting_id (they share definition `b`),
  // so its ledger holds both prior 'set' revisions plus both 'purge' revisions.
  assert.equal(revsB.length, 4);
  assert.deepEqual(
    revsB.map((r) => r.op),
    ["set", "set", "purge", "purge"]
  );
  for (const rev of revsB.slice(2)) {
    assert.equal(rev.beforeJson, null);
    assert.equal(rev.afterJson, null);
  }
});

test("purgeTenantSettings scoped to a principalId only purges that principal's user-scope rows, leaving other principals' and workspace-scope values intact", async () => {
  const defA = definition("a", { scopes: 2 });
  const defB = definition("b", { scopes: 4 });
  const repo = new InMemorySettingsRepo({ definitions: [defA, defB] });
  const principals = new InMemoryPrincipalRepo([
    { id: "p-1", workspaceId: "ws-1", kind: "user", displayName: "P1", status: "active", createdAt: NOW },
    { id: "p-2", workspaceId: "ws-1", kind: "user", displayName: "P2", status: "active", createdAt: NOW },
  ]);
  const writeDeps = { repo, clock, ids, authorize: alwaysAllow, principals };

  await set({
    deps: writeDeps,
    input: { namespace: "core.ns", key: "a", scope: "workspace", value: "x", workspaceId: "ws-1", callerPrincipalId: "actor-1" },
  });
  await set({
    deps: writeDeps,
    input: { namespace: "core.ns", key: "b", scope: "user", value: "y", workspaceId: "ws-1", principalId: "p-1", callerPrincipalId: "actor-1" },
  });
  await set({
    deps: writeDeps,
    input: { namespace: "core.ns", key: "b", scope: "user", value: "z", workspaceId: "ws-1", principalId: "p-2", callerPrincipalId: "actor-1" },
  });

  const result = await purgeTenantSettings({
    deps: { repo, clock, authorize: alwaysAllow },
    input: { workspaceId: "ws-1", principalId: "p-1", callerPrincipalId: "actor-1" },
  });

  assert.equal(result.purgedCount, 1);
  assert.equal(await repo.getUserValue({ workspaceId: "ws-1", principalId: "p-1", settingId: defB.settingId }), null);
  assert.equal(
    (await repo.getUserValue({ workspaceId: "ws-1", principalId: "p-2", settingId: defB.settingId }))?.valueJson,
    "z"
  );
  assert.equal(
    (await repo.getWorkspaceValue({ workspaceId: "ws-1", settingId: defA.settingId }))?.valueJson,
    "x"
  );
});

test("purgeTenantSettings is rejected FORBIDDEN and deletes/appends nothing when the caller is unauthorized", async () => {
  const defA = definition("a", { scopes: 2 });
  const repo = new InMemorySettingsRepo({ definitions: [defA] });
  const principals = new InMemoryPrincipalRepo([]);

  await set({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: { namespace: "core.ns", key: "a", scope: "workspace", value: "x", workspaceId: "ws-1", callerPrincipalId: "actor-1" },
  });

  await assert.rejects(
    () =>
      purgeTenantSettings({
        deps: { repo, clock, authorize: alwaysDeny },
        input: { workspaceId: "ws-1", callerPrincipalId: "actor-1" },
      }),
    ForbiddenError
  );

  assert.equal(
    (await repo.getWorkspaceValue({ workspaceId: "ws-1", settingId: defA.settingId }))?.valueJson,
    "x"
  );
  assert.equal((await repo.listRevisions({ settingId: defA.settingId })).length, 1);
});

test("purgeTenantSettings appends the purge revision before deleting the row, per affected row (INV-06 ordering)", async () => {
  const defA = definition("a", { scopes: 2 });
  const repo = new InMemorySettingsRepo({ definitions: [defA] });
  const principals = new InMemoryPrincipalRepo([]);

  await set({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: { namespace: "core.ns", key: "a", scope: "workspace", value: "x", workspaceId: "ws-1", callerPrincipalId: "actor-1" },
  });

  const log: string[] = [];
  const spiedRepo = wrapWithCallLog(repo, log);

  await purgeTenantSettings({
    deps: { repo: spiedRepo, clock, authorize: alwaysAllow },
    input: { workspaceId: "ws-1", callerPrincipalId: "actor-1" },
  });

  assert.deepEqual(log, ["appendRevision", "deleteWorkspaceValue"]);
});

test("purgeTenantSettings against an already-empty workspace purges nothing and does not error", async () => {
  const repo = new InMemorySettingsRepo({});

  const result = await purgeTenantSettings({
    deps: { repo, clock, authorize: alwaysAllow },
    input: { workspaceId: "ws-empty", callerPrincipalId: "actor-1" },
  });

  assert.equal(result.purgedCount, 0);
});
