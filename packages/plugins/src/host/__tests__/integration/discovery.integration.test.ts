import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { loadPlugin } from "../support/loader.js";
import { discoverPlugins, siteEntryPath } from "../support/discovery.js";
import type { PluginManifest } from "../support/manifest.js";
import { buildAc11FixtureInstallDir, WORD_COUNT_BUILT_IN } from "../fixtures/ac11-fixture.js";

/**
 * @file C-007 `discoverPlugins()` — SPEC-005 REQ-02/03, AC-09, AC-11, AC-16, EC-08/EC-09, TB-01,
 * DUP-01.
 *
 * TDD-certified against the stub in `../../discovery.ts`; currently RED — `discoverPlugins` throws
 * "not implemented". These assertions describe the contract the Programmer stage must satisfy.
 */

test("AC-11/REQ-10 (RT-009 fixture): built-in word-count + one valid + one invalid site plugin all appear with correct source/status", async () => {
  const { installDir, builtIns } = await buildAc11FixtureInstallDir();
  try {
    const records = await discoverPlugins({ installDir, builtIns });

    assert.equal(records.length, 3);
    const byId = new Map(records.map((r) => [r.id, r]));

    assert.equal(byId.get("word-count")?.source, "built-in");
    assert.equal(byId.get("word-count")?.status, "valid");
    assert.deepEqual(byId.get("word-count")?.errors, []);

    assert.equal(byId.get("valid-site-plugin")?.source, "site");
    assert.equal(
      byId.get("valid-site-plugin")?.status,
      "valid",
      "the tier-fixed (RT-009) valid site plugin must not spuriously become invalid"
    );
    assert.deepEqual(byId.get("valid-site-plugin")?.errors, []);

    assert.equal(byId.get("invalid-site-plugin")?.source, "site");
    assert.equal(byId.get("invalid-site-plugin")?.status, "invalid");
    assert.ok(byId.get("invalid-site-plugin")?.errors.some((e) => e.code === "HOOK_UNKNOWN"));
  } finally {
    await rm(installDir, { recursive: true, force: true });
  }
});

test("TB-01: PLUGINS_LIST ordering is built-ins first by id ascending, then site plugins by id ascending", async () => {
  const { installDir, builtIns } = await buildAc11FixtureInstallDir();
  try {
    const records = await discoverPlugins({ installDir, builtIns });
    assert.deepEqual(
      records.map((r) => `${r.source}:${r.id}`),
      ["built-in:word-count", "site:invalid-site-plugin", "site:valid-site-plugin"]
    );
  } finally {
    await rm(installDir, { recursive: true, force: true });
  }
});

test("EC-09/AC-16: legacy mode (no install dir) discovers built-ins only; word-count is still listed and enableable", async () => {
  const records = await discoverPlugins({ builtIns: [WORD_COUNT_BUILT_IN] });
  assert.equal(records.length, 1);
  const record = records[0];
  assert.ok(record);
  assert.equal(record.id, "word-count");
  assert.equal(record.source, "built-in");
  assert.equal(record.status, "valid");
});

test("AC-09/EC-08: when two installed versions of one site plugin id exist, only the latest by semver is included, the other stays dormant", async () => {
  const { installDir, builtIns } = await buildAc11FixtureInstallDir();
  try {
    for (const version of ["0.9.0", "1.9.0", "1.10.0-rc.1", "1.10.0"]) {
      const versionDir = path.join(installDir, "valid-site-plugin", version);
      await mkdir(path.join(versionDir, "server"), { recursive: true });
      const entry = `export default { definition: { setup(sdk) { sdk.content.extend("marker", "${version}"); } } };\n`;
      await writeFile(path.join(versionDir, "tovu.plugin.json"), JSON.stringify({
        id: "valid-site-plugin", name: "Valid Site Plugin", version,
        sdkRange: "^0.1.0 || ^0.2.0", engine: 1, tier: "tier-3",
        capabilities: ["content.extend"], hooks: [],
        fields: [{ path: "ext.valid-site-plugin.marker", type: "string", queryable: false }],
        integrity: { "server/index.mjs": `sha256-${createHash("sha256").update(entry).digest("hex")}` },
      }), "utf8");
      await writeFile(path.join(versionDir, "server", "index.mjs"), entry, "utf8");
    }

    const records = await discoverPlugins({ installDir, builtIns });
    const matches = records.filter((r) => r.id === "valid-site-plugin");

    assert.equal(matches.length, 1, "only one record per plugin id — the older dormant install must not appear as a second row");
    const record = matches[0];
    assert.ok(record);
    assert.equal(record.version, "1.10.0", "semver must beat lexical ordering and prefer a release over its prerelease");
    assert.equal(record.status, "valid");
    assert.equal(record.manifest?.version, "1.10.0");
    assert.ok(record.manifest);
    const writes: [string, string | number | boolean][] = [];
    const loaded = await loadPlugin({
      record,
      manifest: record.manifest,
      entryPath: siteEntryPath(installDir, record.id, record.version),
      coreDeps: {
        getCurrentEntry: () => assert.fail("this setup only writes a marker"),
        writeExtField: (field, value) => { writes.push([field, value]); },
        attachFilter: () => assert.fail("this fixture has no filter"),
      },
    });
    assert.equal(loaded.loaded, true);
    assert.deepEqual(writes, [["marker", "1.10.0"]], "the winning version's actual server entry must be loaded");
  } finally {
    await rm(installDir, { recursive: true, force: true });
  }
});

test("DUP-01: two site plugins with case-insensitively matching ids are BOTH marked ID_DUPLICATE", async () => {
  const { installDir, builtIns } = await buildAc11FixtureInstallDir();
  try {
    // Distinct physical folder names work on both case-sensitive and case-insensitive disks.
    // The duplicate also violates EC-01; DUP-01 must still annotate both colliding records.
    const duplicateId = "Valid-Site-Plugin";
    const duplicateFolder = "duplicate-site-plugin";
    const versionDir = path.join(installDir, duplicateFolder, "1.0.0");
    await mkdir(path.join(versionDir, "server"), { recursive: true });
    await writeFile(path.join(versionDir, "tovu.plugin.json"), JSON.stringify({
      id: duplicateId, name: "Duplicate", version: "1.0.0", sdkRange: "^1.0.0",
      engine: 1, tier: "tier-3", capabilities: [], hooks: [], fields: [], integrity: {},
    }), "utf8");
    await writeFile(path.join(versionDir, "server", "index.mjs"), "export default {};\n", "utf8");

    const records = await discoverPlugins({ installDir, builtIns });
    const collisions = records.filter((r) => r.id.toLowerCase() === "valid-site-plugin");

    assert.deepEqual(
      collisions.map(({ id, version, source }) => ({ id, version, source })).sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: "valid-site-plugin", version: "1.0.0", source: "site" },
        { id: "Valid-Site-Plugin", version: "1.0.0", source: "site" },
      ].sort((a, b) => a.id.localeCompare(b.id))
    );
    assert.deepEqual(
      records.filter((record) => record.errors.some((error) => error.code === "ID_DUPLICATE")).map((record) => record.id).sort(),
      ["valid-site-plugin", "Valid-Site-Plugin"].sort()
    );
    const duplicate = collisions.find((record) => record.id === duplicateId)!;
    assert.equal(duplicate.name, "Duplicate");
    assert.ok(duplicate.errors.some((error) => error.code === "ID_FOLDER_MISMATCH" && error.message.includes(duplicateFolder)));
    assert.equal(records.find((record) => record.id === "word-count")?.status, "valid");
    assert.deepEqual(records.find((record) => record.id === "invalid-site-plugin")?.errors.map((error) => error.code), ["HOOK_UNKNOWN"]);
    for (const record of collisions) {
      assert.ok(
        record.errors.some((e) => e.code === "ID_DUPLICATE"),
        `record ${record.id} must carry ID_DUPLICATE — site-vs-site collisions mark BOTH (DUP-01)`
      );
    }
  } finally {
    await rm(installDir, { recursive: true, force: true });
  }
});

test("DUP-01: a site plugin id equal to a built-in id marks the site record SHADOWS_BUILT_IN and leaves the built-in unaffected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tovu-plugin-shadow-"));
  const versionDir = path.join(root, "plugins", "word-count", "1.0.0", "server");
  try {
    await mkdir(versionDir, { recursive: true });
    await writeFile(
      path.join(root, "plugins", "word-count", "1.0.0", "tovu.plugin.json"),
      JSON.stringify({
        id: "word-count",
        name: "Shadowing Word Count",
        version: "1.0.0",
        sdkRange: "^1.0.0",
        engine: 1,
        tier: "tier-3",
        capabilities: [],
        hooks: [],
        fields: [],
        integrity: {},
      }),
      "utf8"
    );
    await writeFile(path.join(versionDir, "index.mjs"), "export default {};\n", "utf8");

    const records = await discoverPlugins({ installDir: path.join(root, "plugins"), builtIns: [WORD_COUNT_BUILT_IN] });
    const builtIn = records.find((r) => r.source === "built-in" && r.id === "word-count");
    const site = records.find((r) => r.source === "site" && r.id === "word-count");

    assert.equal(builtIn?.status, "valid", "the built-in must be entirely unaffected by a shadowing site plugin");
    assert.ok(site?.errors.some((e) => e.code === "SHADOWS_BUILT_IN"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a site package declaring tier-2 is invalid (the installer's trust rule), so enable and boot never load it; a built-in tier-2 stays valid", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tovu-plugin-tier2-site-"));
  const versionDir = path.join(root, "plugins", "sideloaded-t2", "1.0.0");
  const manifest = {
    id: "sideloaded-t2", name: "Sideloaded Tier 2", version: "1.0.0", sdkRange: "^0.1.0 || ^0.2.0", engine: 1,
    tier: "tier-2", capabilities: ["hooks.attach"], hooks: [], fields: [], integrity: {},
  } satisfies PluginManifest;
  try {
    await mkdir(path.join(versionDir, "server"), { recursive: true });
    await writeFile(path.join(versionDir, "tovu.plugin.json"), JSON.stringify(manifest), "utf8");
    await writeFile(path.join(versionDir, "server", "index.mjs"), "export default {};\n", "utf8");
    const builtInTier2 = { manifest: { ...manifest, id: "built-in-t2", name: "Built-in Tier 2" } } as const;

    const records = await discoverPlugins({ installDir: path.join(root, "plugins"), builtIns: [builtInTier2] });
    const site = records.find((r) => r.id === "sideloaded-t2");

    assert.equal(site?.status, "invalid");
    assert.equal(site?.manifest, undefined, "an invalid record carries no manifest for the loader");
    assert.deepEqual(site?.errors, [{
      code: "TIER_NOT_ALLOWED",
      file: "tovu.plugin.json",
      message: "A site-installed plugin cannot declare tier-2: tier-2 is for verified publishers and needs a sandbox that does not exist yet. Declare tier-3 (unverified publisher).",
    }]);
    assert.equal(records.find((r) => r.id === "built-in-t2")?.status, "valid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
