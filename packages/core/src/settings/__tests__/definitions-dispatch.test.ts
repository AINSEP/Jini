import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemorySettingsPrincipalLookup } from "./principal.fixture.js";
import { NON_REGISTER_DEFINITION_OPS, parseNonRegisterDefinitionOp } from "../definitions-dispatch.js";
import type { DefinitionOpContext, DefinitionOpRequestItem } from "../definitions-dispatch.js";
import { AliasDepthExceededError, DefinitionInvalidError } from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { registerDefinitions } from "../write-service.js";

/**
 * The per-op dispatch table a host's `SETTINGS_REGISTER_DEFINITIONS` route looks up into: each
 * entry translates a raw request item into one write-service call, filling the optional request
 * fields with their documented defaults (`defaultJson` -> null, `coercionJson` -> identity coercer).
 */

const clock = { nowMs: () => Date.parse("2026-07-12T00:00:00.000Z") };
let idCounter = 0;
const ids = { newId: () => `id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

async function seeded(...keys: string[]): Promise<{ ctx: DefinitionOpContext; repo: InMemorySettingsRepo }> {
  const repo = new InMemorySettingsRepo();
  const deps = { repo, clock, ids, authorize: alwaysAllow, principals: new InMemorySettingsPrincipalLookup([]) };
  await registerDefinitions({
    deps,
    input: {
      definitions: keys.map((key) => ({
        namespace: "core.ns",
        key,
        ownerKind: "core" as const,
        workspaceId: null,
        schema: { type: "string" as const },
        defaultValue: "default",
        scopes: 2,
        secret: false,
      })),
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });
  return { ctx: { deps, callerPrincipalId: "actor-1", authWorkspaceId: "ws-1" }, repo };
}

function item(key: string, extra: Partial<DefinitionOpRequestItem> = {}): DefinitionOpRequestItem {
  return { namespace: "core.ns", key, ownerKind: "core", workspaceId: null, ...extra };
}

test("parseNonRegisterDefinitionOp narrows only the four table ops, never register or a prototype key", () => {
  for (const op of ["rename", "retype", "deprecate", "tombstone"] as const) {
    assert.equal(parseNonRegisterDefinitionOp({ op }), op);
  }
  for (const op of ["register", "constructor", "__proto__", ""]) {
    assert.equal(parseNonRegisterDefinitionOp({ op }), null);
  }
});

test("retype with no defaultJson and no coercionJson writes a null default under the identity coercer", async () => {
  const { ctx, repo } = await seeded("a");

  await NON_REGISTER_DEFINITION_OPS.retype({ ctx, item: item("a", { schemaJson: { type: "number", nullable: true } }) });

  const def = await repo.findActiveDefinition({ namespace: "core.ns", key: "a", workspaceId: null });
  assert.equal(def?.version, 2);
  assert.deepEqual(def?.schema, { type: "number", nullable: true });
  assert.equal(def?.defaultValue, null);
  assert.equal(def?.coercionTag, "identity");
});

test("retype accepts coercionJson as a bare tag string or as a {tag} object, and an empty object means identity", async () => {
  const { ctx, repo } = await seeded("bare", "empty");

  await NON_REGISTER_DEFINITION_OPS.retype({
    ctx,
    item: item("bare", { schemaJson: { type: "number" }, defaultJson: 1, coercionJson: "identity" }),
  });
  await NON_REGISTER_DEFINITION_OPS.retype({
    ctx,
    item: item("empty", { schemaJson: { type: "number" }, defaultJson: 2, coercionJson: {} }),
  });

  const bare = await repo.findActiveDefinition({ namespace: "core.ns", key: "bare", workspaceId: null });
  const empty = await repo.findActiveDefinition({ namespace: "core.ns", key: "empty", workspaceId: null });
  assert.deepEqual([bare?.coercionTag, bare?.defaultValue], ["identity", 1]);
  assert.deepEqual([empty?.coercionTag, empty?.defaultValue], ["identity", 2]);
});

// Regression: a rename item missing its target used to move the definition to the empty name `.`.
test("rename with no newNamespace/newKey is refused as an invalid definition instead of renaming to the empty name", async () => {
  const { ctx, repo } = await seeded("a");

  for (const target of [{}, { newNamespace: "core.ns" }, { newKey: "b" }]) {
    await assert.rejects(
      () => NON_REGISTER_DEFINITION_OPS.rename({ ctx, item: item("a", target) }),
      (error: unknown) => error instanceof DefinitionInvalidError && /non-empty newNamespace and newKey/.test(error.message)
    );
  }
  assert.equal(await repo.findActiveDefinition({ namespace: "", key: "", workspaceId: null }), null);
  assert.equal((await repo.findActiveDefinition({ namespace: "core.ns", key: "a", workspaceId: null }))?.status, "active");
});

test("rename to the definition's own current name is refused before anything is written", async () => {
  const { ctx, repo } = await seeded("a");
  const before = await repo.maxRevisionSeq();

  await assert.rejects(
    () => NON_REGISTER_DEFINITION_OPS.rename({ ctx, item: item("a", { newNamespace: "core.ns", newKey: "a" }) }),
    (error: unknown) => error instanceof DefinitionInvalidError && /differ from the current name/.test(error.message)
  );
  assert.equal(await repo.maxRevisionSeq(), before);
});

test("rename onto another live definition's name is refused as already in use", async () => {
  const { ctx } = await seeded("a", "b");

  await assert.rejects(
    () => NON_REGISTER_DEFINITION_OPS.rename({ ctx, item: item("a", { newNamespace: "core.ns", newKey: "b" }) }),
    (error: unknown) => error instanceof DefinitionInvalidError && /already in use/.test(error.message)
  );
});

test("rename onto a name that is now an alias marker is refused ALIAS_DEPTH_EXCEEDED", async () => {
  const { ctx } = await seeded("a", "c");
  await NON_REGISTER_DEFINITION_OPS.rename({ ctx, item: item("a", { newNamespace: "core.ns", newKey: "b" }) });

  await assert.rejects(
    () => NON_REGISTER_DEFINITION_OPS.rename({ ctx, item: item("c", { newNamespace: "core.ns", newKey: "a" }) }),
    AliasDepthExceededError
  );
});

test("deprecate and tombstone refuse an alias marker: only the canonical active definition can change status", async () => {
  const { ctx, repo } = await seeded("a");
  await NON_REGISTER_DEFINITION_OPS.rename({ ctx, item: item("a", { newNamespace: "core.ns", newKey: "b" }) });

  for (const op of ["deprecate", "tombstone"] as const) {
    await assert.rejects(
      () => NON_REGISTER_DEFINITION_OPS[op]({ ctx, item: item("a") }),
      (error: unknown) => error instanceof DefinitionInvalidError && new RegExp(`cannot ${op} 'core.ns.a'`).test(error.message)
    );
  }
  assert.equal((await repo.findActiveDefinition({ namespace: "core.ns", key: "b", workspaceId: null }))?.status, "active");
});
