import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryPrincipalRepo } from "../../identity/index.js";
import { DefinitionInvalidError, ValueValidationFailedError } from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { reconcileDefinitionDefault, registerDefinitions } from "../write-service.js";
import type { JsonValue } from "../../core/ports.js";
import type { SettingDefinitionRecord, SettingValueSchema } from "../types.js";

/**
 * @file Covers `reconcileDefinitionDefault` — the write-service chokepoint that
 * lets a `defaultValue` edited in SOURCE reach an install that has already
 * booted. `ensure-definitions.ts` registers each definition once and then skips
 * it forever, so without this the stored `default_json` from first boot wins
 * permanently, for every settings-dialog tab.
 *
 * The cases exercised here are the ones a boot-time smoke test could not reach:
 * the structural compare on a `{ type: "json" }` array/object default, the
 * operator-owned rejection, and the schema-violating rejection.
 */

const NOW = "2026-07-12T00:00:00.000Z";
const clock = { nowIso: () => NOW };
let idCounter = 0;
const ids = { newId: () => `id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

function deps(seed: { definitions?: SettingDefinitionRecord[] } = {}) {
  const repo = new InMemorySettingsRepo(seed);
  const principals = new InMemoryPrincipalRepo([]);
  return { repo, clock, ids, authorize: alwaysAllow, principals };
}

async function register(
  d: ReturnType<typeof deps>,
  opts: { schema: SettingValueSchema; defaultValue: JsonValue; ownerKind?: "core" | "theme" }
) {
  const ownerKind = opts.ownerKind ?? ("core" as const);
  const { registered } = await registerDefinitions({
    deps: d,
    input: {
      definitions: [
        {
          // The namespace fence (REQ-02) pins each ownerKind to its own prefix,
          // so a non-core case cannot simply reuse `core.ns`.
          namespace: `${ownerKind}.ns`,
          key: "a",
          ownerKind,
          workspaceId: null,
          schema: opts.schema,
          defaultValue: opts.defaultValue,
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

function reconcile(
  d: ReturnType<typeof deps>,
  defaultValue: JsonValue,
  namespace = "core.ns"
) {
  return reconcileDefinitionDefault({
    deps: d,
    input: {
      namespace,
      key: "a",
      workspaceId: null,
      defaultValue,
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });
}

test("reconcileDefinitionDefault is a no-op when the stored default already agrees", async () => {
  const d = deps();
  await register(d, { schema: { type: "string" }, defaultValue: "light" });
  const revisionsBefore = (await d.repo.listRevisions({ settingId: "id-1" })).length;

  const result = await reconcile(d, "light");

  assert.equal(result.changed, false);
  const revisionsAfter = await d.repo.listRevisions({ settingId: result.settingId });
  assert.equal(revisionsAfter.length, revisionsBefore, "a no-op must not append a revision");
});

test("reconcileDefinitionDefault rewrites a drifted scalar default in place at the same version", async () => {
  const d = deps();
  const settingId = await register(d, {
    schema: { type: "enum", values: ["system", "light", "dark"] },
    defaultValue: "system",
  });

  const result = await reconcile(d, "light");

  assert.equal(result.changed, true);
  assert.equal(result.settingId, settingId);

  const active = await d.repo.findActiveDefinition({
    namespace: "core.ns",
    key: "a",
    workspaceId: null,
  });
  assert.equal(active?.defaultValue, "light");
  // The contrast with `retype`: a changed DEFAULT needs no coercer, so no new
  // version is cut and the prior row is not deprecated.
  assert.equal(active?.version, 1);
  assert.equal(active?.status, "active");

  const revisions = await d.repo.listRevisions({ settingId });
  const last = revisions[revisions.length - 1]!;
  assert.equal(last.op, "redefault");
  assert.equal(last.beforeJson, "system");
  assert.equal(last.afterJson, "light");
  assert.equal(last.defVersion, 1, "redefault must not advance the definition version");
  assert.equal(last.entityKind, "definition");
  assert.equal(last.scope, null);
});

test("reconcileDefinitionDefault detects a changed ARRAY default (structural compare, not ===)", async () => {
  // The case `===` would miss entirely.
  const d = deps();
  const settingId = await register(d, { schema: { type: "json" }, defaultValue: [] });

  const result = await reconcile(d, ["/admin", "/preview"]);

  assert.equal(result.changed, true);
  const active = await d.repo.findActiveDefinition({
    namespace: "core.ns",
    key: "a",
    workspaceId: null,
  });
  assert.deepEqual(active?.defaultValue, ["/admin", "/preview"]);

  const revisions = await d.repo.listRevisions({ settingId });
  assert.deepEqual(revisions[revisions.length - 1]!.afterJson, ["/admin", "/preview"]);
});

test("reconcileDefinitionDefault treats a structurally equal ARRAY default as a no-op", async () => {
  // Same contents, different object identity — `===` would report a spurious
  // change here and append a revision on every single boot.
  const d = deps();
  await register(d, { schema: { type: "json" }, defaultValue: ["/admin"] });

  const result = await reconcile(d, ["/admin"]);

  assert.equal(result.changed, false);
});

test("reconcileDefinitionDefault detects a changed OBJECT default", async () => {
  const d = deps();
  await register(d, { schema: { type: "json" }, defaultValue: { retentionDays: 30 } });

  const result = await reconcile(d, { retentionDays: 90 });

  assert.equal(result.changed, true);
  const active = await d.repo.findActiveDefinition({
    namespace: "core.ns",
    key: "a",
    workspaceId: null,
  });
  assert.deepEqual(active?.defaultValue, { retentionDays: 90 });
});

test("reconcileDefinitionDefault refuses to overwrite an operator-owned (non-core) default", async () => {
  // `site`/`theme` definitions are the operator's choice. Code owns `core`
  // defaults only; silently rewriting the rest would destroy a deliberate one.
  const d = deps();
  await register(d, { schema: { type: "string" }, defaultValue: "stored", ownerKind: "theme" });

  await assert.rejects(() => reconcile(d, "from-source", "theme.ns"), DefinitionInvalidError);

  const active = await d.repo.findActiveDefinition({
    namespace: "theme.ns",
    key: "a",
    workspaceId: null,
  });
  assert.equal(active?.defaultValue, "stored", "the operator's default must survive");
});

test("reconcileDefinitionDefault rejects a source default that violates the definition's own schema", async () => {
  const d = deps();
  const settingId = await register(d, {
    schema: { type: "enum", values: ["system", "light", "dark"] },
    defaultValue: "system",
  });
  const revisionsBefore = (await d.repo.listRevisions({ settingId })).length;

  await assert.rejects(() => reconcile(d, "chartreuse"), ValueValidationFailedError);

  const active = await d.repo.findActiveDefinition({
    namespace: "core.ns",
    key: "a",
    workspaceId: null,
  });
  assert.equal(active?.defaultValue, "system", "a rejected reconcile must not partially apply");
  assert.equal((await d.repo.listRevisions({ settingId })).length, revisionsBefore);
});

test("reconcileDefinitionDefault is idempotent across repeated boots", async () => {
  // The property that actually matters at runtime: this runs on EVERY boot, so
  // a second boot with unchanged source must not append a second revision.
  const d = deps();
  const settingId = await register(d, { schema: { type: "string" }, defaultValue: "system" });

  const first = await reconcile(d, "light");
  const second = await reconcile(d, "light");
  const third = await reconcile(d, "light");

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(third.changed, false);

  const redefaults = (await d.repo.listRevisions({ settingId })).filter((r) => r.op === "redefault");
  assert.equal(redefaults.length, 1, "only the boot that actually changed the default writes");
});
