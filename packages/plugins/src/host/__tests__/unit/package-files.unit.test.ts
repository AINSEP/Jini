import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test, type TestContext } from "../support/fixture-runner.js";

import {
  PLUGIN_PACKAGE_FILE_LIMITS,
  PluginPackagePathError,
  readPluginPackageFiles,
  type PluginPackageFileLimits,
} from "../../node/package-files.js";

/**
 * @file `readPluginPackageFiles()` against a real temp directory — ordering, text/binary handling,
 * every cap, and each path guard on its own (root symlink, root outside the container, a symlinked
 * parent that resolves outside, a symlinked file inside the package).
 */

async function tempRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "tovu-plugin-package-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeTree(base: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(base, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

function limits(overrides: Partial<PluginPackageFileLimits>): PluginPackageFileLimits {
  return { ...PLUGIN_PACKAGE_FILE_LIMITS, ...overrides };
}

test("a missing plugin directory lists no files instead of throwing", async (t) => {
  const root = await tempRoot(t);
  const result = await readPluginPackageFiles({ input: { rootDir: path.join(root, "absent"), containerDir: root } });
  assert.deepEqual(result, { files: [], truncated: false });
});

test("lists breadth-first in name order: every top-level file before any nested one", async (t) => {
  const root = await tempRoot(t);
  const pkg = path.join(root, "pkg");
  await writeTree(pkg, {
    "tovu.plugin.json": "{}",
    "a-dir/deep/z.md": "deep",
    "a-dir/b.md": "b",
    "README.md": "readme",
  });

  const result = await readPluginPackageFiles({ input: { rootDir: pkg, containerDir: root } });

  assert.deepEqual(
    result.files.map((file) => file.relativePath),
    ["README.md", "tovu.plugin.json", "a-dir/b.md", "a-dir/deep/z.md"]
  );
  assert.deepEqual(result.files[0], { relativePath: "README.md", sizeBytes: 6, content: "readme", omitted: null });
  assert.equal(result.truncated, false);
});

test("a file with a NUL byte or invalid UTF-8 is listed as binary, with no content", async (t) => {
  const root = await tempRoot(t);
  await writeTree(root, {
    "nul.bin": Buffer.from([0x50, 0x4b, 0x00, 0x03]),
    "latin1.txt": Buffer.from([0x63, 0x61, 0x66, 0xe9]),
  });

  const result = await readPluginPackageFiles({ input: { rootDir: root, containerDir: root } });

  assert.deepEqual(result.files, [
    { relativePath: "latin1.txt", sizeBytes: 4, content: null, omitted: "binary" },
    { relativePath: "nul.bin", sizeBytes: 4, content: null, omitted: "binary" },
  ]);
});

test("a symlinked file inside the package is listed as a symlink and its target is never read", async (t) => {
  const root = await tempRoot(t);
  const pkg = path.join(root, "pkg");
  await writeTree(root, { "outside-secret.txt": "TOP-SECRET-OUTSIDE" });
  await writeTree(pkg, { "manifest.json": "{}" });
  await symlink(path.join(root, "outside-secret.txt"), path.join(pkg, "leak.txt"));
  await symlink(root, path.join(pkg, "leak-dir"));

  const result = await readPluginPackageFiles({ input: { rootDir: pkg, containerDir: root } });

  assert.deepEqual(result.files, [
    { relativePath: "leak-dir", sizeBytes: 0, content: null, omitted: "symlink" },
    { relativePath: "leak.txt", sizeBytes: 0, content: null, omitted: "symlink" },
    { relativePath: "manifest.json", sizeBytes: 2, content: "{}", omitted: null },
  ]);
  assert.equal(JSON.stringify(result).includes("TOP-SECRET-OUTSIDE"), false);
});

test("a package root that is itself a symlink is refused, even when it points inside the container", async (t) => {
  const root = await tempRoot(t);
  await writeTree(root, { "real/manifest.json": "{}" });
  await symlink(path.join(root, "real"), path.join(root, "linked"));

  await assert.rejects(
    readPluginPackageFiles({ input: { rootDir: path.join(root, "linked"), containerDir: root } }),
    PluginPackagePathError
  );
});

test("a package root outside the container is refused", async (t) => {
  const root = await tempRoot(t);
  await writeTree(root, { "install/.keep": "", "elsewhere/secret.txt": "TOP-SECRET-OUTSIDE" });

  await assert.rejects(
    readPluginPackageFiles({ input: { rootDir: path.join(root, "install", "..", "elsewhere"), containerDir: path.join(root, "install") } }),
    PluginPackagePathError
  );
});

test("a package root reached through a symlinked parent that resolves outside the container is refused", async (t) => {
  const root = await tempRoot(t);
  const install = path.join(root, "install");
  await writeTree(root, { "install/.keep": "", "outside/1.0.0/secret.txt": "TOP-SECRET-OUTSIDE" });
  await symlink(path.join(root, "outside"), path.join(install, "evil"));

  await assert.rejects(
    readPluginPackageFiles({ input: { rootDir: path.join(install, "evil", "1.0.0"), containerDir: install } }),
    PluginPackagePathError
  );
});

test("a file over maxFileBytes is listed as too-large with no content, and the walk continues", async (t) => {
  const root = await tempRoot(t);
  await writeTree(root, { "big.txt": "x".repeat(9), "small.txt": "ok" });

  const result = await readPluginPackageFiles({ input: { rootDir: root, containerDir: root } }, { limits: limits({ maxFileBytes: 8 }) });

  assert.deepEqual(result.files, [
    { relativePath: "big.txt", sizeBytes: 9, content: null, omitted: "too-large" },
    { relativePath: "small.txt", sizeBytes: 2, content: "ok", omitted: null },
  ]);
  assert.equal(result.truncated, false);
});

test("maxFiles: exactly that many files is complete; one more sets truncated", async (t) => {
  const root = await tempRoot(t);
  await writeTree(root, { "a.txt": "a", "b.txt": "b" });

  const exact = await readPluginPackageFiles({ input: { rootDir: root, containerDir: root } }, { limits: limits({ maxFiles: 2 }) });
  assert.equal(exact.files.length, 2);
  assert.equal(exact.truncated, false);

  await writeTree(root, { "c.txt": "c" });
  const over = await readPluginPackageFiles({ input: { rootDir: root, containerDir: root } }, { limits: limits({ maxFiles: 2 }) });
  assert.deepEqual(
    over.files.map((file) => file.relativePath),
    ["a.txt", "b.txt"]
  );
  assert.equal(over.truncated, true);
});

test("maxTotalBytes stops the walk before the file that would exceed it", async (t) => {
  const root = await tempRoot(t);
  await writeTree(root, { "a.txt": "12345", "b.txt": "67890" });

  const result = await readPluginPackageFiles({ input: { rootDir: root, containerDir: root } }, { limits: limits({ maxTotalBytes: 8 }) });

  assert.deepEqual(
    result.files.map((file) => file.relativePath),
    ["a.txt"]
  );
  assert.equal(result.truncated, true);
});

test("maxEntries counts directories too, so a wide tree of empty folders cannot force unbounded readdir calls", async (t) => {
  const root = await tempRoot(t);
  for (const name of ["d1", "d2", "d3"]) await mkdir(path.join(root, name));
  await writeTree(root, { "z.txt": "z" });

  const result = await readPluginPackageFiles({ input: { rootDir: root, containerDir: root } }, { limits: limits({ maxEntries: 2 }) });

  assert.deepEqual(result.files, []);
  assert.equal(result.truncated, true);
});


test("a regular file replaced by a symlink after listing never exposes the target", async (t) => {
  const root = await tempRoot(t);
  const pkg = path.join(root, "pkg");
  const victim = path.join(pkg, "victim.txt");
  const secret = path.join(root, "secret.txt");
  await writeTree(root, { "secret.txt": "TOP-SECRET-OUTSIDE", "pkg/victim.txt": "regular file" });
  const pkgReal = await fsPromises.realpath(pkg);
  const originalReaddir = fsPromises.readdir;
  let swapped = false;
  const spy = t.mock.method(fsPromises, "readdir", async (...args: Parameters<typeof fsPromises.readdir>) => {
    const entries = await originalReaddir(...args);
    if (args[0] === pkgReal && !swapped) {
      await rm(victim);
      await symlink(secret, victim);
      swapped = true;
    }
    return entries;
  });
  syncBuiltinESMExports();
  try {
    const result = await readPluginPackageFiles({ input: { rootDir: pkg, containerDir: root } });
    assert.equal(swapped, true, "fixture must swap only after the regular Dirent is captured");
    assert.deepEqual(result.files, [{ relativePath: "victim.txt", sizeBytes: 0, content: null, omitted: "symlink" }]);
    assert.equal(JSON.stringify(result).includes("TOP-SECRET-OUTSIDE"), false);
  } finally {
    spy.mock.restore();
    syncBuiltinESMExports();
  }
});
