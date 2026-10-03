import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "../legacy-test.js";

import { forceRemove } from "../fixtures/force-remove.js";
import { readAgentPluginActivations, recordBundledAgentPluginIfAbsent, setAgentPluginActivation } from "../test-support.js";
import { ACTIVATIONS_FILENAME } from "../../activation.js";
import { readBundledAgentPluginDigests, recordBundledAgentPluginDigests, removeBundledAgentPluginDigest } from "../test-support.js";
import { BUNDLED_DIGESTS_FILENAME } from "../../bundled-digests.js";
import { installAgentPlugin } from "../test-support.js";
import { type AgentPluginArchiveEntry, type AgentPluginArchiveReaderPort } from "../../install.js";
import { resolveAgentPluginLayout } from "../test-support.js";

import { listInstalledPlugins } from "../test-support.js";

import { RETIRED_BUNDLED_AGENT_PLUGINS, retireBundledAgentPlugins } from "../test-support.js";

import { seedBundledAgentPlugins } from "../test-support.js";

import { uninstallAgentPlugin } from "../test-support.js";
import { AgentPluginNotUninstallableError } from "../../uninstall.js";

/**
 * @file `retireBundledAgentPlugins()` — the boot migration that removes `old-integration` (merged
 * into `deploy`, 2026-09-29) from a workspace and keeps its users' capability on.
 *
 * Every test builds the real on-disk shape a workspace has after earlier boots: packages installed
 * through `installAgentPlugin`, records written by the seeder's own `recordBundledAgentPluginIfAbsent`
 * (or an operator's `setAgentPluginActivation`), and the seeder's own digest ledger.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const RETIRED = "old-integration";
const SUCCESSOR = "new-integration";

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
  const cwd = await mkdtemp(path.join(tmpdir(), "host-agent-plugin-retire-test-"));
  const layout = resolveAgentPluginLayout({ cwd, env: {} });
  return { cwd, layout, workspaceLayout: layout.forWorkspace({ workspaceId: WORKSPACE_ID }) };
}

async function installPackage(layout: ReturnType<typeof resolveAgentPluginLayout>, pluginId: string, archiveLabel: string) {
  const manifest = JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: pluginId, version: "1.0.0" });
  const archive = new Uint8Array(Buffer.from(archiveLabel));
  return installAgentPlugin({
    archive,
    expectedSha256: createHash("sha256").update(archive).digest("hex"),
    archiveReader: reader([fileEntry("plugin.json", manifest), fileEntry(`skills/${pluginId}/SKILL.md`, `# ${pluginId}\n`)]),
    layout,
    workspaceId: WORKSPACE_ID,
  });
}

/** The state a workspace is in after booting a build that still shipped `old-integration`: both
 *  bundled packages installed, both seeded (fly disabled, deploy enabled), both in the ledger. */
async function seedPreRetirementWorkspace(layout: ReturnType<typeof resolveAgentPluginLayout>, workspaceRoot: string) {
  const fly = await installPackage(layout, RETIRED, "archive-fly");
  const deploy = await installPackage(layout, SUCCESSOR, "archive-deploy");
  await recordBundledAgentPluginIfAbsent({ workspaceRoot, pluginId: RETIRED });
  await recordBundledAgentPluginIfAbsent({ workspaceRoot, pluginId: SUCCESSOR }, { enabled: true });
  await recordBundledAgentPluginDigests({
    workspaceRoot,
    seeded: [
      { pluginId: RETIRED, archiveDigest: fly.archiveDigest },
      { pluginId: SUCCESSOR, archiveDigest: deploy.archiveDigest },
    ],
  });
  return { fly, deploy };
}

async function installedIds(packagesDir: string): Promise<string[]> {
  return (await listInstalledPlugins(packagesDir)).map((plugin) => plugin.pluginId).sort();
}

test("the retirement map sends old-integration to deploy", () => {
  assert.equal(RETIRED_BUNDLED_AGENT_PLUGINS.get(RETIRED), SUCCESSOR);
});

test("an ENABLED old-integration: its package, record and ledger entry go; deploy stays enabled", async () => {
  const { cwd, layout, workspaceLayout } = await freshLayout();
  try {
    const { fly, deploy } = await seedPreRetirementWorkspace(layout, workspaceLayout.root);
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: RETIRED, enabled: true, actor: "test:operator" });

    const outcomes = await retireBundledAgentPlugins({ layout, workspaceId: WORKSPACE_ID });

    assert.deepEqual(outcomes, [
      {
        pluginId: RETIRED,
        successorId: SUCCESSOR,
        status: "retired",
        removedDigests: [fly.archiveDigest],
        activationRemoved: true,
        ledgerEntryRemoved: true,
        successor: "already-enabled",
      },
    ]);
    assert.deepEqual(await installedIds(workspaceLayout.packages), [SUCCESSOR]);

    const activations = await readAgentPluginActivations(workspaceLayout.root);
    assert.equal(Object.hasOwn(activations.plugins, RETIRED), false, "the retired plugin's record is deleted, not tombstoned");
    assert.equal(activations.plugins[SUCCESSOR]?.enabled, true);

    const ledger = await readBundledAgentPluginDigests(workspaceLayout.root);
    assert.equal(ledger.has(RETIRED), false);
    assert.equal(ledger.get(SUCCESSOR), deploy.archiveDigest, "the successor's ledger entry is untouched");
  } finally {
    await forceRemove(cwd);
  }
});

test("an enabled old-integration switches on deploy's untouched disabled seed record, as the retirement actor", async () => {
  const { cwd, layout, workspaceLayout } = await freshLayout();
  try {
    await installPackage(layout, RETIRED, "archive-fly");
    await installPackage(layout, SUCCESSOR, "archive-deploy");
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: RETIRED, enabled: true, actor: "test:operator" }, { origin: "bundled" });
    // The seeder's own disabled record, never touched by an operator.
    await recordBundledAgentPluginIfAbsent({ workspaceRoot: workspaceLayout.root, pluginId: SUCCESSOR });

    const [outcome] = await retireBundledAgentPlugins({ layout, workspaceId: WORKSPACE_ID });

    assert.equal(outcome?.status, "retired");
    assert.equal(outcome?.status === "retired" && outcome.successor, "enabled");
    const record = (await readAgentPluginActivations(workspaceLayout.root)).plugins[SUCCESSOR];
    assert.equal(record?.enabled, true);
    assert.equal(record?.origin, "bundled");
    assert.equal(record?.updatedBy, "system:retire-old-integration");
  } finally {
    await forceRemove(cwd);
  }
});

test("an enabled old-integration with NO deploy record creates deploy's record enabled", async () => {
  const { cwd, layout, workspaceLayout } = await freshLayout();
  try {
    await installPackage(layout, RETIRED, "archive-fly");
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: RETIRED, enabled: true, actor: "test:operator" }, { origin: "bundled" });

    const [outcome] = await retireBundledAgentPlugins({ layout, workspaceId: WORKSPACE_ID });

    assert.equal(outcome?.status === "retired" && outcome.successor, "enabled");
    assert.equal((await readAgentPluginActivations(workspaceLayout.root)).plugins[SUCCESSOR]?.enabled, true);
  } finally {
    await forceRemove(cwd);
  }
});

test("an operator-DISABLED deploy stays off and is reported, while old-integration is still removed", async () => {
  const { cwd, layout, workspaceLayout } = await freshLayout();
  try {
    await seedPreRetirementWorkspace(layout, workspaceLayout.root);
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: RETIRED, enabled: true, actor: "test:operator" });
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: SUCCESSOR, enabled: false, actor: "test:operator" });

    const [outcome] = await retireBundledAgentPlugins({ layout, workspaceId: WORKSPACE_ID });

    assert.equal(outcome?.status, "retired");
    assert.equal(outcome?.status === "retired" && outcome.successor, "left-disabled-by-operator");

    const activations = await readAgentPluginActivations(workspaceLayout.root);
    assert.equal(activations.plugins[SUCCESSOR]?.enabled, false, "an operator's decision is never overridden");
    assert.equal(activations.plugins[SUCCESSOR]?.updatedBy, "test:operator");
    assert.equal(Object.hasOwn(activations.plugins, RETIRED), false);
    assert.deepEqual(await installedIds(workspaceLayout.packages), [SUCCESSOR]);
  } finally {
    await forceRemove(cwd);
  }
});

test("a DISABLED old-integration is removed without touching deploy", async () => {
  const { cwd, layout, workspaceLayout } = await freshLayout();
  try {
    await seedPreRetirementWorkspace(layout, workspaceLayout.root);
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: SUCCESSOR, enabled: false, actor: "test:operator" });
    const deployBefore = (await readAgentPluginActivations(workspaceLayout.root)).plugins[SUCCESSOR];

    const [outcome] = await retireBundledAgentPlugins({ layout, workspaceId: WORKSPACE_ID });

    assert.equal(outcome?.status === "retired" && outcome.successor, "not-needed");
    assert.deepEqual((await readAgentPluginActivations(workspaceLayout.root)).plugins[SUCCESSOR], deployBefore);
    assert.deepEqual(await installedIds(workspaceLayout.packages), [SUCCESSOR]);
  } finally {
    await forceRemove(cwd);
  }
});

test("a second run is a no-op: 'absent', and neither state file is rewritten", async () => {
  const { cwd, layout, workspaceLayout } = await freshLayout();
  try {
    await seedPreRetirementWorkspace(layout, workspaceLayout.root);
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: RETIRED, enabled: true, actor: "test:operator" });
    await retireBundledAgentPlugins({ layout, workspaceId: WORKSPACE_ID });

    const activationsBytes = await readFile(path.join(workspaceLayout.root, ACTIVATIONS_FILENAME), "utf8");
    const ledgerBytes = await readFile(path.join(workspaceLayout.root, BUNDLED_DIGESTS_FILENAME), "utf8");

    const second = await retireBundledAgentPlugins({ layout, workspaceId: WORKSPACE_ID });

    assert.deepEqual(second, [{ pluginId: RETIRED, successorId: SUCCESSOR, status: "absent" }]);
    assert.equal(await readFile(path.join(workspaceLayout.root, ACTIVATIONS_FILENAME), "utf8"), activationsBytes);
    assert.equal(await readFile(path.join(workspaceLayout.root, BUNDLED_DIGESTS_FILENAME), "utf8"), ledgerBytes);
  } finally {
    await forceRemove(cwd);
  }
});

test("a workspace that never had old-integration: 'absent', and no state file is created", async () => {
  const { cwd, layout, workspaceLayout } = await freshLayout();
  try {
    const outcomes = await retireBundledAgentPlugins({ layout, workspaceId: WORKSPACE_ID });

    assert.deepEqual(outcomes, [{ pluginId: RETIRED, successorId: SUCCESSOR, status: "absent" }]);
    await assert.rejects(() => access(path.join(workspaceLayout.root, ACTIVATIONS_FILENAME)));
    await assert.rejects(() => access(path.join(workspaceLayout.root, BUNDLED_DIGESTS_FILENAME)));
  } finally {
    await forceRemove(cwd);
  }
});

test("a record with no package left is deleted directly", async () => {
  const { cwd, layout, workspaceLayout } = await freshLayout();
  try {
    await recordBundledAgentPluginIfAbsent({ workspaceRoot: workspaceLayout.root, pluginId: RETIRED });

    const [outcome] = await retireBundledAgentPlugins({ layout, workspaceId: WORKSPACE_ID });

    assert.deepEqual(outcome, {
      pluginId: RETIRED,
      successorId: SUCCESSOR,
      status: "retired",
      removedDigests: [],
      activationRemoved: true,
      ledgerEntryRemoved: false,
      successor: "not-needed",
    });
    assert.equal(Object.hasOwn((await readAgentPluginActivations(workspaceLayout.root)).plugins, RETIRED), false);
  } finally {
    await forceRemove(cwd);
  }
});

test("a leftover ledger entry alone is dropped, and every other entry keeps its own bytes", async () => {
  const { cwd, layout, workspaceLayout } = await freshLayout();
  try {
    const ledgerPath = path.join(workspaceLayout.root, BUNDLED_DIGESTS_FILENAME);
    await mkdir(workspaceLayout.root, { recursive: true });
    const deployEntry = { archiveDigest: "b".repeat(64), seededAt: "2026-01-01T00:00:00.000Z" };
    await writeFile(
      ledgerPath,
      JSON.stringify({ schemaVersion: 1, plugins: { [RETIRED]: { archiveDigest: "a".repeat(64), seededAt: "2026-01-01T00:00:00.000Z" }, [SUCCESSOR]: deployEntry } }),
      "utf8",
    );

    const [outcome] = await retireBundledAgentPlugins({ layout, workspaceId: WORKSPACE_ID });

    assert.equal(outcome?.status === "retired" && outcome.ledgerEntryRemoved, true);
    const written = JSON.parse(await readFile(ledgerPath, "utf8")) as { plugins: Record<string, unknown> };
    assert.deepEqual(written.plugins, { [SUCCESSOR]: deployEntry }, "the successor's seededAt is preserved, not restamped");
  } finally {
    await forceRemove(cwd);
  }
});

test("removeBundledAgentPluginDigest writes nothing for a missing or malformed ledger", async () => {
  const { cwd, workspaceLayout } = await freshLayout();
  try {
    assert.equal(await removeBundledAgentPluginDigest({ workspaceRoot: workspaceLayout.root, pluginId: RETIRED }), false);

    await mkdir(workspaceLayout.root, { recursive: true });
    const ledgerPath = path.join(workspaceLayout.root, BUNDLED_DIGESTS_FILENAME);
    await writeFile(ledgerPath, "{not json", "utf8");
    assert.equal(await removeBundledAgentPluginDigest({ workspaceRoot: workspaceLayout.root, pluginId: RETIRED }), false);
    assert.equal(await readFile(ledgerPath, "utf8"), "{not json");
  } finally {
    await forceRemove(cwd);
  }
});

test("a MALFORMED old-integration record fails the retirement and changes nothing", async () => {
  const { cwd, layout, workspaceLayout } = await freshLayout();
  try {
    await installPackage(layout, RETIRED, "archive-fly");
    await mkdir(workspaceLayout.root, { recursive: true });
    const activationsPath = path.join(workspaceLayout.root, ACTIVATIONS_FILENAME);
    const raw = JSON.stringify({ schemaVersion: 1, plugins: { [RETIRED]: "bundled" } });
    await writeFile(activationsPath, raw, "utf8");

    const [outcome] = await retireBundledAgentPlugins({ layout, workspaceId: WORKSPACE_ID });

    assert.equal(outcome?.status, "failed");
    assert.match(outcome?.status === "failed" ? outcome.reason : "", /cannot tell whether 'old-integration' was enabled/);
    assert.equal(await readFile(activationsPath, "utf8"), raw);
    assert.deepEqual(await installedIds(workspaceLayout.packages), [RETIRED]);
  } finally {
    await forceRemove(cwd);
  }
});

test("uninstallAgentPlugin's retiredBundled option skips only the bundled refusal", async () => {
  const { cwd, layout, workspaceLayout } = await freshLayout();
  try {
    const installed = await installPackage(layout, RETIRED, "archive-fly");
    await recordBundledAgentPluginIfAbsent({ workspaceRoot: workspaceLayout.root, pluginId: RETIRED });
    const request = { layout, workspaceId: WORKSPACE_ID, pluginId: RETIRED };

    await assert.rejects(() => uninstallAgentPlugin(request), AgentPluginNotUninstallableError);

    const result = await uninstallAgentPlugin(request, { retiredBundled: true });
    assert.deepEqual(result.removedDigests, [installed.archiveDigest]);
    assert.deepEqual(await installedIds(workspaceLayout.packages), []);
  } finally {
    await forceRemove(cwd);
  }
});

test("seedBundledAgentPlugins never seeds a retired id from a stale source directory, and reports retirements", async () => {
  const { cwd, layout, workspaceLayout } = await freshLayout();
  const bundledRoot = await mkdtemp(path.join(tmpdir(), "host-retire-bundled-source-"));
  try {
    const staleDir = path.join(bundledRoot, RETIRED);
    await mkdir(path.join(staleDir, "skills", RETIRED), { recursive: true });
    await writeFile(
      path.join(staleDir, "plugin.json"),
      JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: RETIRED, version: "1.0.0" }),
      "utf8",
    );
    await writeFile(path.join(staleDir, "skills", RETIRED, "SKILL.md"), `# ${RETIRED}\n`, "utf8");

    const result = await seedBundledAgentPlugins({ layout, workspaceId: WORKSPACE_ID, sourceRoot: bundledRoot });

    assert.deepEqual(result.outcomes, []);
    assert.deepEqual(result.retirements, [{ pluginId: RETIRED, successorId: SUCCESSOR, status: "absent" }]);
    assert.deepEqual(await installedIds(workspaceLayout.packages), []);
  } finally {
    await forceRemove(cwd);
    await forceRemove(bundledRoot);
  }
});
