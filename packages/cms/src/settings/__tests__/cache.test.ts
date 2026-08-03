import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryPrincipalRepo } from "../../identity/index.js";
import { getEffective } from "../settings.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import {
  clear,
  deprecateDefinition,
  registerDefinitions,
  renameDefinition,
  retypeDefinition,
  set,
  tombstoneDefinition,
} from "../write-service.js";
import { purgeTenantSettings } from "../purge-service.js";
import type { SettingDefinitionRecord, SettingValueRecord } from "../types.js";

/**
 * @file T048/T049 — per-layer + definition cache (SPEC-007 REQ-12; ADR-028
 * §8; AC-19/AC-20).
 *
 * Covers:
 * - AC-19: a global write to namespace N invalidates only that one
 *   `settings:global:N`-shaped cache entry — no fan-out to workspace/user
 *   layer entries cached for the same namespace.
 * - AC-20: the definition cache is workspace-qualified — two workspaces
 *   holding the same-named site-owned key never see each other's cached
 *   definition, and a cache actually exists (a stale entry survives an
 *   out-of-band repo mutation until its own invalidation path runs).
 * - Every write path (set/clear, the 4 definition-lifecycle ops, and
 *   purgeTenantSettings) correctly busts the cache entries it owns.
 */

const clock = { nowIso: () => "2026-07-12T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `cache-id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const NOW = "2026-07-12T00:00:00.000Z";

function definition(overrides: Partial<SettingDefinitionRecord> = {}): SettingDefinitionRecord {
  return {
    settingId: "setting-1",
    version: 1,
    workspaceId: null,
    namespace: "core.ns",
    key: "k1",
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

function value(overrides: Partial<SettingValueRecord>): SettingValueRecord {
  return {
    settingId: "setting-1",
    scope: "global",
    workspaceId: null,
    principalId: null,
    valueJson: "x",
    state: "set",
    defVersion: 1,
    seq: 1,
    updatedBy: "actor-1",
    updatedAt: NOW,
    originPluginId: null,
    ...overrides,
  };
}

test("AC-19: a global write to namespace N invalidates only that namespace's global cache entry, with no fan-out to workspace/user caches", async () => {
  const def = definition({ scopes: 1 | 2 | 4 });
  const repo = new InMemorySettingsRepo({
    definitions: [def],
    globalValues: [value({ scope: "global", valueJson: "g-initial" })],
    workspaceValues: [value({ scope: "workspace", workspaceId: "ws-1", valueJson: "ws-initial" })],
    userValues: [value({ scope: "user", workspaceId: "ws-1", principalId: "p-1", valueJson: "u-initial" })],
  });
  const principals = new InMemoryPrincipalRepo([]);

  // Populate 3 distinct layer-cache entries: global (via a workspace with no
  // override), workspace (ws-1), and user (ws-1, p-1).
  const globalRead = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-2" } }
  );
  assert.equal(globalRead?.value, "g-initial");
  assert.equal(globalRead?.sourceLayer, "global");

  const workspaceRead = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1" } }
  );
  assert.equal(workspaceRead?.value, "ws-initial");

  const userRead = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1", principalId: "p-1" } }
  );
  assert.equal(userRead?.value, "u-initial");

  // The real chokepoint write: a global set() to the same namespace/key.
  await set({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: { namespace: def.namespace, key: def.key, scope: "global", value: "g-updated", callerPrincipalId: "actor-1" },
  });

  const globalAfter = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-2" } }
  );
  assert.equal(globalAfter?.value, "g-updated", "the global write must be visible to a workspace with no override");

  // The no-fan-out property, now asserted on the DATA rather than on cache bookkeeping: a global
  // write must leave the workspace and user rows alone, so those layers keep winning precedence
  // with their own unchanged values. This was previously demonstrated by out-of-band mutations
  // staying INVISIBLE behind a stale cache entry — an assertion that could only ever hold while
  // the cache existed, and which passed just as happily when the cache was wrong.
  const workspaceAfter = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1" } }
  );
  assert.equal(workspaceAfter?.value, "ws-initial", "a global write must not disturb the workspace layer (no fan-out)");
  assert.equal(workspaceAfter?.sourceLayer, "workspace");

  const userAfter = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1", principalId: "p-1" } }
  );
  assert.equal(userAfter?.value, "u-initial", "a global write must not disturb the user layer either");
  assert.equal(userAfter?.sourceLayer, "user");
});

/**
 * The standing guard against reintroducing the per-layer value cache.
 *
 * An out-of-band row mutation — one that bypasses the write chokepoint entirely, and therefore any
 * invalidation hook a future cache might install — must be visible to the very next read. That is
 * precisely what the removed cache could not promise across process boundaries: a second process
 * writing through its own repo instance is, from the first process's point of view, always
 * out-of-band. See `settings.ts`'s cache header.
 */
for (const layer of ["global", "workspace", "user"] as const) {
  test(`reads are always fresh: an out-of-band ${layer}-layer write is visible to the next getEffective`, async () => {
    const def = definition({ scopes: 1 | 2 | 4 });
    const scopeContext =
      layer === "global" ? {} : layer === "workspace" ? { workspaceId: "ws-1" } : { workspaceId: "ws-1", principalId: "p-1" };
    const seed = value(
      layer === "global"
        ? { scope: "global", valueJson: "before" }
        : layer === "workspace"
          ? { scope: "workspace", workspaceId: "ws-1", valueJson: "before" }
          : { scope: "user", workspaceId: "ws-1", principalId: "p-1", valueJson: "before" }
    );
    const repo = new InMemorySettingsRepo({
      definitions: [def],
      ...(layer === "global" ? { globalValues: [seed] } : {}),
      ...(layer === "workspace" ? { workspaceValues: [seed] } : {}),
      ...(layer === "user" ? { userValues: [seed] } : {}),
    });

    const before = await getEffective({ repo }, { namespace: def.namespace, key: def.key, scopeContext });
    assert.equal(before?.value, "before", "sanity: the seeded value is what the first read resolves");

    const mutated = { ...seed, valueJson: "after" };
    if (layer === "global") await repo.saveGlobalValue(mutated);
    else if (layer === "workspace") await repo.saveWorkspaceValue(mutated);
    else await repo.saveUserValue(mutated);

    const after = await getEffective({ repo }, { namespace: def.namespace, key: def.key, scopeContext });
    assert.equal(
      after?.value,
      "after",
      `a ${layer}-layer row changed outside the write chokepoint must be visible immediately — if this fails, a value cache has been reintroduced without cross-process invalidation`
    );
  });
}

test("AC-19 (workspace scope): a workspace-scope write invalidates only that workspace's cache entry, not other workspaces' entries for the same namespace", async () => {
  const def = definition({ scopes: 1 | 2 | 4 });
  const repo = new InMemorySettingsRepo({
    definitions: [def],
    workspaceValues: [
      value({ scope: "workspace", workspaceId: "ws-1", valueJson: "ws1-initial" }),
      value({ scope: "workspace", workspaceId: "ws-2", valueJson: "ws2-initial" }),
    ],
  });
  const principals = new InMemoryPrincipalRepo([]);

  await getEffective({ repo }, { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1" } });
  const ws2Before = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-2" } }
  );
  assert.equal(ws2Before?.value, "ws2-initial");

  await set({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: {
      namespace: def.namespace,
      key: def.key,
      scope: "workspace",
      value: "ws1-updated",
      workspaceId: "ws-1",
      callerPrincipalId: "actor-1",
    },
  });

  const ws1After = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1" } }
  );
  assert.equal(ws1After?.value, "ws1-updated");

  const ws2After = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-2" } }
  );
  assert.equal(ws2After?.value, "ws2-initial", "a ws-1 write must not reach ws-2's row (tenant isolation, no fan-out)");
});

test("clear() invalidates the value cache so a subsequent getEffective reflects the cleared (fallen-through) layer", async () => {
  const def = definition({ scopes: 1 | 2 | 4 });
  const repo = new InMemorySettingsRepo({
    definitions: [def],
    globalValues: [value({ scope: "global", valueJson: "g-fallback" })],
    workspaceValues: [value({ scope: "workspace", workspaceId: "ws-1", valueJson: "ws-initial" })],
  });
  const principals = new InMemoryPrincipalRepo([]);

  const before = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1" } }
  );
  assert.equal(before?.value, "ws-initial");

  await clear({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: { namespace: def.namespace, key: def.key, scope: "workspace", workspaceId: "ws-1", callerPrincipalId: "actor-1" },
  });

  const after = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1" } }
  );
  assert.equal(after?.value, "g-fallback", "clear() must invalidate the cached workspace entry, falling through to global");
  assert.equal(after?.sourceLayer, "global");
});

test("AC-20: the definition cache is workspace-qualified -- two workspaces with the same site-owned key never see each other's cached definition, and a real cache exists", async () => {
  const defA: SettingDefinitionRecord = definition({
    settingId: "setting-site-a",
    namespace: "site.appearance",
    key: "theme",
    workspaceId: "ws-A",
    ownerKind: "site",
    defaultValue: "paper-A",
    scopes: 1 | 2 | 4, // will be overridden below for owner-fence validity
  });
  // site-owned defs may not declare the global bit (INV-05) -- use workspace|user only.
  defA.scopes = 2 | 4;
  const defB: SettingDefinitionRecord = {
    ...defA,
    settingId: "setting-site-b",
    workspaceId: "ws-B",
    defaultValue: "paper-B",
  };
  const repo = new InMemorySettingsRepo({ definitions: [defA, defB] });

  const resultA1 = await getEffective(
    { repo },
    { namespace: "site.appearance", key: "theme", scopeContext: { workspaceId: "ws-A" } }
  );
  assert.equal(resultA1?.value, "paper-A");

  const resultB1 = await getEffective(
    { repo },
    { namespace: "site.appearance", key: "theme", scopeContext: { workspaceId: "ws-B" } }
  );
  assert.equal(resultB1?.value, "paper-B", "ws-B must resolve its own definition, never ws-A's cached one");

  // Mutate ws-A's definition row directly (out-of-band, no invalidation call
  // involved) to prove a cache genuinely exists and is keyed by workspace.
  await repo.saveDefinition({ ...defA, defaultValue: "paper-A-MUTATED" });

  const resultA2 = await getEffective(
    { repo },
    { namespace: "site.appearance", key: "theme", scopeContext: { workspaceId: "ws-A" } }
  );
  assert.equal(
    resultA2?.value,
    "paper-A",
    "ws-A's cached definition entry must still serve its original (cached) value, unaffected by the out-of-band mutation and by ws-B's intervening read"
  );

  const resultB2 = await getEffective(
    { repo },
    { namespace: "site.appearance", key: "theme", scopeContext: { workspaceId: "ws-B" } }
  );
  assert.equal(resultB2?.value, "paper-B", "ws-B's cache entry must remain distinct and correct");
});

test("retypeDefinition invalidates the definition cache so getEffective picks up the new schema/default, not a stale cached definition", async () => {
  const def = definition({ coercionTag: null });
  const repo = new InMemorySettingsRepo({ definitions: [def] });

  const before = await getEffective({ repo }, { namespace: def.namespace, key: def.key, scopeContext: {} });
  assert.equal(before?.value, "default");

  await retypeDefinition({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals: new InMemoryPrincipalRepo([]) },
    input: {
      namespace: def.namespace,
      key: def.key,
      workspaceId: null,
      schema: { type: "string" },
      defaultValue: "retyped-default",
      coercionTag: "identity",
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });

  const after = await getEffective({ repo }, { namespace: def.namespace, key: def.key, scopeContext: {} });
  assert.equal(
    after?.value,
    "retyped-default",
    "retypeDefinition must invalidate the definition cache so the new version is visible immediately"
  );
});

test("tombstoneDefinition invalidates the definition cache so getEffective immediately reports typed-absent", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({ definitions: [def] });

  const before = await getEffective({ repo }, { namespace: def.namespace, key: def.key, scopeContext: {} });
  assert.ok(before, "must resolve before tombstoning");

  await tombstoneDefinition({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals: new InMemoryPrincipalRepo([]) },
    input: {
      namespace: def.namespace,
      key: def.key,
      workspaceId: null,
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });

  const after = await getEffective({ repo }, { namespace: def.namespace, key: def.key, scopeContext: {} });
  assert.equal(after, null, "tombstoneDefinition must invalidate the cached (still-active) definition entry");
});

test("deprecateDefinition invalidates the definition cache", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({ definitions: [def] });

  await getEffective({ repo }, { namespace: def.namespace, key: def.key, scopeContext: {} });

  await deprecateDefinition({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals: new InMemoryPrincipalRepo([]) },
    input: {
      namespace: def.namespace,
      key: def.key,
      workspaceId: null,
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });

  // Deprecated defs are excluded from findActiveDefinition entirely, so the
  // slot now resolves to "not found" -- proves the cache was refreshed
  // rather than continuing to serve the pre-deprecate active row.
  const after = await getEffective({ repo }, { namespace: def.namespace, key: def.key, scopeContext: {} });
  assert.equal(after, null);
});

test("renameDefinition invalidates the definition cache for both the old and new namespace/key so alias-transparent resolution is immediately correct", async () => {
  const def = definition({ namespace: "core.ns", key: "oldKey" });
  const repo = new InMemorySettingsRepo({ definitions: [def] });

  const beforeOld = await getEffective({ repo }, { namespace: "core.ns", key: "oldKey", scopeContext: {} });
  assert.equal(beforeOld?.value, "default");

  await renameDefinition({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals: new InMemoryPrincipalRepo([]) },
    input: {
      namespace: "core.ns",
      key: "oldKey",
      workspaceId: null,
      newNamespace: "core.ns",
      newKey: "newKey",
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });

  const afterOld = await getEffective({ repo }, { namespace: "core.ns", key: "oldKey", scopeContext: {} });
  const afterNew = await getEffective({ repo }, { namespace: "core.ns", key: "newKey", scopeContext: {} });
  assert.deepEqual(afterOld, afterNew, "the renamed key must resolve transparently by both old and new name");
  assert.equal(afterOld?.value, "default");
});

test("purgeTenantSettings invalidates the workspace-scope cache entry it deletes", async () => {
  const def = definition({ scopes: 2 | 4 });
  const repo = new InMemorySettingsRepo({
    definitions: [def],
    workspaceValues: [value({ scope: "workspace", workspaceId: "ws-1", valueJson: "ws-value" })],
  });

  const before = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1" } }
  );
  assert.equal(before?.value, "ws-value");

  await purgeTenantSettings({
    deps: { repo, clock, authorize: alwaysAllow },
    input: { workspaceId: "ws-1", callerPrincipalId: "actor-1" },
  });

  const after = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1" } }
  );
  assert.equal(after?.value, "default", "purge must invalidate the workspace cache entry, falling back to default");
});

test("purgeTenantSettings scoped to a principalId invalidates only that principal's user cache entry, not other principals'", async () => {
  const def = definition({ scopes: 4 });
  const repo = new InMemorySettingsRepo({
    definitions: [def],
    userValues: [
      value({ scope: "user", workspaceId: "ws-1", principalId: "p-1", valueJson: "p1-value" }),
      value({ scope: "user", workspaceId: "ws-1", principalId: "p-2", valueJson: "p2-value" }),
    ],
  });

  await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1", principalId: "p-1" } }
  );
  const p2Before = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1", principalId: "p-2" } }
  );
  assert.equal(p2Before?.value, "p2-value");

  await purgeTenantSettings({
    deps: { repo, clock, authorize: alwaysAllow },
    input: { workspaceId: "ws-1", principalId: "p-1", callerPrincipalId: "actor-1" },
  });

  const p1After = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1", principalId: "p-1" } }
  );
  assert.equal(p1After?.value, "default", "p-1's purged row must be gone, so the read falls through to the default");

  // No fan-out from a single-principal purge, asserted on the data: p-2's row must survive intact.
  const p2After = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1", principalId: "p-2" } }
  );
  assert.equal(p2After?.value, "p2-value", "a purge scoped to p-1 must not delete p-2's row");
  assert.equal(p2After?.sourceLayer, "user");
});

test("registerDefinitions bumps the namespace's definition-cache epoch (no stale not-found entry survives a fresh registration)", async () => {
  const repo = new InMemorySettingsRepo({});
  const principals = new InMemoryPrincipalRepo([]);

  const beforeRegister = await getEffective(
    { repo },
    { namespace: "core.fresh", key: "k", scopeContext: {} }
  );
  assert.equal(beforeRegister, null, "not yet registered");

  await registerDefinitions({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: {
      definitions: [
        {
          namespace: "core.fresh",
          key: "k",
          ownerKind: "core",
          workspaceId: null,
          schema: { type: "string" },
          defaultValue: "fresh-default",
          scopes: 1 | 2 | 4,
          secret: false,
        },
      ],
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });

  const afterRegister = await getEffective(
    { repo },
    { namespace: "core.fresh", key: "k", scopeContext: {} }
  );
  assert.equal(afterRegister?.value, "fresh-default");
});
