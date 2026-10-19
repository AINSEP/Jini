import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { ACTIVATIONS_FILENAME } from "../../activation.js";
import { type AgentPluginArchiveEntry, type AgentPluginArchiveReaderPort } from "../../install.js";
import type { AgentPluginLifecyclePorts, FilesystemPort } from "../../ports.js";
import { AgentPluginNotUninstallableError, createUninstallModule } from "../../uninstall.js";
import { forceRemove } from "../fixtures/force-remove.js";
import { installLegacyRevision } from "../fixtures/install-legacy-revision.js";
import {
  installAgentPlugin,
  ports as nativePorts,
  previewAgentPluginUninstall,
  readAgentPluginActivations,
  recordBundledAgentPluginIfAbsent,
  resolveAgentPluginLayout,
  setAgentPluginActivation,
} from "../test-support.js";

/**
 * @file Fault-injection boundary tests for `uninstall.ts`'s reversible half: staging package roots
 * aside, rolling them back when the activation-record delete fails, and reporting trees that could
 * not be put back. The suite runs as root in CI, where the `chmod 0o555` trick in
 * `uninstall.unit.test.ts` cannot provoke a failure, so each fault here is injected through a typed
 * `FilesystemPort` that delegates to the real `node:fs/promises` for everything it does not fail.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const FIXED_STAGE_ID = "fixed-stage-id";

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
  };
}

async function freshLayout() {
  const cwd = await mkdtemp(path.join(tmpdir(), "host-agent-plugin-uninstall-fault-test-"));
  const instanceLayout = resolveAgentPluginLayout({ cwd, env: {} });
  const workspaceLayout = instanceLayout.forWorkspace({ workspaceId: WORKSPACE_ID });
  return { cwd, instanceLayout, workspaceLayout };
}

async function installTestPackage(
  instanceLayout: ReturnType<typeof resolveAgentPluginLayout>,
  pluginId: string,
  archiveLabel: string,
  manifestFields: Record<string, string> = { version: "1.0.0" },
) {
  const manifest = JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: pluginId, ...manifestFields });
  const archive = new Uint8Array(Buffer.from(archiveLabel));
  return installAgentPlugin({
    archive,
    expectedSha256: createHash("sha256").update(archive).digest("hex"),
    archiveReader: reader([fileEntry("plugin.json", manifest), fileEntry(`skills/${pluginId}/SKILL.md`, `# ${pluginId}\n`)]),
    layout: instanceLayout,
    workspaceId: WORKSPACE_ID,
  });
}

/** The real ports, with a deterministic staging id and the given filesystem operations replaced. */
function faultyUninstall(overrides: Partial<FilesystemPort>, extra: Partial<AgentPluginLifecyclePorts> = {}) {
  const ports: AgentPluginLifecyclePorts = {
    ...nativePorts,
    ids: { ...nativePorts.ids, newId: () => FIXED_STAGE_ID },
    filesystem: { ...nativePorts.filesystem, ...overrides },
    ...extra,
  };
  return createUninstallModule(ports);
}

const realRename = nativePorts.filesystem.rename.bind(nativePorts.filesystem);
const realChmod = nativePorts.filesystem.chmod.bind(nativePorts.filesystem);
const realRm = nativePorts.filesystem.rm.bind(nativePorts.filesystem);

function injected(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

const isActivationsWrite = (to: unknown) => String(to).endsWith(ACTIVATIONS_FILENAME);
const isStaged = (p: unknown) => path.basename(String(p)).startsWith(".uninstalling-");

async function withLayout(run: (fixture: Awaited<ReturnType<typeof freshLayout>>) => Promise<void>) {
  const fixture = await freshLayout();
  try {
    await run(fixture);
  } finally {
    await forceRemove(fixture.cwd);
  }
}

test("an activation-record delete failure rejects with that same error and renames every staged tree back", () =>
  withLayout(async ({ instanceLayout, workspaceLayout }) => {
    const installed = await installTestPackage(instanceLayout, "rollback-plugin", "archive-rollback");
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: "rollback-plugin", enabled: true, actor: "op-1" });
    const failure = injected("EIO", "injected activations rename failure");
    const { uninstallAgentPlugin } = faultyUninstall({
      rename: async (from, to) => (isActivationsWrite(to) ? Promise.reject(failure) : realRename(from, to)),
    });

    await assert.rejects(() => uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "rollback-plugin" }), (error: unknown) => error === failure);

    assert.deepEqual(await readdir(workspaceLayout.pluginPackagesDir({ pluginId: "rollback-plugin" })), [installed.archiveDigest]);
    assert.equal((await stat(installed.packageRoot)).mode & 0o777, 0o555, "the restored root must be frozen again");
    assert.equal((await readAgentPluginActivations(workspaceLayout.root)).plugins["rollback-plugin"]?.enabled, true);
  }));

test("a rolled-back tree whose re-freeze fails is still restored, left writable, and the original error is rethrown", () =>
  withLayout(async ({ instanceLayout, workspaceLayout }) => {
    const installed = await installTestPackage(instanceLayout, "refreeze-plugin", "archive-refreeze");
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: "refreeze-plugin", enabled: true, actor: "op-1" });
    const failure = injected("EIO", "injected activations rename failure");
    let restored = false;
    const { uninstallAgentPlugin } = faultyUninstall({
      rename: async (from, to) => {
        if (isActivationsWrite(to)) throw failure;
        await realRename(from, to);
        if (isStaged(from)) restored = true;
      },
      chmod: async (target, mode) => (restored ? Promise.reject(injected("EPERM", "injected re-freeze failure")) : realChmod(target, mode)),
    });

    await assert.rejects(() => uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "refreeze-plugin" }), (error: unknown) => error === failure);

    assert.equal((await stat(installed.packageRoot)).mode & 0o777, 0o755, "staging widened 0o555 to 0o755 and the failed re-freeze leaves it so");
  }));

test("a staged tree that cannot be renamed back is named as stranded, keeping the original error as cause", () =>
  withLayout(async ({ instanceLayout, workspaceLayout }) => {
    const installed = await installTestPackage(instanceLayout, "stranded-plugin", "archive-stranded");
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: "stranded-plugin", enabled: true, actor: "op-1" });
    const failure = injected("EIO", "injected activations rename failure");
    const { uninstallAgentPlugin } = faultyUninstall({
      rename: async (from, to) => {
        if (isActivationsWrite(to)) throw failure;
        if (isStaged(from)) throw injected("EXDEV", "injected restore failure");
        await realRename(from, to);
      },
    });
    const quarantined = path.join(workspaceLayout.pluginPackagesDir({ pluginId: "stranded-plugin" }), `.uninstalling-${FIXED_STAGE_ID}`);

    await assert.rejects(
      () => uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "stranded-plugin" }),
      (error: unknown) =>
        error instanceof Error &&
        error.cause === failure &&
        error.message ===
          "Agent Plugin uninstall failed (injected activations rename failure) and 1 package tree(s) could not be put back. " +
            `They still hold the package bytes and were left in place for recovery: ${quarantined}`,
    );

    assert.equal(await readFile(path.join(quarantined, "plugin.json"), "utf8").then((text) => JSON.parse(text).name), "stranded-plugin");
    await assert.rejects(stat(installed.packageRoot), { code: "ENOENT" });
  }));

test("a stranded-tree report renders a non-Error cause with String()", () =>
  withLayout(async ({ instanceLayout, workspaceLayout }) => {
    await installTestPackage(instanceLayout, "string-cause", "archive-string-cause");
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: "string-cause", enabled: true, actor: "op-1" });
    const { uninstallAgentPlugin } = faultyUninstall({
      rename: async (from, to) => {
        if (isActivationsWrite(to)) return Promise.reject("plain string failure");
        if (isStaged(from)) throw injected("EXDEV", "injected restore failure");
        await realRename(from, to);
      },
    });

    await assert.rejects(
      () => uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "string-cause" }),
      (error: unknown) =>
        error instanceof Error && error.cause === "plain string failure" && error.message.startsWith("Agent Plugin uninstall failed (plain string failure) and 1 package tree(s)"),
    );
  }));

test("a staging rename failure re-freezes the package root, rethrows, and removes nothing", () =>
  withLayout(async ({ instanceLayout, workspaceLayout }) => {
    const installed = await installTestPackage(instanceLayout, "stage-fail", "archive-stage-fail");
    await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: "stage-fail", enabled: false, actor: "op-1" });
    const failure = injected("EBUSY", "injected staging rename failure");
    const { uninstallAgentPlugin } = faultyUninstall({
      rename: async (from, to) => (isStaged(to) ? Promise.reject(failure) : realRename(from, to)),
    });

    await assert.rejects(() => uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "stage-fail" }), (error: unknown) => error === failure);

    assert.equal((await stat(installed.packageRoot)).mode & 0o777, 0o555);
    assert.equal((await readAgentPluginActivations(workspaceLayout.root)).plugins["stage-fail"]?.enabled, false);
  }));

test("a staging rename failure whose re-freeze also fails still rethrows the rename error", () =>
  withLayout(async ({ instanceLayout }) => {
    const installed = await installTestPackage(instanceLayout, "stage-refreeze", "archive-stage-refreeze");
    const failure = injected("EBUSY", "injected staging rename failure");
    const { uninstallAgentPlugin } = faultyUninstall({
      rename: async (from, to) => (isStaged(to) ? Promise.reject(failure) : realRename(from, to)),
      chmod: async (target, mode) => (mode === 0o555 ? Promise.reject(injected("EPERM", "injected re-freeze failure")) : realChmod(target, mode)),
    });

    await assert.rejects(() => uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "stage-refreeze" }), (error: unknown) => error === failure);

    assert.equal((await stat(installed.packageRoot)).isDirectory(), true);
  }));

test("a failure staging the SECOND digest puts the first, already-staged digest back", () =>
  withLayout(async ({ instanceLayout, workspaceLayout }) => {
    const packagesDir = workspaceLayout.pluginPackagesDir({ pluginId: "two-digests" });
    const first = await installTestPackage(instanceLayout, "two-digests", "archive-two-a");
    const second = await installLegacyRevision({ packagesDir, install: () => installTestPackage(instanceLayout, "two-digests", "archive-two-b") });
    let stagings = 0;
    const failure = injected("EBUSY", "injected second staging failure");
    const { uninstallAgentPlugin } = faultyUninstall({
      rename: async (from, to) => {
        if (isStaged(to) && ++stagings === 2) throw failure;
        await realRename(from, to);
      },
    });

    await assert.rejects(() => uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "two-digests" }), (error: unknown) => error === failure);

    assert.deepEqual((await readdir(packagesDir)).sort(), [first.archiveDigest, second.archiveDigest].sort());
  }));

for (const code of ["ENOENT", "ENOTEMPTY", "EEXIST"]) {
  test(`an ${code} from removing an empty package ancestor is ignored`, () =>
    withLayout(async ({ instanceLayout }) => {
      const installed = await installTestPackage(instanceLayout, "rmdir-ignored", `archive-rmdir-${code}`);
      const { uninstallAgentPlugin } = faultyUninstall({ rmdir: async () => Promise.reject(injected(code, `injected ${code}`)) });

      const result = await uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "rmdir-ignored" });

      assert.deepEqual(result.removedDigests, [installed.archiveDigest]);
    }));
}

for (const [label, thrown] of [
  ["an EPERM error", injected("EPERM", "injected rmdir EPERM")],
  ["an Error without a code", new Error("injected codeless rmdir failure")],
  ["a non-object rejection", "injected string rmdir failure"],
  ["a null rejection", null],
] as const) {
  test(`${label} from removing an empty package ancestor is rethrown after the package is already gone`, () =>
    withLayout(async ({ instanceLayout, workspaceLayout }) => {
      const installed = await installTestPackage(instanceLayout, "rmdir-fatal", `archive-rmdir-fatal-${label}`);
      await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: "rmdir-fatal", enabled: true, actor: "op-1" });
      const { uninstallAgentPlugin } = faultyUninstall({ rmdir: async () => Promise.reject(thrown) });

      await assert.rejects(
        uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "rmdir-fatal" }).then(() => "resolved"),
        (error: unknown) => error === thrown,
      );

      await assert.rejects(stat(installed.packageRoot), { code: "ENOENT" });
      assert.equal("rmdir-fatal" in (await readAgentPluginActivations(workspaceLayout.root)).plugins, false);
    }));
}

test("deleteMemory without a confirmed preview is refused before anything is removed", () =>
  withLayout(async ({ instanceLayout }) => {
    const installed = await installTestPackage(instanceLayout, "memory-plugin", "archive-memory-no-preview");
    const { uninstallAgentPlugin } = faultyUninstall({});

    await assert.rejects(
      () => uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "memory-plugin" }, { deleteMemory: true }),
      (error: unknown) => error instanceof Error && error.message === "Deleting plugin memory requires a confirmed preview for this plugin",
    );

    assert.equal((await stat(installed.packageRoot)).isDirectory(), true);
  }));

test("deleteMemory with a confirmed preview naming a different plugin is refused before anything is removed", () =>
  withLayout(async ({ instanceLayout }) => {
    const installed = await installTestPackage(instanceLayout, "memory-plugin", "archive-memory-other-preview");
    const { uninstallAgentPlugin } = faultyUninstall({});
    const confirmedPreview = { pluginId: "someone-else", versions: [], archiveDigests: [installed.archiveDigest] };

    await assert.rejects(
      () => uninstallAgentPlugin({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "memory-plugin" }, { deleteMemory: true, confirmedPreview }),
      (error: unknown) => error instanceof Error && error.message === "Deleting plugin memory requires a confirmed preview for this plugin",
    );

    assert.equal((await stat(installed.packageRoot)).isDirectory(), true);
  }));

test("deleteMemory keeps persistent memory when the plugin was reinstalled while its trees were being removed", () =>
  withLayout(async ({ cwd, instanceLayout, workspaceLayout }) => {
    const installed = await installTestPackage(instanceLayout, "reinstalled", "archive-reinstalled");
    const req = { layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "reinstalled" };
    const confirmedPreview = await previewAgentPluginUninstall(req);
    const memoryFile = path.join(workspaceLayout.pluginRootDir({ pluginId: "reinstalled" }), "memory", "note.txt");
    await mkdir(path.dirname(memoryFile), { recursive: true });
    await writeFile(memoryFile, "keep me");
    const backup = path.join(cwd, "reinstall-backup");
    await cp(installed.packageRoot, backup, { recursive: true });
    const { uninstallAgentPlugin } = faultyUninstall({
      rm: async (target, options) => {
        await realRm(target, options);
        if (isStaged(target)) await cp(backup, installed.packageRoot, { recursive: true });
      },
    });

    await assert.rejects(
      () => uninstallAgentPlugin(req, { confirmedPreview, deleteMemory: true }),
      (error: unknown) => error instanceof Error && error.message === "Plugin was reinstalled during uninstall; persistent memory was kept",
    );

    assert.equal(await readFile(memoryFile, "utf8"), "keep me");
  }));

test("a host recovery formatter replaces the bundled refusal's default disable advice", () =>
  withLayout(async ({ instanceLayout, workspaceLayout }) => {
    await installTestPackage(instanceLayout, "bundled-custom", "archive-bundled-custom");
    await recordBundledAgentPluginIfAbsent({ workspaceRoot: workspaceLayout.root, pluginId: "bundled-custom" });
    const { previewAgentPluginUninstall: preview } = faultyUninstall({}, { formatBundledUninstallRecovery: ({ pluginId }) => `use, run host-disable ${pluginId}.` });

    await assert.rejects(
      () => preview({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "bundled-custom" }),
      (error: unknown) =>
        error instanceof AgentPluginNotUninstallableError &&
        error.message ===
          "Agent Plugin 'bundled-custom' is bundled with the host and cannot be uninstalled — it is re-seeded on every boot " +
            "(seed-bundled.ts), so removing its files now would silently reappear on the next restart. To stop it being " +
            "use, run host-disable bundled-custom.",
    );
  }));

test("a preview of a package whose manifest declares no version lists no versions", () =>
  withLayout(async ({ instanceLayout }) => {
    const installed = await installTestPackage(instanceLayout, "unversioned", "archive-unversioned", {});

    const preview = await previewAgentPluginUninstall({ layout: instanceLayout, workspaceId: WORKSPACE_ID, pluginId: "unversioned" });

    assert.deepEqual(preview, { pluginId: "unversioned", versions: [], archiveDigests: [installed.archiveDigest] });
  }));

test("removeFrozenPackageTree removes a path that is not a directory (its listing fails and is skipped)", () =>
  withLayout(async ({ cwd }) => {
    const file = path.join(cwd, "not-a-directory");
    await writeFile(file, "bytes");

    await faultyUninstall({}).removeFrozenPackageTree(file);

    await assert.rejects(stat(file), { code: "ENOENT" });
  }));

test("removeFrozenPackageTree still removes the tree when unfreezing an entry fails", () =>
  withLayout(async ({ cwd }) => {
    const root = path.join(cwd, "tree");
    await mkdir(path.join(root, "nested"), { recursive: true });
    await writeFile(path.join(root, "nested", "file.txt"), "bytes");
    const { removeFrozenPackageTree } = faultyUninstall({ chmod: async () => Promise.reject(injected("EPERM", "injected chmod failure")) });

    await removeFrozenPackageTree(root);

    await assert.rejects(stat(root), { code: "ENOENT" });
  }));
