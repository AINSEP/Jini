import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "../legacy-test.js";

import { forceRemove } from "../fixtures/force-remove.js";
import { resolveAgentPluginLayout } from "../test-support.js";
import { type AgentPluginLayout } from "../../layout.js";
import { installAgentPlugin } from "../test-support.js";
import { AgentPluginInstallError, type AgentPluginArchiveEntry, type AgentPluginArchiveReaderPort, type InstallAgentPluginRequired } from "../../install.js";

/**
 * @file `installAgentPlugin()` — content-addressed extraction of one Agent Plugin archive.
 *
 * This is the highest-risk unit in the feature (team directive: "Extraction hardening... is where
 * containment actually breaks"). Every adversarial case below is drawn from a named, cited attack
 * class rather than invented: symlink-entry escape and lexical zip-slip are the two independent
 * zip-slip vectors (Snyk's zip-slip research, JFrog's `archiver` writeup); the decompression-bomb
 * and entry-count caps guard the "declared size lies" and "million small files" variants of the same
 * resource-exhaustion class. A dedicated cross-workspace isolation test proves the tenant-grade
 * layout decision (`layout.ts`'s header, 2026-08-12) end to end at the install level, not only at
 * the pure path-computation level `layout.unit.test.ts` already covers.
 *
 * The archive format itself is abstracted behind `AgentPluginArchiveReaderPort` (this repo's own
 * port+adapter discipline — `mcp-federation/ports.ts`'s `McpSessionPort`/`McpStdioChannel` split is
 * the precedent) so these tests drive real extraction/containment/limit logic with a scripted
 * in-memory archive. The identical adversarial suite is re-run against the REAL `yauzl`-backed
 * reader in `yauzl-archive-reader.unit.test.ts` — per the team directive, that file is the
 * acceptance criteria for the real archive library, not a duplicate of this one.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

function reader(entries: readonly AgentPluginArchiveEntry[]): AgentPluginArchiveReaderPort {
  return {
    async *entries() {
      yield* entries;
    },
  };
}

function fileEntry(entryPath: string, content: string, overrides: Partial<AgentPluginArchiveEntry> = {}): AgentPluginArchiveEntry {
  const bytes = Buffer.from(content, "utf8");
  return {
    kind: "file",
    entryPath,
    declaredSize: bytes.byteLength,
    executable: false,
    async *openReadStream() {
      yield bytes;
    },
    ...overrides,
  } as AgentPluginArchiveEntry;
}

const VALID_MANIFEST = JSON.stringify({
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "ui-ux-design",
  version: "1.1.0",
});

function validPackageEntries(): AgentPluginArchiveEntry[] {
  return [
    fileEntry("plugin.json", VALID_MANIFEST),
    fileEntry("skills/ui-ux-design/SKILL.md", "# UI/UX Design\n\nGuidance."),
  ];
}

async function freshLayout() {
  const cwd = await mkdtemp(path.join(tmpdir(), "host-agent-plugin-install-test-"));
  const instanceLayout = resolveAgentPluginLayout({ cwd, env: {} });
  return { cwd, instanceLayout, layout: instanceLayout.forWorkspace({ workspaceId: WORKSPACE_ID }) };
}

test("installs a valid package and indexes its skills", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const entries = validPackageEntries();
    const archive = new Uint8Array(Buffer.from("archive-bytes-1"));
    const digest = createHash("sha256").update(archive).digest("hex");

    const installed = await installAgentPlugin({
      archive,
      expectedSha256: digest,
      archiveReader: reader(entries),
      layout: instanceLayout,
      workspaceId: WORKSPACE_ID,
    });

    assert.equal(installed.pluginId, "ui-ux-design");
    assert.equal(installed.archiveDigest, digest);
    assert.deepEqual(installed.skills, [{ name: "ui-ux-design", skillPath: "skills/ui-ux-design/SKILL.md" }]);
    assert.deepEqual([...installed.files].sort(), ["plugin.json", "skills/ui-ux-design/SKILL.md"]);
    // VALID_MANIFEST declares only name/version — description/keywords/author/license must stay
    // genuinely absent, not present with value `undefined`, matching every pre-existing manifest.
    assert.equal(installed.description, undefined);
    assert.equal(installed.keywords, undefined);
    assert.equal(installed.author, undefined);
    assert.equal(installed.license, undefined);
    assert.equal("description" in installed, false);
    assert.equal("keywords" in installed, false);

    const published = await readFile(path.join(installed.packageRoot, "plugin.json"), "utf8");
    assert.equal(published, VALID_MANIFEST);
  } finally {
    await forceRemove(cwd);
  }
});

test("carries plugin.json's description/keywords/author/license through onto InstalledAgentPlugin (search_agent_plugin_local's ranking signal)", async () => {
  const { cwd, instanceLayout } = await freshLayout();
  try {
    const manifest = JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "site-compliance",
      version: "1.0.0",
      description: "Evidence-based privacy, cookie/consent, and accessibility risk screening for a the host site.",
      author: "the host",
      license: "Apache-2.0",
      keywords: ["compliance", "privacy", "gdpr", "ccpa", "cookie", "consent", "wcag", "accessibility"],
    });
    const archive = new Uint8Array(Buffer.from("archive-bytes-manifest-fields"));
    const digest = createHash("sha256").update(archive).digest("hex");

    const installed = await installAgentPlugin({
      archive,
      expectedSha256: digest,
      archiveReader: reader([fileEntry("plugin.json", manifest), fileEntry("skills/site-compliance/SKILL.md", "# Site Compliance\n")]),
      layout: instanceLayout,
      workspaceId: WORKSPACE_ID,
    });

    assert.equal(installed.description, "Evidence-based privacy, cookie/consent, and accessibility risk screening for a the host site.");
    assert.equal(installed.author, "the host");
    assert.equal(installed.license, "Apache-2.0");
    assert.deepEqual(installed.keywords, ["compliance", "privacy", "gdpr", "ccpa", "cookie", "consent", "wcag", "accessibility"]);
  } finally {
    await forceRemove(cwd);
  }
});

test("a symlink ENTRY is rejected outright, and no package is published", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-symlink"));
    const digest = createHash("sha256").update(archive).digest("hex");

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: reader([
            { kind: "symlink", entryPath: "skills", linkTarget: "/etc" } as AgentPluginArchiveEntry,
            fileEntry("skills/a/SKILL.md", "# A"),
          ]),
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "SYMLINK_ENTRY_REJECTED",
    );

    const publishedDirs = await readdir(layout.packages).catch(() => []);
    assert.deepEqual(publishedDirs, [], "no digest directory may be published after a rejected install");
    assert.deepEqual(await readdir(layout.packages), [], "rejection must not publish a package");
    assert.deepEqual(await readdir(layout.staging), [], "rejection must remove the staging transaction");
  } finally {
    await forceRemove(cwd);
  }
});

test("a lexical zip-slip path ('../../..') is rejected", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-traversal"));
    const digest = createHash("sha256").update(archive).digest("hex");

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: reader([fileEntry("../../../outside.txt", "leaked")]),
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "UNSAFE_ENTRY_PATH",
    );

    assert.deepEqual(await readdir(layout.packages).catch(() => []), []);
    assert.deepEqual(await readdir(layout.packages), [], "rejection must not publish a package");
    assert.deepEqual(await readdir(layout.staging), [], "rejection must remove the staging transaction");
  } finally {
    await forceRemove(cwd);
  }
});

test("a duplicate archive entry path is rejected (never silently overwritten)", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-duplicate"));
    const digest = createHash("sha256").update(archive).digest("hex");

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: reader([fileEntry("plugin.json", VALID_MANIFEST), fileEntry("plugin.json", "{}")]),
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "DUPLICATE_ENTRY",
    );
    assert.deepEqual(await readdir(layout.packages), [], "rejection must not publish a package");
    assert.deepEqual(await readdir(layout.staging), [], "rejection must remove the staging transaction");
  } finally {
    await forceRemove(cwd);
  }
});

test("a file exceeding the declared per-file size cap is rejected", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-oversized-declared"));
    const digest = createHash("sha256").update(archive).digest("hex");

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: reader([
            fileEntry("plugin.json", VALID_MANIFEST),
            fileEntry("skills/a/SKILL.md", "x", { declaredSize: 999_999_999 } as Partial<AgentPluginArchiveEntry>),
          ]),
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "FILE_TOO_LARGE",
    );
    assert.deepEqual(await readdir(layout.packages), [], "rejection must not publish a package");
    assert.deepEqual(await readdir(layout.staging), [], "rejection must remove the staging transaction");
  } finally {
    await forceRemove(cwd);
  }
});

test("a decompression bomb (actual bytes exceed the declared size) is caught while streaming, not after", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-bomb"));
    const digest = createHash("sha256").update(archive).digest("hex");

    // Declares a tiny size, but the read stream actually yields far more — the lie a real
    // compressed bomb tells. The per-file byte cap must be enforced against bytes ACTUALLY
    // observed leaving the "decompressor" (this fake stream), not the declared/trusted size.
    let chunksConsumed = 0;
    let streamClosed = false;
    const bomb: AgentPluginArchiveEntry = {
      kind: "file",
      entryPath: "skills/a/SKILL.md",
      declaredSize: 10,
      executable: false,
      async *openReadStream() {
        const chunk = new Uint8Array(1024 * 1024); // 1 MiB per chunk
        try {
          for (let i = 0; i < 64; i += 1) {
            chunksConsumed += 1;
            yield chunk; // 64 MiB actual, far past the 16 MiB per-file cap
          }
        } finally {
          streamClosed = true;
        }
      },
    } as AgentPluginArchiveEntry;

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: reader([fileEntry("plugin.json", VALID_MANIFEST), bomb]),
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "DECOMPRESSION_BOMB",
    );
    assert.equal(chunksConsumed, 17, "stop at the first chunk crossing the 16 MiB cap");
    assert.equal(streamClosed, true, "the decompressor must be closed on early rejection");
    assert.deepEqual(await readdir(layout.packages), [], "rejection must not publish a package");
    assert.deepEqual(await readdir(layout.staging), [], "rejection must remove the staging transaction");
  } finally {
    await forceRemove(cwd);
  }
});

test("the total-extracted-bytes cap is enforced across many small files (the 'many files' bomb variant)", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-many-files"));
    const digest = createHash("sha256").update(archive).digest("hex");

    const bigContent = "x".repeat(1024 * 1024); // 1 MiB per file
    const manyEntries: AgentPluginArchiveEntry[] = [fileEntry("plugin.json", VALID_MANIFEST)];
    for (let i = 0; i < 200; i += 1) manyEntries.push(fileEntry(`skills/a/refs/f${i}.md`, bigContent));

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: reader(manyEntries),
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "TOTAL_SIZE_EXCEEDED",
    );
    assert.deepEqual(await readdir(layout.packages), [], "rejection must not publish a package");
    assert.deepEqual(await readdir(layout.staging), [], "rejection must remove the staging transaction");
  } finally {
    await forceRemove(cwd);
  }
});

test("the entry-count cap is enforced", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-many-entries"));
    const digest = createHash("sha256").update(archive).digest("hex");

    const manyEntries: AgentPluginArchiveEntry[] = [fileEntry("plugin.json", VALID_MANIFEST)];
    for (let i = 0; i < 5000; i += 1) manyEntries.push(fileEntry(`skills/a/refs/f${i}.md`, "x"));

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: reader(manyEntries),
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "TOO_MANY_ENTRIES",
    );
    assert.deepEqual(await readdir(layout.packages), [], "rejection must not publish a package");
    assert.deepEqual(await readdir(layout.staging), [], "rejection must remove the staging transaction");
  } finally {
    await forceRemove(cwd);
  }
});

test("a SHA-256 digest mismatch is rejected before any extraction is attempted", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  let extractionAttempted = false;
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-digest-mismatch"));
    const wrongDigest = "0".repeat(64);

    const spyReader: AgentPluginArchiveReaderPort = {
      async *entries() {
        extractionAttempted = true;
        yield* validPackageEntries();
      },
    };

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: wrongDigest,
          archiveReader: spyReader,
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "DIGEST_MISMATCH",
    );
    assert.equal(extractionAttempted, false, "extraction must never run against unverified bytes");
  } finally {
    await forceRemove(cwd);
  }
});

test("installing the identical archive twice extracts only once (content-addressed dedup)", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-dedup"));
    const digest = createHash("sha256").update(archive).digest("hex");

    let extractCount = 0;
    const countingReader: AgentPluginArchiveReaderPort = {
      async *entries() {
        extractCount += 1;
        yield* validPackageEntries();
      },
    };

    const first = await installAgentPlugin({
      archive,
      expectedSha256: digest,
      archiveReader: countingReader,
      layout: instanceLayout,
      workspaceId: WORKSPACE_ID,
    });
    const second = await installAgentPlugin({
      archive,
      expectedSha256: digest,
      archiveReader: countingReader,
      layout: instanceLayout,
      workspaceId: WORKSPACE_ID,
    });

    assert.equal(extractCount, 1, "the second install of byte-identical content must not re-extract");
    assert.equal(first.packageRoot, second.packageRoot);
  } finally {
    await forceRemove(cwd);
  }
});

test("explicit directory entries are extracted and excluded from the file index", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-directories"));
    const digest = createHash("sha256").update(archive).digest("hex");
    const installed = await installAgentPlugin({
      archive, expectedSha256: digest, layout: instanceLayout, workspaceId: WORKSPACE_ID,
      archiveReader: reader([
        { kind: "directory", entryPath: "skills/" },
        { kind: "directory", entryPath: "skills/ui-ux-design/" },
        { kind: "directory", entryPath: "empty/" },
        ...validPackageEntries(),
      ]),
    });
    assert.deepEqual(installed.files, ["plugin.json", "skills/ui-ux-design/SKILL.md"]);
    assert.deepEqual(installed.skills, [{ name: "ui-ux-design", skillPath: "skills/ui-ux-design/SKILL.md" }]);
    assert.equal((await stat(path.join(installed.packageRoot, "empty"))).isDirectory(), true);
    assert.deepEqual(await readdir(layout.packages), [digest]);
    assert.deepEqual(await readdir(layout.staging), []);
  } finally {
    await forceRemove(cwd);
  }
});

test("an in-flight install recovers when another install publishes the same digest first", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const extracting = new Promise<void>((resolve) => { entered = resolve; });
  let losingInstall: ReturnType<typeof installAgentPlugin> | undefined;
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-publication-race"));
    const digest = createHash("sha256").update(archive).digest("hex");
    losingInstall = installAgentPlugin({
      archive, expectedSha256: digest, layout: instanceLayout, workspaceId: WORKSPACE_ID,
      archiveReader: { async *entries() { entered(); await held; yield* validPackageEntries(); } },
    });
    await extracting; // The loser has passed the dedup check and owns a staging transaction.
    const winner = await installAgentPlugin({
      archive, expectedSha256: digest, layout: instanceLayout, workspaceId: WORKSPACE_ID,
      archiveReader: reader(validPackageEntries()),
    });
    release();
    const loser = await losingInstall;
    assert.deepEqual(loser, winner);
    assert.equal(await readFile(path.join(loser.packageRoot, "plugin.json"), "utf8"), VALID_MANIFEST);
    assert.deepEqual(await readdir(layout.packages), [digest]);
    assert.deepEqual(await readdir(layout.staging), []);
    assert.equal((await stat(loser.packageRoot)).mode & 0o777, 0o555);
  } finally {
    release();
    await losingInstall?.catch(() => undefined);
    await forceRemove(cwd);
  }
});

test("publication failure preserves an obstructing file and cleans all staging output", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-publication-failure"));
    const digest = createHash("sha256").update(archive).digest("hex");
    const finalRoot = path.join(layout.packages, digest);
    await assert.rejects(installAgentPlugin({
      archive, expectedSha256: digest, layout: instanceLayout, workspaceId: WORKSPACE_ID,
      archiveReader: { async *entries() {
        // Obstruct publication only after the initial dedup check, using the real filesystem.
        await writeFile(finalRoot, "existing file", { flag: "wx" });
        yield* validPackageEntries();
      } },
    }), (error: unknown) => error instanceof AgentPluginInstallError && error.code === "PUBLISH_FAILED");
    assert.equal(await readFile(finalRoot, "utf8"), "existing file");
    assert.deepEqual(await readdir(layout.packages), [digest]);
    assert.deepEqual(await readdir(layout.staging), []);
  } finally {
    await forceRemove(cwd);
  }
});

test("a publication permission failure without a concurrent winner is still rejected", {
  skip: process.platform === "win32" || process.getuid?.() === 0,
}, async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-publication-denied"));
    const digest = createHash("sha256").update(archive).digest("hex");
    await assert.rejects(installAgentPlugin({
      archive, expectedSha256: digest, layout: instanceLayout, workspaceId: WORKSPACE_ID,
      archiveReader: { async *entries() {
        await chmod(layout.packages, 0o555);
        yield* validPackageEntries();
      } },
    }), (error: unknown) => error instanceof AgentPluginInstallError && error.code === "PUBLISH_FAILED"
      && (error.cause as NodeJS.ErrnoException).code === "EACCES");
    assert.deepEqual(await readdir(layout.packages), [], "permission denial must not masquerade as a successful publication");
    assert.deepEqual(await readdir(layout.staging), []);
  } finally {
    await forceRemove(cwd);
  }
});

test("a missing plugin.json is rejected", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-no-manifest"));
    const digest = createHash("sha256").update(archive).digest("hex");

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: reader([fileEntry("skills/a/SKILL.md", "# A")]),
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "MANIFEST_MISSING",
    );
    assert.deepEqual(await readdir(layout.packages), [], "rejection must not publish a package");
    assert.deepEqual(await readdir(layout.staging), [], "rejection must remove the staging transaction");
  } finally {
    await forceRemove(cwd);
  }
});

test("a manifest that fails Agent Plugins grammar validation is rejected", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-bad-manifest"));
    const digest = createHash("sha256").update(archive).digest("hex");

    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: reader([fileEntry("plugin.json", JSON.stringify({ name: "Not Valid!" }))]),
          layout: instanceLayout,
          workspaceId: WORKSPACE_ID,
        }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "MANIFEST_INVALID",
    );
    assert.deepEqual(await readdir(layout.packages), [], "rejection must not publish a package");
    assert.deepEqual(await readdir(layout.staging), [], "rejection must remove the staging transaction");
  } finally {
    await forceRemove(cwd);
  }
});

test("a published package root is frozen read-only", async () => {
  const { cwd, instanceLayout, layout } = await freshLayout();
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-freeze"));
    const digest = createHash("sha256").update(archive).digest("hex");

    const installed = await installAgentPlugin({
      archive,
      expectedSha256: digest,
      archiveReader: reader(validPackageEntries()),
      layout: instanceLayout,
      workspaceId: WORKSPACE_ID,
    });

    const rootMode = (await stat(installed.packageRoot)).mode & 0o777;
    assert.equal(rootMode, 0o555, "package root must carry no write bit after publication");
    for (const relative of ["skills", "skills/ui-ux-design", "plugin.json", "skills/ui-ux-design/SKILL.md"]) {
      const info = await stat(path.join(installed.packageRoot, relative));
      assert.equal(info.mode & 0o222, 0, `${relative} must carry no write bits`);
      assert.equal(info.mode & 0o777, info.isDirectory() ? 0o555 : 0o444, relative);
    }
  } finally {
    await forceRemove(cwd);
  }
});

test("TENANT-GRADE: two workspaces installing the identical archive extract INDEPENDENTLY -- no sharing", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "host-agent-plugin-install-test-"));
  try {
    const instanceLayout = resolveAgentPluginLayout({ cwd, env: {} });
    const workspaceA = instanceLayout.forWorkspace({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const workspaceB = instanceLayout.forWorkspace({ workspaceId: "22222222-2222-4222-8222-222222222222" });

    const archive = new Uint8Array(Buffer.from("archive-bytes-shared-by-two-workspaces"));
    const digest = createHash("sha256").update(archive).digest("hex");

    let extractCount = 0;
    const countingReader: AgentPluginArchiveReaderPort = {
      async *entries() {
        extractCount += 1;
        yield* validPackageEntries();
      },
    };

    const idA = "11111111-1111-4111-8111-111111111111";
    const idB = "22222222-2222-4222-8222-222222222222";
    // Both installs share the SAME `instanceLayout` object -- only `workspaceId` differs -- proving
    // disjointness comes from `installAgentPlugin`'s own internal `forWorkspace()` call, not from the
    // caller resolving two separate layout values (which is what `workspaceA`/`workspaceB` below are
    // now used for: independent expectations to assert against, not inputs fed back into the call).
    const installedA = await installAgentPlugin({ archive, expectedSha256: digest, archiveReader: countingReader, layout: instanceLayout, workspaceId: idA });
    const installedB = await installAgentPlugin({ archive, expectedSha256: digest, archiveReader: countingReader, layout: instanceLayout, workspaceId: idB });

    // The tenancy property itself: byte-identical content installed by two DIFFERENT workspaces
    // is extracted TWICE, into two entirely disjoint package roots -- the opposite of
    // install.ts's own within-one-workspace dedup test above, and that contrast is the point.
    assert.equal(extractCount, 2, "a second workspace's install must not be satisfied by the first workspace's bytes");
    assert.notEqual(installedA.packageRoot, installedB.packageRoot);
    assert.equal(path.relative(workspaceB.root, installedA.packageRoot).startsWith(".."), true);

    // Deleting workspace A's entire tree must not touch workspace B's copy -- proves the two
    // package roots are not merely different paths but structurally independent on disk.
    await forceRemove(workspaceA.root);
    const stillThere = await readFile(path.join(installedB.packageRoot, "plugin.json"), "utf8");
    assert.equal(stillThere, VALID_MANIFEST);
  } finally {
    await forceRemove(cwd);
  }
});

// ---------------------------------------------------------------------------
// CLOSED, security pass 2026-08-13 (ADS-memory/reports/security/2026-08-13-post-session-security-pass.md,
// Finding 2 -- fixed same day). The tenant-isolation guarantee above used to hold only when every
// caller derived `layout` via `instanceLayout.forWorkspace({ workspaceId: workspaceId })` and never mixed the results
// of two different calls. `AgentPluginWorkspaceLayout` (layout.ts) was a plain interface of four
// string/function fields with no `workspaceId` tag and no back-reference to the instance root it came
// from -- `installAgentPlugin` never re-derived or re-validated `layout` against any expected
// workspace. The two tests below USED TO prove that gap (a hand-stitched layout mixing two real
// workspaces' own directories; a layout never derived from `forWorkspace` at all) -- both installed
// with no error, into the wrong tree, exactly as the original PROVEN GAP test names below still say
// in this section's git history.
//
// THE FIX (`install.ts`): `installAgentPlugin` no longer accepts a pre-resolved
// `AgentPluginWorkspaceLayout` as an input at all. It takes the INSTANCE-level `AgentPluginLayout`
// plus one `workspaceId` string, and calls `layout.forWorkspace({ workspaceId: workspaceId })` itself, exactly once,
// internally -- there is no longer any workspace-shaped parameter here for a caller to stitch
// together. The two tests below are DELIBERATELY REWRITTEN, not deleted or silently renamed, to prove
// the hole is closed rather than merely retired: each keeps the IDENTICAL hostile object literal from
// the original exploit (so this is still evidence against the same attack, not a weaker substitute),
// and proves it now fails two independent ways:
//   1. Honest TypeScript usage cannot even construct the call anymore -- verified with
//      `@ts-expect-error` on a synchronous, side-effect-free type check (never calls
//      `installAgentPlugin`, so there is no runtime behavior riding on this half of the proof; this is
//      confirmed for real by `npx tsc --noEmit`, not merely asserted by a comment).
//   2. Even a caller who defeats the type system with an explicit cast (the realistic worst case:
//      transpiled/loosely-typed JS, or a deliberate `as unknown as`) gets a hard runtime `TypeError`
//      instead of silent cross-workspace publication, because the hostile object has no
//      `forWorkspace` method for `installAgentPlugin`'s first line to call -- this is what actually
//      protects a workspace's data if the type system is bypassed, not merely "the honest path is
//      inconvenient."
//
// Explicitly NOT claimed closed: a caller could still hand `installAgentPlugin` a fully-fabricated
// `AgentPluginLayout` whose OWN `forWorkspace` implementation is malicious (returns mismatched paths
// on purpose). That is no longer "stitching two real, already-resolved values together" (the
// demonstrated bug class this fix targets -- wrong variable capture, a stale cached layout,
// hand-assembly for convenience) but "reimplementing the trusted resolver itself," a materially more
// deliberate act -- the same residual trust every caller-supplied port in this module already carries
// (`archiveReader` is equally free to lie about archive contents). Recorded here rather than silently
// assumed away.
// ---------------------------------------------------------------------------

test("CLOSED: a layout literal stitching workspace A's `packages` onto workspace B's `staging` is now a compile-time type error, and a cast-bypassed call fails at runtime instead of publishing into the wrong tree", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "host-agent-plugin-install-test-"));
  try {
    const instanceLayout = resolveAgentPluginLayout({ cwd, env: {} });
    const workspaceA = instanceLayout.forWorkspace({ workspaceId: "11111111-1111-4111-8111-111111111111" });
    const workspaceB = instanceLayout.forWorkspace({ workspaceId: "22222222-2222-4222-8222-222222222222" });

    // The IDENTICAL hostile object from the original gap this test used to prove -- unchanged, so
    // what follows is still proof against the SAME exploit attempt, not a weaker substitute.
    const confusedLayout = {
      root: workspaceA.root,
      packages: workspaceB.packages, // <- workspace B's real package tree
      staging: workspaceB.staging, // <- workspace B's real staging tree
      pluginDataDir: workspaceA.pluginDataDir,
    };

    const archive = new Uint8Array(Buffer.from("archive-bytes-confused-layout"));
    const digest = createHash("sha256").update(archive).digest("hex");

    // Proof 1 (compile-time): `confusedLayout` is not assignable to `InstallAgentPluginRequired["layout"]`
    // anymore (it has no `forWorkspace` method), and `workspaceId` is a required field that's simply
    // absent here. This never calls `installAgentPlugin` -- it only constructs (and immediately
    // discards) a same-shaped argument object, purely so `@ts-expect-error` has something concrete to
    // check. If `install.ts`'s signature ever regressed back to accepting a bare workspace layout,
    // this line would stop producing a type error and `tsc --noEmit` would fail on the now-unused
    // `@ts-expect-error` directive itself -- the proof is self-checking, not just a comment.
    void ((): InstallAgentPluginRequired => ({
      archive,
      expectedSha256: digest,
      archiveReader: reader(validPackageEntries()),
      // @ts-expect-error -- confusedLayout has no forWorkspace method; workspaceId is also missing entirely
      layout: confusedLayout,
    }))();

    // Proof 2 (runtime): the realistic worst case is a caller who bypasses the type system entirely.
    // Even then, `confusedLayout` has no `forWorkspace` method -- `installAgentPlugin`'s very first
    // line now calls `layout.forWorkspace({ workspaceId: workspaceId })`, which throws immediately, before any digest
    // check, mkdir, or extraction happens.
    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: reader(validPackageEntries()),
          layout: confusedLayout as unknown as AgentPluginLayout,
          workspaceId: "11111111-1111-4111-8111-111111111111",
        }),
      /forWorkspace is not a function/,
    );

    // And the bytes genuinely never landed anywhere -- neither workspace's tree gained a package.
    assert.deepEqual(await readdir(workspaceA.packages).catch(() => []), []);
    assert.deepEqual(await readdir(workspaceB.packages).catch(() => []), []);
  } finally {
    await forceRemove(cwd);
  }
});

test("CLOSED: a layout never derived from forWorkspace() at all -- arbitrary strings -- is now a compile-time type error, and a cast-bypassed call fails at runtime instead of extracting outside the agent-plugins tree", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "host-agent-plugin-install-test-"));
  try {
    // A location that has nothing to do with `<site>/agent-plugins`, `resolveAgentPluginLayout`, or
    // any workspace id at all -- the IDENTICAL hostile shape from the original gap this test used to
    // prove.
    const rogueRoot = path.join(cwd, "somewhere-else-entirely");

    const rogueLayout = {
      root: rogueRoot,
      packages: path.join(rogueRoot, "packages", "sha256"),
      staging: path.join(rogueRoot, "staging"),
      pluginDataDir: (pluginId: string) => path.join(rogueRoot, "data", pluginId),
    };

    const archive = new Uint8Array(Buffer.from("archive-bytes-rogue-layout"));
    const digest = createHash("sha256").update(archive).digest("hex");

    // Proof 1 (compile-time): same shape as the test above -- no `forWorkspace`, no `workspaceId`.
    void ((): InstallAgentPluginRequired => ({
      archive,
      expectedSha256: digest,
      archiveReader: reader(validPackageEntries()),
      // @ts-expect-error -- rogueLayout has no forWorkspace method; workspaceId is also missing entirely
      layout: rogueLayout,
    }))();

    // Proof 2 (runtime): cast-bypassed, exactly like the test above -- `rogueLayout` has no
    // `forWorkspace` either, so the failure mode is identical regardless of whether the hostile
    // object claims to be "two real workspaces confused" or "not a workspace at all."
    await assert.rejects(
      () =>
        installAgentPlugin({
          archive,
          expectedSha256: digest,
          archiveReader: reader(validPackageEntries()),
          layout: rogueLayout as unknown as AgentPluginLayout,
          workspaceId: "11111111-1111-4111-8111-111111111111",
        }),
      /forWorkspace is not a function/,
    );

    // No bytes were written outside the agent-plugins tree at all -- `rogueRoot` was never created.
    await assert.rejects(() => stat(rogueRoot));
  } finally {
    await forceRemove(cwd);
  }
});
