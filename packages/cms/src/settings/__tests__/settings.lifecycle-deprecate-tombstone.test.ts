import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryPrincipalRepo } from "../../identity/index.js";
import { DefinitionNotFoundError, DefinitionTombstonedError } from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { deprecateDefinition, registerDefinitions, tombstoneDefinition } from "../write-service.js";

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

test("deprecateDefinition flips status to deprecated and ledgers an op='deprecate' revision", async () => {
  const d = deps();
  const settingId = await register(d, "core.ns", "a");

  const result = await deprecateDefinition({
    deps: d,
    input: { namespace: "core.ns", key: "a", workspaceId: null, callerPrincipalId: "actor-1", authWorkspaceId: "ws-1" },
  });

  assert.equal(result.settingId, settingId);
  const stored = await d.repo.findDefinitionBySettingId({ settingId, version: 1 });
  assert.equal(stored?.status, "deprecated");
  const revisions = await d.repo.listRevisions({ settingId });
  assert.equal(revisions[revisions.length - 1]!.op, "deprecate");
});

test("tombstoneDefinition flips status to tombstone and ledgers an op='tombstone' revision", async () => {
  const d = deps();
  const settingId = await register(d, "core.ns", "a");

  const result = await tombstoneDefinition({
    deps: d,
    input: { namespace: "core.ns", key: "a", workspaceId: null, callerPrincipalId: "actor-1", authWorkspaceId: "ws-1" },
  });

  assert.equal(result.settingId, settingId);
  const stored = await d.repo.findActiveDefinition({ namespace: "core.ns", key: "a", workspaceId: null });
  assert.equal(stored?.status, "tombstone");
  const revisions = await d.repo.listRevisions({ settingId });
  assert.equal(revisions[revisions.length - 1]!.op, "tombstone");
});

test("tombstoneDefinition rejects an already-tombstoned definition", async () => {
  const d = deps();
  await register(d, "core.ns", "a");
  await tombstoneDefinition({
    deps: d,
    input: { namespace: "core.ns", key: "a", workspaceId: null, callerPrincipalId: "actor-1", authWorkspaceId: "ws-1" },
  });

  await assert.rejects(
    () =>
      tombstoneDefinition({
        deps: d,
        input: { namespace: "core.ns", key: "a", workspaceId: null, callerPrincipalId: "actor-1", authWorkspaceId: "ws-1" },
      }),
    DefinitionTombstonedError
  );
});

test("deprecateDefinition rejects a missing definition", async () => {
  const d = deps();
  await assert.rejects(
    () =>
      deprecateDefinition({
        deps: d,
        input: { namespace: "core.ns", key: "missing", workspaceId: null, callerPrincipalId: "actor-1", authWorkspaceId: "ws-1" },
      }),
    DefinitionNotFoundError
  );
});
