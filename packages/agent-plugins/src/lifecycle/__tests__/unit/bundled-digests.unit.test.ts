import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "../legacy-test.js";

import { forceRemove } from "../fixtures/force-remove.js";
import { setAgentPluginActivation } from "../test-support.js";

import { normalizeBundledDigests, preferBundledAgentPluginDigests, readBundledAgentPluginDigests, recordBundledAgentPluginDigests } from "../test-support.js";
import { BUNDLED_DIGESTS_FILENAME } from "../../bundled-digests.js";
import { installAgentPlugin } from "../test-support.js";
import { type AgentPluginArchiveEntry, type AgentPluginArchiveReaderPort } from "../../install.js";
import { resolveAgentPluginLayout } from "../test-support.js";

import { resolveAgentPluginRefs } from "../test-support.js";

import { loadFixturePluginSources as loadInstalledAgentPluginToolSources } from "../test-support.js";

/**
 * @file `bundled-digests.ts` — the ledger that lets a bundled plugin's UPGRADE resolve to the digest
 * the running build published, instead of being refused as ambiguous.
 *
 * The cases that matter most here are the ones where the ledger must NOT decide anything. Its whole
 * justification is that it replaces a guess with the build's own recorded answer; a ledger that
 * narrowed an id it has no authority over would be exactly the "silently picking one" failure mode
 * `resolve-agent-plugin-refs.ts`'s header rules out. So: no entry, an entry naming a digest that is
 * not installed, and an unreadable file all have to leave the existing ambiguity refusal standing,
 * and each is asserted below against the REAL surfaces rather than only against the pure selector.
 */

const WORKSPACE_ID = "55555555-5555-4555-8555-555555555555";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);

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

/** A temp instance root exported through `PLUGIN_ROOT`, because
 *  `loadInstalledAgentPluginToolSources` resolves its own layout from the environment rather than
 *  taking one. */
async function withWorkspace<T>(fn: (context: { readonly cwd: string; readonly workspaceRoot: string }) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "host-bundled-digests-"));
  const previous = process.env.PLUGIN_ROOT;
  process.env.PLUGIN_ROOT = dir;
  try {
    return await fn({ cwd: dir, workspaceRoot: resolveAgentPluginLayout().forWorkspace({ workspaceId: WORKSPACE_ID }).root });
  } finally {
    if (previous === undefined) delete process.env.PLUGIN_ROOT;
    else process.env.PLUGIN_ROOT = previous;
    await forceRemove(dir);
  }
}

/** Installs one real package through the production pipeline, keyed to a unique archive so a second
 *  call for the same `pluginId` produces a genuinely different digest. */
async function installRealPackage(pluginId: string, skillMarkdown: string, archiveSeed: string) {
  const archive = new Uint8Array(Buffer.from(archiveSeed));
  return installAgentPlugin({
    archive,
    expectedSha256: createHash("sha256").update(archive).digest("hex"),
    archiveReader: reader([
      fileEntry("plugin.json", JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: pluginId, version: "1.0.0" })),
      fileEntry(`skills/${pluginId}/SKILL.md`, skillMarkdown),
    ]),
    layout: resolveAgentPluginLayout(),
    workspaceId: WORKSPACE_ID,
  });
}

test("normalizeBundledDigests keeps only well-formed entries and rejects a foreign envelope", () => {
  assert.deepEqual([...normalizeBundledDigests({ schemaVersion: 1, plugins: { github: { archiveDigest: DIGEST_A } } })], [["github", DIGEST_A]]);
  assert.deepEqual([...normalizeBundledDigests({ schemaVersion: 2, plugins: { github: { archiveDigest: DIGEST_A } } })], []);
  assert.deepEqual([...normalizeBundledDigests({ plugins: { github: { archiveDigest: DIGEST_A } } })], []);
  assert.deepEqual([...normalizeBundledDigests("not a document")], []);
  assert.deepEqual(
    [...normalizeBundledDigests({ schemaVersion: 1, plugins: { github: { archiveDigest: "not-a-digest" }, supabase: { archiveDigest: DIGEST_B } } })],
    [["supabase", DIGEST_B]],
    "one malformed entry must not discard its well-formed siblings",
  );
});

test("preferBundledAgentPluginDigests narrows ONLY an id the ledger can speak for", () => {
  const installed = [
    { pluginId: "github", archiveDigest: DIGEST_A },
    { pluginId: "github", archiveDigest: DIGEST_B },
    { pluginId: "supabase", archiveDigest: DIGEST_C },
  ];

  assert.deepEqual(preferBundledAgentPluginDigests(installed, new Map()), installed, "no ledger: every candidate survives, so the caller still refuses");
  assert.deepEqual(
    preferBundledAgentPluginDigests(installed, new Map([["github", DIGEST_C]])),
    installed,
    "a ledger naming a digest that is NOT one of the candidates decides nothing",
  );
  assert.deepEqual(
    preferBundledAgentPluginDigests(installed, new Map([["supabase", DIGEST_C]])),
    installed,
    "a single-digest id is already unambiguous and is never filtered",
  );
  assert.deepEqual(preferBundledAgentPluginDigests(installed, new Map([["github", DIGEST_B]])), [
    { pluginId: "github", archiveDigest: DIGEST_B },
    { pluginId: "supabase", archiveDigest: DIGEST_C },
  ]);
});

test("recordBundledAgentPluginDigests merges over earlier boots and refuses a self-contradictory build", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "host-bundled-digests-record-"));
  try {
    await recordBundledAgentPluginDigests({
      workspaceRoot: dir,
      seeded: [
        { pluginId: "github", archiveDigest: DIGEST_A },
        { pluginId: "supabase", archiveDigest: DIGEST_B },
      ],
    });

    // A later boot that seeded only github — supabase failed, or was dropped from this build's
    // source root — must not cost supabase the entry the earlier boot recorded.
    await recordBundledAgentPluginDigests({ workspaceRoot: dir, seeded: [{ pluginId: "github", archiveDigest: DIGEST_C }] });
    assert.deepEqual(
      [...(await readBundledAgentPluginDigests(dir))].sort(),
      [
        ["github", DIGEST_C],
        ["supabase", DIGEST_B],
      ].sort(),
    );

    // Two bundled source directories declaring the same manifest name under different content: the
    // BUILD is ambiguous, so there is nothing authoritative to record and the prior entry goes too.
    await recordBundledAgentPluginDigests({
      workspaceRoot: dir,
      seeded: [
        { pluginId: "github", archiveDigest: DIGEST_A },
        { pluginId: "github", archiveDigest: DIGEST_B },
      ],
    });
    assert.deepEqual([...(await readBundledAgentPluginDigests(dir))], [["supabase", DIGEST_B]]);

    const onDisk = JSON.parse(await readFile(path.join(dir, BUNDLED_DIGESTS_FILENAME), "utf8"));
    assert.equal(onDisk.schemaVersion, 1, "the file must stay a schemaVersion 1 document");
  } finally {
    await forceRemove(dir);
  }
});

test("a boot that seeded nothing writes no ledger at all", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "host-bundled-digests-empty-"));
  try {
    await recordBundledAgentPluginDigests({ workspaceRoot: path.join(dir, "never-created"), seeded: [] });
    assert.deepEqual([...(await readBundledAgentPluginDigests(path.join(dir, "never-created")))], []);
  } finally {
    await forceRemove(dir);
  }
});

test("an OPERATOR-installed plugin under two digests is still refused — the ledger has no say over it", async () => {
  await withWorkspace(async () => {
    const first = await installRealPackage("ui-ux-design", "# Variant A\n", "operator-archive-a");
    const second = await installRealPackage("ui-ux-design", "# Variant B\n", "operator-archive-b");
    const sorted = [first.archiveDigest, second.archiveDigest].sort();

    const layout = resolveAgentPluginLayout().forWorkspace({ workspaceId: WORKSPACE_ID });
    assert.deepEqual(await resolveAgentPluginRefs(["ui-ux-design"], layout), {
      ok: false,
      reason: `Agent Plugin 'ui-ux-design' matches 2 installed packages (digests: ${sorted.join(", ")}) — refusing to guess which one to use`,
    });
    assert.deepEqual(
      (await loadInstalledAgentPluginToolSources({ workspaceId: WORKSPACE_ID })).filter((source) => source.pluginId === "ui-ux-design"),
      [],
      "an ambiguous operator install must still be excluded from tool registration",
    );
  });
});

test("a ledger naming a digest this workspace does not have leaves the ambiguity refusal standing", async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const first = await installRealPackage("ui-ux-design", "# Variant A\n", "absent-ledger-a");
    const second = await installRealPackage("ui-ux-design", "# Variant B\n", "absent-ledger-b");
    const sorted = [first.archiveDigest, second.archiveDigest].sort();

    await recordBundledAgentPluginDigests({ workspaceRoot, seeded: [{ pluginId: "ui-ux-design", archiveDigest: DIGEST_A }] });

    const layout = resolveAgentPluginLayout().forWorkspace({ workspaceId: WORKSPACE_ID });
    assert.deepEqual(await resolveAgentPluginRefs(["ui-ux-design"], layout), {
      ok: false,
      reason: `Agent Plugin 'ui-ux-design' matches 2 installed packages (digests: ${sorted.join(", ")}) — refusing to guess which one to use`,
    });
  });
});

test("an UNREADABLE ledger reads as empty, so the ambiguity refusal still fires", async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const first = await installRealPackage("ui-ux-design", "# Variant A\n", "corrupt-ledger-a");
    const second = await installRealPackage("ui-ux-design", "# Variant B\n", "corrupt-ledger-b");
    const sorted = [first.archiveDigest, second.archiveDigest].sort();

    await writeFile(path.join(workspaceRoot, BUNDLED_DIGESTS_FILENAME), "{ this is not json", "utf8");
    assert.deepEqual([...(await readBundledAgentPluginDigests(workspaceRoot))], []);

    const layout = resolveAgentPluginLayout().forWorkspace({ workspaceId: WORKSPACE_ID });
    assert.deepEqual(await resolveAgentPluginRefs(["ui-ux-design"], layout), {
      ok: false,
      reason: `Agent Plugin 'ui-ux-design' matches 2 installed packages (digests: ${sorted.join(", ")}) — refusing to guess which one to use`,
    });
  });
});

test("a DISABLED plugin under two digests stays harmless — the activation gate answers first", async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    await installRealPackage("ui-ux-design", "# Variant A\n", "disabled-ambiguous-a");
    await installRealPackage("ui-ux-design", "# Variant B\n", "disabled-ambiguous-b");
    await setAgentPluginActivation({ workspaceRoot, pluginId: "ui-ux-design", enabled: false, actor: "operator:test" });

    const layout = resolveAgentPluginLayout().forWorkspace({ workspaceId: WORKSPACE_ID });
    const injected = await resolveAgentPluginRefs(["ui-ux-design"], layout);
    assert.ok(injected.ok === false && injected.reason.includes("is installed in this workspace but is not enabled"));
    assert.deepEqual(await loadInstalledAgentPluginToolSources({ workspaceId: WORKSPACE_ID }), []);
  });
});

test("a first-ever install resolves exactly as before, ledger or no ledger", async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const only = await installRealPackage("ui-ux-design", "# Only one\n\nUse an 8px spacing grid.\n", "first-install-a");

    const layout = resolveAgentPluginLayout().forWorkspace({ workspaceId: WORKSPACE_ID });
    const withoutLedger = await resolveAgentPluginRefs(["ui-ux-design"], layout);
    assert.ok(withoutLedger.ok && withoutLedger.promptPrefix.includes("Use an 8px spacing grid."));

    await recordBundledAgentPluginDigests({ workspaceRoot, seeded: [{ pluginId: "ui-ux-design", archiveDigest: only.archiveDigest }] });
    const withLedger = await resolveAgentPluginRefs(["ui-ux-design"], layout);
    assert.deepEqual(withLedger, withoutLedger, "a ledger for an already-unambiguous id must change nothing at all");
  });
});

test("the bundled ledger selects one upgrade's content on both real resolution surfaces", async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const oldMarkdown = "# Old bundled guidance\n\nUse the obsolete variant.\n";
    const newMarkdown = "# Current bundled guidance\n\nUse the published variant.\n";
    const old = await installRealPackage("ui-ux-design", oldMarkdown, "bundled-upgrade-old");
    const published = await installRealPackage("ui-ux-design", newMarkdown, "bundled-upgrade-published");
    assert.notEqual(old.archiveDigest, published.archiveDigest);
    await recordBundledAgentPluginDigests({ workspaceRoot, seeded: [{ pluginId: "ui-ux-design", archiveDigest: published.archiveDigest }] });

    const resolved = await resolveAgentPluginRefs(["ui-ux-design"], resolveAgentPluginLayout().forWorkspace({ workspaceId: WORKSPACE_ID }));
    assert.equal(resolved.ok, true, JSON.stringify(resolved));
    assert.ok(resolved.promptPrefix.includes(newMarkdown));
    assert.equal(resolved.promptPrefix.includes(oldMarkdown), false);

    const sources = (await loadInstalledAgentPluginToolSources({ workspaceId: WORKSPACE_ID })).filter((source) => source.pluginId === "ui-ux-design");
    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.archiveDigest, published.archiveDigest);
    assert.deepEqual(sources[0]?.skills.map((skill) => skill.markdown), [newMarkdown]);
  });
});
