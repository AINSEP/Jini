import assert from "node:assert/strict";
import { test } from "vitest";

import {
  AGENT_PREFERENCE_REQUIRED_SCOPE_BIT,
  AGENT_PREFERENCE_WRITE_SCOPE,
  AGENT_WRITABLE_PREFERENCES,
  AGENT_WRITABLE_PREFERENCE_IDS,
  resolveAgentWritablePreference,
} from "../agent-writable-preferences.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import type { SettingDefinitionRecord } from "../types.js";
import { ensureSettingsUiTabDefinitions } from "../ui-tab-definitions.js";

/**
 * @file The guard on the agent-writable allowlist.
 *
 * `agent-writable-preferences.ts` is a hand-maintained list that claims to be a SUBSET of what
 * `ui-tab-definitions.ts` registers at boot. Nothing in the type system enforces that claim, and
 * the two failure modes it protects against are asymmetric:
 *
 * - An entry naming a key boot does NOT register fails at call time, from inside the write
 *   chokepoint, as a `DefinitionNotFoundError` — on a tool the model was already told it could
 *   call. Annoying, and visible.
 * - An entry naming a key whose scope mask omits `user` would be silently written at a scope the
 *   definition never opted into, or refused for a reason the operator cannot see. Worse, and
 *   quiet.
 *
 * So the assertions here run boot's own registration against a real repo and compare, rather than
 * restating the expected list — a second hand-maintained copy would drift in exactly the same way
 * the first one can.
 */

const SYSTEM_PRINCIPAL_ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-07-31T00:00:00.000Z";

/** Runs the real boot registration and returns every definition it created, keyed by dotted id. */
async function registeredByBoot(): Promise<Map<string, SettingDefinitionRecord>> {
  const settingsRepo = new InMemorySettingsRepo({ definitions: [] });
  let nextId = 0;

  await ensureSettingsUiTabDefinitions(
    {
      settingsRepo,
      clock: { nowIso: () => NOW },
      ids: { newId: () => `setting-${++nextId}` },
      principals: { findById: async () => null },
    } as unknown as Parameters<typeof ensureSettingsUiTabDefinitions>[0],
    { systemPrincipalId: SYSTEM_PRINCIPAL_ID as never },
  );

  const defs = await settingsRepo.listActiveDefinitions({ workspaceId: null });
  return new Map(defs.map((d) => [`${d.namespace}.${d.key}`, d]));
}

test("every agent-writable preference names a definition the boot registration actually creates", async () => {
  const registered = await registeredByBoot();

  for (const pref of AGENT_WRITABLE_PREFERENCES) {
    const definition = registered.get(pref.id);
    assert.ok(definition, `'${pref.id}' is on the allowlist but ensureSettingsUiTabDefinitions() never registers it`);
    assert.equal(definition.namespace, pref.namespace, `${pref.id}: namespace disagrees with the registered definition`);
    assert.equal(definition.key, pref.key, `${pref.id}: key disagrees with the registered definition`);
  }
});

test("every agent-writable preference is registered at a scope that permits the user layer", async () => {
  const registered = await registeredByBoot();

  for (const pref of AGENT_WRITABLE_PREFERENCES) {
    const definition = registered.get(pref.id);
    assert.ok(definition);
    assert.notEqual(
      definition.scopes & AGENT_PREFERENCE_REQUIRED_SCOPE_BIT,
      0,
      `'${pref.id}' is agent-writable but its definition does not allow scope '${AGENT_PREFERENCE_WRITE_SCOPE}' — the write would be refused by ScopeNotAllowedError`,
    );
  }
});

test("the consent and self-instruction keys stay off the allowlist", async () => {
  const registered = await registeredByBoot();

  // These ARE registered by the same boot call, so their absence here is a deliberate withholding
  // rather than an accident of what exists — which is the only reason asserting it is meaningful.
  const withheld = [
    "core.privacy.telemetry.metrics",
    "core.privacy.telemetry.content",
    "core.privacy.decisionAt",
    "core.privacy.installationId",
    "core.instructions.custom",
  ];

  for (const id of withheld) {
    assert.ok(registered.has(id), `sanity: '${id}' should still be registered by boot — update this test if the tab was removed`);
    assert.equal(resolveAgentWritablePreference(id), undefined, `'${id}' must not be agent-writable — see agent-writable-preferences.ts`);
    assert.equal(AGENT_WRITABLE_PREFERENCE_IDS.includes(id), false);
  }
});

test("the published id list matches the entries exactly, in the same order", () => {
  assert.deepEqual(
    AGENT_WRITABLE_PREFERENCE_IDS,
    AGENT_WRITABLE_PREFERENCES.map((p) => p.id),
    "the enum is derived, not restated — a mismatch means someone reintroduced a hand-maintained copy",
  );
});

test("ids are unique and each parses back to its own namespace and key", () => {
  assert.equal(new Set(AGENT_WRITABLE_PREFERENCE_IDS).size, AGENT_WRITABLE_PREFERENCE_IDS.length, "a duplicate id would shadow an entry in the lookup map");

  for (const pref of AGENT_WRITABLE_PREFERENCES) {
    assert.equal(pref.id, `${pref.namespace}.${pref.key}`, `${pref.id}: the published id must be the dotted namespace+key`);
    assert.ok(pref.valueHint.length > 0, `${pref.id}: a published enum value with no hint tells the model nothing about what to send`);
  }
});

test("resolveAgentWritablePreference refuses anything off the list", () => {
  assert.equal(resolveAgentWritablePreference("core.presentation.site_title"), undefined);
  assert.equal(resolveAgentWritablePreference(""), undefined);
  assert.equal(resolveAgentWritablePreference("core.language"), undefined, "a namespace alone is not a setting");
  assert.equal(resolveAgentWritablePreference("__proto__"), undefined, "a Map lookup must not resolve prototype keys");

  const known = resolveAgentWritablePreference("core.language.locale");
  assert.equal(known?.namespace, "core.language");
  assert.equal(known?.key, "locale");
});
