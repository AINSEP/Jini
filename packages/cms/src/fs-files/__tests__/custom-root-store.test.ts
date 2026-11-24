import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { beforeEach, onTestFinished, test, vi } from "vitest";

import {
  CustomFsRootError,
  getCustomFsRoot,
  getCustomFsRootStatus,
  resetCustomFsRootForTests,
  setCustomFsRoot,
} from "../custom-root-store.js";

/**
 * @file Certifies the operator-set `custom` fs-files root's own store: path-only capture (never a
 * read of the folder's contents), the validation `setCustomFsRoot` performs before accepting a path,
 * that clearing genuinely clears rather than merely no-oping, that the value survives a simulated
 * process restart, that a vanished path is reported honestly rather than as "never set", and that two
 * workspaces never share a value.
 *
 * Every call below passes its own fresh `mkdtempSync` directory as `siteDir` — `setCustomFsRoot`'s
 * default (the real site) must never be exercised here, since this suite runs against the developer's
 * live working tree.
 */

const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";

function freshSiteDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-site-"));
}

beforeEach(() => {
  const siteDir = freshSiteDir();
  resetCustomFsRootForTests({ siteDir });
});

test("unset by default", () => {
  const siteDir = freshSiteDir();
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), undefined);
});

test("setting a real absolute directory makes it the current custom root, resolved through realpath", () => {
  const siteDir = freshSiteDir();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-"));
  setCustomFsRoot({ workspaceId: WORKSPACE_A, path: dir, optional: { siteDir } });
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), fs.realpathSync(dir));
});

test("setting does not read, list, or otherwise touch anything INSIDE the folder", () => {
  const siteDir = freshSiteDir();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-"));
  const bigFile = path.join(dir, "huge.bin");
  // A child file lets the filesystem spies observe any eager read or walk.
  fs.writeFileSync(bigFile, Buffer.alloc(1024));
  const forbiddenAccesses: string[] = [];
  const reads = ["readFileSync", "readdirSync", "opendirSync", "openSync", "statSync", "lstatSync"] as const;
  for (const method of reads) {
    const original = fs[method];
    vi.spyOn(fs, method).mockImplementation(((...args: unknown[]) => {
      const accessed = String(args[0]);
      if (accessed.startsWith(`${dir}${path.sep}`) || ((method === "readdirSync" || method === "opendirSync") && accessed === dir)) forbiddenAccesses.push(`${method}:${accessed}`);
      return Reflect.apply(original, fs, args);
    }) as never);
  }
  syncBuiltinESMExports();
  onTestFinished(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); });
  const before = Date.now();
  setCustomFsRoot({ workspaceId: WORKSPACE_A, path: dir, optional: { siteDir } });
  const elapsedMs = Date.now() - before;
  assert.ok(elapsedMs < 1000, `setCustomFsRoot took ${elapsedMs}ms — expected an O(1) stat, not a walk`);
  assert.deepEqual(forbiddenAccesses, [], "setting a path must never enumerate the folder or read/stat its children");
});

test("a relative path is refused", () => {
  const siteDir = freshSiteDir();
  assert.throws(() => setCustomFsRoot({ workspaceId: WORKSPACE_A, path: "relative/path", optional: { siteDir } }), CustomFsRootError);
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), undefined);
});

test("a path that does not exist is refused", () => {
  const siteDir = freshSiteDir();
  const missing = path.join(os.tmpdir(), `host-custom-root-missing-${Date.now()}`);
  assert.throws(() => setCustomFsRoot({ workspaceId: WORKSPACE_A, path: missing, optional: { siteDir } }), CustomFsRootError);
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), undefined);
});

test("a path naming a FILE, not a directory, is refused", () => {
  const siteDir = freshSiteDir();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-"));
  const file = path.join(dir, "not-a-directory.txt");
  fs.writeFileSync(file, "hello", "utf8");
  assert.throws(() => setCustomFsRoot({ workspaceId: WORKSPACE_A, path: file, optional: { siteDir } }), CustomFsRootError);
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), undefined);
});

test("setting null clears a previously-set root", () => {
  const siteDir = freshSiteDir();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-"));
  setCustomFsRoot({ workspaceId: WORKSPACE_A, path: dir, optional: { siteDir } });
  assert.notEqual(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), undefined);
  setCustomFsRoot({ workspaceId: WORKSPACE_A, path: null, optional: { siteDir } });
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), undefined);
});

test("a rejected set leaves a previously-valid root untouched", () => {
  const siteDir = freshSiteDir();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-"));
  setCustomFsRoot({ workspaceId: WORKSPACE_A, path: dir, optional: { siteDir } });
  const before = getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } });
  assert.throws(() => setCustomFsRoot({ workspaceId: WORKSPACE_A, path: "relative/nonsense", optional: { siteDir } }), CustomFsRootError);
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), before);
});

// ---------------------------------------------------------------------------
// Persistence: survives a simulated restart.
// ---------------------------------------------------------------------------

test("a set folder survives a simulated restart — a fresh call against the same siteDir still sees it", () => {
  const siteDir = freshSiteDir();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-"));
  setCustomFsRoot({ workspaceId: WORKSPACE_A, path: dir, optional: { siteDir } });

  const moduleUrl = new URL("../custom-root-store.ts", import.meta.url).href;
  // The site-dir barrel also loads database runtimes whose handles can keep the child alive.
  // Finish this read-only probe after stdout flushes; persistence is asserted from its actual output.
  const script = `import { getCustomFsRoot } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(getCustomFsRoot({ workspaceId: process.argv[1], optional: { siteDir: process.argv[2] } })) ?? "null", () => process.exit(0));`;
  const persisted = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, WORKSPACE_A, siteDir], { encoding: "utf8", timeout: 10000 });
  assert.equal(JSON.parse(persisted), fs.realpathSync(dir), "a new process must load the persisted path without the setter's module state");
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), fs.realpathSync(dir));
});

test("the persistence file is small, inspectable JSON keyed by workspace id", () => {
  const siteDir = freshSiteDir();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-"));
  setCustomFsRoot({ workspaceId: WORKSPACE_A, path: dir, optional: { siteDir } });

  const persisted = fs.readFileSync(path.join(siteDir, ".fs-custom-root.json"), "utf8");
  const parsed = JSON.parse(persisted);
  assert.deepEqual(parsed, { [WORKSPACE_A]: fs.realpathSync(dir) });
});

// ---------------------------------------------------------------------------
// Honest degradation: a vanished path is not the same as "never set".
// ---------------------------------------------------------------------------

test("a path that vanished after being set is reported as vanished, not as unset", () => {
  const siteDir = freshSiteDir();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-"));
  setCustomFsRoot({ workspaceId: WORKSPACE_A, path: dir, optional: { siteDir } });
  const realDir = fs.realpathSync(dir);

  fs.rmSync(dir, { recursive: true, force: true });

  const status = getCustomFsRootStatus({ workspaceId: WORKSPACE_A, optional: { siteDir } });
  assert.equal(status.path, undefined);
  assert.equal(status.vanished, true);
  assert.equal(status.vanishedPath, realDir);
});

test("getCustomFsRoot treats a vanished path the same as unset — undefined either way", () => {
  const siteDir = freshSiteDir();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-"));
  setCustomFsRoot({ workspaceId: WORKSPACE_A, path: dir, optional: { siteDir } });
  fs.rmSync(dir, { recursive: true, force: true });

  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), undefined);
});

test("never having set anything is NOT reported as vanished", () => {
  const siteDir = freshSiteDir();
  const status = getCustomFsRootStatus({ workspaceId: WORKSPACE_A, optional: { siteDir } });
  assert.equal(status.path, undefined);
  assert.equal(status.vanished, false);
  assert.equal(status.vanishedPath, undefined);
});

// ---------------------------------------------------------------------------
// Two workspaces never share a value.
// ---------------------------------------------------------------------------

test("two workspaces do not share a custom root", () => {
  const siteDir = freshSiteDir();
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-a-"));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-b-"));

  setCustomFsRoot({ workspaceId: WORKSPACE_A, path: dirA, optional: { siteDir } });
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_B, optional: { siteDir } }), undefined, "workspace B must not see workspace A's root");

  setCustomFsRoot({ workspaceId: WORKSPACE_B, path: dirB, optional: { siteDir } });
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), fs.realpathSync(dirA), "workspace A's own root must be unaffected");
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_B, optional: { siteDir } }), fs.realpathSync(dirB));
});

test("clearing one workspace's root leaves the other workspace's root untouched", () => {
  const siteDir = freshSiteDir();
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-a-"));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-b-"));

  setCustomFsRoot({ workspaceId: WORKSPACE_A, path: dirA, optional: { siteDir } });
  setCustomFsRoot({ workspaceId: WORKSPACE_B, path: dirB, optional: { siteDir } });
  setCustomFsRoot({ workspaceId: WORKSPACE_A, path: null, optional: { siteDir } });

  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), undefined);
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_B, optional: { siteDir } }), fs.realpathSync(dirB));
});

test("corrupt persistence degrades to an unset root without throwing", () => {
  const siteDir = freshSiteDir();
  fs.writeFileSync(path.join(siteDir, ".fs-custom-root.json"), "{garbage JSON");
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), undefined);
  assert.deepEqual(getCustomFsRootStatus({ workspaceId: WORKSPACE_A, optional: { siteDir } }), { path: undefined, vanished: false });
});

test("a saved directory replaced by a file is reported as vanished", () => {
  const siteDir = freshSiteDir();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-custom-root-"));
  setCustomFsRoot({ workspaceId: WORKSPACE_A, path: dir, optional: { siteDir } });
  const realDir = fs.realpathSync(dir);
  fs.rmSync(dir, { recursive: true });
  fs.writeFileSync(dir, "now a file");
  assert.equal(getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), undefined);
  assert.deepEqual(getCustomFsRootStatus({ workspaceId: WORKSPACE_A, optional: { siteDir } }), { path: undefined, vanished: true, vanishedPath: realDir });
});

test("resetCustomFsRootForTests ignores a site directory that does not exist but surfaces any other write fault", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "host-fs-root-reset-"));
  try {
    assert.doesNotThrow(() => resetCustomFsRootForTests({ siteDir: path.join(base, "never-created") }));
    const fileAsDir = path.join(base, "not-a-dir");
    fs.writeFileSync(fileAsDir, "plain file");
    assert.throws(() => resetCustomFsRootForTests({ siteDir: fileAsDir }), (err: NodeJS.ErrnoException) => err.code === "ENOTDIR");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("persistence read I/O rejection propagates instead of becoming an empty store", () => {
  const siteDir = freshSiteDir();
  const cause = Object.assign(new Error("persistence read canary"), { code: "EACCES" });
  vi.spyOn(fs, "readFileSync").mockImplementation(() => { throw cause; });
  syncBuiltinESMExports();
  onTestFinished(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(siteDir, { recursive: true, force: true }); });
  assert.throws(() => getCustomFsRoot({ workspaceId: WORKSPACE_A, optional: { siteDir } }), error => error === cause);
});
