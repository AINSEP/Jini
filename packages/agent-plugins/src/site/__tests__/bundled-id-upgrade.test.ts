import assert from "node:assert/strict";
import { test } from "vitest";

import { restoreUnseededUpgrades, upgradeRenamedBundledPlugins, type BundledIdUpgradePort, type InstalledRevision } from "../bundled-id-upgrade.js";

/**
 * @file The publisher-ID upgrade's decisions over injected ports: what it refuses to move and how it
 * puts a moved copy back. The rename map and the held-reason wording are host-injected.
 */

const RENAMED = new Map([["alpha", { from: "old-pub/alpha", to: "new-pub/alpha" }]]);
const LEDGER_REASON = "host wording: not installed by the host's own build";
const REVISION: InstalledRevision = { pluginId: "alpha", id: "old-pub/alpha", archiveDigest: "a".repeat(64), packageRoot: "/ws/alpha/package/sha256/aaa" };

/** A port over fixed answers that records every rename instead of touching a disk. */
function fakePort({ ledgerDigest = REVISION.archiveDigest, sourceId = "new-pub/alpha", repackDigest = REVISION.archiveDigest, revision = REVISION, renames = [] as string[][] } = {}): BundledIdUpgradePort {
  return {
    listInstalledPlugins: async () => [revision],
    readBundledAgentPluginDigests: async () => new Map([["alpha", ledgerDigest]]),
    packAgentPluginDirectory: async () => ({ sha256: repackDigest }),
    readBundledSourceManifest: async () => JSON.stringify({ extensions: { jini: { id: sourceId } } }),
    filesystem: {
      stat: (async () => ({ mode: 0o40555 })) as unknown as BundledIdUpgradePort["filesystem"]["stat"],
      mkdir: (async () => undefined) as BundledIdUpgradePort["filesystem"]["mkdir"],
      chmod: async () => undefined,
      rename: async (from, to) => { renames.push([String(from), String(to)]); },
    },
  };
}

const upgrade = (port: BundledIdUpgradePort) => upgradeRenamedBundledPlugins({ workspaceRoot: "/ws", port, renamed: RENAMED, ledgerMismatchReason: LEDGER_REASON });

test("a revision the ledger does not name is held with the INJECTED wording, never moved", async () => {
  const renames: string[][] = [];
  assert.deepEqual(await upgrade(fakePort({ ledgerDigest: "b".repeat(64), renames })),
    [{ status: "held", pluginId: "alpha", to: "new-pub/alpha", reason: LEDGER_REASON }]);
  assert.deepEqual(renames, []);
});

test("a revision published under another id is held and not moved", async () => {
  const renames: string[][] = [];
  const outcomes = await upgrade(fakePort({ revision: { ...REVISION, id: "other/alpha" }, renames }));
  assert.deepEqual(outcomes, [{ status: "held", pluginId: "alpha", to: "new-pub/alpha", reason: "its installed copy is published as 'other/alpha', not 'old-pub/alpha'" }]);
  assert.deepEqual(renames, []);
});

test("a revision edited after install (re-pack differs) is held and not moved", async () => {
  const renames: string[][] = [];
  const outcomes = await upgrade(fakePort({ repackDigest: "c".repeat(64), renames }));
  assert.deepEqual(outcomes, [{ status: "held", pluginId: "alpha", to: "new-pub/alpha", reason: "its installed files were changed after install" }]);
  assert.deepEqual(renames, []);
});

test("nothing moves when this build does not ship the canonical package", async () => {
  const renames: string[][] = [];
  assert.deepEqual(await upgrade(fakePort({ sourceId: "old-pub/alpha", renames })), []);
  assert.deepEqual(renames, []);
});

test("an already-upgraded site yields no outcomes and never reads the ledger", async () => {
  const port = { ...fakePort({ revision: { ...REVISION, id: "new-pub/alpha" } }), readBundledAgentPluginDigests: async () => { throw new Error("must not read"); } };
  assert.deepEqual(await upgrade(port), []);
});

test("a moved copy whose replacement did not seed is put back and reported as restored", async () => {
  const renames: string[][] = [];
  const port = fakePort({ renames });
  const upgrades = await upgrade(port);
  const savedAt = `/ws/.bundled-id-upgrade/alpha/${REVISION.archiveDigest}`;
  assert.deepEqual(upgrades, [{ status: "upgraded", pluginId: "alpha", to: "new-pub/alpha", moved: [{ packageRoot: REVISION.packageRoot, savedAt }] }]);
  const restored = await restoreUnseededUpgrades({ outcomes: upgrades, seededIds: new Set(), filesystem: port.filesystem });
  assert.equal(restored[0]?.status, "restored");
  assert.deepEqual(renames, [[REVISION.packageRoot, savedAt], [savedAt, REVISION.packageRoot]]);
  assert.deepEqual(await restoreUnseededUpgrades({ outcomes: upgrades, seededIds: new Set(["alpha"]), filesystem: port.filesystem }), upgrades);
});
