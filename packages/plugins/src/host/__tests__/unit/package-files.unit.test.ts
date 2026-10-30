import { PLUGIN_MANIFEST_FILENAME } from '../../plugin-format.js';
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test, type TestContext } from "../support/fixture-runner.js";

import {
  listSitePluginPackage,
  PLUGIN_PACKAGE_FILE_LIMITS,
  PluginPackagePathError,
  readPluginPackageFiles,
  type PluginPackageFileLimits,
} from "../../node/package-files.js";
import type { PluginDiscoveryRecord } from "../../discovery-types.js";

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
    [PLUGIN_MANIFEST_FILENAME]: "{}",
    "a-dir/deep/z.md": "deep",
    "a-dir/b.md": "b",
    "README.md": "readme",
  });

  const result = await readPluginPackageFiles({ input: { rootDir: pkg, containerDir: root } });

  assert.deepEqual(
    result.files.map((file) => file.relativePath),
    ["README.md", PLUGIN_MANIFEST_FILENAME, "a-dir/b.md", "a-dir/deep/z.md"]
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

/** Runs `run` with `fsPromises[key]` replaced, restoring the real export afterwards. */
async function withFsPatch<K extends "open" | "readdir">(t: TestContext, key: K, implementation: unknown, run: () => Promise<void>): Promise<void> {
  const spy = t.mock.method(fsPromises, key, implementation);
  syncBuiltinESMExports();
  try { await run(); } finally { spy.mock.restore(); syncBuiltinESMExports(); }
}

test('growth within the per-file limit still cannot exceed the total package budget', async t => {
  const root = await tempRoot(t);
  await writeTree(root, { 'growing.txt': 'x' });
  const originalOpen = fsPromises.open;
  await withFsPatch(t, 'open', async (...args: Parameters<typeof fsPromises.open>) => {
    const handle = await originalOpen(...args);
    return new Proxy(handle, { get(target, key) {
      if (key === 'stat') return async () => {
        const info = await target.stat();
        await writeFile(path.join(root, 'growing.txt'), '12345');
        return info;
      };
      const value = Reflect.get(target, key) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  }, async () => {
    const result = await readPluginPackageFiles({ input: { rootDir: root, containerDir: root } },
      { limits: limits({ maxFileBytes: 8, maxTotalBytes: 4 }) });
    assert.deepEqual(result, { files: [], truncated: true });
  });
});

test("C26: a file growing beyond maxFileBytes after stat is omitted instead of returning a prefix", async (t) => {
  const root = await tempRoot(t);
  const file = path.join(root, "growing.txt");
  await writeTree(root, { "growing.txt": "x" });
  const originalOpen = fsPromises.open;
  let grew = false;
  await withFsPatch(t, "open", async (...args: Parameters<typeof fsPromises.open>) => {
    const handle = await originalOpen(...args);
    return new Proxy(handle, { get: (target, key) => {
      if (key === "stat") return async () => {
        const stats = await target.stat();
        // Keep the observed one-byte size, then grow the real file before the read.
        if (!grew) { await writeFile(file, "123456789"); grew = true; }
        return stats;
      };
      const value = Reflect.get(target, key) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    } });
  }, async () => {
    const result = await readPluginPackageFiles({ input: { rootDir: root, containerDir: root } }, { limits: limits({ maxFileBytes: 8 }) });
    assert.equal(grew, true, "fixture must grow the file between stat and read");
    assert.deepEqual(result.files.map(({ relativePath, content, omitted }) => ({ relativePath, content, omitted })), [
      { relativePath: "growing.txt", content: null, omitted: "too-large" },
    ]);
    assert.equal(result.truncated, false);
  });
});

test("open faults: EMLINK reads as a symlink, anything else as unreadable", async (t) => {
  const root = await tempRoot(t);
  await writeTree(root, { "pkg/a.txt": "a", "pkg/b.txt": "b" });
  const originalOpen = fsPromises.open;
  await withFsPatch(t, "open", async (...args: Parameters<typeof fsPromises.open>) => {
    const name = path.basename(String(args[0]));
    if (name === "a.txt") throw Object.assign(new Error("links"), { code: "EMLINK" });
    if (name === "b.txt") throw Object.assign(new Error("denied"), { code: "EACCES" });
    return originalOpen(...args);
  }, async () => {
    const result = await readPluginPackageFiles({ input: { rootDir: path.join(root, "pkg"), containerDir: root } });
    assert.deepEqual(result.files.map((file) => [file.relativePath, file.omitted]), [["a.txt", "symlink"], ["b.txt", "unreadable"]]);
  });
});

test("a file swapped for a non-file after listing is skipped, and one that grew past the cap is too large", async (t) => {
  const root = await tempRoot(t);
  await writeTree(root, { "pkg/a.txt": "a", "pkg/b.txt": "bb" });
  const originalOpen = fsPromises.open;
  await withFsPatch(t, "open", async (...args: Parameters<typeof fsPromises.open>) => {
    const handle = await originalOpen(...args);
    const name = path.basename(String(args[0]));
    const overrides: Record<string, unknown> = name === "a.txt"
      ? { stat: async () => Object.assign(await handle.stat(), { isFile: () => false }) }
      : { stat: async () => Object.assign(await handle.stat(), { size: 1 }) };
    return new Proxy(handle, { get: (target, key) => {
      if (typeof key === "string" && key in overrides) return overrides[key];
      const value = Reflect.get(target, key) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    } });
  }, async () => {
    const result = await readPluginPackageFiles({ input: { rootDir: path.join(root, "pkg"), containerDir: root } }, { limits: limits({ maxFileBytes: 1 }) });
    assert.deepEqual(result.files, [{ relativePath: "b.txt", sizeBytes: 2, content: null, omitted: "too-large" }]);
  });
});

test("an unreadable subdirectory lists as empty, and a root lstat fault other than ENOENT propagates", async (t) => {
  const root = await tempRoot(t);
  await writeTree(root, { "pkg/top.txt": "t", "pkg/sub/inner.txt": "i" });
  const originalReaddir = fsPromises.readdir;
  await withFsPatch(t, "readdir", async (...args: Parameters<typeof fsPromises.readdir>) => {
    if (path.basename(String(args[0])) === "sub") throw Object.assign(new Error("denied"), { code: "EACCES" });
    return originalReaddir(...args);
  }, async () => {
    const result = await readPluginPackageFiles({ input: { rootDir: path.join(root, "pkg"), containerDir: root } });
    assert.deepEqual(result.files.map((file) => file.relativePath), ["top.txt"]);
  });
  await assert.rejects(readPluginPackageFiles({ input: { rootDir: path.join(root, "pkg", "top.txt", "x"), containerDir: root } }), { code: "ENOTDIR" });
});

test("listing order is code-unit order whatever order readdir returns", async (t) => {
  const root = await tempRoot(t);
  await writeTree(root, { "pkg/a.txt": "a", "pkg/B.txt": "b", "pkg/c.txt": "c" });
  const originalReaddir = fsPromises.readdir;
  await withFsPatch(t, "readdir", async (...args: Parameters<typeof fsPromises.readdir>) => [...(await originalReaddir(...args) as unknown[])].reverse(), async () => {
    const result = await readPluginPackageFiles({ input: { rootDir: path.join(root, "pkg"), containerDir: root } });
    assert.deepEqual(result.files.map((file) => file.relativePath), ["B.txt", "a.txt", "c.txt"]);
  });
});

// j3 (design 2026-10-27, backup ownership): a site plugin's package is its manifest plus exactly the files its
// integrity lists. Runtime folders (data/, memory/private/) and stray files in the version folder are not.
const HASH = `sha256-${"a".repeat(64)}`;
function siteRecord(overrides: Partial<PluginDiscoveryRecord> = {}, integrity: Record<string, string> = { "server/index.mjs": HASH }): PluginDiscoveryRecord {
  return { id: "demo", name: "demo", version: "1.0.0", source: "site", status: "valid", errors: [], manifest: {
    id: "demo", name: "demo", version: "1.0.0", sdkRange: "^0.1.0", engine: 1, tier: "tier-3", capabilities: [], hooks: [], fields: [], integrity,
  }, ...overrides };
}

test("j3: a valid site plugin's package is its manifest plus its integrity files, never data/ or private memory", async (t) => {
  const root = await tempRoot(t);
  await writeTree(path.join(root, "demo", "1.0.0"), {
    [PLUGIN_MANIFEST_FILENAME]: "{}", "server/index.mjs": "export {}", "data/x.json": "token", "memory/private/y.md": "private", "stray.txt": "stray",
  });
  const listed = await listSitePluginPackage({ installDir: root, record: siteRecord() });
  assert.equal(listed.rootDir, path.join(await fsPromises.realpath(root), "demo", "1.0.0"));
  assert.deepEqual(listed.files, [{ relativePath: PLUGIN_MANIFEST_FILENAME, sha256: null }, { relativePath: "server/index.mjs", sha256: "a".repeat(64) }]);
});

test("j3: an invalid, built-in, missing, linked or escaping site plugin has no package to list", async (t) => {
  const root = await tempRoot(t);
  await writeTree(path.join(root, "demo", "1.0.0"), { [PLUGIN_MANIFEST_FILENAME]: "{}", "server/index.mjs": "export {}" });
  const refused = [
    siteRecord({ status: "invalid" }), siteRecord({ manifest: undefined }), siteRecord({ source: "built-in" }), siteRecord({ version: "2.0.0" }),
    siteRecord({}, { "../escape.js": HASH }), siteRecord({}, { "/abs.js": HASH }),
  ];
  for (const record of refused) await assert.rejects(listSitePluginPackage({ installDir: root, record }), PluginPackagePathError);
  await writeTree(path.join(root, "outside", "1.0.0"), { [PLUGIN_MANIFEST_FILENAME]: "{}" });
  await mkdir(path.join(root, "linked"));
  await symlink(path.join(root, "outside", "1.0.0"), path.join(root, "linked", "1.0.0"));
  await assert.rejects(listSitePluginPackage({ installDir: root, record: siteRecord({ id: "linked" }) }), PluginPackagePathError);
  await writeTree(path.join(root, "bare", "1.0.0"), { "server/index.mjs": "export {}" });
  await assert.rejects(listSitePluginPackage({ installDir: root, record: siteRecord({ id: "bare" }) }), PluginPackagePathError);
});
