import assert from "node:assert/strict";
import { deleteAgentPluginActivation, filterActiveAgentPlugins, isAgentPluginActive, normalizeActivations, readAgentPluginActivations, recordBundledAgentPluginIfAbsent, resolveAgentPluginActivation, setAgentPluginActivation } from "../test-support.js";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "../legacy-test.js";

import { ACTIVATIONS_FILENAME, AgentPluginActivationsUnreadableError, type AgentPluginActivations } from "../../activation.js";

/**
 * @file `activation.ts` — the record that makes "bundled but inactive" enforceable.
 *
 * The default direction is the thing worth testing hardest. `isAgentPluginActive` treats an ABSENT
 * record as active (so an operator's own installs keep working across the upgrade that introduces
 * this file), and the seeder is what keeps that from becoming a loophole for bundled packages. Both
 * halves are asserted below; either one alone would be wrong.
 */

async function freshWorkspaceRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "host-activation-"));
}

test("a plugin with NO record is active — an operator's own install keeps working", () => {
  const activations: AgentPluginActivations = { schemaVersion: 1, plugins: {} };
  assert.equal(isAgentPluginActive(activations, "ui-ux-design"), true);
});

test("an explicit enabled:false record makes a plugin inactive", () => {
  const activations: AgentPluginActivations = {
    schemaVersion: 1,
    plugins: { "site-compliance": { enabled: false, origin: "bundled", updatedAt: "2026-08-26T00:00:00.000Z", updatedBy: "system:seed" } },
  };
  assert.equal(isAgentPluginActive(activations, "site-compliance"), false);
});

test("isAgentPluginActive: a plugin named for an Object.prototype member is active by absence, never an inherited value", () => {
  const activations: AgentPluginActivations = { schemaVersion: 1, plugins: {} };
  // `constructor` passes the plugin-name grammar (`NAME_PATTERN` in `manifest.ts`, identical to this
  // file's `SAFE_PLUGIN_ID_PATTERN`), so a plain bag lookup (`activations.plugins["constructor"]`)
  // hands back `Object.prototype.constructor` instead of `undefined` — and `.enabled` on that
  // function is `undefined`, not the `true` this function's own doc promises for an absent record.
  assert.equal(isAgentPluginActive(activations, "constructor"), true);
  assert.equal(isAgentPluginActive(activations, "hasownproperty"), true);
});

test("filterActiveAgentPlugins drops exactly the disabled ones, keeping order", () => {
  const activations: AgentPluginActivations = {
    schemaVersion: 1,
    plugins: {
      "site-compliance": { enabled: false, origin: "bundled", updatedAt: "t", updatedBy: "system:seed" },
      "turned-off": { enabled: false, origin: "operator-installed", updatedAt: "t", updatedBy: "op" },
    },
  };
  const items = [{ id: "a-plugin" }, { id: "site-compliance" }, { id: "turned-off" }, { id: "z-plugin" }];
  assert.deepEqual(
    filterActiveAgentPlugins(activations, items, (item) => item.id).map((item) => item.id),
    ["a-plugin", "z-plugin"],
  );
});

test("a workspace with no activations file reads as empty, not as an error", async () => {
  const root = await freshWorkspaceRoot();
  try {
    assert.deepEqual(await readAgentPluginActivations(root), { schemaVersion: 1, plugins: {} });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a corrupt activations file reads as empty for DISCOVERY — but the boot seeder refuses to rewrite it", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await writeFile(path.join(root, ACTIVATIONS_FILENAME), "{ not json at all", "utf8");
    // The lenient DISCOVERY read is unchanged — that half of the old test still holds.
    assert.deepEqual(await readAgentPluginActivations(root), { schemaVersion: 1, plugins: {} });

    // What changed (t91 F1.1, 2026-09-16): the seeder's writer no longer launders that lenient view
    // into a fresh, rewritten file. It refuses outright, and the corrupt bytes are left exactly as
    // they were — see `activation.ts`'s header, "Writers never rewrite what they could not read".
    await assert.rejects(
      () => recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: "site-compliance" }),
      AgentPluginActivationsUnreadableError,
    );
    assert.equal(await readFile(path.join(root, ACTIVATIONS_FILENAME), "utf8"), "{ not json at all");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("normalizeActivations drops malformed entries WITHOUT discarding the operator's good ones", () => {
  const normalized = normalizeActivations({
    schemaVersion: 1,
    plugins: {
      good: { enabled: true, origin: "operator-installed", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "op" },
      "enabled-not-a-boolean": { enabled: "yes" },
      "not-an-object": 7,
      "Bad Id": { enabled: false },
      "another-good": { enabled: false },
    },
  });

  assert.deepEqual(Object.keys(normalized.plugins).sort(), ["another-good", "good"]);
  assert.equal(normalized.plugins.good?.enabled, true);
  // A record missing its optional fields still normalizes rather than being dropped — losing an
  // operator's disable decision because it lacked a timestamp would be the worst possible failure.
  assert.equal(normalized.plugins["another-good"]?.enabled, false);
  assert.equal(normalized.plugins["another-good"]?.origin, "operator-installed");
});

test("a wrong schemaVersion reads as empty rather than being interpreted under this version's rules", () => {
  assert.deepEqual(normalizeActivations({ schemaVersion: 2, plugins: { x: { enabled: false } } }), { schemaVersion: 1, plugins: {} });
});

test("setAgentPluginActivation round-trips and leaves no temp file behind", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await setAgentPluginActivation({ workspaceRoot: root, pluginId: "site-compliance", enabled: true, actor: "cli:alice" });

    const activations = await readAgentPluginActivations(root);
    assert.equal(activations.plugins["site-compliance"]?.enabled, true);
    assert.equal(activations.plugins["site-compliance"]?.updatedBy, "cli:alice");

    assert.deepEqual(await readdir(root), [ACTIVATIONS_FILENAME]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deleteAgentPluginActivation removes the record entirely — a subsequent read has no key for it, not a disabled tombstone", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await setAgentPluginActivation({ workspaceRoot: root, pluginId: "my-plugin", enabled: false, actor: "op-1" });
    await setAgentPluginActivation({ workspaceRoot: root, pluginId: "other-plugin", enabled: true, actor: "op-1" });

    await deleteAgentPluginActivation({ workspaceRoot: root, pluginId: "my-plugin" });

    const activations = await readAgentPluginActivations(root);
    assert.equal("my-plugin" in activations.plugins, false, "the deleted plugin's key must be absent, not present with enabled:false");
    assert.equal(activations.plugins["other-plugin"]?.enabled, true, "a sibling plugin's record must be untouched");
    // Absent now means active again — proves this really is a delete, not a disabled tombstone.
    assert.equal(isAgentPluginActive(activations, "my-plugin"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deleteAgentPluginActivation is a no-op, not an error, when no record exists", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await deleteAgentPluginActivation({ workspaceRoot: root, pluginId: "never-recorded" });
    assert.deepEqual(await readAgentPluginActivations(root), { schemaVersion: 1, plugins: {} });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deleteAgentPluginActivation rejects an invalid plugin id", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await assert.rejects(() => deleteAgentPluginActivation({ workspaceRoot: root, pluginId: "Not Valid!" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("toggling preserves provenance — enabling a bundled plugin does not make it look operator-installed", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: "site-compliance" });
    await setAgentPluginActivation({ workspaceRoot: root, pluginId: "site-compliance", enabled: true, actor: "cli:alice" });

    const activations = await readAgentPluginActivations(root);
    assert.equal(activations.plugins["site-compliance"]?.enabled, true);
    assert.equal(activations.plugins["site-compliance"]?.origin, "bundled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recordBundledAgentPluginIfAbsent NEVER overwrites an existing decision — it runs on every boot", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: "site-compliance" });
    await setAgentPluginActivation({ workspaceRoot: root, pluginId: "site-compliance", enabled: true, actor: "cli:alice" });

    for (let i = 0; i < 3; i += 1) {
      const { recorded } = await recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: "site-compliance" });
      assert.equal(recorded, false);
    }

    const activations = await readAgentPluginActivations(root);
    assert.equal(activations.plugins["site-compliance"]?.enabled, true, "re-seeding must not re-disable what the operator enabled");
    assert.equal(activations.plugins["site-compliance"]?.updatedBy, "cli:alice");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recordBundledAgentPluginIfAbsent { enabled: true } writes an ENABLED bundled record when none exists", async () => {
  const root = await freshWorkspaceRoot();
  try {
    const { recorded } = await recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: "deploy" }, { enabled: true });
    assert.equal(recorded, true);
    const record = (await readAgentPluginActivations(root)).plugins.deploy;
    assert.equal(record?.enabled, true);
    assert.equal(record?.origin, "bundled");
    assert.equal(record?.updatedBy, "system:seed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recordBundledAgentPluginIfAbsent { enabled: true } upgrades the seeder's OWN untouched disabled record — existing sites need no action", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: "deploy" });
    assert.equal((await readAgentPluginActivations(root)).plugins.deploy?.enabled, false);

    const { recorded } = await recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: "deploy" }, { enabled: true });
    assert.equal(recorded, true);
    assert.equal((await readAgentPluginActivations(root)).plugins.deploy?.enabled, true);

    const again = await recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: "deploy" }, { enabled: true });
    assert.equal(again.recorded, false, "an enabled seed record is a decision already made");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recordBundledAgentPluginIfAbsent { enabled: true } NEVER re-enables a plugin an operator switched off", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: "deploy" }, { enabled: true });
    await setAgentPluginActivation({ workspaceRoot: root, pluginId: "deploy", enabled: false, actor: "cli:alice" });

    const { recorded } = await recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: "deploy" }, { enabled: true });
    assert.equal(recorded, false);
    const record = (await readAgentPluginActivations(root)).plugins.deploy;
    assert.equal(record?.enabled, false);
    assert.equal(record?.updatedBy, "cli:alice");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a plugin id that is not valid Agent Plugins grammar is refused with an exact message", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await assert.rejects(
      () => setAgentPluginActivation({ workspaceRoot: root, pluginId: "../escape", enabled: true, actor: "cli:mallory" }),
      { message: "agent-plugin activation: '../escape' is not a valid Agent Plugin id" },
    );
    await assert.rejects(
      () => recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: "Not-Lowercase" }),
      { message: "agent-plugin activation: 'Not-Lowercase' is not a valid Agent Plugin id" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the written file is human-readable JSON an operator can inspect", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: "site-compliance" });
    const raw = await readFile(path.join(root, ACTIVATIONS_FILENAME), "utf8");
    assert.match(raw, /"schemaVersion": 1/);
    assert.match(raw, /"origin": "bundled"/);
    assert.match(raw, /"updatedBy": "system:seed"/);
    assert.ok(raw.endsWith("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * ---------------------------------------------------------------------------
 * `resolveAgentPluginActivation` — the fail-CLOSED reader the per-call tool gate uses
 * ---------------------------------------------------------------------------
 * `readAgentPluginActivations` folds "there is nothing recorded" and "I could not read what was
 * recorded" into the same empty record. That is right for discovery and wrong for authorization, so
 * this reader keeps them apart. The tests below pin BOTH directions: the "absent means active" rule
 * must survive intact (or every operator-installed plugin that was never toggled would stop
 * working), and every genuine fault must come back `undetermined` (or a corrupt byte would read as
 * consent).
 */

test("resolveAgentPluginActivation: no file at all is ACTIVE — the 'absent means active' rule is untouched", async () => {
  const root = await freshWorkspaceRoot();
  try {
    assert.deepEqual(await resolveAgentPluginActivation(root, "never-recorded"), { verdict: "active" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveAgentPluginActivation: a workspace root that does not exist at all is ACTIVE, not a fault", async () => {
  const root = path.join(os.tmpdir(), `host-activation-missing-${process.pid}-${Date.now()}`);
  assert.deepEqual(await resolveAgentPluginActivation(root, "never-installed-here"), { verdict: "active" });
});

test("resolveAgentPluginActivation: a well-formed file with no entry for THIS plugin is ACTIVE", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await setAgentPluginActivation({ workspaceRoot: root, pluginId: "other-plugin", enabled: false, actor: "op-1" });
    assert.deepEqual(await resolveAgentPluginActivation(root, "my-plugin"), { verdict: "active" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveAgentPluginActivation: an explicit record answers exactly what it says", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await setAgentPluginActivation({ workspaceRoot: root, pluginId: "my-plugin", enabled: false, actor: "op-1" });
    assert.deepEqual(await resolveAgentPluginActivation(root, "my-plugin"), { verdict: "inactive" });

    await setAgentPluginActivation({ workspaceRoot: root, pluginId: "my-plugin", enabled: true, actor: "op-1" });
    assert.deepEqual(await resolveAgentPluginActivation(root, "my-plugin"), { verdict: "active" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveAgentPluginActivation: a file that is not valid JSON is UNDETERMINED — readAgentPluginActivations reads the same bytes as empty", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await writeFile(path.join(root, ACTIVATIONS_FILENAME), "{ this is not json", "utf8");

    const verdict = await resolveAgentPluginActivation(root, "my-plugin");
    assert.equal(verdict.verdict, "undetermined", "a corrupt file must never be laundered into 'nothing recorded, therefore permitted'");
    assert.match(verdict.verdict === "undetermined" ? verdict.reason : "", /not valid JSON/);

    // The lenient reader's own behavior is unchanged — that divergence is the point, not a bug.
    assert.deepEqual(await readAgentPluginActivations(root), { schemaVersion: 1, plugins: {} });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveAgentPluginActivation: a wrong-shape or wrong-version envelope is UNDETERMINED", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await writeFile(path.join(root, ACTIVATIONS_FILENAME), JSON.stringify({ schemaVersion: 2, plugins: {} }), "utf8");
    assert.equal((await resolveAgentPluginActivation(root, "my-plugin")).verdict, "undetermined");

    await writeFile(path.join(root, ACTIVATIONS_FILENAME), JSON.stringify(["not", "an", "envelope"]), "utf8");
    assert.equal((await resolveAgentPluginActivation(root, "my-plugin")).verdict, "undetermined");

    await writeFile(path.join(root, ACTIVATIONS_FILENAME), JSON.stringify({ schemaVersion: 1, plugins: "nope" }), "utf8");
    assert.equal((await resolveAgentPluginActivation(root, "my-plugin")).verdict, "undetermined");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveAgentPluginActivation: a malformed record for THIS plugin is UNDETERMINED, not 'dropped, therefore absent, therefore active'", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await writeFile(
      path.join(root, ACTIVATIONS_FILENAME),
      JSON.stringify({ schemaVersion: 1, plugins: { "my-plugin": { enabled: "false" }, "good-plugin": { enabled: true } } }),
      "utf8",
    );

    // This is exactly where the lenient reader would say "active": normalization drops the entry,
    // and an entry that is gone is an entry that was never there.
    assert.equal(isAgentPluginActive(await readAgentPluginActivations(root), "my-plugin"), true);

    const verdict = await resolveAgentPluginActivation(root, "my-plugin");
    assert.equal(verdict.verdict, "undetermined", "a garbled decision about this plugin must not be read as consent");
    assert.deepEqual(await resolveAgentPluginActivation(root, "good-plugin"), { verdict: "active" }, "a sibling's readable record still answers normally");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveAgentPluginActivation: an id that names an Object.prototype member is ACTIVE by absence, never an inherited value", async () => {
  const root = await freshWorkspaceRoot();
  try {
    await writeFile(path.join(root, ACTIVATIONS_FILENAME), JSON.stringify({ schemaVersion: 1, plugins: {} }), "utf8");
    // `constructor` and `tostring` both pass the plugin-name grammar, so a plain bag lookup would
    // hand back an inherited function instead of `undefined`.
    assert.deepEqual(await resolveAgentPluginActivation(root, "constructor"), { verdict: "active" });
    assert.deepEqual(await resolveAgentPluginActivation(root, "valueof"), { verdict: "active" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
