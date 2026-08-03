import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryPrincipalRepo } from "../../identity/index.js";
import { ForbiddenError } from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import {
  deprecateDefinition,
  registerDefinitions,
  renameDefinition,
  retypeDefinition,
  tombstoneDefinition,
} from "../write-service.js";

/**
 * @file `authorizeDefinitionsManage` (ADR-028 §3/§7) is the single shared authorization gate in
 * front of every definition-lifecycle op: rename/retype/deprecate/tombstone each call it before
 * touching the repo. A mutation sweep proved a denied caller could reach all four writes
 * unchallenged with this one gate deleted outright -- every existing lifecycle test
 * (settings.lifecycle-rename/-retype/-deprecate-tombstone.test.ts) passes `alwaysAllow`, so the
 * gate itself was never exercised. This file exists solely to close that gap.
 */

const clock = { nowIso: () => "2026-07-31T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const alwaysDeny = async () => ({ allowed: false, reason: "no_grant" });

async function seedDefinition(repo: InMemorySettingsRepo, principals: InMemoryPrincipalRepo, namespace: string, key: string) {
  const { registered } = await registerDefinitions({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: {
      definitions: [
        {
          namespace,
          key,
          ownerKind: "core" as const,
          workspaceId: null,
          schema: { type: "string" as const },
          defaultValue: "default",
          scopes: 2,
          secret: false,
        },
      ],
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });
  return registered[0]!;
}

test("renameDefinition/retypeDefinition/deprecateDefinition/tombstoneDefinition are each rejected FORBIDDEN when the caller lacks settings.definitions.manage, and none of the four writes anything", async () => {
  const repo = new InMemorySettingsRepo();
  const principals = new InMemoryPrincipalRepo([]);
  const settingId = await seedDefinition(repo, principals, "core.ns", "a");
  const deniedDeps = { repo, clock, ids, authorize: alwaysDeny, principals };

  await assert.rejects(
    () =>
      renameDefinition({
        deps: deniedDeps,
        input: {
          namespace: "core.ns",
          key: "a",
          workspaceId: null,
          newNamespace: "core.ns",
          newKey: "b",
          callerPrincipalId: "actor-1",
          authWorkspaceId: "ws-1",
        },
      }),
    ForbiddenError
  );

  await assert.rejects(
    () =>
      retypeDefinition({
        deps: deniedDeps,
        input: {
          namespace: "core.ns",
          key: "a",
          workspaceId: null,
          schema: { type: "number" },
          defaultValue: 1,
          coercionTag: "identity",
          callerPrincipalId: "actor-1",
          authWorkspaceId: "ws-1",
        },
      }),
    ForbiddenError
  );

  await assert.rejects(
    () =>
      deprecateDefinition({
        deps: deniedDeps,
        input: { namespace: "core.ns", key: "a", workspaceId: null, callerPrincipalId: "actor-1", authWorkspaceId: "ws-1" },
      }),
    ForbiddenError
  );

  await assert.rejects(
    () =>
      tombstoneDefinition({
        deps: deniedDeps,
        input: { namespace: "core.ns", key: "a", workspaceId: null, callerPrincipalId: "actor-1", authWorkspaceId: "ws-1" },
      }),
    ForbiddenError
  );

  // None of the four denied calls may have written anything: still v1, still active, still at 'a',
  // and no lifecycle revision beyond the original 'register' was ever appended.
  const current = await repo.findActiveDefinition({ namespace: "core.ns", key: "a", workspaceId: null });
  assert.equal(current?.status, "active");
  assert.equal(current?.version, 1);
  assert.equal(current?.settingId, settingId);
  const revisions = await repo.listRevisions({ settingId });
  assert.equal(
    revisions.length,
    1,
    "only the initial 'register' revision should exist -- none of the four denied lifecycle calls should have appended one"
  );
  assert.equal(revisions[0]!.op, "register");
});
