import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "../support/fixture-runner.js";

import type { PluginManifest } from "../support/manifest.js";
import { PluginSnapshotIntegrityError, snapshotPluginModuleGraph } from "../../node/module-snapshot.js";

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
  writeFileSync(path.join(pluginRoot, "tovu.plugin.json"), "{}");
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
