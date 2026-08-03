import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryPrincipalRepo } from "../../identity/index.js";
import { AliasDepthExceededError, DefinitionNotFoundError } from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { registerDefinitions, renameDefinition, retypeDefinition } from "../write-service.js";

const clock = { nowIso: () => "2026-07-12T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

function deps() {
  const repo = new InMemorySettingsRepo();
  const principals = new InMemoryPrincipalRepo([]);
  return { repo, clock, ids, authorize: alwaysAllow, principals };
}

async function register(d: ReturnType<typeof deps>, namespace: string, key: string) {
  const { registered } = await registerDefinitions({
    deps: d,
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

test("renameDefinition after a retype: v1 alias marker lands at the old name, settingId is preserved (AC-09)", async () => {
  const d = deps();
  const settingId = await register(d, "core.ns", "a");

  await retypeDefinition({
    deps: d,
    input: {
      namespace: "core.ns",
      key: "a",
      workspaceId: null,
      schema: { type: "string" },
      defaultValue: "default-v2",
      coercionTag: "identity",
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });

  const result = await renameDefinition({
    deps: d,
    input: {
      namespace: "core.ns",
      key: "a",
      workspaceId: null,
      newNamespace: "core.ns",
      newKey: "b",
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });

  assert.equal(result.settingId, settingId);

  const marker = await d.repo.findActiveDefinition({ namespace: "core.ns", key: "a", workspaceId: null });
  assert.ok(marker);
  assert.equal(marker?.status, "alias");
  assert.equal(marker?.version, 1);
  assert.equal(marker?.aliasOfNamespace, "core.ns");
  assert.equal(marker?.aliasOfKey, "b");
  assert.notEqual(marker?.settingId, settingId);

  const moved = await d.repo.findActiveDefinition({ namespace: "core.ns", key: "b", workspaceId: null });
  assert.ok(moved);
  assert.equal(moved?.status, "active");
  assert.equal(moved?.settingId, settingId);
  assert.equal(moved?.version, 2);

  const revisions = await d.repo.listRevisions({ settingId });
  const ops = revisions.map((r) => r.op);
  assert.ok(ops.includes("retype"));
  assert.ok(ops.includes("alias"));
});

test("sequential rename A->B->C retargets prior markers to C in the same tx", async () => {
  const d = deps();
  const settingId = await register(d, "core.ns", "a");

  await renameDefinition({
    deps: d,
    input: {
      namespace: "core.ns",
      key: "a",
      workspaceId: null,
      newNamespace: "core.ns",
      newKey: "b",
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });

  await renameDefinition({
    deps: d,
    input: {
      namespace: "core.ns",
      key: "b",
      workspaceId: null,
      newNamespace: "core.ns",
      newKey: "c",
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });

  const markerA = await d.repo.findActiveDefinition({ namespace: "core.ns", key: "a", workspaceId: null });
  assert.equal(markerA?.status, "alias");
  assert.equal(markerA?.aliasOfNamespace, "core.ns");
  assert.equal(markerA?.aliasOfKey, "c", "the A marker must be retargeted from B to C, not left pointing at B");

  const markerB = await d.repo.findActiveDefinition({ namespace: "core.ns", key: "b", workspaceId: null });
  assert.equal(markerB?.status, "alias");
  assert.equal(markerB?.aliasOfNamespace, "core.ns");
  assert.equal(markerB?.aliasOfKey, "c");

  const active = await d.repo.findActiveDefinition({ namespace: "core.ns", key: "c", workspaceId: null });
  assert.equal(active?.status, "active");
  assert.equal(active?.settingId, settingId);
});

test("rename target that resolves to an existing alias is rejected ALIAS_DEPTH_EXCEEDED (EC-06)", async () => {
  const d = deps();
  await register(d, "core.ns", "a");
  await register(d, "core.ns", "x");

  // core.ns.a -> core.ns.b leaves an alias marker at 'a'.
  await renameDefinition({
    deps: d,
    input: {
      namespace: "core.ns",
      key: "a",
      workspaceId: null,
      newNamespace: "core.ns",
      newKey: "b",
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });

  // Renaming the unrelated 'x' definition onto 'a' would point a fresh marker
  // at an existing alias marker (depth > 1) -- must be rejected.
  await assert.rejects(
    () =>
      renameDefinition({
        deps: d,
        input: {
          namespace: "core.ns",
          key: "x",
          workspaceId: null,
          newNamespace: "core.ns",
          newKey: "a",
          callerPrincipalId: "actor-1",
          authWorkspaceId: "ws-1",
        },
      }),
    AliasDepthExceededError
  );
});

test("renameDefinition rejects a missing source definition", async () => {
  const d = deps();
  await assert.rejects(
    () =>
      renameDefinition({
        deps: d,
        input: {
          namespace: "core.ns",
          key: "missing",
          workspaceId: null,
          newNamespace: "core.ns",
          newKey: "elsewhere",
          callerPrincipalId: "actor-1",
          authWorkspaceId: "ws-1",
        },
      }),
    DefinitionNotFoundError
  );
});
