import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemorySettingsPrincipalLookup } from "./principal.fixture.js";
import { ForbiddenError } from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { clear, resetNamespace, set } from "../write-service.js";
import type { SettingDefinitionRecord, SettingValueRecord } from "../types.js";

/**
 * The write chokepoint's workspace guards: a non-global write must land in the workspace it was
 * authorized against, and a write that names no workspace at all is stored partition-less
 * (`workspaceId: null`) rather than borrowing the authorization workspace.
 */

const clock = { nowMs: () => Date.parse("2026-07-11T00:00:00.000Z") };
let idCounter = 0;
const ids = { newId: () => `id-${++idCounter}` };
const NOW = "2026-07-11T00:00:00.000Z";

function definition(): SettingDefinitionRecord {
  return {
    settingId: "setting-1",
    version: 1,
    workspaceId: null,
    namespace: "core.presentation",
    key: "activeThemeId",
    ownerKind: "core",
    ownerId: null,
    schema: { type: "string" },
    defaultValue: "paper",
    scopes: 1 | 2 | 4,
    secret: false,
    status: "active",
    aliasOfNamespace: null,
    aliasOfKey: null,
    coercionTag: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** A real in-memory repo that also records every value row it is asked to save. */
class RecordingRepo extends InMemorySettingsRepo {
  readonly saved: Array<{ kind: "workspace" | "user"; row: SettingValueRecord }> = [];
  override async saveWorkspaceValue(row: SettingValueRecord): Promise<void> {
    this.saved.push({ kind: "workspace", row });
    await super.saveWorkspaceValue(row);
  }
  override async saveUserValue(row: SettingValueRecord): Promise<void> {
    this.saved.push({ kind: "user", row });
    await super.saveUserValue(row);
  }
}

function harness() {
  const repo = new RecordingRepo({ definitions: [definition()] });
  const authorizeCalls: unknown[] = [];
  const principals = new InMemorySettingsPrincipalLookup([]);
  const authorize = async (request: unknown) => {
    authorizeCalls.push(request);
    return { allowed: true, reason: "matched" };
  };
  return { repo, authorizeCalls, deps: { repo, clock, ids, authorize, principals } };
}

const target = { namespace: "core.presentation", key: "activeThemeId" };

test("set, clear and resetNamespace refuse FORBIDDEN, before authorizing or writing, when the target workspace differs from the authorized one", async () => {
  const { repo, authorizeCalls, deps } = harness();
  const crossTenant = { workspaceId: "ws-other", authWorkspaceId: "ws-1", callerPrincipalId: "actor-1" };
  const isCrossTenantRefusal = (error: unknown) =>
    error instanceof ForbiddenError &&
    /authorized against workspace 'ws-1' but the write targets workspace 'ws-other'/.test(error.message);

  await assert.rejects(() => set({ deps, input: { ...target, ...crossTenant, scope: "workspace", value: "atlas" } }), isCrossTenantRefusal);
  await assert.rejects(() => clear({ deps, input: { ...target, ...crossTenant, scope: "user" } }), isCrossTenantRefusal);
  await assert.rejects(
    () => resetNamespace({ deps, input: { namespace: target.namespace, ...crossTenant, scope: "workspace" } }, [target.key]),
    isCrossTenantRefusal
  );

  assert.deepEqual(authorizeCalls, []);
  assert.deepEqual(repo.saved, []);
  assert.equal(await repo.maxRevisionSeq(), 0);
});

test("a workspace-scope set that names no workspace stores a partition-less row and revision", async () => {
  const { repo, deps } = harness();

  await set({ deps, input: { ...target, scope: "workspace", value: "atlas", callerPrincipalId: "actor-1", authWorkspaceId: "ws-1" } });

  assert.equal(repo.saved.length, 1);
  assert.equal(repo.saved[0]!.kind, "workspace");
  assert.equal(repo.saved[0]!.row.workspaceId, null);
  assert.equal(repo.saved[0]!.row.valueJson, "atlas");
  const [revision] = await repo.listRevisions({ settingId: "setting-1" });
  assert.equal(revision?.workspaceId, null);
});

test("a user-scope set for another principal with no workspace skips the membership lookup and stores the target principal's row", async () => {
  const { repo, deps } = harness();

  await set({
    deps,
    input: { ...target, scope: "user", value: "atlas", principalId: "p-2", callerPrincipalId: "actor-1", authWorkspaceId: "ws-1" },
  });

  assert.equal(repo.saved.length, 1);
  assert.deepEqual(
    { kind: repo.saved[0]!.kind, workspaceId: repo.saved[0]!.row.workspaceId, principalId: repo.saved[0]!.row.principalId },
    { kind: "user", workspaceId: null, principalId: "p-2" }
  );
});

test("clear that names no workspace writes partition-less cleared rows at workspace and user scope", async () => {
  const { repo, deps } = harness();
  const caller = { callerPrincipalId: "actor-1", authWorkspaceId: "ws-1" };

  await clear({ deps, input: { ...target, ...caller, scope: "workspace" } });
  await clear({ deps, input: { ...target, ...caller, scope: "user" } });

  assert.deepEqual(
    repo.saved.map(({ kind, row }) => ({ kind, workspaceId: row.workspaceId, principalId: row.principalId, state: row.state })),
    [
      { kind: "workspace", workspaceId: null, principalId: null, state: "cleared" },
      { kind: "user", workspaceId: null, principalId: "actor-1", state: "cleared" },
    ]
  );
});
