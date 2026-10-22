import assert from "node:assert/strict";
import { test } from "vitest";

import type { ContentEntryDraft } from "../support/fixture-sdk.js";

import { createHookRegistry, PluginHookFailedError, type PluginQuarantineEvent } from "../support/hook-registry.js";

/**
 * @file `HookRegistry.previewBeforeSave()` — run ONE attached plugin's beforeSave filter on a draft
 * for the admin preview route: same snapshot/validation as a save, but nothing is merged, saved,
 * or counted toward quarantine.
 *
 * Requirement-to-test map:
 * - not attached -> null (route: 409 PLUGIN_NOT_ENABLED).
 * - returns only that plugin's declared-field-validated patch -> the patch tests.
 * - a failing preview throws PluginHookFailedError but never quarantines, never detaches, and
 *   never adds to a real save's consecutive-failure count -> the no-quarantine test.
 */

const entry: ContentEntryDraft = {
  id: "e1",
  workspaceId: "ws",
  title: "Hello",
  slug: "hello",
  status: "draft",
  bodyJson: {},
  ext: { other: { kept: 1 } },
};
const fields = [{ path: "ext.p.n", type: "integer" as const }];

test("a plugin that is not attached previews as null", async () => {
  assert.equal(await createHookRegistry().previewBeforeSave("p", entry), null);
});

test("returns that one plugin's validated patch and leaves the others' filters alone", async () => {
  const registry = createHookRegistry();
  let otherRan = false;
  let seen: unknown;
  registry.attach("p", "built-in", (draft, ctx) => { seen = { draft, ctx }; return { n: draft.title.length }; }, fields);
  registry.attach("q", "built-in", () => { otherRan = true; return {}; }, []);
  assert.deepEqual(await registry.previewBeforeSave("p", entry), { n: 5 });
  assert.equal(otherRan, false);
  assert.deepEqual(seen, { draft: entry, ctx: { pluginId: "p", workspaceId: "ws" } });
  assert.notEqual((seen as { draft: unknown }).draft, entry, "the filter gets an isolated snapshot");
});

test("an undeclared field fails the preview like a save would", async () => {
  const registry = createHookRegistry();
  registry.attach("p", "built-in", () => ({ nope: 1 }), fields);
  await assert.rejects(registry.previewBeforeSave("p", entry), {
    name: "PluginHookFailedError",
    message: "plugin 'p' returned undeclared ext field 'nope' (FIELD_PATH_INVALID)",
  });
});

test("a failing preview never counts toward quarantine and never detaches", async () => {
  const quarantined: PluginQuarantineEvent[] = [];
  const registry = createHookRegistry({ failureThreshold: 2, onQuarantine: async (event) => { quarantined.push(event); } });
  let fail = true;
  registry.attach("p", "built-in", () => { if (fail) throw new Error("boom"); return { n: 1 }; }, fields);

  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(registry.previewBeforeSave("p", entry), PluginHookFailedError);
  }
  assert.deepEqual(quarantined, []);

  // One real failing save after three failed previews is still only failure #1 of 2.
  await assert.rejects(registry.runBeforeSave(entry), PluginHookFailedError);
  assert.deepEqual(quarantined, []);
  fail = false;
  assert.deepEqual(await registry.previewBeforeSave("p", entry), { n: 1 }, "still attached");
});

test("a draft that cannot be snapshotted fails as PluginHookFailedError, not a raw DataCloneError", async () => {
  const registry = createHookRegistry();
  registry.attach("p", "built-in", () => ({ n: 1 }), fields);
  await assert.rejects(registry.previewBeforeSave("p", { ...entry, bodyJson: { fn: () => 1 } }), {
    name: "PluginHookFailedError",
    message: "plugin 'p' beforeSave hook failed",
  });
});
