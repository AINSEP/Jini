import assert from "node:assert/strict";
import { packAgentPluginDirectory } from "../test-support.js";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "../legacy-test.js";

import { createBundledSourceArchiveReader } from "../test-support.js";


/**
 * @file The directory-to-archive round trip that lets a bundled package go THROUGH
 * `installAgentPlugin` rather than around it.
 *
 * The two properties that matter: the round trip is lossless (or the installer would publish
 * different bytes than the repo holds), and the digest is deterministic (or seeding would
 * re-extract on every boot instead of hitting the content-addressed dedup path).
 */

async function fixtureDir(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "host-bundled-archive-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(dir, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  return dir;
}

async function readBack(bytes: Uint8Array): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for await (const entry of createBundledSourceArchiveReader().entries({ archive: bytes })) {
    assert.equal(entry.kind, "file");
    if (entry.kind !== "file") continue;
    const chunks: Uint8Array[] = [];
    for await (const chunk of entry.openReadStream({})) chunks.push(chunk);
    out[entry.entryPath] = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  }
  return out;
}

test("packs and unpacks every file losslessly, including nested and non-ASCII content", async () => {
  const files = {
    "plugin.json": '{"name":"x"}',
    "skills/x/SKILL.md": "# X\n\nBody — with an em dash and an emoji 🧭\n",
    "skills/x/references/deep/nested.md": "nested\n",
    "empty.txt": "",
  };
  const dir = await fixtureDir(files);
  try {
    const packed = await packAgentPluginDirectory(dir);
    assert.deepEqual(await readBack(packed.bytes), files);
    assert.deepEqual([...packed.files], Object.keys(files).sort());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("packed plugins omit tests and their fixtures while preserving runtime files and digest", async () => {
  const runtimeFiles = {
    "plugin.json": '{"name":"runtime-only"}',
    "mcp/server.mjs": "export const ready = true;",
    "skills/runtime/SKILL.md": "# Runtime skill",
    // Runtime examples remain installable even when their names include 'fixture' or 'test'.
    "skills/runtime/examples/fixture.json": '{"example":true}',
    "mcp/test-client.mjs": "export const client = {};",
    "mcp/spec.json": '{"version":1}',
  };
  const dir = await fixtureDir({
    ...runtimeFiles,
    "__tests__/plain.mjs": "test helper",
    "__tests__/fixtures/response.json": "test-only fixture",
    "mcp/__tests__/fixtures.mjs": "nested test-only fixture",
    "mcp/server.test.mjs": "test",
    "mcp/server.spec.mjs": "spec",
    "mcp/server.test.ts": "TypeScript test",
    "mcp/server.spec.js.map": "test source map",
  });
  try {
    const packed = await packAgentPluginDirectory(dir);
    assert.deepEqual([...packed.files], Object.keys(runtimeFiles).sort());
    // Check the encoded archive too: filtering only the reported file list cannot pass.
    assert.deepEqual(await readBack(packed.bytes), runtimeFiles);
    await writeFile(path.join(dir, "__tests__/plain.mjs"), "changed test helper");
    await writeFile(path.join(dir, "mcp/server.test.mjs"), "changed test");
    await writeFile(path.join(dir, "mcp/server.spec.js.map"), "changed test source map");
    const repacked = await packAgentPluginDirectory(dir);
    assert.deepEqual(repacked.bytes, packed.bytes);
    assert.equal(repacked.sha256, packed.sha256,
      "test-only edits must not republish installed runtime packages");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the digest is a real SHA-256 of the archive bytes and is deterministic across packs", async () => {
  const dir = await fixtureDir({ "plugin.json": '{"name":"x"}', "a.md": "a" });
  try {
    const first = await packAgentPluginDirectory(dir);
    const second = await packAgentPluginDirectory(dir);
    assert.match(first.sha256, /^[a-f0-9]{64}$/);
    assert.equal(first.sha256, second.sha256, "seeding relies on this to hit the content-addressed dedup path");

    const { createHash } = await import("node:crypto");
    assert.equal(createHash("sha256").update(Buffer.from(first.bytes)).digest("hex"), first.sha256);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("changing one byte of content changes the digest", async () => {
  const before = await fixtureDir({ "plugin.json": '{"name":"x"}', "a.md": "a" });
  const after = await fixtureDir({ "plugin.json": '{"name":"x"}', "a.md": "b" });
  try {
    assert.notEqual((await packAgentPluginDirectory(before)).sha256, (await packAgentPluginDirectory(after)).sha256);
  } finally {
    await rm(before, { recursive: true, force: true });
    await rm(after, { recursive: true, force: true });
  }
});

test("a symlink is skipped rather than followed — the installer would reject one anyway", async () => {
  const dir = await fixtureDir({ "plugin.json": '{"name":"x"}' });
  try {
    await symlink("/etc/passwd", path.join(dir, "sneaky"));
    const packed = await packAgentPluginDirectory(dir);
    assert.deepEqual([...packed.files], ["plugin.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the reader refuses bytes that are not this format", async () => {
  const reader = createBundledSourceArchiveReader();
  await assert.rejects(async () => {
    for await (const _entry of reader.entries({ archive: new TextEncoder().encode("PK a real zip") })) void _entry;
  }, /bad magic/);
});

test("the reader refuses a truncated archive rather than yielding a partial file", async () => {
  const dir = await fixtureDir({ "plugin.json": '{"name":"x"}', "a.md": "a long enough body to truncate" });
  try {
    const packed = await packAgentPluginDirectory(dir);
    const truncated = packed.bytes.slice(0, packed.bytes.byteLength - 10);
    await assert.rejects(async () => {
      for await (const _entry of createBundledSourceArchiveReader().entries({ archive: truncated })) void _entry;
    }, /truncated entry body/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
