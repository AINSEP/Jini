// Ported from the host app's test of the same name with the module; the host keeps its copy as the consumer check.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { onTestFinished, test, vi } from "vitest";

import { packagedPtyHelperFailures } from "../pty-helpers.js";

/** A packaged resources dir whose unpacked node-pty carries `helpers` (relative path -> mode). */
function resourcesWith(root: string, helpers: Record<string, number>): string {
  const pty = path.join(root, "app.asar.unpacked", "node_modules", "node-pty");
  for (const [rel, mode] of Object.entries(helpers)) {
    fs.mkdirSync(path.join(pty, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(pty, rel), "helper");
    fs.chmodSync(path.join(pty, rel), mode);
  }
  return root;
}

test("packaged spawn-helpers lacking execute bits are named with their mode; executable ones pass", { skip: process.platform === "win32" }, t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pty-helpers-"));
  onTestFinished(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const mac = resourcesWith(path.join(scratch, "Tovu.app", "Contents", "Resources"), {
    "prebuilds/darwin-arm64/spawn-helper": 0o644,
    "prebuilds/darwin-x64/spawn-helper": 0o755,
    "prebuilds/win32-x64/pty.node": 0o644,
  });
  const helper = path.join(mac, "app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper");
  assert.deepEqual(packagedPtyHelperFailures({ resourcesDirs: [mac] }), [`${helper} (mode 644)`]);
  fs.chmodSync(helper, 0o755);
  assert.deepEqual(packagedPtyHelperFailures({ resourcesDirs: [mac] }), []);
});

test("a mac bundle with no spawn-helper fails; a non-mac resources dir with none passes", t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pty-helpers-"));
  onTestFinished(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const mac = path.join(scratch, "Tovu.app", "Contents", "Resources");
  const win = resourcesWith(path.join(scratch, "win-unpacked", "resources"), { "prebuilds/win32-x64/pty.node": 0o644 });
  assert.deepEqual(packagedPtyHelperFailures({ resourcesDirs: [mac, win] }), [`no node-pty spawn-helper under ${path.join(mac, "app.asar.unpacked", "node_modules", "node-pty")}`]);
});

test("a Windows resources dir passes even though node-pty ships macOS spawn-helpers without execute bits", t => {
  // node-pty's tarball carries darwin prebuilds into Windows packages too; chmod cannot set POSIX
  // modes on Windows and conpty never execs spawn-helper, so their modes must not fail the build.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pty-helpers-"));
  onTestFinished(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const win = resourcesWith(path.join(scratch, "win-unpacked", "resources"), {
    "prebuilds/darwin-arm64/spawn-helper": 0o644,
    "prebuilds/darwin-x64/spawn-helper": 0o644,
    "prebuilds/win32-x64/pty.node": 0o644,
  });
  assert.deepEqual(packagedPtyHelperFailures({ resourcesDirs: [win] }), []);
});
