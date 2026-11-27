import { PLUGIN_MANIFEST_FILENAME } from '../../plugin-format.js';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "../support/fixture-runner.js";

import type { PluginManifest } from "../support/manifest.js";
import { createPluginModuleImporter, createPluginModuleSnapshotLifecycle, PluginSnapshotIntegrityError, snapshotPluginModuleGraph, type PluginModuleSnapshotLifecycle } from "../../node/module-snapshot.js";

/**
 * @file `snapshotPluginModuleGraph` against a real installed package on disk: the verified copy, each
 * integrity refusal, the linked-runtime-root refusal, and cleanup of a half-written snapshot.
 */

const ENTRY = "export default 1;\n";
const digest = (text: string) => `sha256-${createHash("sha256").update(text).digest("hex")}`;

/** `<tmp>/plugins/installed/acme` with a manifest and one server entry; snapshots go to `<tmp>/plugins-runtime`. */
function installed(t: TestContext) {
  const tmp = mkdtempSync(path.join(tmpdir(), "tovu-module-snapshot-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const pluginRoot = path.join(tmp, "plugins", "installed", "acme");
  mkdirSync(path.join(pluginRoot, "server"), { recursive: true });
  writeFileSync(path.join(pluginRoot, PLUGIN_MANIFEST_FILENAME), "{}");
  writeFileSync(path.join(pluginRoot, "server", "index.mjs"), ENTRY);
  const manifest = (integrity: Record<string, string>) => ({ integrity }) as unknown as PluginManifest;
  return { tmp, pluginRoot, runtimeRoot: path.join(tmp, "plugins-runtime"), manifest };
}

test("a verified package is copied read-only into a fresh runtime snapshot and its server entry returned", async t => {
  const p = installed(t);
  const entry = await snapshotPluginModuleGraph({ pluginRoot: p.pluginRoot, manifest: p.manifest({ "server/index.mjs": digest(ENTRY) }) });
  assert.equal(path.dirname(path.dirname(path.dirname(entry))), p.runtimeRoot);
  assert.match(path.basename(path.dirname(path.dirname(entry))), /^load-/);
  assert.equal(readFileSync(entry, "utf8"), ENTRY);
  assert.equal(statSync(entry).mode & 0o777, 0o400);
  const second = await snapshotPluginModuleGraph({ pluginRoot: p.pluginRoot, manifest: p.manifest({ "server/index.mjs": digest(ENTRY) }) });
  assert.notEqual(second, entry, "every load gets its own filesystem identity");
});

test("a file whose bytes do not match the manifest is refused before anything is copied", async t => {
  const p = installed(t);
  await assert.rejects(snapshotPluginModuleGraph({ pluginRoot: p.pluginRoot, manifest: p.manifest({ "server/index.mjs": digest("other") }) }),
    (error: unknown) => error instanceof PluginSnapshotIntegrityError && error.message === "Package changed before loading.");
  assert.throws(() => readdirSync(p.runtimeRoot), { code: "ENOENT" });
});

test("a file the manifest lists but the package no longer has is refused", async t => {
  const p = installed(t);
  await assert.rejects(snapshotPluginModuleGraph({ pluginRoot: p.pluginRoot, manifest: p.manifest({ "server/index.mjs": digest(ENTRY), "server/gone.mjs": digest("x") }) }),
    (error: unknown) => error instanceof PluginSnapshotIntegrityError && error.message === "Package file disappeared before loading.");
});

test("a runtime root that is a symbolic link is refused", async t => {
  const p = installed(t);
  const elsewhere = path.join(p.tmp, "elsewhere");
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, p.runtimeRoot, "dir");
  await assert.rejects(snapshotPluginModuleGraph({ pluginRoot: p.pluginRoot, manifest: p.manifest({ "server/index.mjs": digest(ENTRY) }) }),
    (error: unknown) => error instanceof PluginSnapshotIntegrityError && error.message === "Runtime snapshot root must not be a link.");
  assert.deepEqual(readdirSync(elsewhere), []);
});

test("a failed copy removes the half-written snapshot and rethrows", async t => {
  const p = installed(t);
  const failure = new Error("disk full");
  await assert.rejects(snapshotPluginModuleGraph(
    { pluginRoot: p.pluginRoot, manifest: p.manifest({ "server/index.mjs": digest(ENTRY) }) },
    { writeSnapshotFile: async () => { throw failure; } },
  ), (error: unknown) => error === failure);
  assert.deepEqual(readdirSync(p.runtimeRoot), []);
});

test("a snapshot owner for a different runtime root is refused before copying into it", async t => {
  const p = installed(t);
  let copied = false;
  const lifecycle: PluginModuleSnapshotLifecycle = {
    runtimeRoot: path.join(p.tmp, "another-runtime"), ready: Promise.resolve(),
    createSnapshot: async () => { copied = true; return "unused"; }, dispose: async () => {},
  };
  await assert.rejects(snapshotPluginModuleGraph(
    { pluginRoot: p.pluginRoot, manifest: p.manifest({ "server/index.mjs": digest(ENTRY) }) }, { lifecycle },
  ), { code: "SNAPSHOT_ROOT_MISMATCH" });
  assert.equal(copied, false);
});

test("a site entry inside its package is imported from a verified copy held by the host snapshot owner", async t => {
  const p = installed(t);
  const snapshots = createPluginModuleSnapshotLifecycle({ runtimeRoot: p.runtimeRoot });
  t.after(() => snapshots.dispose({}, {}));
  const importer = createPluginModuleImporter({ manifest: p.manifest({ "server/index.mjs": digest(ENTRY) }), source: "site" }, { snapshots });
  const modulePath = path.join(p.pluginRoot, "server", "index.mjs");
  assert.deepEqual(await importer({ plugin: { pluginId: "acme", packageRoot: p.pluginRoot }, modulePath }), { exported: 1 });
  // The import ran from the owner's copy, not the installed package: one owned snapshot now exists.
  const copies = readdirSync(p.runtimeRoot);
  assert.equal(copies.length, 1);
  assert.match(copies[0]!, /^load-[0-9a-f]{16}-\d+-/);
  assert.equal(readFileSync(path.join(p.runtimeRoot, copies[0]!, "server", "index.mjs"), "utf8"), ENTRY);
});

const manifest = { integrity: {} } as unknown as PluginManifest;

test("built-in seam receives its original entry and projects the default without running setup", async () => {
  let entry: string | undefined;
  let setupCalls = 0;
  const exported = { definition: { setup: () => { setupCalls++; } } };
  const importer = createPluginModuleImporter({ manifest, source: "built-in" }, {
    importModule: async (entryPath) => { entry = entryPath; return { default: exported }; },
  });
  assert.deepEqual(await importer({ plugin: { pluginId: manifest.id, packageRoot: "/built-in" }, modulePath: "compiled-in-entry" }), { exported });
  assert.equal(entry, "compiled-in-entry");
  assert.equal(setupCalls, 0);
});

test("non-object module seams remain invalid even when they carry a default property", async () => {
  const invalidModule = Object.assign(() => {}, { default: { definition: { setup() {} } } });
  const importer = createPluginModuleImporter({ manifest, source: "built-in" }, { importModule: async () => invalidModule });
  assert.deepEqual(await importer({ plugin: { pluginId: manifest.id, packageRoot: "/built-in" }, modulePath: "compiled-in-entry" }), { exported: undefined });
});

test("site entry outside its real package root is refused without importing it", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "plugin-host-containment-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, "package");
  mkdirSync(packageRoot);
  const modulePath = path.join(root, "outside.mjs");
  writeFileSync(modulePath, 'throw new Error("outside entry was evaluated");');
  const importer = createPluginModuleImporter({ manifest, source: "site" });
  assert.equal(await importer({ plugin: { pluginId: manifest.id, packageRoot }, modulePath }), `module path '${modulePath}' escapes the plugin root`);
});

test("a built-in source with no injected seam imports its entry directly, without a site snapshot", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "plugin-host-builtin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const modulePath = path.join(root, "entry.mjs");
  writeFileSync(modulePath, 'export default { origin: "compiled-in" };');
  const importer = createPluginModuleImporter({ manifest, source: "built-in" });
  assert.deepEqual(await importer({ plugin: { pluginId: manifest.id, packageRoot: root }, modulePath }), { exported: { origin: "compiled-in" } });
});
