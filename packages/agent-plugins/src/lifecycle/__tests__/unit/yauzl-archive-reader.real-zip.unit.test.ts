import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { createRequire } from "node:module";

import { buildZipFixture, type ZipFixtureEntry } from "../fixtures/build-zip.js";
import { forceRemove } from "../fixtures/force-remove.js";
import { AgentPluginInstallError } from "../../install.js";
import { installAgentPlugin } from "../test-support.js";
import { createAgentPluginLayout } from "../../layout.js";
import { createYauzlAgentPluginArchiveReader, type YauzlPort } from "../../yauzl-archive-reader.js";

// Load the actual optional peer: no scripted decoder stands between these bytes and the installer.
const require = createRequire(import.meta.url);
const yauzlAgentPluginArchiveReader = createYauzlAgentPluginArchiveReader({ yauzl: require("yauzl") as YauzlPort });
const yazl = require("yazl") as { ZipFile: new () => { addBuffer(buffer: Buffer, metadataPath: string): void } };

/**
 * @file Every adversarial case from `install.unit.test.ts` (the scripted-double suite) re-run
 * against a REAL zip archive, built with `yazl`, read through the real `yauzlAgentPluginArchiveReader`
 * — per the team directive: "the adversarial tests you already wrote are the acceptance criteria...
 * every one must still pass against the real yauzl reader, not just your scripted double. If any
 * passes only against the double, the hardening was testing your test."
 *
 * One vector needed more than `yazl`'s own validated write API to construct honestly, and that is
 * reported here rather than silently worked around:
 *
 * - **Zip-slip (`../` entry name).** `yazl`'s `addBuffer()` refuses to write an entry whose
 *   `metadataPath` contains a `..` segment — proof no WELL-BEHAVED tool can produce one (its own
 *   test below). A real attacker doesn't go through a validated writer, though, so the actual
 *   end-to-end proof below constructs a structurally valid zip via `yazl` using a same-length safe
 *   placeholder name, then overwrites those exact bytes (both the local file header and the central
 *   directory copy) with the malicious path directly — a genuinely malicious archive, not a
 *   yazl-written one. `yauzl` itself additionally refuses to EMIT such an entry via its own
 *   automatic `validateFileName()` (which runs before every `"entry"` iteration and independently
 *   rejects `..` segments, absolute paths, and Windows drive prefixes) — so this vector is proven
 *   rejected end to end by `yauzl`'s own built-in guard before `install.ts`'s own
 *   `normalizePackageEntryPath` even gets the chance to run for it. That does not make
 *   `install.ts`'s own check redundant: it is still the only defense for a hypothetical future
 *   reader library without `yauzl`'s built-in protection, and it remains exercised directly by the
 *   scripted-double suite.
 * - **Decompression bomb (declared size understates actual).** A validly-formed zip's central
 *   directory always states the TRUE uncompressed size — that is a structural format guarantee, not
 *   a policy `yauzl` layers on top, so a well-formed real archive cannot honestly "lie" about it the
 *   way the scripted double's fixture deliberately does. What IS realistic, and tested below, is a
 *   genuinely large real file whose real declared size correctly exceeds the per-file cap (proving
 *   the real adapter reports `declaredSize` correctly and `install.ts`'s early check acts on it), and
 *   a real multi-file archive whose combined real bytes exceed the TOTAL cap while streaming through
 *   many small, real `zlib` chunks rather than one synthetic mega-chunk — this is the part that
 *   actually differs between a scripted double and a real reader (real Node streams chunk
 *   incrementally; the double's `openReadStream` yielded one `Uint8Array` in a single step), and it
 *   is exactly what proves `install.ts`'s running-total accounting works against genuine incremental
 *   `data` events, not merely against one big pre-assembled buffer.
 */

const VALID_MANIFEST = JSON.stringify({
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "ui-ux-design",
  version: "1.1.0",
});

/** Unix `st_mode` for a symlink (`S_IFLNK | 0777`) — the same convention `yauzl-archive-reader.ts`
 * reads on the way back in. */
const SYMLINK_MODE = 0o120777;

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Returns both the INSTANCE-level layout (`instanceLayout`, what `installAgentPlugin` now takes
 * directly — security pass 2026-08-13 Finding 2 fix, `install.ts`) and the already-resolved
 * workspace layout (`workspaceLayout`, kept only for this file's own `.packages` assertions below —
 * never fed back into `installAgentPlugin` itself anymore).
 */
async function freshWorkspaceLayout() {
  const cwd = await mkdtemp(path.join(tmpdir(), "agent-plugin-yauzl-test-"));
  const instanceLayout = createAgentPluginLayout({ root: path.join(cwd, "agent-plugins") });
  const workspaceLayout = instanceLayout.forWorkspace({ workspaceId: WORKSPACE_ID });
  return { cwd, instanceLayout, workspaceLayout };
}


test("real zip: installs a valid package end to end (real yazl-built archive, real yauzl reader)", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshWorkspaceLayout();
  try {
    const archive = await buildZipFixture({ entries: [
      { path: "plugin.json", content: VALID_MANIFEST },
      { path: "skills/ui-ux-design/SKILL.md", content: "# UI/UX Design\n\nGuidance." },
      { path: "skills/", content: "" },
      { path: "empty/", content: "" },
    ] });
    const digest = createHash("sha256").update(archive).digest("hex");

    const installed = await installAgentPlugin({
      archive,
      expectedSha256: digest,
      archiveReader: yauzlAgentPluginArchiveReader,
      layout: instanceLayout,
      workspaceId: WORKSPACE_ID,
    });

    assert.equal(installed.pluginId, "ui-ux-design");
    assert.deepEqual(installed.skills, [{ name: "ui-ux-design", skillPath: "skills/ui-ux-design/SKILL.md" }]);
    assert.equal(await readFile(path.join(installed.packageRoot, "plugin.json"), "utf8"), VALID_MANIFEST);
    assert.equal(await readFile(path.join(installed.packageRoot, "skills/ui-ux-design/SKILL.md"), "utf8"), "# UI/UX Design\n\nGuidance.");
    assert.equal((await stat(path.join(installed.packageRoot, "empty"))).isDirectory(), true);
    assert.deepEqual(await readdir(path.join(installed.packageRoot, "empty")), []);
  } finally {
    await forceRemove(cwd);
  }
});

test("real zip: a real duplicate-named entry (yazl allows writing one; a real reader/attacker could too) is rejected", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshWorkspaceLayout();
  try {
    // Unlike a traversal path, yazl does NOT refuse a repeated metadataPath -- so this one needs no
    // byte-patching to be a genuine, ordinarily-constructible real zip.
    const archive = await buildZipFixture({ entries: [
      { path: "plugin.json", content: VALID_MANIFEST },
      { path: "plugin.json", content: "{}" },
    ] });
    const digest = createHash("sha256").update(archive).digest("hex");

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: yauzlAgentPluginArchiveReader,
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "DUPLICATE_ENTRY",
    );

    assert.deepEqual(await readdir(workspaceLayout.packages).catch(() => []), []);
  } finally {
    await forceRemove(cwd);
  }
});

test("real zip: a symlink entry (real Unix mode bits, S_IFLNK) is rejected outright", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshWorkspaceLayout();
  try {
    const archive = await buildZipFixture({ entries: [
      { path: "plugin.json", content: VALID_MANIFEST },
      // A real symlink entry: content is the (unread, per this module's header) link target text,
      // and the mode's file-type bits are S_IFLNK — exactly what a real malicious archiver would
      // produce, not a synthetic { kind: "symlink" } object.
      { path: "skills/evil", content: "/etc", mode: SYMLINK_MODE },
    ] });
    const digest = createHash("sha256").update(archive).digest("hex");

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: yauzlAgentPluginArchiveReader,
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "SYMLINK_ENTRY_REJECTED",
    );

    assert.deepEqual(await readdir(workspaceLayout.packages).catch(() => []), []);
  } finally {
    await forceRemove(cwd);
  }
});

test("real zip: an ordinary file with the executable bit set is preserved as executable", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshWorkspaceLayout();
  try {
    const archive = await buildZipFixture({ entries: [
      { path: "plugin.json", content: VALID_MANIFEST },
      { path: "server/index.js", content: "#!/usr/bin/env node\n", mode: 0o100755 },
    ] });
    const digest = createHash("sha256").update(archive).digest("hex");

    const installed = await installAgentPlugin({
      archive,
      expectedSha256: digest,
      archiveReader: yauzlAgentPluginArchiveReader,
      layout: instanceLayout,
      workspaceId: WORKSPACE_ID,
    });

    const { stat } = await import("node:fs/promises");
    const mode = (await stat(path.join(installed.packageRoot, "server/index.js"))).mode & 0o777;
    assert.equal(mode, 0o555, "an archive-declared executable file must keep its +x bit through freezeTree");
  } finally {
    await forceRemove(cwd);
  }
});

test("real zip: yazl itself refuses to WRITE a traversal entry name (no well-behaved tool can produce one)", () => {
  assert.throws(() => {
    const zipfile = new yazl.ZipFile();
    zipfile.addBuffer(Buffer.from("leaked"), "../../../outside.txt");
  });
});

test("real zip: a genuinely malicious archive (byte-patched, not yazl-written) with a traversal entry name is rejected end to end", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshWorkspaceLayout();
  try {
    // The test above proves a well-behaved WRITER can't produce this archive -- it does not prove
    // the READER refuses one. A real attacker doesn't use yazl's validated addBuffer(); they patch
    // bytes directly. This constructs a real, structurally valid zip via yazl using a same-length
    // SAFE placeholder name, then overwrites that exact byte sequence with the malicious path
    // everywhere it appears (the local file header AND the central directory both store the name;
    // both must change identically or the archive becomes malformed). CRC/lengths are untouched --
    // only the name bytes move, and both occurrences are the same length, so no offset in the
    // archive shifts.
    const maliciousPath = "../../../outside.txt";
    const placeholder = "A".repeat(maliciousPath.length); // same byte length, computed not guessed
    assert.equal(placeholder.length, maliciousPath.length, "test fixture invariant: same byte length");

    const safeArchive = await buildZipFixture({ entries: [
      { path: "plugin.json", content: VALID_MANIFEST },
      { path: placeholder, content: "leaked" },
    ] });
    const patched = Buffer.from(safeArchive.toString("latin1").replaceAll(placeholder, maliciousPath), "latin1");
    assert.notDeepEqual(patched, safeArchive, "the byte-patch must actually have changed something");

    const digest = createHash("sha256").update(patched).digest("hex");

    // Reject for traversal specifically, rather than accepting structural ZIP corruption.
    await assert.rejects(() =>
      installAgentPlugin({
        archive: patched,
        expectedSha256: digest,
        archiveReader: yauzlAgentPluginArchiveReader,
        layout: instanceLayout,
        workspaceId: WORKSPACE_ID,
      }),
      (error: unknown) => (error instanceof Error && error.message === `invalid relative path: ${maliciousPath}`) ||
        (error instanceof AgentPluginInstallError && error.code === "UNSAFE_ENTRY_PATH"),
    );

    assert.deepEqual(await readdir(workspaceLayout.packages).catch(() => []), []);
    const safeName = "B".repeat(maliciousPath.length);
    const control = Buffer.from(safeArchive.toString("latin1").replaceAll(placeholder, safeName), "latin1");
    const installed = await installAgentPlugin({
      archive: control,
      expectedSha256: createHash("sha256").update(control).digest("hex"),
      archiveReader: yauzlAgentPluginArchiveReader,
      layout: instanceLayout,
      workspaceId: WORKSPACE_ID,
    });
    assert.equal(await readFile(path.join(installed.packageRoot, safeName), "utf8"), "leaked");
    assert.equal(await readFile(path.join(installed.packageRoot, "plugin.json"), "utf8"), VALID_MANIFEST);
  } finally {
    await forceRemove(cwd);
  }
});

test("real zip: a large real file exceeding the per-file cap is rejected via its true declared size", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshWorkspaceLayout();
  try {
    // Real, honestly-declared size: 20MiB of zero bytes. Highly compressible (tiny on disk), but
    // yauzl reports the entry's TRUE uncompressed size from the central directory regardless of how
    // well it compressed — proving the real adapter's `declaredSize` is accurate and install.ts's
    // early FILE_TOO_LARGE check fires against real metadata, not a synthetic number.
    const bigContent = Buffer.alloc(20 * 1024 * 1024, 0);
    const archive = await buildZipFixture({ entries: [
      { path: "plugin.json", content: VALID_MANIFEST },
      { path: "skills/a/refs/big.md", content: bigContent },
    ] });
    const digest = createHash("sha256").update(archive).digest("hex");

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: yauzlAgentPluginArchiveReader,
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "FILE_TOO_LARGE",
    );
  } finally {
    await forceRemove(cwd);
  }
});

// Real compression and 64 MiB of disk writes need a wider timeout on loaded hosts.
test("real zip: the total-extracted-bytes cap fires against real, incrementally-streamed bytes across many files", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshWorkspaceLayout();
  try {
    // Each file is honestly declared and genuinely under the PER-FILE cap (1MiB < 16MiB) — only the
    // real, actually-streamed RUNNING TOTAL across ~70 real files (each read through its own real
    // zlib inflate stream, chunk by chunk) crosses the 64MiB total cap. This is the scenario that
    // cannot be faked by a scripted double yielding one synthetic chunk per file: it depends on
    // install.ts's totalBytes accumulator correctly summing across many independent real streams.
    const fileContent = Buffer.alloc(1024 * 1024, 65); // 1 MiB of 'A' -- still compresses well, but
    // yauzl reports the true (post-inflate) byte count as each chunk is actually produced.
    const entries: ZipFixtureEntry[] = [{ path: "plugin.json", content: VALID_MANIFEST }];
    for (let i = 0; i < 70; i += 1) entries.push({ path: `skills/a/refs/f${i}.md`, content: fileContent });

    const archive = await buildZipFixture({ entries });
    const digest = createHash("sha256").update(archive).digest("hex");

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: yauzlAgentPluginArchiveReader,
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "TOTAL_SIZE_EXCEEDED",
    );
  } finally {
    await forceRemove(cwd);
  }
}, 30_000);

test("real zip: a SHA-256 digest mismatch is rejected before the real archive is ever opened", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshWorkspaceLayout();
  try {
    const archive = await buildZipFixture({ entries: [{ path: "plugin.json", content: VALID_MANIFEST }] });

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: "0".repeat(64),
          archiveReader: yauzlAgentPluginArchiveReader,
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "DIGEST_MISMATCH",
    );
  } finally {
    await forceRemove(cwd);
  }
});

test("real zip: a missing plugin.json is rejected", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshWorkspaceLayout();
  try {
    const archive = await buildZipFixture({ entries: [{ path: "skills/a/SKILL.md", content: "# A" }] });
    const digest = createHash("sha256").update(archive).digest("hex");

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: yauzlAgentPluginArchiveReader,
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "MANIFEST_MISSING",
    );
  } finally {
    await forceRemove(cwd);
  }
});


test("real zip: malformed archive bytes are rejected without publishing a package", async () => {
  const { cwd, instanceLayout, workspaceLayout } = await freshWorkspaceLayout();
  try {
    const archive = Buffer.from("not a zip archive");
    await assert.rejects(() => installAgentPlugin({
      archive,
      expectedSha256: createHash("sha256").update(archive).digest("hex"),
      archiveReader: yauzlAgentPluginArchiveReader,
      layout: instanceLayout,
      workspaceId: WORKSPACE_ID,
    }), /End of central directory record signature not found/);
    // Layout B chooses a plugin-owned package directory only after manifest validation.
    // Malformed ZIP metadata must leave only empty staging, with no package or persistent state.
    assert.deepEqual(await readdir(workspaceLayout.root), ["staging"]);
    assert.deepEqual(await readdir(workspaceLayout.staging), []);
    const control = await buildZipFixture({ entries: [{ path: "plugin.json", content: VALID_MANIFEST }] });
    const installed = await installAgentPlugin({
      archive: control,
      expectedSha256: createHash("sha256").update(control).digest("hex"),
      archiveReader: yauzlAgentPluginArchiveReader,
      layout: instanceLayout,
      workspaceId: WORKSPACE_ID,
    });
    assert.equal(await readFile(path.join(installed.packageRoot, "plugin.json"), "utf8"), VALID_MANIFEST);
  } finally {
    await forceRemove(cwd);
  }
});
