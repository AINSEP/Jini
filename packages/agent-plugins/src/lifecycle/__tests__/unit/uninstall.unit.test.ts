import assert from "node:assert/strict";
import { readAgentPluginActivations, recordBundledAgentPluginIfAbsent, setAgentPluginActivation } from "../test-support.js";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "../legacy-test.js";

import { forceRemove } from "../fixtures/force-remove.js";
import { ACTIVATIONS_FILENAME } from "../../activation.js";
import { installAgentPlugin } from "../test-support.js";
import { type AgentPluginArchiveEntry, type AgentPluginArchiveReaderPort } from "../../install.js";
import { resolveAgentPluginLayout } from "../test-support.js";

import { previewAgentPluginUninstall, uninstallAgentPlugin } from "../test-support.js";
import { AgentPluginChangedSincePreviewError, AgentPluginNotFoundError, AgentPluginNotUninstallableError } from "../../uninstall.js";

/**
 * @file `uninstallAgentPlugin()` — the RED/GREEN proof this domain's uninstall was missing entirely
 * before this dispatch. No `origin: "operator-installed"` Agent Plugin can exist through any real
 * flow yet (there is no install-from-marketplace surface, only `install-from-url.ts`'s dev/admin
 * path) — every test below that needs one CONSTRUCTS it directly via `installAgentPlugin` plus
 * `setAgentPluginActivation`, exactly the way a real operator install would leave the workspace.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

function reader(entries: readonly AgentPluginArchiveEntry[]): AgentPluginArchiveReaderPort {
  return {
    async *entries() {
      yield* entries;
    },
  };
}

function fileEntry(entryPath: string, content: string): AgentPluginArchiveEntry {
  const bytes = Buffer.from(content, "utf8");
  return {
    kind: "file",
    entryPath,
    declaredSize: bytes.byteLength,
    executable: false,
    async *openReadStream() {
      yield bytes;
    },
  } as AgentPluginArchiveEntry;
}

async function freshLayout() {
  const cwd = await mkdtemp(path.join(tmpdir(), "host-agent-plugin-uninstall-test-"));
  const instanceLayout = resolveAgentPluginLayout({ cwd, env: {} });
  return { cwd, instanceLayout, workspaceLayout: instanceLayout.forWorkspace({ workspaceId: WORKSPACE_ID }) };
}

/** Installs a real package via `installAgentPlugin` — the same mechanism a real install-from-url
 *  flow uses — so every "operator-installed" test below exercises the real on-disk shape, not a
 *  hand-rolled fixture. */
async function installTestPackage(instanceLayout: ReturnType<typeof resolveAgentPluginLayout>, pluginId: string, archiveLabel: string) {
  const manifest = JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: pluginId, version: "1.0.0" });
  const archive = new Uint8Array(Buffer.from(archiveLabel));
  const digest = createHash("sha256").update(archive).digest("hex");
  return installAgentPlugin({
    archive,
    expectedSha256: digest,
    archiveReader: reader([fileEntry("plugin.json", manifest), fileEntry(`skills/${pluginId}/SKILL.md`, `# ${pluginId}\n`)]),
    layout: instanceLayout,
    workspaceId: WORKSPACE_ID,
  });
}

test("refuses an unknown plugin id with AgentPluginNotFoundError", async () => {
  const { cwd, instanceLayout } = await freshLayout();
  try {
    await assert.rejects(
      () => uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "does-not-exist" }),
      (error: unknown) => error instanceof AgentPluginNotFoundError && /not installed/.test(error.message),
    );
  } finally {
    await forceRemove(cwd);
  }
});

test("refuses a bundled plugin with AgentPluginNotUninstallableError, naming the disable alternative — and removes nothing", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshLayout();
  try {
    const installed = await installTestPackage(instanceLayout, "site-compliance", "archive-bundled");
    await recordBundledAgentPluginIfAbsent({ workspaceRoot: workspaceLayout.root, pluginId: "site-compliance" });

    await assert.rejects(
      () => uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "site-compliance" }),
      (error: unknown) =>
        error instanceof AgentPluginNotUninstallableError &&
        /bundled/i.test(error.message) &&
        // Since a1abe2bb the assistant CAN disable one itself — the refusal must say how, not send
        // the model to a human for something it can do.
        /disable it through the host's activation control/.test(error.message) &&
        !/no assistant tool wraps/.test(error.message),
    );

    const stillPublished = await stat(installed.packageRoot);
    assert.equal(stillPublished.isDirectory(), true, "a refused uninstall must not touch the on-disk package");

    const activations = await readAgentPluginActivations(workspaceLayout.root);
    assert.equal(activations.plugins["site-compliance"]?.origin, "bundled", "the bundled activation record must survive a refusal");
  } finally {
    await forceRemove(cwd);
  }
});

// t91 R4: a present-but-malformed entry for THIS plugin means its provenance is undetermined — the same "undetermined
// means refuse" rule the per-call gate applies (F1.1). Uninstalling anyway would remove a bundled plugin that the
// next boot silently re-seeds.
for (const [label, entry] of [
  ["a non-object entry", '"bundled"'],
  ["an entry with a non-boolean 'enabled'", '{"enabled":"yes","origin":"operator-installed"}'],
] as const) {
  test(`t91 R4: ${label} for the plugin refuses preview AND uninstall — nothing removed, file bytes unchanged`, async () => {
    const { cwd, instanceLayout, workspaceLayout } = await freshLayout();
    try {
      const installed = await installTestPackage(instanceLayout, "op-plugin", `archive-malformed-${label}`);
      const activationsPath = path.join(workspaceLayout.root, ACTIVATIONS_FILENAME);
      const bytes = `{"schemaVersion":1,"plugins":{"op-plugin":${entry}}}`;
      await writeFile(activationsPath, bytes);
      const req = { layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "op-plugin" };
      const refusal = (error: unknown) =>
        error instanceof AgentPluginNotUninstallableError &&
        error.message ===
          "Agent Plugin 'op-plugin' cannot be uninstalled: its entry in this workspace's activation record is malformed, so " +
            "whether it is bundled with the host (and would be re-seeded on the next boot) cannot be established. Nothing was " +
            "removed. Tell the user an operator has to repair that entry in activations.json first; until then this " +
            "plugin's tool calls and plugin-pinned runs are refused.";

      await assert.rejects(() => previewAgentPluginUninstall(req), refusal);
      await assert.rejects(() => uninstallAgentPlugin(req), refusal);

      assert.equal((await stat(installed.packageRoot)).isDirectory(), true);
      assert.equal(await readFile(activationsPath, "utf8"), bytes);
    } finally {
      await forceRemove(cwd);
    }
  });
}

test("t91 R4: a malformed entry for a DIFFERENT plugin does not block uninstalling this one, and survives the delete", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshLayout();
  try {
    const installed = await installTestPackage(instanceLayout, "op-plugin", "archive-malformed-sibling");
    const activationsPath = path.join(workspaceLayout.root, ACTIVATIONS_FILENAME);
    await writeFile(
      activationsPath,
      '{"schemaVersion":1,"plugins":{"other-plugin":"garbage","op-plugin":{"enabled":true,"origin":"operator-installed"}}}',
    );

    const result = await uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "op-plugin" });

    assert.deepEqual(result.removedDigests, [installed.archiveDigest]);
    await assert.rejects(() => stat(installed.packageRoot), { code: "ENOENT" });
    assert.deepEqual(JSON.parse(await readFile(activationsPath, "utf8")).plugins, { "other-plugin": "garbage" });
  } finally {
    await forceRemove(cwd);
  }
});

test("uninstalls an operator-installed plugin: removes the package root and deletes (not tombstones) its activation record", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshLayout();
  try {
    const installed = await installTestPackage(instanceLayout, "my-custom-plugin", "archive-operator-installed");
    // A real operator install leaves NO activation record until explicitly toggled — but this test
    // also proves the delete-not-tombstone decision, so it toggles first (mirroring
    // AGENT_PLUGIN_SET_ENABLED) to prove an EXISTING operator-installed record is fully removed, not
    // merely flipped.
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: "my-custom-plugin", enabled: false, actor: "op-1" });

    const result = await uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "my-custom-plugin" });

    assert.equal(result.pluginId, "my-custom-plugin");
    assert.deepEqual(result.removedDigests, [installed.archiveDigest]);

    await assert.rejects(() => stat(installed.packageRoot), "the package root must actually be gone from disk");
    assert.deepEqual((await readdir(workspaceLayout.pluginRootDir({ pluginId: "my-custom-plugin" }))).sort(), ["data", "memory"], "only preserved state may remain; the package tree must be removed");

    const activations = await readAgentPluginActivations(workspaceLayout.root);
    assert.equal(
      "my-custom-plugin" in activations.plugins,
      false,
      "the activation record must be DELETED, not left behind as a disabled tombstone — a future " +
        "reinstall of the same id must start fresh (active by default), not inherit a stale disable",
    );
  } finally {
    await forceRemove(cwd);
  }
});

test("uninstalls an operator-installed plugin that was NEVER explicitly toggled (no activation record at all)", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshLayout();
  try {
    const installed = await installTestPackage(instanceLayout, "never-toggled", "archive-never-toggled");

    const activationsBefore = await readAgentPluginActivations(workspaceLayout.root);
    assert.equal("never-toggled" in activationsBefore.plugins, false, "sanity: a fresh install has no activation record yet");

    const result = await uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "never-toggled" });
    assert.deepEqual(result.removedDigests, [installed.archiveDigest]);
    await assert.rejects(() => stat(installed.packageRoot));
  } finally {
    await forceRemove(cwd);
  }
});

test("removing a frozen (read-only, 0o555) published package root does not throw EACCES", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshLayout();
  try {
    const installed = await installTestPackage(instanceLayout, "frozen-check", "archive-frozen-check");
    const rootMode = (await stat(installed.packageRoot)).mode & 0o777;
    assert.equal(rootMode, 0o555, "sanity: install.ts really does freeze the package root read-only");

    await uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "frozen-check" });
    await assert.rejects(() => stat(installed.packageRoot));
  } finally {
    await forceRemove(cwd);
  }
});

test("a failed uninstall puts every staged package tree back — no digest is left half-deleted", {
  skip: process.getuid?.() === 0,
}, async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshLayout();
  try {
    const first = await installTestPackage(instanceLayout, "multi-digest", "archive-multi-digest-a");
    const second = await installTestPackage(instanceLayout, "multi-digest", "archive-multi-digest-b");
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: "multi-digest", enabled: true, actor: "op-1" });

    // Freeze the workspace ROOT only. `<pluginId>/package/sha256/` keeps its own mode, so every digest can be
    // staged successfully and the failure lands on the activation record's write-temp-then-rename —
    // the one ordering under which "did the rollback actually run?" is a real question. A rollback
    // that only ever fires on the FIRST digest (i.e. before anything is staged) is a no-op, and the
    // two assertions below it would pass for an implementation that never staged anything at all.
    await chmod(workspaceLayout.root, 0o555);
    let failure: unknown = null;
    try {
      await uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "multi-digest" });
    } catch (error) {
      failure = error;
    } finally {
      await chmod(workspaceLayout.root, 0o700);
    }

    assert.notEqual(failure, null, "uninstall must reject when the activation record cannot be rewritten");
    assert.match(
      failure instanceof Error ? failure.message : String(failure),
      new RegExp(ACTIVATIONS_FILENAME.replace(".", "\\.")),
      "the failure must come from the activation-record write, proving every package tree was already staged " +
        "aside — an EACCES naming a package root instead would mean staging never got off the ground",
    );

    assert.equal((await stat(first.packageRoot)).isDirectory(), true, "a failed uninstall must not leave the first digest deleted");
    assert.equal((await stat(second.packageRoot)).isDirectory(), true, "a failed uninstall must not leave the second digest deleted");
    assert.equal(
      (await stat(first.packageRoot)).mode & 0o777,
      0o555,
      "staging has to unfreeze a package root to rename it; a restored tree must be frozen again, not left writable",
    );
    assert.deepEqual(
      (await readdir(workspaceLayout.pluginPackagesDir({ pluginId: "multi-digest" }))).sort(),
      [first.archiveDigest, second.archiveDigest].sort(),
      "the rollback must restore the original digest names and leave no staged directory behind",
    );

    const activations = await readAgentPluginActivations(workspaceLayout.root);
    assert.equal(activations.plugins["multi-digest"]?.enabled, true, "the activation record must survive, so it still describes real bytes");
  } finally {
    await forceRemove(cwd);
  }
});

test("TENANT ISOLATION: uninstalling in one workspace never touches another workspace's own copy of the same plugin id", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "host-agent-plugin-uninstall-test-"));
  try {
    const instanceLayout = resolveAgentPluginLayout({ cwd, env: {} });
    const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";

    const manifest = JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "shared-name", version: "1.0.0" });
    const archive = new Uint8Array(Buffer.from("archive-shared-across-two-workspaces"));
    const digest = createHash("sha256").update(archive).digest("hex");
    const archiveReader = reader([fileEntry("plugin.json", manifest), fileEntry("skills/shared-name/SKILL.md", "# Shared\n")]);

    const installedMine = await installAgentPlugin({ archive, expectedSha256: digest, archiveReader, layout: instanceLayout, workspaceId: WORKSPACE_ID });
    const installedOther = await installAgentPlugin({ archive, expectedSha256: digest, archiveReader, layout: instanceLayout, workspaceId: otherWorkspaceId });

    await uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "shared-name" });

    await assert.rejects(() => stat(installedMine.packageRoot));
    const otherStillThere = await stat(installedOther.packageRoot);
    assert.equal(otherStillThere.isDirectory(), true, "the other workspace's own copy must survive untouched");
  } finally {
    await forceRemove(cwd);
  }
});

test("previewAgentPluginUninstall names what would be removed — id, versions, digests — without removing anything or carrying a host path", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshLayout();
  try {
    const installed = await installTestPackage(instanceLayout, "preview-me", "archive-preview");
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: "preview-me", enabled: true, actor: "op-1" });

    const preview = await previewAgentPluginUninstall({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "preview-me" });

    assert.deepEqual(preview, { pluginId: "preview-me", versions: ["1.0.0"], archiveDigests: [installed.archiveDigest] });
    assert.equal(JSON.stringify(preview).includes(cwd), false, "the preview feeds a confirmation dialog; it must carry no host path");
    assert.equal((await stat(installed.packageRoot)).isDirectory(), true, "a preview must not remove the package");
    const activations = await readAgentPluginActivations(workspaceLayout.root);
    assert.equal(activations.plugins["preview-me"]?.enabled, true, "a preview must not touch the activation record");
  } finally {
    await forceRemove(cwd);
  }
});

test("previewAgentPluginUninstall refuses exactly what uninstallAgentPlugin refuses — an unknown id and a bundled plugin", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshLayout();
  try {
    await installTestPackage(instanceLayout, "site-compliance", "archive-preview-bundled");
    await recordBundledAgentPluginIfAbsent({ workspaceRoot: workspaceLayout.root, pluginId: "site-compliance" });

    await assert.rejects(
      () => previewAgentPluginUninstall({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "does-not-exist" }),
      AgentPluginNotFoundError,
    );
    await assert.rejects(
      () => previewAgentPluginUninstall({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "site-compliance" }),
      AgentPluginNotUninstallableError,
    );
  } finally {
    await forceRemove(cwd);
  }
});

// ---------------------------------------------------------------------------
// t91 F2.2 — a confirmed preview binds the uninstall to what was resolved for the dialog
// ---------------------------------------------------------------------------

test("a confirmed preview refuses — removing nothing — when an archive for the same id was installed after it was taken", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshLayout();
  try {
    const first = await installTestPackage(instanceLayout, "changed-plugin", "archive-changed-a");
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: "changed-plugin", enabled: false, actor: "op-1" });
    const req = { layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "changed-plugin" };
    const preview = await previewAgentPluginUninstall(req);
    const second = await installTestPackage(instanceLayout, "changed-plugin", "archive-changed-b");

    await assert.rejects(
      () => uninstallAgentPlugin(req, { confirmedPreview: preview }),
      (error: unknown) =>
        error instanceof AgentPluginChangedSincePreviewError &&
        error.message ===
          `Agent Plugin 'changed-plugin' changed after its uninstall was previewed (previewed archive digests: ${first.archiveDigest}; ` +
            `installed now: ${[first.archiveDigest, second.archiveDigest].sort().join(", ")}) — nothing was removed`,
    );

    assert.equal((await stat(first.packageRoot)).isDirectory(), true);
    assert.equal((await stat(second.packageRoot)).isDirectory(), true);
    assert.deepEqual((await readdir(workspaceLayout.pluginPackagesDir({ pluginId: "changed-plugin" }))).sort(), [first.archiveDigest, second.archiveDigest].sort());
    const activations = await readAgentPluginActivations(workspaceLayout.root);
    assert.equal(activations.plugins["changed-plugin"]?.enabled, false);
  } finally {
    await forceRemove(cwd);
  }
});

test("a confirmed preview refuses when one of its previewed archives was removed before the answer", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshLayout();
  try {
    const first = await installTestPackage(instanceLayout, "shrunk-plugin", "archive-shrunk-a");
    const second = await installTestPackage(instanceLayout, "shrunk-plugin", "archive-shrunk-b");
    const req = { layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "shrunk-plugin" };
    const preview = await previewAgentPluginUninstall(req);
    await forceRemove(second.packageRoot);

    await assert.rejects(() => uninstallAgentPlugin(req, { confirmedPreview: preview }), AgentPluginChangedSincePreviewError);

    assert.equal((await stat(first.packageRoot)).isDirectory(), true);
  } finally {
    await forceRemove(cwd);
  }
});

test("an unchanged confirmed preview uninstalls normally", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshLayout();
  try {
    const installed = await installTestPackage(instanceLayout, "unchanged-plugin", "archive-unchanged");
    const req = { layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "unchanged-plugin" };
    const preview = await previewAgentPluginUninstall(req);

    const result = await uninstallAgentPlugin(req, { confirmedPreview: preview });

    assert.deepEqual(result, { pluginId: "unchanged-plugin", removedDigests: [installed.archiveDigest] });
    await assert.rejects(() => stat(installed.packageRoot));
  } finally {
    await forceRemove(cwd);
  }
});
